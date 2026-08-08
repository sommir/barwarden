use crate::autofill_contract::{
    AgentCommandOutcome, AgentErrorCode, AgentOperation, AgentRequest, AgentResponse,
    AgentResponseStatus, AGENT_PROTOCOL_VERSION,
};
use std::io::{ErrorKind, Read, Write};
use std::os::unix::net::UnixStream;
use std::path::{Path, PathBuf};
use std::time::Duration;
use zeroize::Zeroizing;

pub const MAXIMUM_PAYLOAD_BYTES: usize = 65_536;
const DEFAULT_TIMEOUT: Duration = Duration::from_secs(2);
const APP_GROUP_IDENTIFIER: &str = "group.com.sommir.barwarden.autofill";
const SOCKET_FILENAME: &str = "agent-v1.sock";

pub struct AgentClient {
    socket_path: PathBuf,
    timeout: Duration,
}

impl AgentClient {
    pub const NONCE_BYTES: usize = 32;

    pub fn new(socket_path: PathBuf, timeout: Duration) -> Self {
        Self {
            socket_path,
            timeout,
        }
    }

    pub fn system_default() -> Result<Self, AgentErrorCode> {
        Ok(Self::new(default_socket_path()?, DEFAULT_TIMEOUT))
    }

    pub fn perform(&self, operation: AgentOperation) -> Result<AgentResponse, AgentErrorCode> {
        self.perform_request(AgentRequest::new(operation))
    }

    pub fn perform_request(&self, request: AgentRequest) -> Result<AgentResponse, AgentErrorCode> {
        let mut stream =
            UnixStream::connect(&self.socket_path).map_err(|_| AgentErrorCode::Unavailable)?;
        stream
            .set_read_timeout(Some(self.timeout))
            .map_err(|_| AgentErrorCode::Transport)?;
        stream
            .set_write_timeout(Some(self.timeout))
            .map_err(|_| AgentErrorCode::Transport)?;

        let payload = Zeroizing::new(
            serde_json::to_vec(&request).map_err(|_| AgentErrorCode::MalformedRequest)?,
        );
        let frame = Zeroizing::new(encode_frame(&payload)?);
        let write_result = stream.write_all(&frame).map_err(map_io_error);
        write_result?;
        stream
            .shutdown(std::net::Shutdown::Write)
            .map_err(|_| AgentErrorCode::Transport)?;

        let response: AgentResponse = serde_json::from_slice(&read_frame(&mut stream)?)
            .map_err(|_| AgentErrorCode::MalformedRequest)?;
        if response.version != AGENT_PROTOCOL_VERSION {
            return Err(AgentErrorCode::UnsupportedVersion);
        }
        if response.status == AgentResponseStatus::Error {
            return Err(response.error.unwrap_or(AgentErrorCode::MalformedRequest));
        }
        let response_request_id = response
            .request_id
            .as_deref()
            .and_then(|value| uuid::Uuid::parse_str(value).ok());
        let request_id = uuid::Uuid::parse_str(&request.request_id).ok();
        if response.error.is_some()
            || response_request_id != request_id
            || response.nonce != request.nonce
        {
            return Err(AgentErrorCode::MalformedRequest);
        }
        Ok(response)
    }
}

pub fn encode_frame(payload: &[u8]) -> Result<Vec<u8>, AgentErrorCode> {
    if payload.len() > MAXIMUM_PAYLOAD_BYTES {
        return Err(AgentErrorCode::MessageTooLarge);
    }
    let mut frame = Vec::with_capacity(4 + payload.len());
    frame.extend_from_slice(&(payload.len() as u32).to_be_bytes());
    frame.extend_from_slice(payload);
    Ok(frame)
}

pub fn decode_frame(frame: &[u8]) -> Result<Vec<u8>, AgentErrorCode> {
    if frame.len() < 4 {
        return Err(AgentErrorCode::MalformedRequest);
    }
    let payload_length = u32::from_be_bytes(frame[..4].try_into().unwrap()) as usize;
    if payload_length > MAXIMUM_PAYLOAD_BYTES {
        return Err(AgentErrorCode::MessageTooLarge);
    }
    if frame.len() != payload_length + 4 {
        return Err(AgentErrorCode::MalformedRequest);
    }
    Ok(frame[4..].to_vec())
}

fn read_frame(stream: &mut UnixStream) -> Result<Vec<u8>, AgentErrorCode> {
    let mut header = [0_u8; 4];
    stream.read_exact(&mut header).map_err(map_io_error)?;
    let payload_length = u32::from_be_bytes(header) as usize;
    if payload_length > MAXIMUM_PAYLOAD_BYTES {
        return Err(AgentErrorCode::MessageTooLarge);
    }
    let mut payload = vec![0; payload_length];
    stream.read_exact(&mut payload).map_err(map_io_error)?;
    Ok(payload)
}

fn map_io_error(error: std::io::Error) -> AgentErrorCode {
    match error.kind() {
        ErrorKind::TimedOut | ErrorKind::WouldBlock => AgentErrorCode::Timeout,
        ErrorKind::UnexpectedEof | ErrorKind::InvalidData => AgentErrorCode::MalformedRequest,
        _ => AgentErrorCode::Transport,
    }
}

fn default_socket_path() -> Result<PathBuf, AgentErrorCode> {
    if cfg!(debug_assertions) {
        if let Some(path) = std::env::var_os("BARWARDEN_AUTOFILL_SOCKET") {
            let path = PathBuf::from(path);
            if path.is_absolute() {
                return Ok(path);
            }
        }
    }
    let home = std::env::var_os("HOME").ok_or(AgentErrorCode::Unavailable)?;
    Ok(Path::new(&home)
        .join("Library/Group Containers")
        .join(APP_GROUP_IDENTIFIER)
        .join(SOCKET_FILENAME))
}

fn perform_command(operation: AgentOperation) -> AgentCommandOutcome {
    AgentCommandOutcome::from_result(
        AgentClient::system_default().and_then(|client| client.perform(operation)),
    )
}

#[tauri::command]
pub fn autofill_agent_probe() -> AgentCommandOutcome {
    perform_command(AgentOperation::Probe)
}

#[tauri::command]
pub fn autofill_agent_status() -> AgentCommandOutcome {
    perform_command(AgentOperation::Status)
}

#[tauri::command]
pub fn autofill_agent_lock() -> AgentCommandOutcome {
    perform_command(AgentOperation::Lock)
}

#[cfg(test)]
mod tests {
    use super::{decode_frame, encode_frame, AgentClient, MAXIMUM_PAYLOAD_BYTES};
    use crate::autofill_contract::{
        AgentErrorCode, AgentOperation, AgentRequest, AgentResponse, AgentResponseStatus,
    };
    use std::fs;
    use std::io::{Read, Write};
    use std::os::unix::net::UnixListener;
    use std::path::PathBuf;
    use std::thread;
    use std::time::Duration;

    #[test]
    fn frame_rejects_payload_larger_than_64_kib() {
        assert_eq!(
            encode_frame(&vec![0; MAXIMUM_PAYLOAD_BYTES + 1]),
            Err(AgentErrorCode::MessageTooLarge)
        );
    }

    #[test]
    fn frame_rejects_oversized_declared_length() {
        assert_eq!(
            decode_frame(&[0x00, 0x01, 0x00, 0x01]),
            Err(AgentErrorCode::MessageTooLarge)
        );
    }

    #[test]
    fn client_sends_fresh_ids_and_nonces_and_requires_exact_echo() {
        let (socket_path, listener) = listener();
        let server = thread::spawn(move || {
            let mut observed = Vec::new();
            for stream in listener.incoming().take(2) {
                let mut stream = stream.unwrap();
                let request: AgentRequest = read_json_frame(&mut stream);
                let response = AgentResponse {
                    version: 1,
                    request_id: Some(request.request_id.clone()),
                    nonce: request.nonce.clone(),
                    status: AgentResponseStatus::Ok,
                    error: None,
                };
                stream
                    .write_all(&encode_frame(&serde_json::to_vec(&response).unwrap()).unwrap())
                    .unwrap();
                observed.push(request);
            }
            observed
        });
        let client = AgentClient::new(socket_path.clone(), Duration::from_secs(1));

        let first = client.perform(AgentOperation::Probe).unwrap();
        let second = client.perform(AgentOperation::Status).unwrap();
        let observed = server.join().unwrap();
        fs::remove_file(socket_path).unwrap();

        assert_eq!(first.nonce, observed[0].nonce);
        assert_eq!(second.nonce, observed[1].nonce);
        assert_ne!(observed[0].request_id, observed[1].request_id);
        assert_ne!(observed[0].nonce, observed[1].nonce);
        assert_eq!(observed[0].nonce.len(), AgentClient::NONCE_BYTES);
    }

    #[test]
    fn client_rejects_wrong_response_request_id() {
        let (socket_path, listener) = listener();
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let request: AgentRequest = read_json_frame(&mut stream);
            let response = AgentResponse {
                version: 1,
                request_id: Some("00000000-0000-4000-8000-000000000001".to_owned()),
                nonce: request.nonce.clone(),
                status: AgentResponseStatus::Ok,
                error: None,
            };
            stream
                .write_all(&encode_frame(&serde_json::to_vec(&response).unwrap()).unwrap())
                .unwrap();
        });
        let client = AgentClient::new(socket_path.clone(), Duration::from_secs(1));

        assert_eq!(
            client.perform(AgentOperation::Probe),
            Err(AgentErrorCode::MalformedRequest)
        );
        server.join().unwrap();
        fs::remove_file(socket_path).unwrap();
    }

    #[test]
    fn client_read_deadline_is_enforced() {
        let (socket_path, listener) = listener();
        let server = thread::spawn(move || {
            let (_stream, _) = listener.accept().unwrap();
            thread::sleep(Duration::from_millis(200));
        });
        let client = AgentClient::new(socket_path.clone(), Duration::from_millis(30));

        assert_eq!(
            client.perform(AgentOperation::Probe),
            Err(AgentErrorCode::Timeout)
        );
        server.join().unwrap();
        fs::remove_file(socket_path).unwrap();
    }

    #[test]
    #[ignore = "requires the signed Swift Agent integration harness"]
    fn signed_main_application_harness_echoes_nonce() {
        let response = AgentClient::system_default()
            .and_then(|client| client.perform(AgentOperation::Probe))
            .expect("signed main application probe must succeed");

        assert_eq!(response.nonce.len(), AgentClient::NONCE_BYTES);
        assert!(response.request_id.is_some());
    }

    fn listener() -> (PathBuf, UnixListener) {
        let path = PathBuf::from(format!(
            "/private/tmp/bw-agent-{}.sock",
            uuid::Uuid::new_v4()
        ));
        let listener = UnixListener::bind(&path).unwrap();
        (path, listener)
    }

    fn read_json_frame<T: serde::de::DeserializeOwned>(stream: &mut impl Read) -> T {
        let mut header = [0_u8; 4];
        stream.read_exact(&mut header).unwrap();
        let length = u32::from_be_bytes(header) as usize;
        let mut payload = vec![0; length];
        stream.read_exact(&mut payload).unwrap();
        serde_json::from_slice(&payload).unwrap()
    }
}

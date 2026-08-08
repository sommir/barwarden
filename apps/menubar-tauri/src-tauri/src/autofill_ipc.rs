use crate::autofill_contract::{
    AgentCommandOutcome, AgentErrorCode, AgentOperation, AgentRequest, AgentResponse,
    AgentResponseStatus, AgentSessionPayload, AutoFillSecretField, CandidateGroup,
    CandidateQueryPayload, CandidateResponsePayload, NativeAutoFillContext,
    RepromptGrantIssuePayload, RepromptResultPayload, SecretReleasePayload, AGENT_PROTOCOL_VERSION,
};
use crate::autofill_reprompt::{
    is_main_picker_window, AutoFillRepromptReceiptStore, AutoFillRepromptScope,
};
use serde::{Deserialize, Serialize};
use std::io::{ErrorKind, Read, Write};
use std::os::unix::net::UnixStream;
use std::path::{Path, PathBuf};
use std::sync::Arc;
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

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CandidateCommandRequest {
    account_id: String,
    lock_generation: String,
    field: AutoFillSecretField,
    context: CandidateCommandContext,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CandidateCommandContext {
    bundle_id: String,
    app_name: String,
    service_identifiers: Vec<String>,
    query: String,
}

#[derive(Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CandidateCommandResponse {
    context_token: String,
    candidates: Vec<CandidateCommandCandidate>,
}

#[derive(Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct CandidateCommandCandidate {
    cipher_id: String,
    display_name: String,
    username: String,
    group: CandidateGroup,
    reason: String,
    requires_mismatch_confirmation: bool,
}

#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "kebab-case")]
pub enum CandidateCommandOutcome {
    Success {
        #[serde(flatten)]
        response: CandidateCommandResponse,
    },
    Error {
        code: AgentErrorCode,
    },
}

#[derive(Debug, Serialize)]
#[serde(
    tag = "status",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum AgentSessionCommandOutcome {
    Success {
        generation: String,
        account_id: String,
        vault_revision: u64,
    },
    Error {
        code: AgentErrorCode,
    },
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretCommandRequest {
    scope: AutoFillRepromptScope,
    mismatch_confirmed: bool,
    reprompt_receipt: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "kebab-case")]
pub enum SecretCommandOutcome {
    Success {
        field: AutoFillSecretField,
        value: String,
    },
    Error {
        code: AgentErrorCode,
    },
}

impl Drop for SecretCommandOutcome {
    fn drop(&mut self) {
        if let Self::Success { value, .. } = self {
            zeroize::Zeroize::zeroize(value);
        }
    }
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

fn decode_candidate_response(
    mut response: AgentResponse,
) -> Result<CandidateCommandResponse, AgentErrorCode> {
    if response.session.is_some()
        || response.secret_response.is_some()
        || response.reprompt_grant.is_some()
    {
        return Err(AgentErrorCode::MalformedRequest);
    }
    let payload = response
        .candidate_response
        .take()
        .ok_or(AgentErrorCode::MalformedRequest)?;
    validate_candidate_payload(payload)
}

fn validate_candidate_payload(
    payload: CandidateResponsePayload,
) -> Result<CandidateCommandResponse, AgentErrorCode> {
    if payload.context_token.is_empty()
        || payload.context_token.len() > 512
        || payload.candidates.len() > 500
    {
        return Err(AgentErrorCode::MalformedRequest);
    }
    let mut candidates = Vec::with_capacity(payload.candidates.len());
    for candidate in payload.candidates {
        if candidate.cipher_id.is_empty()
            || candidate.cipher_id.len() > 512
            || candidate.display_name.len() > 2_048
            || candidate.username.len() > 2_048
            || candidate.reason.is_empty()
            || candidate.reason.len() > 64
        {
            return Err(AgentErrorCode::MalformedRequest);
        }
        candidates.push(CandidateCommandCandidate {
            cipher_id: candidate.cipher_id,
            display_name: candidate.display_name,
            username: candidate.username,
            group: candidate.group,
            reason: candidate.reason,
            requires_mismatch_confirmation: candidate.requires_mismatch_confirmation,
        });
    }
    Ok(CandidateCommandResponse {
        context_token: payload.context_token,
        candidates,
    })
}

fn decode_session_response(
    mut response: AgentResponse,
) -> Result<AgentSessionPayload, AgentErrorCode> {
    if response.candidate_response.is_some()
        || response.secret_response.is_some()
        || response.reprompt_grant.is_some()
    {
        return Err(AgentErrorCode::MalformedRequest);
    }
    response
        .session
        .take()
        .ok_or(AgentErrorCode::MalformedRequest)
}

fn validate_candidate_request(
    request: CandidateCommandRequest,
) -> Result<CandidateQueryPayload, AgentErrorCode> {
    if request.account_id.trim().is_empty()
        || request.account_id.len() > 512
        || uuid::Uuid::parse_str(&request.lock_generation).is_err()
        || request.context.bundle_id.is_empty()
        || request.context.bundle_id.len() > 255
        || request.context.app_name.len() > 255
        || request.context.service_identifiers.len() > 32
        || request
            .context
            .service_identifiers
            .iter()
            .any(|value| value.len() > 2_048)
        || request.context.query.len() > 512
    {
        return Err(AgentErrorCode::MalformedRequest);
    }
    Ok(CandidateQueryPayload {
        generation: request.lock_generation,
        account_id: request.account_id,
        field: request.field,
        context: NativeAutoFillContext {
            bundle_id: request.context.bundle_id,
            app_name: request.context.app_name,
            service_identifiers: request.context.service_identifiers,
            query: request.context.query,
        },
    })
}

fn perform_candidates(
    client: &AgentClient,
    request: CandidateCommandRequest,
) -> Result<CandidateCommandResponse, AgentErrorCode> {
    let payload = validate_candidate_request(request)?;
    decode_candidate_response(client.perform_request(AgentRequest::candidate_query(payload))?)
}

fn perform_session(client: &AgentClient) -> Result<AgentSessionPayload, AgentErrorCode> {
    decode_session_response(client.perform(AgentOperation::Status)?)
}

fn perform_secret(
    client: &AgentClient,
    receipts: &AutoFillRepromptReceiptStore,
    request: SecretCommandRequest,
) -> Result<(AutoFillSecretField, String), AgentErrorCode> {
    let scope = request.scope;
    if scope.account_id.trim().is_empty()
        || scope.candidate_id.trim().is_empty()
        || scope.context_token.trim().is_empty()
        || uuid::Uuid::parse_str(&scope.generation).is_err()
    {
        return Err(AgentErrorCode::MalformedRequest);
    }
    let reprompt = if let Some(receipt) = request.reprompt_receipt {
        if !receipts.consume_verified(&receipt, &scope) {
            return Err(AgentErrorCode::Unauthorized);
        }
        let mut grant_response = client.perform_request(AgentRequest::reprompt_grant_issue(
            RepromptGrantIssuePayload {
                generation: scope.generation.clone(),
                account_id: scope.account_id.clone(),
                candidate_id: scope.candidate_id.clone(),
                field: scope.field,
                context_token: scope.context_token.clone(),
            },
        ))?;
        if grant_response.candidate_response.is_some()
            || grant_response.session.is_some()
            || grant_response.secret_response.is_some()
        {
            return Err(AgentErrorCode::MalformedRequest);
        }
        let grant = grant_response
            .reprompt_grant
            .take()
            .filter(|value| !value.grant.is_empty() && value.grant.len() <= 512)
            .ok_or(AgentErrorCode::MalformedRequest)?;
        RepromptResultPayload::grant(grant.grant)
    } else {
        RepromptResultPayload::not_required()
    };
    let mut response =
        client.perform_request(AgentRequest::secret_release(SecretReleasePayload {
            generation: scope.generation,
            account_id: scope.account_id,
            candidate_id: scope.candidate_id,
            field: scope.field,
            context_token: scope.context_token,
            mismatch_confirmed: request.mismatch_confirmed,
            reprompt,
            published_service: None,
        }))?;
    if response.candidate_response.is_some()
        || response.session.is_some()
        || response.reprompt_grant.is_some()
    {
        return Err(AgentErrorCode::MalformedRequest);
    }
    let mut secret = response
        .secret_response
        .take()
        .ok_or(AgentErrorCode::MalformedRequest)?;
    if secret.field != scope.field || secret.value.len() > 16_384 {
        return Err(AgentErrorCode::MalformedRequest);
    }
    let bytes = std::mem::take(&mut secret.value);
    let value = String::from_utf8(bytes).map_err(|error| {
        let mut bytes = error.into_bytes();
        zeroize::Zeroize::zeroize(&mut bytes);
        AgentErrorCode::MalformedRequest
    })?;
    Ok((scope.field, value))
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
pub fn autofill_agent_session(window: tauri::WebviewWindow) -> AgentSessionCommandOutcome {
    if !is_main_picker_window(window.label()) {
        return AgentSessionCommandOutcome::Error {
            code: AgentErrorCode::Unauthorized,
        };
    }
    let result = AgentClient::system_default().and_then(|client| perform_session(&client));
    match result {
        Ok(session) => AgentSessionCommandOutcome::Success {
            generation: session.generation,
            account_id: session.account_id,
            vault_revision: session.vault_revision,
        },
        Err(code) => AgentSessionCommandOutcome::Error { code },
    }
}

#[tauri::command]
pub fn autofill_query_candidates(
    window: tauri::WebviewWindow,
    request: CandidateCommandRequest,
) -> CandidateCommandOutcome {
    if !is_main_picker_window(window.label()) {
        return CandidateCommandOutcome::Error {
            code: AgentErrorCode::Unauthorized,
        };
    }
    let result =
        AgentClient::system_default().and_then(|client| perform_candidates(&client, request));
    match result {
        Ok(response) => CandidateCommandOutcome::Success { response },
        Err(code) => CandidateCommandOutcome::Error { code },
    }
}

#[tauri::command]
pub fn autofill_release_secret(
    window: tauri::WebviewWindow,
    receipts: tauri::State<'_, Arc<AutoFillRepromptReceiptStore>>,
    request: SecretCommandRequest,
) -> SecretCommandOutcome {
    if !is_main_picker_window(window.label()) {
        return SecretCommandOutcome::Error {
            code: AgentErrorCode::Unauthorized,
        };
    }
    let result = AgentClient::system_default()
        .and_then(|client| perform_secret(&client, &receipts, request));
    match result {
        Ok((field, value)) => SecretCommandOutcome::Success { field, value },
        Err(code) => SecretCommandOutcome::Error { code },
    }
}

#[tauri::command]
pub fn autofill_agent_lock(
    receipts: tauri::State<'_, Arc<AutoFillRepromptReceiptStore>>,
) -> AgentCommandOutcome {
    receipts.clear();
    perform_command(AgentOperation::Lock)
}

#[cfg(test)]
mod tests {
    use super::*;
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
                    candidate_response: None,
                    session: None,
                    secret_response: None,
                    reprompt_grant: None,
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
                candidate_response: None,
                session: None,
                secret_response: None,
                reprompt_grant: None,
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
    fn operation_decoder_rejects_smuggled_payloads_and_maps_only_metadata() {
        let response: AgentResponse = serde_json::from_value(serde_json::json!({
            "version": 1,
            "request_id": "00000000-0000-4000-8000-000000000001",
            "nonce": [1],
            "status": "ok",
            "candidate_response": {
                "context_token": "context-a",
                "candidates": [{
                    "cipher_id": "cipher-a", "display_name": "Example", "username": "person@example.test",
                    "group": "exact", "reason": "service_identifier", "requires_mismatch_confirmation": false
                }]
            },
            "session": { "generation": "00000000-0000-4000-8000-000000000004", "account_id": "account-a", "vault_revision": 1 }
        })).unwrap();

        assert_eq!(
            decode_candidate_response(response),
            Err(AgentErrorCode::MalformedRequest)
        );
    }

    #[test]
    fn candidate_decoder_emits_the_exact_camel_case_picker_contract() {
        let response: AgentResponse = serde_json::from_value(serde_json::json!({
            "version": 1,
            "request_id": "00000000-0000-4000-8000-000000000001",
            "nonce": [1],
            "status": "ok",
            "candidate_response": {
                "context_token": "context-a",
                "candidates": [{
                    "cipher_id": "cipher-a", "display_name": "Example", "username": "person@example.test",
                    "group": "exact", "reason": "service_identifier", "requires_mismatch_confirmation": false
                }]
            }
        })).unwrap();

        let outcome = decode_candidate_response(response).unwrap();
        assert_eq!(
            serde_json::to_value(outcome).unwrap(),
            serde_json::json!({
                "contextToken": "context-a",
                "candidates": [{
                    "cipherId": "cipher-a", "displayName": "Example", "username": "person@example.test",
                    "group": "exact", "reason": "service_identifier", "requiresMismatchConfirmation": false
                }]
            })
        );
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

use serde::{Deserialize, Serialize};

pub const AGENT_PROTOCOL_VERSION: u16 = 1;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentOperation {
    Probe,
    Status,
    Lock,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct AgentRequest {
    pub version: u16,
    pub request_id: String,
    pub operation: AgentOperation,
    pub nonce: Vec<u8>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentResponseStatus {
    Ok,
    Error,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct AgentResponse {
    pub version: u16,
    pub request_id: Option<String>,
    pub nonce: Vec<u8>,
    pub status: AgentResponseStatus,
    pub error: Option<AgentErrorCode>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentErrorCode {
    MalformedRequest,
    MessageTooLarge,
    Unauthorized,
    #[serde(rename = "protocol_version")]
    UnsupportedVersion,
    #[serde(rename = "replay")]
    ReplayedRequest,
    Timeout,
    Unavailable,
    Transport,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum AgentCommandOutcome {
    Success { request_id: String, nonce: Vec<u8> },
    Error { code: AgentErrorCode },
}

impl AgentCommandOutcome {
    pub fn from_result(result: Result<AgentResponse, AgentErrorCode>) -> Self {
        match result {
            Ok(response) => Self::Success {
                request_id: response.request_id.unwrap_or_default(),
                nonce: response.nonce,
            },
            Err(code) => Self::Error { code },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{AgentErrorCode, AgentOperation, AgentRequest, AgentResponse, AgentResponseStatus};

    #[test]
    fn request_wire_shape_matches_swift_contract() {
        let request = AgentRequest {
            version: 1,
            request_id: "00000000-0000-4000-8000-000000000001".to_owned(),
            operation: AgentOperation::Probe,
            nonce: vec![0, 1, 254, 255],
        };

        assert_eq!(
            serde_json::to_value(request).unwrap(),
            serde_json::json!({
                "version": 1,
                "request_id": "00000000-0000-4000-8000-000000000001",
                "operation": "probe",
                "nonce": [0, 1, 254, 255]
            })
        );
    }

    #[test]
    fn response_error_is_a_fixed_sanitized_code() {
        let response = AgentResponse {
            version: 1,
            request_id: None,
            nonce: Vec::new(),
            status: AgentResponseStatus::Error,
            error: Some(AgentErrorCode::Unauthorized),
        };

        assert_eq!(
            serde_json::to_value(response).unwrap(),
            serde_json::json!({
                "version": 1,
                "request_id": null,
                "nonce": [],
                "status": "error",
                "error": "unauthorized"
            })
        );
    }
}

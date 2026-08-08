use serde::{Deserialize, Serialize};
use zeroize::Zeroize;

pub const AGENT_PROTOCOL_VERSION: u16 = 1;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentOperation {
    Probe,
    Status,
    Lock,
    Provision,
    RenewLease,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ProjectionProvisionPayload {
    pub generation: String,
    pub account_id: String,
    pub vault_revision: u64,
    pub key: Vec<u8>,
    pub lease_duration_seconds: u64,
    pub projection_path: String,
}

impl Drop for ProjectionProvisionPayload {
    fn drop(&mut self) {
        self.key.zeroize();
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ProjectionLeasePayload {
    pub generation: String,
    pub account_id: String,
    pub lease_duration_seconds: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct AgentRequest {
    pub version: u16,
    pub request_id: String,
    pub operation: AgentOperation,
    pub nonce: Vec<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub projection: Option<ProjectionProvisionPayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lease: Option<ProjectionLeasePayload>,
}

impl AgentRequest {
    pub fn new(operation: AgentOperation) -> Self {
        let mut nonce = Vec::with_capacity(32);
        nonce.extend_from_slice(uuid::Uuid::new_v4().as_bytes());
        nonce.extend_from_slice(uuid::Uuid::new_v4().as_bytes());
        Self {
            version: AGENT_PROTOCOL_VERSION,
            request_id: uuid::Uuid::new_v4().to_string(),
            operation,
            nonce,
            projection: None,
            lease: None,
        }
    }

    pub fn projection_provision(
        generation: String,
        account_id: String,
        vault_revision: u64,
        key: Vec<u8>,
        lease_duration_seconds: u64,
        projection_path: String,
    ) -> Self {
        let mut request = Self::new(AgentOperation::Provision);
        request.projection = Some(ProjectionProvisionPayload {
            generation,
            account_id,
            vault_revision,
            key,
            lease_duration_seconds,
            projection_path,
        });
        request
    }

    pub fn lease_renewal(
        generation: String,
        account_id: String,
        lease_duration_seconds: u64,
    ) -> Self {
        let mut request = Self::new(AgentOperation::RenewLease);
        request.lease = Some(ProjectionLeasePayload {
            generation,
            account_id,
            lease_duration_seconds,
        });
        request
    }
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
    RequestCapacity,
    Timeout,
    Unavailable,
    Transport,
    CorruptProjection,
    StaleRevision,
    AccountMismatch,
    Locked,
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
            projection: None,
            lease: None,
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

    #[test]
    fn replay_capacity_error_matches_swift_wire_code() {
        let code: AgentErrorCode = serde_json::from_str("\"request_capacity\"").unwrap();

        assert_eq!(code, AgentErrorCode::RequestCapacity);
    }

    #[test]
    fn projection_provision_wire_shape_contains_only_bounded_key_lease_material() {
        let request = AgentRequest::projection_provision(
            "00000000-0000-4000-8000-000000000004".to_owned(),
            "account-a".to_owned(),
            7,
            vec![9; 32],
            30,
            "/private/tmp/projection.bwaf".to_owned(),
        );
        let value = serde_json::to_value(request).unwrap();

        assert_eq!(value["operation"], "provision");
        assert_eq!(
            value["projection"]["generation"],
            "00000000-0000-4000-8000-000000000004"
        );
        assert_eq!(value["projection"]["account_id"], "account-a");
        assert_eq!(value["projection"]["vault_revision"], 7);
        assert_eq!(value["projection"]["key"].as_array().unwrap().len(), 32);
        assert!(value.get("access_token").is_none());
        assert!(value.get("master_password").is_none());
    }
}

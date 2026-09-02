use serde::{Deserialize, Serialize};
use zeroize::Zeroize;

// Version 3 requires the rolling Agent replay window. An older Agent may still
// be alive after an in-place app replacement, so the wire boundary forces
// Service Management reconciliation before AutoFill resumes.
pub const AGENT_PROTOCOL_VERSION: u16 = 3;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentOperation {
    Probe,
    Status,
    Lock,
    Provision,
    RenewLease,
    QueryCandidates,
    ReleaseSecret,
    IssueRepromptGrant,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AutoFillSecretField {
    Username,
    Password,
    Totp,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct NativeAutoFillContext {
    pub bundle_id: String,
    pub app_name: String,
    pub service_identifiers: Vec<String>,
    pub query: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct CandidateQueryPayload {
    pub generation: String,
    pub account_id: String,
    pub field: AutoFillSecretField,
    pub context: NativeAutoFillContext,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CandidateGroup {
    Exact,
    Relevant,
    Other,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct RankedCandidate {
    pub cipher_id: String,
    pub display_name: String,
    pub username: String,
    pub group: CandidateGroup,
    pub reason: String,
    pub requires_mismatch_confirmation: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct CandidateResponsePayload {
    pub context_token: String,
    pub candidates: Vec<RankedCandidate>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct AgentSessionPayload {
    pub generation: String,
    pub account_id: String,
    pub vault_revision: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RepromptResult {
    NotRequired,
    Grant,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct RepromptResultPayload {
    pub result: RepromptResult,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub grant: Option<String>,
}

impl RepromptResultPayload {
    pub fn not_required() -> Self {
        Self {
            result: RepromptResult::NotRequired,
            grant: None,
        }
    }

    pub fn grant(grant: String) -> Self {
        Self {
            result: RepromptResult::Grant,
            grant: Some(grant),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct PublishedCredentialService {
    pub identifier: String,
    pub kind: PublishedCredentialServiceKind,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum PublishedCredentialServiceKind {
    #[serde(rename = "URL")]
    Url,
    #[serde(rename = "domain")]
    Domain,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SecretReleasePayload {
    pub generation: String,
    pub account_id: String,
    pub candidate_id: String,
    pub field: AutoFillSecretField,
    pub context_token: String,
    pub mismatch_confirmed: bool,
    pub reprompt: RepromptResultPayload,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub published_service: Option<PublishedCredentialService>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct RepromptGrantIssuePayload {
    pub generation: String,
    pub account_id: String,
    pub candidate_id: String,
    pub field: AutoFillSecretField,
    pub context_token: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct RepromptGrantPayload {
    pub grant: String,
}

#[derive(Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ReleasedSecret {
    pub field: AutoFillSecretField,
    #[serde(with = "base64_key")]
    pub value: Vec<u8>,
}

impl Drop for ReleasedSecret {
    fn drop(&mut self) {
        self.value.zeroize();
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ProjectionProvisionPayload {
    pub generation: String,
    pub account_id: String,
    pub vault_revision: u64,
    #[serde(with = "base64_key")]
    pub key: Vec<u8>,
    pub lease_duration_seconds: u64,
    pub projection_path: String,
}

mod base64_key {
    use base64::Engine;
    use serde::{Deserialize, Deserializer, Serializer};
    use zeroize::Zeroize;

    pub fn serialize<S>(key: &[u8], serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut encoded = base64::engine::general_purpose::STANDARD.encode(key);
        let result = serializer.serialize_str(&encoded);
        encoded.zeroize();
        result
    }

    pub fn deserialize<'de, D>(deserializer: D) -> Result<Vec<u8>, D::Error>
    where
        D: Deserializer<'de>,
    {
        let mut encoded = String::deserialize(deserializer)?;
        let result = base64::engine::general_purpose::STANDARD
            .decode(encoded.as_bytes())
            .map_err(serde::de::Error::custom);
        encoded.zeroize();
        result
    }
}

impl Drop for ProjectionProvisionPayload {
    fn drop(&mut self) {
        self.key.zeroize();
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ProjectionLeasePayload {
    pub generation: String,
    pub account_id: String,
    pub lease_duration_seconds: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct AgentRequest {
    pub version: u16,
    pub request_id: String,
    pub operation: AgentOperation,
    pub nonce: Vec<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub projection: Option<ProjectionProvisionPayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lease: Option<ProjectionLeasePayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub candidate_query: Option<CandidateQueryPayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub secret_release: Option<SecretReleasePayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reprompt_grant_issue: Option<RepromptGrantIssuePayload>,
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
            candidate_query: None,
            secret_release: None,
            reprompt_grant_issue: None,
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

    pub fn candidate_query(payload: CandidateQueryPayload) -> Self {
        let mut request = Self::new(AgentOperation::QueryCandidates);
        request.candidate_query = Some(payload);
        request
    }

    pub fn secret_release(payload: SecretReleasePayload) -> Self {
        let mut request = Self::new(AgentOperation::ReleaseSecret);
        request.secret_release = Some(payload);
        request
    }

    pub fn reprompt_grant_issue(payload: RepromptGrantIssuePayload) -> Self {
        let mut request = Self::new(AgentOperation::IssueRepromptGrant);
        request.reprompt_grant_issue = Some(payload);
        request
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentResponseStatus {
    Ok,
    Error,
}

#[derive(Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct AgentResponse {
    pub version: u16,
    pub request_id: Option<String>,
    pub nonce: Vec<u8>,
    pub status: AgentResponseStatus,
    pub error: Option<AgentErrorCode>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub candidate_response: Option<CandidateResponsePayload>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session: Option<AgentSessionPayload>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub secret_response: Option<ReleasedSecret>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reprompt_grant: Option<RepromptGrantPayload>,
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
    use super::*;

    #[test]
    fn current_protocol_version_invalidates_agents_with_permanent_replay_caches() {
        assert_eq!(AGENT_PROTOCOL_VERSION, 3);
    }

    #[test]
    fn request_wire_shape_matches_swift_contract() {
        let request = AgentRequest {
            version: 1,
            request_id: "00000000-0000-4000-8000-000000000001".to_owned(),
            operation: AgentOperation::Probe,
            nonce: vec![0, 1, 254, 255],
            projection: None,
            lease: None,
            candidate_query: None,
            secret_release: None,
            reprompt_grant_issue: None,
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
            candidate_response: None,
            session: None,
            secret_response: None,
            reprompt_grant: None,
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
        assert_eq!(
            value["projection"]["key"],
            "CQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQk="
        );
        assert!(value.get("access_token").is_none());
        assert!(value.get("master_password").is_none());
    }

    #[test]
    fn candidate_query_wire_is_metadata_only_and_field_scoped() {
        let request = AgentRequest::candidate_query(CandidateQueryPayload {
            generation: "00000000-0000-4000-8000-000000000004".to_owned(),
            account_id: "account-a".to_owned(),
            field: AutoFillSecretField::Password,
            context: NativeAutoFillContext {
                bundle_id: "com.example.App".to_owned(),
                app_name: "Example".to_owned(),
                service_identifiers: vec!["https://example.test".to_owned()],
                query: String::new(),
            },
        });
        let value = serde_json::to_value(request).unwrap();

        assert_eq!(value["operation"], "query_candidates");
        assert_eq!(value["candidate_query"]["field"], "password");
        assert_eq!(
            value["candidate_query"]["context"]["bundle_id"],
            "com.example.App"
        );
        assert!(value.get("secret_release").is_none());
        assert!(!value.to_string().contains("password-value"));
    }

    #[test]
    fn secret_release_wire_binds_every_authorization_dimension_to_one_field() {
        let request = AgentRequest::secret_release(SecretReleasePayload {
            generation: "00000000-0000-4000-8000-000000000004".to_owned(),
            account_id: "account-a".to_owned(),
            candidate_id: "cipher-a".to_owned(),
            field: AutoFillSecretField::Password,
            context_token: "context-a".to_owned(),
            mismatch_confirmed: true,
            reprompt: RepromptResultPayload::grant("grant-a".to_owned()),
            published_service: None,
        });
        let value = serde_json::to_value(request).unwrap();

        assert_eq!(value["operation"], "release_secret");
        assert_eq!(value["secret_release"]["account_id"], "account-a");
        assert_eq!(value["secret_release"]["candidate_id"], "cipher-a");
        assert_eq!(value["secret_release"]["field"], "password");
        assert_eq!(value["secret_release"]["context_token"], "context-a");
        assert_eq!(value["secret_release"]["reprompt"]["grant"], "grant-a");
    }

    #[test]
    fn response_decodes_exact_metadata_session_and_base64_secret_shapes() {
        let response: AgentResponse = serde_json::from_value(serde_json::json!({
            "version": 1,
            "request_id": "00000000-0000-4000-8000-000000000001",
            "nonce": [1, 2, 3],
            "status": "ok",
            "candidate_response": {
                "context_token": "context-a",
                "candidates": [{
                    "cipher_id": "cipher-a",
                    "display_name": "Example",
                    "username": "person@example.test",
                    "group": "exact",
                    "reason": "service_identifier",
                    "requires_mismatch_confirmation": false
                }]
            },
            "session": null,
            "secret_response": { "field": "password", "value": "c2VjcmV0" }
        }))
        .unwrap();

        assert_eq!(
            response.candidate_response.unwrap().candidates[0].cipher_id,
            "cipher-a"
        );
        assert_eq!(response.secret_response.unwrap().value, b"secret");
    }

    #[test]
    fn request_and_response_reject_unknown_root_and_nested_fields() {
        let request = serde_json::json!({
            "version": 1,
            "request_id": "00000000-0000-4000-8000-000000000001",
            "operation": "query_candidates",
            "nonce": [1],
            "candidate_query": {
                "generation": "00000000-0000-4000-8000-000000000004",
                "account_id": "account-a",
                "field": "password",
                "context": { "bundle_id": "com.example.App", "app_name": "Example", "service_identifiers": [], "query": "", "extra": true }
            }
        });
        assert!(serde_json::from_value::<AgentRequest>(request).is_err());

        let response = serde_json::json!({
            "version": 1,
            "request_id": "00000000-0000-4000-8000-000000000001",
            "nonce": [1],
            "status": "ok",
            "unexpected": "smuggled"
        });
        assert!(serde_json::from_value::<AgentResponse>(response).is_err());
    }
}

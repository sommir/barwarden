use std::collections::BTreeMap;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::Emitter;

const MAX_SHARED_SNAPSHOT_BYTES: usize = 3 * 1024 * 1024;
const MAX_SESSION_HANDOFF_BYTES: usize = 512 * 1024;
pub const SESSION_BROKER_EVENT: &str = "barwarden://session-broker-changed";

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum StartupMode {
    Cold,
    Attach,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum AuthorizationState {
    SignedOut,
    Locked,
    Unlocked,
    RecoveryRequired,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum SessionSyncState {
    Idle,
    Syncing,
    Fresh,
    Stale,
    Invalid,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum BrokerFailureCode {
    InvalidWindow,
    InvalidAccount,
    InvalidTransition,
    InvalidPayload,
    SensitivePayload,
    Unavailable,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrokerFailure {
    pub code: BrokerFailureCode,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionBrokerSnapshot {
    pub process_generation: String,
    pub version: u64,
    pub sync_version: u64,
    pub authorization: AuthorizationState,
    pub active_account_id: Option<String>,
    pub sync_state: SessionSyncState,
    pub failure_code: Option<String>,
    pub shared_snapshot: Option<Value>,
    pub origin_window_label: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionBrokerAttachment {
    pub startup_mode: StartupMode,
    pub snapshot: SessionBrokerSnapshot,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionBrokerEvent {
    pub process_generation: String,
    pub version: u64,
    pub sync_version: u64,
    pub authorization: AuthorizationState,
    pub active_account_id: Option<String>,
    pub sync_state: SessionSyncState,
    pub failure_code: Option<String>,
    pub origin_window_label: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProjectionSessionContext {
    pub process_generation: String,
    pub version: u64,
    pub ownership_epoch: u64,
    pub authorization: AuthorizationState,
    pub active_account_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum SessionBrokerMutation {
    Unlocked {
        active_account_id: String,
        shared_snapshot: Option<Value>,
    },
    Locked,
    LoggedOut,
    AccountSelected {
        active_account_id: String,
    },
    SyncStarted,
    SyncSucceeded {
        shared_snapshot: Option<Value>,
    },
    SyncFailed {
        code: String,
    },
    SnapshotUpdated {
        shared_snapshot: Value,
    },
    ActiveTabUpdated {
        active_tab: String,
    },
    RecoveryRequired {
        active_account_id: String,
        code: String,
    },
}

#[derive(Debug)]
struct BrokerState {
    snapshot: SessionBrokerSnapshot,
    startup_modes: BTreeMap<String, StartupMode>,
    sync_owner_window_label: Option<String>,
    session_handoff: Option<Value>,
    projection_ownership_epoch: u64,
}

#[derive(Debug)]
pub struct SessionBroker {
    state: Mutex<BrokerState>,
}

impl SessionBroker {
    pub fn new(process_generation: impl Into<String>) -> Self {
        Self {
            state: Mutex::new(BrokerState {
                snapshot: SessionBrokerSnapshot {
                    process_generation: process_generation.into(),
                    version: 0,
                    sync_version: 0,
                    authorization: AuthorizationState::SignedOut,
                    active_account_id: None,
                    sync_state: SessionSyncState::Idle,
                    failure_code: None,
                    shared_snapshot: None,
                    origin_window_label: None,
                },
                startup_modes: BTreeMap::new(),
                sync_owner_window_label: None,
                session_handoff: None,
                projection_ownership_epoch: 0,
            }),
        }
    }

    pub fn attach(&self, window_label: &str) -> Result<SessionBrokerAttachment, BrokerFailure> {
        validate_window_label(window_label)?;
        let mut state = self
            .state
            .lock()
            .map_err(|_| failure(BrokerFailureCode::Unavailable))?;
        let next_mode = if state.startup_modes.is_empty() {
            StartupMode::Cold
        } else {
            StartupMode::Attach
        };
        let startup_mode = *state
            .startup_modes
            .entry(window_label.to_owned())
            .or_insert(next_mode);
        Ok(SessionBrokerAttachment {
            startup_mode,
            snapshot: state.snapshot.clone(),
        })
    }

    #[cfg(test)]
    pub fn snapshot(&self) -> SessionBrokerSnapshot {
        self.state
            .lock()
            .map(|state| state.snapshot.clone())
            .unwrap_or_else(|_| SessionBrokerSnapshot {
                process_generation: String::new(),
                version: 0,
                sync_version: 0,
                authorization: AuthorizationState::RecoveryRequired,
                active_account_id: None,
                sync_state: SessionSyncState::Invalid,
                failure_code: Some("unavailable".to_owned()),
                shared_snapshot: None,
                origin_window_label: None,
            })
    }

    pub fn snapshot_for(&self, window_label: &str) -> Result<SessionBrokerSnapshot, BrokerFailure> {
        validate_window_label(window_label)?;
        let state = self
            .state
            .lock()
            .map_err(|_| failure(BrokerFailureCode::Unavailable))?;
        if !state.startup_modes.contains_key(window_label) {
            return Err(failure(BrokerFailureCode::InvalidWindow));
        }
        Ok(state.snapshot.clone())
    }

    pub fn projection_context(&self) -> Result<ProjectionSessionContext, BrokerFailure> {
        let state = self
            .state
            .lock()
            .map_err(|_| failure(BrokerFailureCode::Unavailable))?;
        Ok(ProjectionSessionContext {
            process_generation: state.snapshot.process_generation.clone(),
            version: state.snapshot.version,
            ownership_epoch: state.projection_ownership_epoch,
            authorization: state.snapshot.authorization,
            active_account_id: state.snapshot.active_account_id.clone(),
        })
    }

    pub fn mutate(
        &self,
        window_label: &str,
        mutation: SessionBrokerMutation,
    ) -> Result<SessionBrokerSnapshot, BrokerFailure> {
        validate_window_label(window_label)?;
        let mut state = self
            .state
            .lock()
            .map_err(|_| failure(BrokerFailureCode::Unavailable))?;
        if !state.startup_modes.contains_key(window_label) {
            return Err(failure(BrokerFailureCode::InvalidWindow));
        }

        let mut snapshot = state.snapshot.clone();
        match mutation {
            SessionBrokerMutation::Unlocked {
                active_account_id,
                shared_snapshot,
            } => {
                validate_account_id(&active_account_id)?;
                validate_shared_snapshot(shared_snapshot.as_ref())?;
                snapshot.authorization = AuthorizationState::Unlocked;
                snapshot.active_account_id = Some(active_account_id);
                snapshot.sync_state = SessionSyncState::Idle;
                snapshot.failure_code = None;
                snapshot.shared_snapshot = shared_snapshot;
                state.sync_owner_window_label = None;
                state.projection_ownership_epoch =
                    state.projection_ownership_epoch.saturating_add(1);
            }
            SessionBrokerMutation::Locked => {
                state.session_handoff = None;
                snapshot.authorization = AuthorizationState::Locked;
                snapshot.sync_state = SessionSyncState::Idle;
                snapshot.failure_code = None;
                snapshot.shared_snapshot = None;
                state.sync_owner_window_label = None;
                state.projection_ownership_epoch =
                    state.projection_ownership_epoch.saturating_add(1);
            }
            SessionBrokerMutation::LoggedOut => {
                state.session_handoff = None;
                snapshot.authorization = AuthorizationState::SignedOut;
                snapshot.active_account_id = None;
                snapshot.sync_state = SessionSyncState::Idle;
                snapshot.failure_code = None;
                snapshot.shared_snapshot = None;
                state.sync_owner_window_label = None;
                state.projection_ownership_epoch =
                    state.projection_ownership_epoch.saturating_add(1);
            }
            SessionBrokerMutation::AccountSelected { active_account_id } => {
                state.session_handoff = None;
                validate_account_id(&active_account_id)?;
                snapshot.authorization = AuthorizationState::Locked;
                snapshot.active_account_id = Some(active_account_id);
                snapshot.sync_state = SessionSyncState::Idle;
                snapshot.failure_code = None;
                snapshot.shared_snapshot = None;
                state.sync_owner_window_label = None;
                state.projection_ownership_epoch =
                    state.projection_ownership_epoch.saturating_add(1);
            }
            SessionBrokerMutation::SyncStarted => {
                require_unlocked(&snapshot)?;
                if state.sync_owner_window_label.is_some() {
                    return Err(failure(BrokerFailureCode::InvalidTransition));
                }
                snapshot.sync_state = SessionSyncState::Syncing;
                snapshot.sync_version = snapshot.sync_version.saturating_add(1);
                snapshot.failure_code = None;
                state.sync_owner_window_label = Some(window_label.to_owned());
            }
            SessionBrokerMutation::SyncSucceeded { shared_snapshot } => {
                require_unlocked(&snapshot)?;
                require_sync_owner(&state, window_label)?;
                validate_shared_snapshot(shared_snapshot.as_ref())?;
                snapshot.sync_state = SessionSyncState::Fresh;
                snapshot.sync_version = snapshot.sync_version.saturating_add(1);
                snapshot.failure_code = None;
                if shared_snapshot.is_some() {
                    snapshot.shared_snapshot = shared_snapshot;
                }
                state.sync_owner_window_label = None;
            }
            SessionBrokerMutation::SyncFailed { code } => {
                require_unlocked(&snapshot)?;
                require_sync_owner(&state, window_label)?;
                validate_failure_code(&code)?;
                snapshot.sync_state = SessionSyncState::Stale;
                snapshot.sync_version = snapshot.sync_version.saturating_add(1);
                snapshot.failure_code = Some(code);
                state.sync_owner_window_label = None;
            }
            SessionBrokerMutation::SnapshotUpdated { shared_snapshot } => {
                require_unlocked(&snapshot)?;
                validate_shared_snapshot(Some(&shared_snapshot))?;
                snapshot.shared_snapshot = Some(shared_snapshot);
            }
            SessionBrokerMutation::ActiveTabUpdated { active_tab } => {
                require_unlocked(&snapshot)?;
                validate_active_tab(&active_tab)?;
                let shared_snapshot = snapshot
                    .shared_snapshot
                    .as_mut()
                    .and_then(Value::as_object_mut)
                    .ok_or_else(|| failure(BrokerFailureCode::InvalidTransition))?;
                shared_snapshot.insert("activeTab".to_owned(), Value::String(active_tab));
            }
            SessionBrokerMutation::RecoveryRequired {
                active_account_id,
                code,
            } => {
                state.session_handoff = None;
                validate_account_id(&active_account_id)?;
                validate_failure_code(&code)?;
                snapshot.authorization = AuthorizationState::RecoveryRequired;
                snapshot.active_account_id = Some(active_account_id);
                snapshot.sync_state = SessionSyncState::Invalid;
                snapshot.failure_code = Some(code);
                snapshot.shared_snapshot = None;
                state.sync_owner_window_label = None;
                state.projection_ownership_epoch =
                    state.projection_ownership_epoch.saturating_add(1);
            }
        }
        snapshot.version = snapshot.version.saturating_add(1);
        snapshot.origin_window_label = Some(window_label.to_owned());
        state.snapshot = snapshot.clone();
        Ok(snapshot)
    }

    pub fn set_session_handoff(
        &self,
        window_label: &str,
        session: Value,
    ) -> Result<(), BrokerFailure> {
        validate_window_label(window_label)?;
        validate_session_handoff(&session)?;
        let mut state = self
            .state
            .lock()
            .map_err(|_| failure(BrokerFailureCode::Unavailable))?;
        if !state.startup_modes.contains_key(window_label) {
            return Err(failure(BrokerFailureCode::InvalidWindow));
        }
        state.session_handoff = Some(session);
        Ok(())
    }

    pub fn session_handoff(&self, window_label: &str) -> Result<Option<Value>, BrokerFailure> {
        validate_window_label(window_label)?;
        let state = self
            .state
            .lock()
            .map_err(|_| failure(BrokerFailureCode::Unavailable))?;
        if !state.startup_modes.contains_key(window_label) {
            return Err(failure(BrokerFailureCode::InvalidWindow));
        }
        if state.snapshot.authorization != AuthorizationState::Unlocked {
            return Ok(None);
        }
        Ok(state.session_handoff.clone())
    }
}

impl From<&SessionBrokerSnapshot> for SessionBrokerEvent {
    fn from(snapshot: &SessionBrokerSnapshot) -> Self {
        Self {
            process_generation: snapshot.process_generation.clone(),
            version: snapshot.version,
            sync_version: snapshot.sync_version,
            authorization: snapshot.authorization,
            active_account_id: snapshot.active_account_id.clone(),
            sync_state: snapshot.sync_state,
            failure_code: snapshot.failure_code.clone(),
            origin_window_label: snapshot.origin_window_label.clone(),
        }
    }
}

#[tauri::command]
pub async fn session_broker_attach(
    window: tauri::WebviewWindow,
    broker: tauri::State<'_, SessionBroker>,
) -> Result<SessionBrokerAttachment, BrokerFailure> {
    broker.attach(window.label())
}

#[tauri::command]
pub async fn session_broker_snapshot(
    window: tauri::WebviewWindow,
    broker: tauri::State<'_, SessionBroker>,
) -> Result<SessionBrokerSnapshot, BrokerFailure> {
    broker.snapshot_for(window.label())
}

#[tauri::command]
pub async fn session_broker_mutate(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    broker: tauri::State<'_, SessionBroker>,
    mutation: SessionBrokerMutation,
) -> Result<SessionBrokerSnapshot, BrokerFailure> {
    let snapshot = broker.mutate(window.label(), mutation)?;
    app.emit(SESSION_BROKER_EVENT, SessionBrokerEvent::from(&snapshot))
        .map_err(|_| failure(BrokerFailureCode::Unavailable))?;
    Ok(snapshot)
}

#[tauri::command]
pub async fn session_broker_set_handoff(
    window: tauri::WebviewWindow,
    broker: tauri::State<'_, SessionBroker>,
    session: Value,
) -> Result<(), BrokerFailure> {
    broker.set_session_handoff(window.label(), session)
}

#[tauri::command]
pub async fn session_broker_handoff(
    window: tauri::WebviewWindow,
    broker: tauri::State<'_, SessionBroker>,
) -> Result<Option<Value>, BrokerFailure> {
    broker.session_handoff(window.label())
}

fn validate_window_label(window_label: &str) -> Result<(), BrokerFailure> {
    if window_label.is_empty()
        || window_label.len() > 128
        || !window_label
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(failure(BrokerFailureCode::InvalidWindow));
    }
    Ok(())
}

fn validate_account_id(account_id: &str) -> Result<(), BrokerFailure> {
    if account_id.trim().is_empty() || account_id.len() > 512 {
        return Err(failure(BrokerFailureCode::InvalidAccount));
    }
    Ok(())
}

fn validate_failure_code(code: &str) -> Result<(), BrokerFailure> {
    if code.is_empty()
        || code.len() > 64
        || !code
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
    {
        return Err(failure(BrokerFailureCode::InvalidPayload));
    }
    Ok(())
}

fn require_unlocked(snapshot: &SessionBrokerSnapshot) -> Result<(), BrokerFailure> {
    if snapshot.authorization != AuthorizationState::Unlocked
        || snapshot.active_account_id.is_none()
    {
        return Err(failure(BrokerFailureCode::InvalidTransition));
    }
    Ok(())
}

fn require_sync_owner(state: &BrokerState, window_label: &str) -> Result<(), BrokerFailure> {
    if state.sync_owner_window_label.as_deref() != Some(window_label) {
        return Err(failure(BrokerFailureCode::InvalidTransition));
    }
    Ok(())
}

fn validate_shared_snapshot(value: Option<&Value>) -> Result<(), BrokerFailure> {
    let Some(value) = value else {
        return Ok(());
    };
    if serde_json::to_vec(value)
        .map_err(|_| failure(BrokerFailureCode::InvalidPayload))?
        .len()
        > MAX_SHARED_SNAPSHOT_BYTES
    {
        return Err(failure(BrokerFailureCode::InvalidPayload));
    }
    if contains_sensitive_key(value) {
        return Err(failure(BrokerFailureCode::SensitivePayload));
    }
    Ok(())
}

fn validate_active_tab(value: &str) -> Result<(), BrokerFailure> {
    if matches!(value, "vault" | "otp" | "generator" | "send" | "settings") {
        Ok(())
    } else {
        Err(failure(BrokerFailureCode::InvalidPayload))
    }
}

fn validate_session_handoff(value: &Value) -> Result<(), BrokerFailure> {
    if !value.is_object()
        || serde_json::to_vec(value)
            .map_err(|_| failure(BrokerFailureCode::InvalidPayload))?
            .len()
            > MAX_SESSION_HANDOFF_BYTES
    {
        return Err(failure(BrokerFailureCode::InvalidPayload));
    }
    Ok(())
}

fn contains_sensitive_key(value: &Value) -> bool {
    match value {
        Value::Object(entries) => entries.iter().any(|(key, value)| {
            let normalized = key
                .chars()
                .filter(|character| character.is_ascii_alphanumeric())
                .flat_map(char::to_lowercase)
                .collect::<String>();
            matches!(
                normalized.as_str(),
                "mastersassword"
                    | "masterpassword"
                    | "accesstoken"
                    | "refreshtoken"
                    | "activesession"
                    | "sessiontoken"
            ) || contains_sensitive_key(value)
        }),
        Value::Array(values) => values.iter().any(contains_sensitive_key),
        _ => false,
    }
}

fn failure(code: BrokerFailureCode) -> BrokerFailure {
    BrokerFailure { code }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{
        AuthorizationState, BrokerFailureCode, SessionBroker, SessionBrokerMutation,
        SessionSyncState, StartupMode,
    };

    #[test]
    fn only_the_first_webview_in_a_process_receives_cold_start_ownership() {
        let broker = SessionBroker::new("process-generation");

        let popup = broker.attach("main").expect("attach popup");
        let popout = broker.attach("popout").expect("attach popout");
        let repeated_popup = broker.attach("main").expect("reattach popup");

        assert_eq!(popup.startup_mode, StartupMode::Cold);
        assert_eq!(popout.startup_mode, StartupMode::Attach);
        assert_eq!(repeated_popup.startup_mode, StartupMode::Cold);
        assert_eq!(popup.snapshot.process_generation, "process-generation");
        assert_eq!(popup.snapshot.version, 0);
    }

    #[test]
    fn authorization_and_sync_transitions_are_atomic_and_versioned() {
        let broker = SessionBroker::new("process-generation");
        broker.attach("main").expect("attach popup");

        let unlocked = broker
            .mutate(
                "main",
                SessionBrokerMutation::Unlocked {
                    active_account_id: "account-1".to_owned(),
                    shared_snapshot: Some(json!({
                        "isUnlocked": true,
                        "email": "person@example.com",
                        "items": [{ "id": "cipher-1", "name": "Example" }]
                    })),
                },
            )
            .expect("publish unlocked state");
        let syncing = broker
            .mutate("main", SessionBrokerMutation::SyncStarted)
            .expect("start sync");
        let stale = broker
            .mutate(
                "main",
                SessionBrokerMutation::SyncFailed {
                    code: "transport".to_owned(),
                },
            )
            .expect("mark stale");

        assert_eq!(unlocked.authorization, AuthorizationState::Unlocked);
        assert_eq!(unlocked.active_account_id.as_deref(), Some("account-1"));
        assert_eq!(unlocked.version, 1);
        assert_eq!(syncing.sync_state, SessionSyncState::Syncing);
        assert_eq!(syncing.sync_version, 1);
        assert_eq!(stale.authorization, AuthorizationState::Unlocked);
        assert_eq!(stale.sync_state, SessionSyncState::Stale);
        assert_eq!(stale.failure_code.as_deref(), Some("transport"));
        assert_eq!(stale.sync_version, 2);
        assert_eq!(
            broker
                .snapshot()
                .shared_snapshot
                .as_ref()
                .and_then(|value| value.get("items"))
                .and_then(|value| value.as_array())
                .map(Vec::len),
            Some(1),
        );
    }

    #[test]
    fn projection_ownership_epoch_advances_only_for_session_or_account_transitions() {
        let broker = SessionBroker::new("process-generation");
        broker.attach("main").expect("attach popup");
        assert_eq!(broker.projection_context().unwrap().ownership_epoch, 0);

        broker
            .mutate(
                "main",
                SessionBrokerMutation::Unlocked {
                    active_account_id: "account-a".to_owned(),
                    shared_snapshot: Some(json!({ "isUnlocked": true, "activeTab": "vault" })),
                },
            )
            .unwrap();
        let unlocked = broker.projection_context().unwrap();
        assert_eq!(unlocked.ownership_epoch, 1);

        broker
            .mutate(
                "main",
                SessionBrokerMutation::SnapshotUpdated {
                    shared_snapshot: json!({ "isUnlocked": true, "activeTab": "vault" }),
                },
            )
            .unwrap();
        assert_eq!(broker.projection_context().unwrap().ownership_epoch, 1);

        broker
            .mutate("main", SessionBrokerMutation::Locked)
            .unwrap();
        assert_eq!(broker.projection_context().unwrap().ownership_epoch, 2);
        broker
            .mutate(
                "main",
                SessionBrokerMutation::AccountSelected {
                    active_account_id: "account-b".to_owned(),
                },
            )
            .unwrap();
        assert_eq!(broker.projection_context().unwrap().ownership_epoch, 3);
        broker
            .mutate(
                "main",
                SessionBrokerMutation::Unlocked {
                    active_account_id: "account-b".to_owned(),
                    shared_snapshot: Some(json!({ "isUnlocked": true, "activeTab": "vault" })),
                },
            )
            .unwrap();
        let switched = broker.projection_context().unwrap();
        assert_eq!(switched.ownership_epoch, 4);
        assert_eq!(switched.active_account_id.as_deref(), Some("account-b"));
    }

    #[test]
    fn active_tab_update_preserves_the_existing_shared_vault_snapshot() {
        let broker = SessionBroker::new("process-generation");
        broker.attach("main").expect("attach popup");
        broker
            .mutate(
                "main",
                SessionBrokerMutation::Unlocked {
                    active_account_id: "account-1".to_owned(),
                    shared_snapshot: Some(json!({
                        "isUnlocked": true,
                        "activeTab": "vault",
                        "items": [{ "id": "cipher-1", "name": "Example" }]
                    })),
                },
            )
            .expect("unlock");

        let updated = broker
            .mutate(
                "main",
                SessionBrokerMutation::ActiveTabUpdated {
                    active_tab: "otp".to_owned(),
                },
            )
            .expect("update active tab");

        let shared = updated.shared_snapshot.expect("shared snapshot");
        assert_eq!(shared.get("activeTab"), Some(&json!("otp")));
        assert_eq!(
            shared.get("items"),
            Some(&json!([{ "id": "cipher-1", "name": "Example" }]))
        );
    }

    #[test]
    fn mutation_wire_format_uses_the_typescript_camel_case_field_names() {
        let mutation: SessionBrokerMutation = serde_json::from_value(json!({
            "type": "unlocked",
            "activeAccountId": "account-1",
            "sharedSnapshot": {
                "isUnlocked": true
            }
        }))
        .expect("decode the TypeScript mutation wire format");

        assert!(matches!(
            mutation,
            SessionBrokerMutation::Unlocked {
                active_account_id,
                shared_snapshot: Some(_),
            } if active_account_id == "account-1"
        ));
    }

    #[test]
    fn broker_rejects_credentials_and_tokens_at_its_public_snapshot_boundary() {
        for forbidden_snapshot in [
            json!({ "masterPassword": "not-allowed" }),
            json!({ "activeSession": { "token": { "accessToken": "not-allowed" } } }),
            json!({ "refreshToken": "not-allowed" }),
            json!({ "nested": [{ "accessToken": "not-allowed" }] }),
        ] {
            let broker = SessionBroker::new("process-generation");
            broker.attach("main").expect("attach popup");

            let failure = broker
                .mutate(
                    "main",
                    SessionBrokerMutation::Unlocked {
                        active_account_id: "account-1".to_owned(),
                        shared_snapshot: Some(forbidden_snapshot),
                    },
                )
                .expect_err("reject secret-bearing state");

            assert_eq!(failure.code, BrokerFailureCode::SensitivePayload);
            assert_eq!(broker.snapshot().version, 0);
        }
    }

    #[test]
    fn ephemeral_session_handoff_is_available_only_while_the_process_is_unlocked() {
        let broker = SessionBroker::new("process-generation");
        broker.attach("main").expect("attach popup");
        broker.attach("popout").expect("attach popout");
        let session = json!({
            "environment": {
                "apiUrl": "https://api.example.test",
                "identityUrl": "https://identity.example.test"
            },
            "token": {
                "accessToken": "private-access",
                "refreshToken": "private-refresh",
                "tokenType": "Bearer",
                "expiresIn": 3600
            }
        });

        broker
            .set_session_handoff("main", session.clone())
            .expect("store handoff");
        assert!(broker
            .session_handoff("popout")
            .expect("read while signed out")
            .is_none());
        broker
            .mutate(
                "main",
                SessionBrokerMutation::Unlocked {
                    active_account_id: "account-1".to_owned(),
                    shared_snapshot: Some(json!({ "isUnlocked": true })),
                },
            )
            .expect("unlock");
        assert_eq!(
            broker.session_handoff("popout").expect("read handoff"),
            Some(session),
        );

        broker
            .mutate("main", SessionBrokerMutation::Locked)
            .expect("lock");
        assert!(broker
            .session_handoff("popout")
            .expect("read after lock")
            .is_none());
    }

    #[test]
    fn lock_logout_and_account_switch_clear_or_replace_process_authorization() {
        let broker = SessionBroker::new("process-generation");
        broker.attach("main").expect("attach popup");
        broker.attach("popout").expect("attach popout");
        broker
            .mutate(
                "main",
                SessionBrokerMutation::Unlocked {
                    active_account_id: "account-1".to_owned(),
                    shared_snapshot: Some(json!({ "isUnlocked": true })),
                },
            )
            .expect("unlock");

        let selected = broker
            .mutate(
                "popout",
                SessionBrokerMutation::AccountSelected {
                    active_account_id: "account-2".to_owned(),
                },
            )
            .expect("select account");
        assert_eq!(selected.authorization, AuthorizationState::Locked);
        assert_eq!(selected.active_account_id.as_deref(), Some("account-2"));
        assert!(selected.shared_snapshot.is_none());

        let locked = broker
            .mutate("main", SessionBrokerMutation::Locked)
            .expect("lock");
        assert_eq!(locked.authorization, AuthorizationState::Locked);
        assert!(locked.shared_snapshot.is_none());

        let logged_out = broker
            .mutate("popout", SessionBrokerMutation::LoggedOut)
            .expect("log out");
        assert_eq!(logged_out.authorization, AuthorizationState::SignedOut);
        assert!(logged_out.active_account_id.is_none());
        assert!(logged_out.shared_snapshot.is_none());
    }

    #[test]
    fn repeated_popup_popout_attach_does_not_mutate_session_or_sync_versions() {
        let broker = SessionBroker::new("process-generation");
        broker.attach("main").expect("attach popup");
        broker
            .mutate(
                "main",
                SessionBrokerMutation::Unlocked {
                    active_account_id: "account-1".to_owned(),
                    shared_snapshot: Some(json!({ "isUnlocked": true, "items": [] })),
                },
            )
            .expect("unlock");
        let baseline = broker.snapshot();

        for index in 0..50 {
            let label = if index % 2 == 0 { "popout" } else { "main" };
            let attachment = broker.attach(label).expect("attach window");
            if label == "popout" {
                assert_eq!(attachment.startup_mode, StartupMode::Attach);
            }
            assert_eq!(
                attachment.snapshot.authorization,
                AuthorizationState::Unlocked
            );
            assert_eq!(
                attachment.snapshot.active_account_id.as_deref(),
                Some("account-1"),
            );
        }

        let after = broker.snapshot();
        assert_eq!(after.version, baseline.version);
        assert_eq!(after.sync_version, baseline.sync_version);
        assert_eq!(after.shared_snapshot, baseline.shared_snapshot);
    }

    #[test]
    fn only_one_window_can_own_the_process_sync_lease_at_a_time() {
        let broker = SessionBroker::new("process-generation");
        broker.attach("main").expect("attach popup");
        broker.attach("popout").expect("attach popout");
        broker
            .mutate(
                "main",
                SessionBrokerMutation::Unlocked {
                    active_account_id: "account-1".to_owned(),
                    shared_snapshot: None,
                },
            )
            .expect("unlock");
        broker
            .mutate("main", SessionBrokerMutation::SyncStarted)
            .expect("acquire first lease");

        let duplicate = broker
            .mutate("popout", SessionBrokerMutation::SyncStarted)
            .expect_err("reject duplicate sync");

        assert_eq!(duplicate.code, BrokerFailureCode::InvalidTransition);
        assert_eq!(broker.snapshot().sync_version, 1);
    }
}

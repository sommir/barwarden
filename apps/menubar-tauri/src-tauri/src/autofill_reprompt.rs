use crate::autofill_contract::AutoFillSecretField;
use crate::session_broker::{AuthorizationState, SessionBroker};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const MAXIMUM_RECEIPTS: usize = 512;
const MAIN_PICKER_WINDOW_LABEL: &str = "main";

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoFillRepromptScope {
    pub account_id: String,
    pub candidate_id: String,
    pub field: AutoFillSecretField,
    pub generation: String,
    pub context_token: String,
}

#[derive(Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "status", rename_all = "kebab-case")]
pub enum BeginRepromptOutcome {
    Pending { receipt: String },
    Unavailable,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ReceiptStatus {
    Pending,
    Verifying,
    Verified,
}

#[derive(Debug)]
struct ReceiptRecord {
    scope: AutoFillRepromptScope,
    verify_url: String,
    expires_at: Instant,
    status: ReceiptStatus,
}

type Clock = Arc<dyn Fn() -> Instant + Send + Sync>;

pub struct AutoFillRepromptReceiptStore {
    records: Mutex<HashMap<String, ReceiptRecord>>,
    lifetime: Duration,
    clock: Clock,
}

impl Default for AutoFillRepromptReceiptStore {
    fn default() -> Self {
        Self::with_clock(Duration::from_secs(30), Arc::new(Instant::now))
    }
}

impl AutoFillRepromptReceiptStore {
    pub fn with_clock(lifetime: Duration, clock: Clock) -> Self {
        assert!(lifetime > Duration::ZERO && lifetime <= Duration::from_secs(60));
        Self {
            records: Mutex::new(HashMap::new()),
            lifetime,
            clock,
        }
    }

    pub fn begin(&self, scope: AutoFillRepromptScope, verify_url: String) -> Result<String, ()> {
        validate_scope(&scope)?;
        validate_verify_url(&verify_url)?;
        let now = (self.clock)();
        let mut records = self.records.lock().map_err(|_| ())?;
        records.retain(|_, record| record.expires_at > now);
        if records.len() >= MAXIMUM_RECEIPTS {
            return Err(());
        }
        let mut receipt = uuid::Uuid::new_v4().to_string();
        while records.contains_key(&receipt) {
            receipt = uuid::Uuid::new_v4().to_string();
        }
        records.insert(
            receipt.clone(),
            ReceiptRecord {
                scope,
                verify_url,
                expires_at: now + self.lifetime,
                status: ReceiptStatus::Pending,
            },
        );
        Ok(receipt)
    }

    pub fn begin_http_verification(&self, receipt: &str, url: &str) -> Result<(), ()> {
        let now = (self.clock)();
        let mut records = self.records.lock().map_err(|_| ())?;
        let Some(record) = records.remove(receipt) else {
            return Err(());
        };
        if record.expires_at <= now
            || record.status != ReceiptStatus::Pending
            || record.verify_url != url
        {
            return Err(());
        }
        records.insert(
            receipt.to_owned(),
            ReceiptRecord {
                status: ReceiptStatus::Verifying,
                ..record
            },
        );
        Ok(())
    }

    pub fn begin_native_verification(&self, receipt: &str, account_id: &str) -> Result<(), ()> {
        let now = (self.clock)();
        let mut records = self.records.lock().map_err(|_| ())?;
        let Some(record) = records.remove(receipt) else {
            return Err(());
        };
        if record.expires_at <= now
            || record.status != ReceiptStatus::Pending
            || record.scope.account_id != account_id
        {
            return Err(());
        }
        records.insert(
            receipt.to_owned(),
            ReceiptRecord {
                status: ReceiptStatus::Verifying,
                ..record
            },
        );
        Ok(())
    }

    pub fn complete_verification(&self, receipt: &str, succeeded: bool) -> bool {
        let now = (self.clock)();
        let Ok(mut records) = self.records.lock() else {
            return false;
        };
        let Some(record) = records.remove(receipt) else {
            return false;
        };
        if !succeeded || record.expires_at <= now || record.status != ReceiptStatus::Verifying {
            return false;
        }
        records.insert(
            receipt.to_owned(),
            ReceiptRecord {
                status: ReceiptStatus::Verified,
                ..record
            },
        );
        true
    }

    pub fn consume_verified(&self, receipt: &str, scope: &AutoFillRepromptScope) -> bool {
        let now = (self.clock)();
        let Ok(mut records) = self.records.lock() else {
            return false;
        };
        let Some(record) = records.remove(receipt) else {
            return false;
        };
        record.expires_at > now
            && record.status == ReceiptStatus::Verified
            && record.scope == *scope
    }

    pub fn clear(&self) {
        if let Ok(mut records) = self.records.lock() {
            records.clear();
        }
    }
}

fn validate_scope(scope: &AutoFillRepromptScope) -> Result<(), ()> {
    if scope.account_id.trim().is_empty()
        || scope.account_id.len() > 512
        || scope.candidate_id.trim().is_empty()
        || scope.candidate_id.len() > 512
        || scope.context_token.trim().is_empty()
        || scope.context_token.len() > 512
        || uuid::Uuid::parse_str(&scope.generation).is_err()
    {
        return Err(());
    }
    Ok(())
}

fn validate_verify_url(value: &str) -> Result<(), ()> {
    let url = reqwest::Url::parse(value).map_err(|_| ())?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || !url.path().ends_with("/accounts/verify-password")
    {
        return Err(());
    }
    Ok(())
}

fn bound_verify_url(
    broker: &SessionBroker,
    window_label: &str,
    scope: &AutoFillRepromptScope,
) -> Result<String, ()> {
    validate_scope(scope)?;
    let snapshot = broker.snapshot_for(window_label).map_err(|_| ())?;
    if snapshot.authorization != AuthorizationState::Unlocked
        || snapshot.active_account_id.as_deref() != Some(scope.account_id.as_str())
    {
        return Err(());
    }
    let session = broker
        .session_handoff(window_label)
        .map_err(|_| ())?
        .ok_or(())?;
    let api_url = session
        .get("environment")
        .and_then(|environment| environment.get("apiUrl"))
        .and_then(serde_json::Value::as_str)
        .ok_or(())?;
    let mut base = api_url.trim_end_matches('/').to_owned();
    base.push('/');
    let url = reqwest::Url::parse(&base)
        .and_then(|base| base.join("accounts/verify-password"))
        .map_err(|_| ())?;
    let result = url.to_string();
    validate_verify_url(&result)?;
    Ok(result)
}

#[tauri::command]
pub fn autofill_begin_reprompt(
    window: tauri::WebviewWindow,
    broker: tauri::State<'_, SessionBroker>,
    receipts: tauri::State<'_, Arc<AutoFillRepromptReceiptStore>>,
    scope: AutoFillRepromptScope,
) -> BeginRepromptOutcome {
    if !is_main_picker_window(window.label()) {
        return BeginRepromptOutcome::Unavailable;
    }
    let result = bound_verify_url(&broker, window.label(), &scope)
        .and_then(|verify_url| receipts.begin(scope, verify_url));
    match result {
        Ok(receipt) => BeginRepromptOutcome::Pending { receipt },
        Err(()) => BeginRepromptOutcome::Unavailable,
    }
}

pub(crate) fn is_main_picker_window(label: &str) -> bool {
    label == MAIN_PICKER_WINDOW_LABEL
}

#[cfg(test)]
struct TestClock {
    now: Arc<Mutex<Instant>>,
}

#[cfg(test)]
impl TestClock {
    fn new() -> Self {
        Self {
            now: Arc::new(Mutex::new(Instant::now())),
        }
    }

    fn reader(&self) -> Clock {
        let now = Arc::clone(&self.now);
        Arc::new(move || *now.lock().unwrap())
    }

    fn advance(&self, duration: Duration) {
        let mut now = self.now.lock().unwrap();
        *now += duration;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::autofill_contract::AutoFillSecretField;
    use crate::session_broker::{SessionBroker, SessionBrokerMutation};
    use serde_json::json;

    #[test]
    fn reprompt_receipts_are_available_only_to_the_main_picker_webview() {
        assert!(is_main_picker_window("main"));
        assert!(!is_main_picker_window("popout"));
        assert!(!is_main_picker_window("main-copy"));
    }
    use std::time::Duration;

    fn scope(field: AutoFillSecretField) -> AutoFillRepromptScope {
        AutoFillRepromptScope {
            account_id: "account-a".to_owned(),
            candidate_id: "cipher-a".to_owned(),
            field,
            generation: "00000000-0000-4000-8000-000000000004".to_owned(),
            context_token: "context-a".to_owned(),
        }
    }

    #[test]
    fn verified_receipt_is_short_lived_single_use_and_bound_to_every_dimension() {
        let clock = TestClock::new();
        let store =
            AutoFillRepromptReceiptStore::with_clock(Duration::from_secs(30), clock.reader());
        let receipt = store
            .begin(
                scope(AutoFillSecretField::Password),
                "https://api.example/accounts/verify-password".to_owned(),
            )
            .unwrap();

        assert!(store
            .begin_http_verification(&receipt, "https://api.example/accounts/verify-password")
            .is_ok());
        assert!(store.complete_verification(&receipt, true));
        assert!(!store.consume_verified(&receipt, &scope(AutoFillSecretField::Username)));
        assert!(!store.consume_verified(&receipt, &scope(AutoFillSecretField::Password)));

        let expired = store
            .begin(
                scope(AutoFillSecretField::Password),
                "https://api.example/accounts/verify-password".to_owned(),
            )
            .unwrap();
        assert!(store
            .begin_http_verification(&expired, "https://api.example/accounts/verify-password")
            .is_ok());
        assert!(store.complete_verification(&expired, true));
        clock.advance(Duration::from_secs(31));
        assert!(!store.consume_verified(&expired, &scope(AutoFillSecretField::Password)));
    }

    #[test]
    fn verification_requires_the_bound_native_http_target_and_failed_attempt_burns_receipt() {
        let store = AutoFillRepromptReceiptStore::default();
        let receipt = store
            .begin(
                scope(AutoFillSecretField::Password),
                "https://api.example/accounts/verify-password".to_owned(),
            )
            .unwrap();

        assert!(store
            .begin_http_verification(
                &receipt,
                "https://attacker.example/accounts/verify-password"
            )
            .is_err());
        assert!(!store.complete_verification(&receipt, true));
        assert!(!store.consume_verified(&receipt, &scope(AutoFillSecretField::Password)));
    }

    #[test]
    fn begin_uses_only_the_unlocked_active_session_verify_endpoint() {
        let broker = SessionBroker::new("process-a");
        broker.attach("main").unwrap();
        broker
            .mutate(
                "main",
                SessionBrokerMutation::Unlocked {
                    active_account_id: "account-a".to_owned(),
                    shared_snapshot: None,
                },
            )
            .unwrap();
        broker
            .set_session_handoff(
                "main",
                json!({
                    "environment": {
                        "apiUrl": "https://vault.example/api/"
                    },
                    "token": {
                        "accessToken": "token",
                        "refreshToken": "refresh",
                        "tokenType": "Bearer",
                        "expiresIn": 3600
                    }
                }),
            )
            .unwrap();

        assert_eq!(
            bound_verify_url(&broker, "main", &scope(AutoFillSecretField::Password)).unwrap(),
            "https://vault.example/api/accounts/verify-password"
        );
        assert!(bound_verify_url(
            &broker,
            "main",
            &AutoFillRepromptScope {
                account_id: "account-b".to_owned(),
                ..scope(AutoFillSecretField::Password)
            }
        )
        .is_err());
    }
}

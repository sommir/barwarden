use crate::autofill_contract::AutoFillSecretField;
use crate::session_broker::{AuthorizationState, SessionBroker};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const MAXIMUM_RECEIPTS: usize = 512;
const MAIN_PICKER_WINDOW_LABEL: &str = "main";

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BatchBeginRequest {
    scopes: Vec<AutoFillRepromptScope>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BatchCancelRequest {
    scopes: Vec<AutoFillRepromptScope>,
    receipt: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ReceiptStatus {
    Pending,
    Verifying,
    Verified,
}

#[derive(Debug)]
struct ReceiptRecord {
    scopes: Vec<AutoFillRepromptScope>,
    verify_url: String,
    expires_at: Instant,
    status: ReceiptStatus,
}

pub(crate) struct ReservedRepromptReceipt {
    record: ReceiptRecord,
    reserved_at: Instant,
}

impl ReservedRepromptReceipt {
    pub(crate) fn consume_verified_batch(self, scopes: &[AutoFillRepromptScope]) -> bool {
        canonicalize_scopes(scopes.to_vec()).is_ok_and(|scopes| {
            self.record.expires_at > self.reserved_at
                && self.record.status == ReceiptStatus::Verified
                && self.record.scopes == scopes
        })
    }

    fn cancel_batch(self, scopes: &[AutoFillRepromptScope]) -> bool {
        canonicalize_scopes(scopes.to_vec()).is_ok_and(|scopes| self.record.scopes == scopes)
    }
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
        self.begin_batch(vec![scope], verify_url)
    }

    pub fn begin_batch(
        &self,
        scopes: Vec<AutoFillRepromptScope>,
        verify_url: String,
    ) -> Result<String, ()> {
        let scopes = canonicalize_scopes(scopes)?;
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
                scopes,
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
            || record
                .scopes
                .first()
                .is_none_or(|scope| scope.account_id != account_id)
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
        self.consume_verified_batch(receipt, std::slice::from_ref(scope))
    }

    pub fn consume_verified_batch(&self, receipt: &str, scopes: &[AutoFillRepromptScope]) -> bool {
        let now = (self.clock)();
        let Ok(mut records) = self.records.lock() else {
            return false;
        };
        let Some(record) = records.remove(receipt) else {
            return false;
        };
        let Ok(scopes) = canonicalize_scopes(scopes.to_vec()) else {
            return false;
        };
        record.expires_at > now
            && record.status == ReceiptStatus::Verified
            && record.scopes == scopes
    }

    pub fn cancel(&self, receipt: &str, scope: &AutoFillRepromptScope) -> bool {
        self.cancel_batch(receipt, std::slice::from_ref(scope))
    }

    pub fn cancel_batch(&self, receipt: &str, scopes: &[AutoFillRepromptScope]) -> bool {
        let Ok(mut records) = self.records.lock() else {
            return false;
        };
        let Some(record) = records.remove(receipt) else {
            return false;
        };
        canonicalize_scopes(scopes.to_vec()).is_ok_and(|scopes| record.scopes == scopes)
    }

    pub fn burn(&self, receipt: &str) -> bool {
        self.records
            .lock()
            .map(|mut records| records.remove(receipt).is_some())
            .unwrap_or(false)
    }

    pub(crate) fn reserve_identified(&self, receipt: &str) -> Option<ReservedRepromptReceipt> {
        let reserved_at = (self.clock)();
        let record = self.records.lock().ok()?.remove(receipt)?;
        Some(ReservedRepromptReceipt {
            record,
            reserved_at,
        })
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

fn canonicalize_scopes(
    mut scopes: Vec<AutoFillRepromptScope>,
) -> Result<Vec<AutoFillRepromptScope>, ()> {
    if scopes.is_empty() || scopes.len() > 3 {
        return Err(());
    }
    for scope in &scopes {
        validate_scope(scope)?;
    }
    let first = &scopes[0];
    if scopes.iter().any(|scope| {
        scope.account_id != first.account_id
            || scope.candidate_id != first.candidate_id
            || scope.generation != first.generation
    }) {
        return Err(());
    }
    scopes.sort_by_key(|scope| scope.field);
    if scopes.windows(2).any(|pair| pair[0].field == pair[1].field)
        || scopes.iter().enumerate().any(|(index, scope)| {
            scopes[..index]
                .iter()
                .any(|previous| previous.context_token == scope.context_token)
        })
    {
        return Err(());
    }
    Ok(scopes)
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

#[tauri::command]
pub fn autofill_begin_batch_reprompt(
    window: tauri::WebviewWindow,
    broker: tauri::State<'_, SessionBroker>,
    receipts: tauri::State<'_, Arc<AutoFillRepromptReceiptStore>>,
    request: serde_json::Value,
) -> BeginRepromptOutcome {
    begin_batch_reprompt_raw_for_window(window.label(), &broker, &receipts, request)
}

fn batch_raw_envelope_within_limits(raw: &serde_json::Value) -> bool {
    fn visit(
        value: &serde_json::Value,
        depth: usize,
        nodes: &mut usize,
        string_bytes: &mut usize,
    ) -> bool {
        *nodes = nodes.saturating_add(1);
        if depth > 6 || *nodes > 96 {
            return false;
        }
        match value {
            serde_json::Value::Null | serde_json::Value::Bool(_) | serde_json::Value::Number(_) => {
                true
            }
            serde_json::Value::String(value) => {
                *string_bytes = string_bytes.saturating_add(value.len());
                value.len() <= 16_384 && *string_bytes <= 32 * 1024
            }
            serde_json::Value::Array(values) => {
                values.len() <= 4
                    && values
                        .iter()
                        .all(|value| visit(value, depth + 1, nodes, string_bytes))
            }
            serde_json::Value::Object(values) => {
                values.len() <= 8
                    && values.iter().all(|(key, value)| {
                        key.len() <= 64 && visit(value, depth + 1, nodes, string_bytes)
                    })
            }
        }
    }

    let mut nodes = 0;
    let mut string_bytes = 0;
    raw.is_object() && visit(raw, 0, &mut nodes, &mut string_bytes)
}

fn bounded_raw_receipt(raw: &serde_json::Value) -> Option<String> {
    raw.as_object()?
        .get("receipt")?
        .as_str()
        .filter(|receipt| !receipt.trim().is_empty() && receipt.len() <= 512)
        .map(str::to_owned)
}

fn begin_batch_reprompt_raw_for_window(
    window_label: &str,
    broker: &SessionBroker,
    receipts: &AutoFillRepromptReceiptStore,
    raw: serde_json::Value,
) -> BeginRepromptOutcome {
    if !is_main_picker_window(window_label) || !batch_raw_envelope_within_limits(&raw) {
        return BeginRepromptOutcome::Unavailable;
    }
    let Ok(request) = serde_json::from_value::<BatchBeginRequest>(raw) else {
        return BeginRepromptOutcome::Unavailable;
    };
    begin_batch_reprompt_for_window(window_label, broker, receipts, request.scopes)
}

fn begin_batch_reprompt_for_window(
    window_label: &str,
    broker: &SessionBroker,
    receipts: &AutoFillRepromptReceiptStore,
    scopes: Vec<AutoFillRepromptScope>,
) -> BeginRepromptOutcome {
    if !is_main_picker_window(window_label) {
        return BeginRepromptOutcome::Unavailable;
    }
    let result = scopes
        .first()
        .ok_or(())
        .and_then(|scope| bound_verify_url(broker, window_label, scope))
        .and_then(|verify_url| receipts.begin_batch(scopes, verify_url));
    match result {
        Ok(receipt) => BeginRepromptOutcome::Pending { receipt },
        Err(()) => BeginRepromptOutcome::Unavailable,
    }
}

#[tauri::command]
pub fn autofill_cancel_reprompt(
    window: tauri::WebviewWindow,
    receipts: tauri::State<'_, Arc<AutoFillRepromptReceiptStore>>,
    scope: AutoFillRepromptScope,
    receipt: String,
) -> Result<(), &'static str> {
    cancel_reprompt_for_window(window.label(), &receipts, scope, receipt)
}

#[tauri::command]
pub fn autofill_cancel_batch_reprompt(
    window: tauri::WebviewWindow,
    receipts: tauri::State<'_, Arc<AutoFillRepromptReceiptStore>>,
    request: serde_json::Value,
) -> Result<(), &'static str> {
    cancel_batch_reprompt_raw_for_window(window.label(), &receipts, request)
}

fn cancel_batch_reprompt_raw_for_window(
    window_label: &str,
    receipts: &AutoFillRepromptReceiptStore,
    raw: serde_json::Value,
) -> Result<(), &'static str> {
    let receipt = bounded_raw_receipt(&raw);
    let reserved = receipt
        .as_deref()
        .and_then(|receipt| receipts.reserve_identified(receipt));
    if !is_main_picker_window(window_label) || !batch_raw_envelope_within_limits(&raw) {
        return Err("unavailable");
    }
    let request = match serde_json::from_value::<BatchCancelRequest>(raw) {
        Ok(request) => request,
        Err(_) => return Err("unavailable"),
    };
    if receipt.as_deref() != Some(request.receipt.as_str())
        || reserved.is_none_or(|reserved| !reserved.cancel_batch(&request.scopes))
    {
        return Err("unavailable");
    }
    Ok(())
}

#[allow(dead_code)] // Strict typed compatibility/test seam behind the raw Tauri boundary.
fn cancel_batch_reprompt_for_window(
    window_label: &str,
    receipts: &AutoFillRepromptReceiptStore,
    scopes: Vec<AutoFillRepromptScope>,
    receipt: String,
) -> Result<(), &'static str> {
    if !is_main_picker_window(window_label) || receipt.trim().is_empty() || receipt.len() > 512 {
        receipts.burn(&receipt);
        return Err("unavailable");
    }
    if !receipts.cancel_batch(&receipt, &scopes) {
        return Err("unavailable");
    }
    Ok(())
}

fn cancel_reprompt_for_window(
    window_label: &str,
    receipts: &AutoFillRepromptReceiptStore,
    scope: AutoFillRepromptScope,
    receipt: String,
) -> Result<(), &'static str> {
    if !is_main_picker_window(window_label)
        || receipt.trim().is_empty()
        || receipt.len() > 512
        || validate_scope(&scope).is_err()
    {
        receipts.burn(&receipt);
        return Err("unavailable");
    }
    if !receipts.cancel(&receipt, &scope) {
        return Err("unavailable");
    }
    Ok(())
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
            context_token: format!("context-{field:?}"),
        }
    }

    #[test]
    fn verified_batch_receipt_is_canonical_single_use_and_exact_set_bound() {
        let store = AutoFillRepromptReceiptStore::default();
        let receipt = store
            .begin_batch(
                vec![
                    scope(AutoFillSecretField::Totp),
                    scope(AutoFillSecretField::Username),
                    scope(AutoFillSecretField::Password),
                ],
                "https://api.example/accounts/verify-password".to_owned(),
            )
            .unwrap();

        assert!(store
            .begin_http_verification(&receipt, "https://api.example/accounts/verify-password")
            .is_ok());
        assert!(store.complete_verification(&receipt, true));
        assert!(store.consume_verified_batch(
            &receipt,
            &[
                scope(AutoFillSecretField::Password),
                scope(AutoFillSecretField::Totp),
                scope(AutoFillSecretField::Username),
            ]
        ));
        assert!(!store.consume_verified_batch(
            &receipt,
            &[
                scope(AutoFillSecretField::Username),
                scope(AutoFillSecretField::Password),
                scope(AutoFillSecretField::Totp),
            ]
        ));
    }

    #[test]
    fn batch_scope_mismatch_partial_consume_and_cancel_burn_the_receipt() {
        let store = AutoFillRepromptReceiptStore::default();
        let exact = vec![
            scope(AutoFillSecretField::Username),
            scope(AutoFillSecretField::Password),
        ];
        let receipt = store
            .begin_batch(
                exact.clone(),
                "https://api.example/accounts/verify-password".to_owned(),
            )
            .unwrap();
        assert!(store
            .begin_http_verification(&receipt, "https://api.example/accounts/verify-password")
            .is_ok());
        assert!(store.complete_verification(&receipt, true));

        assert!(!store.consume_verified_batch(&receipt, &[scope(AutoFillSecretField::Password)]));
        assert!(!store.consume_verified_batch(&receipt, &exact));

        let cancelled = store
            .begin_batch(
                exact.clone(),
                "https://api.example/accounts/verify-password".to_owned(),
            )
            .unwrap();
        assert!(!store.cancel_batch(&cancelled, &[scope(AutoFillSecretField::Password)]));
        assert!(!store.cancel_batch(&cancelled, &exact));
    }

    #[test]
    fn batch_receipt_rejects_duplicate_fields_and_mixed_candidate_binding() {
        let store = AutoFillRepromptReceiptStore::default();
        let mut duplicate = scope(AutoFillSecretField::Password);
        duplicate.context_token = "context-other".to_owned();
        assert!(store
            .begin_batch(
                vec![scope(AutoFillSecretField::Password), duplicate],
                "https://api.example/accounts/verify-password".to_owned(),
            )
            .is_err());

        let mut wrong_candidate = scope(AutoFillSecretField::Totp);
        wrong_candidate.candidate_id = "cipher-b".to_owned();
        assert!(store
            .begin_batch(
                vec![scope(AutoFillSecretField::Password), wrong_candidate],
                "https://api.example/accounts/verify-password".to_owned(),
            )
            .is_err());

        let password = scope(AutoFillSecretField::Password);
        let mut reused_context = scope(AutoFillSecretField::Totp);
        reused_context.context_token = password.context_token.clone();
        assert!(store
            .begin_batch(
                vec![password, reused_context],
                "https://api.example/accounts/verify-password".to_owned(),
            )
            .is_err());
    }

    #[test]
    fn expired_or_failed_batch_verification_burns_the_entire_receipt() {
        let clock = TestClock::new();
        let store =
            AutoFillRepromptReceiptStore::with_clock(Duration::from_secs(30), clock.reader());
        let exact = vec![
            scope(AutoFillSecretField::Username),
            scope(AutoFillSecretField::Password),
        ];
        let failed = store
            .begin_batch(
                exact.clone(),
                "https://api.example/accounts/verify-password".to_owned(),
            )
            .unwrap();
        assert!(store
            .begin_http_verification(&failed, "https://api.example/accounts/verify-password")
            .is_ok());
        assert!(!store.complete_verification(&failed, false));
        assert!(!store.consume_verified_batch(&failed, &exact));

        let expired = store
            .begin_batch(
                exact.clone(),
                "https://api.example/accounts/verify-password".to_owned(),
            )
            .unwrap();
        assert!(store
            .begin_http_verification(&expired, "https://api.example/accounts/verify-password")
            .is_ok());
        assert!(store.complete_verification(&expired, true));
        clock.advance(Duration::from_secs(30));
        assert!(!store.consume_verified_batch(&expired, &exact));
        assert!(!store.consume_verified_batch(&expired, &exact));
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
    fn cancellation_burns_the_receipt_and_requires_the_exact_full_scope() {
        let store = AutoFillRepromptReceiptStore::default();
        let exact = scope(AutoFillSecretField::Password);
        let receipt = store
            .begin(
                exact.clone(),
                "https://api.example/accounts/verify-password".to_owned(),
            )
            .unwrap();
        let wrong = AutoFillRepromptScope {
            candidate_id: "cipher-b".to_owned(),
            ..exact.clone()
        };

        assert!(!store.cancel(&receipt, &wrong));
        assert!(!store.cancel(&receipt, &exact));
        assert!(!store.consume_verified(&receipt, &exact));

        let malformed_receipt = store
            .begin(
                exact.clone(),
                "https://api.example/accounts/verify-password".to_owned(),
            )
            .unwrap();
        let malformed = AutoFillRepromptScope {
            account_id: String::new(),
            ..exact.clone()
        };
        assert!(
            cancel_reprompt_for_window("main", &store, malformed, malformed_receipt.clone())
                .is_err()
        );
        assert!(!store.cancel(&malformed_receipt, &exact));
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

    #[test]
    fn batch_command_helpers_require_main_and_cancel_only_the_exact_scope_set() {
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
                    "environment": { "apiUrl": "https://vault.example/api/" },
                    "token": {
                        "accessToken": "token",
                        "refreshToken": "refresh",
                        "tokenType": "Bearer",
                        "expiresIn": 3600
                    }
                }),
            )
            .unwrap();
        let receipts = AutoFillRepromptReceiptStore::default();
        let scopes = vec![
            scope(AutoFillSecretField::Username),
            scope(AutoFillSecretField::Password),
        ];

        assert_eq!(
            begin_batch_reprompt_for_window("main-copy", &broker, &receipts, scopes.clone()),
            BeginRepromptOutcome::Unavailable
        );
        let BeginRepromptOutcome::Pending { receipt } =
            begin_batch_reprompt_for_window("main", &broker, &receipts, scopes.clone())
        else {
            panic!("main batch begin must return a receipt");
        };
        assert!(cancel_batch_reprompt_for_window(
            "main",
            &receipts,
            vec![scope(AutoFillSecretField::Password)],
            receipt.clone(),
        )
        .is_err());
        assert!(cancel_batch_reprompt_for_window("main", &receipts, scopes, receipt,).is_err());
    }

    #[test]
    fn raw_batch_cancel_boundary_burns_receipt_before_strict_decode_failure() {
        let scopes = vec![scope(AutoFillSecretField::Password)];
        for mutation in [
            "unknown-root",
            "unknown-nested",
            "invalid-enum",
            "oversized",
            "wrong-window",
        ] {
            let receipts = AutoFillRepromptReceiptStore::default();
            let receipt = receipts
                .begin_batch(
                    scopes.clone(),
                    "https://api.example/accounts/verify-password".to_owned(),
                )
                .unwrap();
            let mut raw = serde_json::json!({
                "scopes": scopes,
                "receipt": receipt,
            });
            match mutation {
                "unknown-root" => raw["secret"] = "x".into(),
                "unknown-nested" => raw["scopes"][0]["secret"] = "x".into(),
                "invalid-enum" => raw["scopes"][0]["field"] = "card".into(),
                "oversized" => raw["scopes"][0]["candidateId"] = "x".repeat(70_000).into(),
                "wrong-window" => {}
                _ => unreachable!(),
            }
            assert_eq!(
                cancel_batch_reprompt_raw_for_window(
                    if mutation == "wrong-window" {
                        "main-copy"
                    } else {
                        "main"
                    },
                    &receipts,
                    raw,
                ),
                Err("unavailable")
            );
            assert!(!receipts.cancel_batch(&receipt, &scopes));
        }
    }

    #[test]
    fn raw_batch_begin_boundary_gates_main_then_strictly_decodes_bounded_scopes() {
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
                    "environment": { "apiUrl": "https://vault.example/api/" },
                    "token": {
                        "accessToken": "token",
                        "refreshToken": "refresh",
                        "tokenType": "Bearer",
                        "expiresIn": 3600
                    }
                }),
            )
            .unwrap();
        let receipts = AutoFillRepromptReceiptStore::default();
        let valid = json!({ "scopes": [scope(AutoFillSecretField::Password)] });
        assert!(matches!(
            begin_batch_reprompt_raw_for_window("main", &broker, &receipts, valid.clone()),
            BeginRepromptOutcome::Pending { .. }
        ));
        assert_eq!(
            begin_batch_reprompt_raw_for_window("main-copy", &broker, &receipts, valid),
            BeginRepromptOutcome::Unavailable
        );

        for raw in [
            json!({ "scopes": [scope(AutoFillSecretField::Password)], "unknown": true }),
            json!({ "scopes": [{
                "accountId": "account-a",
                "candidateId": "cipher-a",
                "field": "password",
                "generation": "00000000-0000-4000-8000-000000000004",
                "contextToken": "context-a",
                "unknown": true
            }] }),
            json!({ "scopes": [{
                "accountId": "account-a",
                "candidateId": "cipher-a",
                "field": "card",
                "generation": "00000000-0000-4000-8000-000000000004",
                "contextToken": "context-a"
            }] }),
            json!({ "scopes": [{
                "accountId": "account-a",
                "candidateId": "x".repeat(70_000),
                "field": "password",
                "generation": "00000000-0000-4000-8000-000000000004",
                "contextToken": "context-a"
            }] }),
        ] {
            assert_eq!(
                begin_batch_reprompt_raw_for_window("main", &broker, &receipts, raw),
                BeginRepromptOutcome::Unavailable
            );
        }
    }
}

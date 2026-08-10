use crate::autofill_ax_context::{
    CapturedFieldFingerprint, CapturedFillPlan, DetectedFillContextStore,
};
use crate::autofill_contract::{AgentErrorCode, AutoFillSecretField};
use crate::autofill_reprompt::{
    is_main_picker_window, AutoFillRepromptReceiptStore, AutoFillRepromptScope,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use zeroize::{Zeroize, Zeroizing};

pub(crate) const MAXIMUM_SECRET_BYTES: usize = 16_384;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DetectedFillAuthorization {
    pub scope: AutoFillRepromptScope,
    pub mismatch_confirmed: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DetectedFillRequest {
    pub fill_context_token: String,
    pub authorizations: Vec<DetectedFillAuthorization>,
    pub reprompt_receipt: Option<String>,
}

#[derive(Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "status", rename_all = "kebab-case")]
pub enum DetectedFillOutcome {
    Success {
        fields: Vec<AutoFillSecretField>,
    },
    Partial {
        filled: Vec<AutoFillSecretField>,
        failed: AutoFillSecretField,
        code: &'static str,
    },
    Error {
        code: &'static str,
    },
}

pub(crate) struct CollectedSecret {
    field: AutoFillSecretField,
    value: Zeroizing<String>,
    #[cfg(test)]
    drop_observer: Option<Box<dyn Fn(&str)>>,
}

impl CollectedSecret {
    pub(crate) fn new(field: AutoFillSecretField, value: Zeroizing<String>) -> Self {
        Self {
            field,
            value,
            #[cfg(test)]
            drop_observer: None,
        }
    }

    #[cfg(test)]
    fn new_observed(
        field: AutoFillSecretField,
        value: Zeroizing<String>,
        observer: impl Fn(&str) + 'static,
    ) -> Self {
        Self {
            field,
            value,
            drop_observer: Some(Box::new(observer)),
        }
    }
}

impl Drop for CollectedSecret {
    fn drop(&mut self) {
        self.value.zeroize();
        #[cfg(test)]
        if let Some(observer) = self.drop_observer.as_ref() {
            observer(&self.value);
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum ExactSetValueOutcome {
    Written,
    Unsupported,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum ExactAxFillError {
    TargetChanged,
    ProcessChanged,
    WindowChanged,
    FrameChanged,
    GenerationChanged,
    WriteFailed,
    PasteFailed,
}

impl ExactAxFillError {
    fn outcome_code(self) -> &'static str {
        match self {
            Self::TargetChanged
            | Self::ProcessChanged
            | Self::WindowChanged
            | Self::FrameChanged
            | Self::GenerationChanged => "stale-context",
            Self::WriteFailed | Self::PasteFailed => "fill-failed",
        }
    }
}

pub(crate) trait ExactAxFillPort {
    fn set_value_exact(
        &mut self,
        plan: &CapturedFillPlan,
        fingerprint: &CapturedFieldFingerprint,
        field: AutoFillSecretField,
        value: &str,
    ) -> Result<ExactSetValueOutcome, ExactAxFillError>;

    fn focus_and_paste_exact(
        &mut self,
        plan: &CapturedFillPlan,
        fingerprint: &CapturedFieldFingerprint,
        field: AutoFillSecretField,
        value: &str,
    ) -> Result<(), ExactAxFillError>;
}

struct NativeExactAxFillPort {
    clipboard_generation: crate::clipboard::ClipboardGeneration,
}

impl ExactAxFillPort for NativeExactAxFillPort {
    fn set_value_exact(
        &mut self,
        plan: &CapturedFillPlan,
        fingerprint: &CapturedFieldFingerprint,
        _field: AutoFillSecretField,
        value: &str,
    ) -> Result<ExactSetValueOutcome, ExactAxFillError> {
        crate::autofill_ax_context::set_value_exact(plan, fingerprint, value)
    }

    fn focus_and_paste_exact(
        &mut self,
        plan: &CapturedFillPlan,
        fingerprint: &CapturedFieldFingerprint,
        _field: AutoFillSecretField,
        value: &str,
    ) -> Result<(), ExactAxFillError> {
        crate::autofill_ax_context::focus_and_paste_exact(
            plan,
            fingerprint,
            value,
            &self.clipboard_generation,
        )
    }
}

fn valid_scope(scope: &AutoFillRepromptScope) -> bool {
    !scope.account_id.trim().is_empty()
        && scope.account_id.len() <= 512
        && !scope.candidate_id.trim().is_empty()
        && scope.candidate_id.len() <= 512
        && !scope.context_token.trim().is_empty()
        && scope.context_token.len() <= 512
        && uuid::Uuid::parse_str(&scope.generation).is_ok()
}

fn canonical_authorizations(
    mut authorizations: Vec<DetectedFillAuthorization>,
) -> Result<Vec<DetectedFillAuthorization>, ()> {
    if authorizations.is_empty() || authorizations.len() > 3 {
        return Err(());
    }
    authorizations.sort_by_key(|authorization| authorization.scope.field);
    if authorizations
        .windows(2)
        .any(|pair| pair[0].scope.field == pair[1].scope.field)
        || authorizations
            .iter()
            .enumerate()
            .any(|(index, authorization)| {
                authorizations[..index].iter().any(|previous| {
                    previous.scope.context_token == authorization.scope.context_token
                })
            })
    {
        return Err(());
    }
    let first = &authorizations[0].scope;
    if !authorizations.iter().all(|authorization| {
        let scope = &authorization.scope;
        valid_scope(scope)
            && scope.account_id == first.account_id
            && scope.candidate_id == first.candidate_id
            && scope.generation == first.generation
    }) {
        return Err(());
    }
    Ok(authorizations)
}

fn error(code: &'static str) -> DetectedFillOutcome {
    DetectedFillOutcome::Error { code }
}

fn bounded_root_string<'a>(raw: &'a serde_json::Value, key: &str) -> Option<&'a str> {
    raw.as_object()?
        .get(key)?
        .as_str()
        .filter(|value| !value.trim().is_empty() && value.len() <= 512)
}

fn raw_fill_envelope_within_limits(raw: &serde_json::Value) -> bool {
    fn visit(
        value: &serde_json::Value,
        depth: usize,
        nodes: &mut usize,
        string_bytes: &mut usize,
    ) -> bool {
        *nodes = nodes.saturating_add(1);
        if depth > 8 || *nodes > 128 {
            return false;
        }
        match value {
            serde_json::Value::Null | serde_json::Value::Bool(_) | serde_json::Value::Number(_) => {
                true
            }
            serde_json::Value::String(value) => {
                *string_bytes = string_bytes.saturating_add(value.len());
                value.len() <= MAXIMUM_SECRET_BYTES && *string_bytes <= 64 * 1024
            }
            serde_json::Value::Array(values) => {
                values.len() <= 8
                    && values
                        .iter()
                        .all(|value| visit(value, depth + 1, nodes, string_bytes))
            }
            serde_json::Value::Object(values) => {
                values.len() <= 16
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

fn burn_raw_fill_credentials(
    contexts: &DetectedFillContextStore,
    receipts: &AutoFillRepromptReceiptStore,
    context_token: Option<&str>,
    receipt: Option<&str>,
) {
    if let Some(context_token) = context_token {
        let _ = contexts.reserve_identified(context_token);
    }
    if let Some(receipt) = receipt {
        let _ = receipts.reserve_identified(receipt);
    }
}

pub(crate) fn perform_detected_fill_raw_with<Release, Port>(
    window_label: &str,
    contexts: &DetectedFillContextStore,
    receipts: &AutoFillRepromptReceiptStore,
    raw: serde_json::Value,
    release_secret: &mut Release,
    port: &mut Port,
) -> DetectedFillOutcome
where
    Release: FnMut(AutoFillRepromptScope, bool, bool) -> Result<CollectedSecret, AgentErrorCode>,
    Port: ExactAxFillPort,
{
    let context_token = bounded_root_string(&raw, "fillContextToken").map(str::to_owned);
    let receipt = bounded_root_string(&raw, "repromptReceipt").map(str::to_owned);
    if !is_main_picker_window(window_label) {
        burn_raw_fill_credentials(
            contexts,
            receipts,
            context_token.as_deref(),
            receipt.as_deref(),
        );
        return error("unauthorized");
    }
    let reserved_context = context_token
        .as_deref()
        .and_then(|token| contexts.reserve_identified(token).ok());
    let reserved_receipt = receipt
        .as_deref()
        .and_then(|receipt| receipts.reserve_identified(receipt));
    if !raw_fill_envelope_within_limits(&raw) {
        return error("invalid-request");
    }
    let request = match serde_json::from_value::<DetectedFillRequest>(raw) {
        Ok(request) => request,
        Err(_) => return error("invalid-request"),
    };
    let DetectedFillRequest {
        fill_context_token,
        authorizations,
        reprompt_receipt,
    } = request;
    if context_token.as_deref() != Some(fill_context_token.as_str())
        || receipt.as_deref() != reprompt_receipt.as_deref()
        || fill_context_token.trim().is_empty()
        || fill_context_token.len() > 512
        || reprompt_receipt
            .as_ref()
            .is_some_and(|receipt| receipt.trim().is_empty() || receipt.len() > 512)
    {
        return error("invalid-request");
    }
    let mut requested = authorizations
        .iter()
        .map(|authorization| authorization.scope.field)
        .collect::<Vec<_>>();
    requested.sort_unstable();
    let plan = match reserved_context
        .and_then(|reserved| contexts.validate_reserved(reserved, &requested).ok())
    {
        Some(plan) => plan,
        None => return error("stale-context"),
    };
    let authorizations = match canonical_authorizations(authorizations) {
        Ok(authorizations) => authorizations,
        Err(()) => return error("invalid-request"),
    };
    let scopes = authorizations
        .iter()
        .map(|authorization| authorization.scope.clone())
        .collect::<Vec<_>>();
    let reprompt_verified = match reprompt_receipt {
        Some(_)
            if reserved_receipt.is_some_and(|receipt| receipt.consume_verified_batch(&scopes)) =>
        {
            true
        }
        Some(_) => return error("reprompt-failed"),
        None => false,
    };
    execute_taken_fill(
        plan,
        authorizations,
        reprompt_verified,
        release_secret,
        port,
    )
}

#[allow(dead_code)] // Typed test seam; the Tauri boundary intentionally accepts bounded raw JSON.
pub(crate) fn perform_detected_fill_with<Release, Port>(
    window_label: &str,
    contexts: &DetectedFillContextStore,
    receipts: &AutoFillRepromptReceiptStore,
    request: DetectedFillRequest,
    release_secret: &mut Release,
    port: &mut Port,
) -> DetectedFillOutcome
where
    Release: FnMut(AutoFillRepromptScope, bool, bool) -> Result<CollectedSecret, AgentErrorCode>,
    Port: ExactAxFillPort,
{
    let DetectedFillRequest {
        fill_context_token,
        authorizations,
        reprompt_receipt,
    } = request;
    if !is_main_picker_window(window_label) {
        contexts.burn(&fill_context_token);
        if let Some(receipt) = reprompt_receipt.as_deref() {
            receipts.burn(receipt);
        }
        return error("unauthorized");
    }

    let mut requested = authorizations
        .iter()
        .map(|authorization| authorization.scope.field)
        .collect::<Vec<_>>();
    requested.sort_unstable();
    let plan = match contexts.take(&fill_context_token, &requested) {
        Ok(plan) => plan,
        Err(_) => {
            if let Some(receipt) = reprompt_receipt.as_deref() {
                receipts.burn(receipt);
            }
            return error("stale-context");
        }
    };
    let authorizations = match canonical_authorizations(authorizations) {
        Ok(authorizations) => authorizations,
        Err(()) => {
            if let Some(receipt) = reprompt_receipt.as_deref() {
                receipts.burn(receipt);
            }
            return error("invalid-request");
        }
    };
    if fill_context_token.trim().is_empty()
        || fill_context_token.len() > 512
        || reprompt_receipt
            .as_ref()
            .is_some_and(|receipt| receipt.trim().is_empty() || receipt.len() > 512)
    {
        if let Some(receipt) = reprompt_receipt.as_deref() {
            receipts.burn(receipt);
        }
        return error("invalid-request");
    }
    let scopes = authorizations
        .iter()
        .map(|authorization| authorization.scope.clone())
        .collect::<Vec<_>>();
    let reprompt_verified = match reprompt_receipt.as_deref() {
        Some(receipt) if receipts.consume_verified_batch(receipt, &scopes) => true,
        Some(_) => return error("reprompt-failed"),
        None => false,
    };

    execute_taken_fill(
        plan,
        authorizations,
        reprompt_verified,
        release_secret,
        port,
    )
}

fn execute_taken_fill<Release, Port>(
    plan: CapturedFillPlan,
    authorizations: Vec<DetectedFillAuthorization>,
    reprompt_verified: bool,
    release_secret: &mut Release,
    port: &mut Port,
) -> DetectedFillOutcome
where
    Release: FnMut(AutoFillRepromptScope, bool, bool) -> Result<CollectedSecret, AgentErrorCode>,
    Port: ExactAxFillPort,
{
    let mut secrets = Vec::with_capacity(authorizations.len());
    for authorization in authorizations {
        let expected_field = authorization.scope.field;
        let secret = match release_secret(
            authorization.scope,
            authorization.mismatch_confirmed,
            reprompt_verified,
        ) {
            Ok(secret)
                if secret.field == expected_field && secret.value.len() <= MAXIMUM_SECRET_BYTES =>
            {
                secret
            }
            Ok(_) | Err(_) => return error("secret-release-failed"),
        };
        secrets.push(secret);
    }

    let mut filled = Vec::with_capacity(secrets.len());
    for secret in &secrets {
        let Some(fingerprint) = plan.fingerprint_for_field(secret.field) else {
            return DetectedFillOutcome::Partial {
                filled,
                failed: secret.field,
                code: "stale-context",
            };
        };
        let result = match port.set_value_exact(&plan, fingerprint, secret.field, &secret.value) {
            Ok(ExactSetValueOutcome::Written) => Ok(()),
            Ok(ExactSetValueOutcome::Unsupported) => {
                port.focus_and_paste_exact(&plan, fingerprint, secret.field, &secret.value)
            }
            Err(error) => Err(error),
        };
        if let Err(fill_error) = result {
            return DetectedFillOutcome::Partial {
                filled,
                failed: secret.field,
                code: fill_error.outcome_code(),
            };
        }
        filled.push(secret.field);
    }

    DetectedFillOutcome::Success { fields: filled }
}

#[tauri::command]
pub fn autofill_fill_detected(
    window: tauri::WebviewWindow,
    contexts: tauri::State<'_, DetectedFillContextStore>,
    receipts: tauri::State<'_, Arc<AutoFillRepromptReceiptStore>>,
    clipboard_generation: tauri::State<'_, crate::clipboard::ClipboardGeneration>,
    request: serde_json::Value,
) -> DetectedFillOutcome {
    let mut client = None;
    let mut release =
        |scope: AutoFillRepromptScope, mismatch_confirmed: bool, reprompt_verified: bool| {
            let client = client
                .get_or_insert_with(crate::autofill_ipc::AgentClient::system_default)
                .as_ref()
                .map_err(|code| *code)?;
            crate::autofill_ipc::perform_secret_with_verified_scope(
                client,
                scope,
                mismatch_confirmed,
                reprompt_verified,
            )
            .map(|(field, value)| CollectedSecret::new(field, value))
        };
    perform_detected_fill_raw_with(
        window.label(),
        &contexts,
        &receipts,
        request,
        &mut release,
        &mut NativeExactAxFillPort {
            clipboard_generation: clipboard_generation.inner().clone(),
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::accessibility_focus::AxFrame;
    use crate::autofill_ax_context::{
        CapturedFieldFingerprint, DetectedFillContextStore, ObserverGeneration, OpaqueAxIdentity,
    };
    use crate::autofill_contract::{AgentErrorCode, AutoFillSecretField};
    use crate::autofill_field_context::{DetectedAction, DetectedFieldKind, FieldConfidence};
    use crate::autofill_reprompt::{AutoFillRepromptReceiptStore, AutoFillRepromptScope};
    use crate::frontmost::test_frontmost_app;
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    };
    use std::time::Instant;
    use zeroize::Zeroizing;

    #[allow(dead_code)]
    #[derive(Clone, Copy, Debug, Eq, PartialEq)]
    enum TestAction {
        SetValue(AutoFillSecretField),
        FocusAndPaste(AutoFillSecretField),
        PressReturn,
        PressTab,
        PressButton,
    }

    struct RecordingAxPort {
        actions: Vec<TestAction>,
        targeted_focused: Vec<bool>,
        targeted_x: Vec<f64>,
        unsupported: Option<AutoFillSecretField>,
        failures: Vec<(AutoFillSecretField, ExactAxFillError)>,
        events: Option<Arc<Mutex<Vec<(bool, AutoFillSecretField)>>>>,
    }

    impl Default for RecordingAxPort {
        fn default() -> Self {
            Self {
                actions: Vec::new(),
                targeted_focused: Vec::new(),
                targeted_x: Vec::new(),
                unsupported: None,
                failures: Vec::new(),
                events: None,
            }
        }
    }

    impl ExactAxFillPort for RecordingAxPort {
        fn set_value_exact(
            &mut self,
            _plan: &crate::autofill_ax_context::CapturedFillPlan,
            fingerprint: &CapturedFieldFingerprint,
            field: AutoFillSecretField,
            _value: &str,
        ) -> Result<ExactSetValueOutcome, ExactAxFillError> {
            if let Some(index) = self
                .failures
                .iter()
                .position(|(failed, _)| *failed == field)
            {
                return Err(self.failures.remove(index).1);
            }
            if self.unsupported == Some(field) {
                return Ok(ExactSetValueOutcome::Unsupported);
            }
            if let Some(events) = &self.events {
                events.lock().unwrap().push((true, field));
            }
            self.targeted_focused.push(fingerprint.focused);
            self.targeted_x.push(fingerprint.frame.x);
            self.actions.push(TestAction::SetValue(field));
            Ok(ExactSetValueOutcome::Written)
        }

        fn focus_and_paste_exact(
            &mut self,
            _plan: &crate::autofill_ax_context::CapturedFillPlan,
            fingerprint: &CapturedFieldFingerprint,
            field: AutoFillSecretField,
            _value: &str,
        ) -> Result<(), ExactAxFillError> {
            if let Some(index) = self
                .failures
                .iter()
                .position(|(failed, _)| *failed == field)
            {
                return Err(self.failures.remove(index).1);
            }
            if let Some(events) = &self.events {
                events.lock().unwrap().push((true, field));
            }
            self.targeted_focused.push(fingerprint.focused);
            self.targeted_x.push(fingerprint.frame.x);
            self.actions.push(TestAction::FocusAndPaste(field));
            Ok(())
        }
    }

    fn fingerprint(field: AutoFillSecretField, focused: bool) -> CapturedFieldFingerprint {
        CapturedFieldFingerprint {
            process_id: 42,
            role: if field == AutoFillSecretField::Password {
                "AXSecureTextField".to_owned()
            } else {
                "AXTextField".to_owned()
            },
            frame: AxFrame {
                x: 10.0 + (field as u8 as f64 * 10.0),
                y: 20.0,
                width: 200.0,
                height: 24.0,
            },
            window_frame: AxFrame {
                x: 0.0,
                y: 0.0,
                width: 800.0,
                height: 600.0,
            },
            container_path: vec![1],
            traversal_path: vec![1, field as u8 as u16 + 1],
            window_identity: OpaqueAxIdentity::for_test(1),
            element_identity: OpaqueAxIdentity::for_test(10 + field as u8 as u64),
            kind: match field {
                AutoFillSecretField::Username => DetectedFieldKind::Username,
                AutoFillSecretField::Password => DetectedFieldKind::Password,
                AutoFillSecretField::Totp => DetectedFieldKind::OneTimeCode,
            },
            secret_field: Some(field),
            confidence: FieldConfidence::High,
            focused,
            observer_generation: 7,
        }
    }

    fn scope(field: AutoFillSecretField) -> AutoFillRepromptScope {
        AutoFillRepromptScope {
            account_id: "account-a".to_owned(),
            candidate_id: "cipher-a".to_owned(),
            field,
            generation: "00000000-0000-4000-8000-000000000004".to_owned(),
            context_token: format!("context-{field:?}"),
        }
    }

    fn authorization(field: AutoFillSecretField) -> DetectedFillAuthorization {
        DetectedFillAuthorization {
            scope: scope(field),
            mismatch_confirmed: false,
        }
    }

    fn raw_request(request: &DetectedFillRequest) -> serde_json::Value {
        serde_json::json!({
            "fillContextToken": request.fill_context_token,
            "authorizations": request.authorizations.iter().map(|authorization| serde_json::json!({
                "scope": {
                    "accountId": authorization.scope.account_id,
                    "candidateId": authorization.scope.candidate_id,
                    "field": authorization.scope.field,
                    "generation": authorization.scope.generation,
                    "contextToken": authorization.scope.context_token,
                },
                "mismatchConfirmed": authorization.mismatch_confirmed,
            })).collect::<Vec<_>>(),
            "repromptReceipt": request.reprompt_receipt,
        })
    }

    fn fixture(
        requested: &[AutoFillSecretField],
    ) -> (DetectedFillContextStore, DetectedFillRequest) {
        let generation = ObserverGeneration::new(7);
        let store = DetectedFillContextStore::for_test_with_generation(
            generation,
            Instant::now,
            |_, _, _| Ok(()),
        );
        let all_fields = vec![
            fingerprint(AutoFillSecretField::Username, true),
            fingerprint(AutoFillSecretField::Password, false),
            fingerprint(AutoFillSecretField::Totp, false),
        ];
        let presentation = store
            .try_insert(
                test_frontmost_app("com.example.Login", 42, 7),
                all_fields,
                DetectedAction::Form {
                    fields: vec![
                        AutoFillSecretField::Username,
                        AutoFillSecretField::Password,
                        AutoFillSecretField::Totp,
                    ],
                },
            )
            .unwrap();
        (
            store,
            DetectedFillRequest {
                fill_context_token: presentation.fill_context_token,
                authorizations: requested.iter().copied().map(authorization).collect(),
                reprompt_receipt: None,
            },
        )
    }

    fn released(field: AutoFillSecretField) -> CollectedSecret {
        CollectedSecret::new(field, Zeroizing::new(format!("secret-value-{field:?}")))
    }

    #[test]
    fn executor_fills_the_exact_elements_once_in_canonical_field_order() {
        let (contexts, request) = fixture(&[
            AutoFillSecretField::Totp,
            AutoFillSecretField::Password,
            AutoFillSecretField::Username,
        ]);
        let receipts = AutoFillRepromptReceiptStore::default();
        let mut releases = Vec::new();
        let mut release = |scope: AutoFillRepromptScope, _: bool, _: bool| {
            releases.push((scope.field, scope.context_token.clone()));
            Ok(released(scope.field))
        };
        let mut port = RecordingAxPort {
            unsupported: Some(AutoFillSecretField::Totp),
            ..RecordingAxPort::default()
        };

        let outcome = perform_detected_fill_with(
            "main",
            &contexts,
            &receipts,
            request,
            &mut release,
            &mut port,
        );

        assert_eq!(
            outcome,
            DetectedFillOutcome::Success {
                fields: vec![
                    AutoFillSecretField::Username,
                    AutoFillSecretField::Password,
                    AutoFillSecretField::Totp,
                ]
            }
        );
        assert_eq!(
            releases,
            vec![
                (AutoFillSecretField::Username, "context-Username".to_owned()),
                (AutoFillSecretField::Password, "context-Password".to_owned()),
                (AutoFillSecretField::Totp, "context-Totp".to_owned()),
            ]
        );
        assert_eq!(
            port.actions,
            vec![
                TestAction::SetValue(AutoFillSecretField::Username),
                TestAction::SetValue(AutoFillSecretField::Password),
                TestAction::FocusAndPaste(AutoFillSecretField::Totp),
            ]
        );
        assert!(!port.actions.iter().any(|action| matches!(
            action,
            TestAction::PressReturn | TestAction::PressTab | TestAction::PressButton
        )));
    }

    #[test]
    fn choose_binds_the_one_requested_field_to_the_unique_focused_element_even_if_unknown() {
        let generation = ObserverGeneration::new(7);
        let contexts = DetectedFillContextStore::for_test_with_generation(
            generation,
            Instant::now,
            |_, _, _| Ok(()),
        );
        let mut semantic_username = fingerprint(AutoFillSecretField::Username, false);
        semantic_username.frame.x = 10.0;
        let mut focused_unknown = fingerprint(AutoFillSecretField::Password, true);
        focused_unknown.frame.x = 90.0;
        focused_unknown.kind = DetectedFieldKind::Unknown;
        focused_unknown.secret_field = None;
        let presentation = contexts
            .try_insert(
                test_frontmost_app("com.example.Login", 42, 7),
                vec![semantic_username, focused_unknown],
                DetectedAction::Choose,
            )
            .unwrap();
        let request = DetectedFillRequest {
            fill_context_token: presentation.fill_context_token,
            authorizations: vec![authorization(AutoFillSecretField::Username)],
            reprompt_receipt: None,
        };
        let receipts = AutoFillRepromptReceiptStore::default();
        let mut release =
            |scope: AutoFillRepromptScope, _: bool, _: bool| Ok(released(scope.field));
        let mut port = RecordingAxPort::default();

        assert_eq!(
            perform_detected_fill_with(
                "main",
                &contexts,
                &receipts,
                request,
                &mut release,
                &mut port,
            ),
            DetectedFillOutcome::Success {
                fields: vec![AutoFillSecretField::Username]
            }
        );
        assert_eq!(port.targeted_focused, vec![true]);
    }

    #[test]
    fn form_binds_only_fields_from_the_unique_action_selected_container() {
        let generation = ObserverGeneration::new(7);
        let contexts = DetectedFillContextStore::for_test_with_generation(
            generation,
            Instant::now,
            |_, _, _| Ok(()),
        );
        let mut unrelated_username = fingerprint(AutoFillSecretField::Username, false);
        unrelated_username.frame.x = 10.0;
        unrelated_username.container_path = vec![1];
        let mut selected_username = fingerprint(AutoFillSecretField::Username, false);
        selected_username.frame.x = 50.0;
        selected_username.container_path = vec![2];
        selected_username.traversal_path = vec![2, 1];
        selected_username.element_identity = OpaqueAxIdentity::for_test(21);
        let mut selected_password = fingerprint(AutoFillSecretField::Password, true);
        selected_password.frame.x = 60.0;
        selected_password.container_path = vec![2];
        selected_password.traversal_path = vec![2, 2];
        let presentation = contexts
            .try_insert(
                test_frontmost_app("com.example.Login", 42, 7),
                vec![unrelated_username, selected_username, selected_password],
                DetectedAction::Form {
                    fields: vec![AutoFillSecretField::Username, AutoFillSecretField::Password],
                },
            )
            .unwrap();
        let request = DetectedFillRequest {
            fill_context_token: presentation.fill_context_token,
            authorizations: vec![
                authorization(AutoFillSecretField::Username),
                authorization(AutoFillSecretField::Password),
            ],
            reprompt_receipt: None,
        };
        let receipts = AutoFillRepromptReceiptStore::default();
        let mut release =
            |scope: AutoFillRepromptScope, _: bool, _: bool| Ok(released(scope.field));
        let mut port = RecordingAxPort::default();

        assert!(matches!(
            perform_detected_fill_with(
                "main",
                &contexts,
                &receipts,
                request,
                &mut release,
                &mut port,
            ),
            DetectedFillOutcome::Success { .. }
        ));
        assert_eq!(port.targeted_x, vec![50.0, 60.0]);
    }

    #[test]
    fn form_rejects_duplicate_or_ambiguous_container_bindings_before_secret_release() {
        let generation = ObserverGeneration::new(7);
        let contexts = DetectedFillContextStore::for_test_with_generation(
            generation,
            Instant::now,
            |_, _, _| Ok(()),
        );
        let mut username_one = fingerprint(AutoFillSecretField::Username, false);
        username_one.element_identity = OpaqueAxIdentity::for_test(40);
        let mut username_two = username_one.clone();
        username_two.element_identity = OpaqueAxIdentity::for_test(41);
        username_two.traversal_path = vec![1, 8];
        let mut password = fingerprint(AutoFillSecretField::Password, true);
        password.element_identity = OpaqueAxIdentity::for_test(42);

        assert_eq!(
            contexts
                .try_insert(
                    test_frontmost_app("com.example.Login", 42, 7),
                    vec![username_one, username_two, password],
                    DetectedAction::Form {
                        fields: vec![AutoFillSecretField::Username, AutoFillSecretField::Password,],
                    },
                )
                .unwrap_err(),
            crate::autofill_ax_context::DetectedFillError::StaleField
        );
    }

    #[test]
    fn all_secrets_are_collected_before_writes_and_release_failure_writes_nothing() {
        let (contexts, request) = fixture(&[
            AutoFillSecretField::Username,
            AutoFillSecretField::Password,
            AutoFillSecretField::Totp,
        ]);
        let receipts = AutoFillRepromptReceiptStore::default();
        let events = Arc::new(Mutex::new(Vec::new()));
        let release_events = Arc::clone(&events);
        let mut release = move |scope: AutoFillRepromptScope, _: bool, _: bool| {
            release_events.lock().unwrap().push((false, scope.field));
            if scope.field == AutoFillSecretField::Totp {
                Err(AgentErrorCode::Unauthorized)
            } else {
                Ok(released(scope.field))
            }
        };
        let mut port = RecordingAxPort {
            events: Some(Arc::clone(&events)),
            ..RecordingAxPort::default()
        };

        assert_eq!(
            perform_detected_fill_with(
                "main",
                &contexts,
                &receipts,
                request,
                &mut release,
                &mut port,
            ),
            DetectedFillOutcome::Error {
                code: "secret-release-failed"
            }
        );
        assert_eq!(
            *events.lock().unwrap(),
            vec![
                (false, AutoFillSecretField::Username),
                (false, AutoFillSecretField::Password),
                (false, AutoFillSecretField::Totp),
            ]
        );
        assert!(port.actions.is_empty());
    }

    #[test]
    fn every_owned_secret_is_zeroized_after_success_and_release_failure() {
        for fail_on in [None, Some(AutoFillSecretField::Totp)] {
            let (contexts, request) = fixture(&[
                AutoFillSecretField::Username,
                AutoFillSecretField::Password,
                AutoFillSecretField::Totp,
            ]);
            let receipts = AutoFillRepromptReceiptStore::default();
            let zeroized = Arc::new(AtomicUsize::new(0));
            let observed = Arc::clone(&zeroized);
            let mut release = move |scope: AutoFillRepromptScope, _: bool, _: bool| {
                if fail_on == Some(scope.field) {
                    return Err(AgentErrorCode::Unauthorized);
                }
                let observed = Arc::clone(&observed);
                Ok(CollectedSecret::new_observed(
                    scope.field,
                    Zeroizing::new(format!("secret-value-{:?}", scope.field)),
                    move |value| {
                        assert!(value.is_empty());
                        observed.fetch_add(1, Ordering::SeqCst);
                    },
                ))
            };
            let mut port = RecordingAxPort::default();

            let _ = perform_detected_fill_with(
                "main",
                &contexts,
                &receipts,
                request,
                &mut release,
                &mut port,
            );

            assert_eq!(
                zeroized.load(Ordering::SeqCst),
                if fail_on.is_some() { 2 } else { 3 }
            );
        }
    }

    #[test]
    fn first_ax_failure_returns_metadata_only_partial_and_stops() {
        let (contexts, request) = fixture(&[
            AutoFillSecretField::Username,
            AutoFillSecretField::Password,
            AutoFillSecretField::Totp,
        ]);
        let receipts = AutoFillRepromptReceiptStore::default();
        let mut release =
            |scope: AutoFillRepromptScope, _: bool, _: bool| Ok(released(scope.field));
        let mut port = RecordingAxPort::default();
        port.failures
            .push((AutoFillSecretField::Password, ExactAxFillError::WriteFailed));

        let outcome = perform_detected_fill_with(
            "main",
            &contexts,
            &receipts,
            request,
            &mut release,
            &mut port,
        );

        assert_eq!(
            outcome,
            DetectedFillOutcome::Partial {
                filled: vec![AutoFillSecretField::Username],
                failed: AutoFillSecretField::Password,
                code: "fill-failed",
            }
        );
        assert_eq!(
            port.actions,
            vec![TestAction::SetValue(AutoFillSecretField::Username)]
        );
        let serialized = serde_json::to_string(&outcome).unwrap();
        assert!(!serialized.contains("secret-value"));
        assert!(!serialized.contains("context-"));
    }

    #[test]
    fn exact_target_window_frame_or_generation_change_fails_before_that_write() {
        for error in [
            ExactAxFillError::TargetChanged,
            ExactAxFillError::ProcessChanged,
            ExactAxFillError::WindowChanged,
            ExactAxFillError::FrameChanged,
            ExactAxFillError::GenerationChanged,
        ] {
            let (contexts, request) =
                fixture(&[AutoFillSecretField::Username, AutoFillSecretField::Password]);
            let receipts = AutoFillRepromptReceiptStore::default();
            let mut release =
                |scope: AutoFillRepromptScope, _: bool, _: bool| Ok(released(scope.field));
            let mut port = RecordingAxPort::default();
            port.failures.push((AutoFillSecretField::Username, error));

            assert_eq!(
                perform_detected_fill_with(
                    "main",
                    &contexts,
                    &receipts,
                    request,
                    &mut release,
                    &mut port,
                ),
                DetectedFillOutcome::Partial {
                    filled: Vec::new(),
                    failed: AutoFillSecretField::Username,
                    code: "stale-context",
                }
            );
            assert!(port.actions.is_empty());
        }
    }

    #[test]
    fn verified_batch_receipt_is_consumed_once_before_field_scoped_releases() {
        let (contexts, mut request) =
            fixture(&[AutoFillSecretField::Username, AutoFillSecretField::Password]);
        let receipts = AutoFillRepromptReceiptStore::default();
        let scopes = request
            .authorizations
            .iter()
            .map(|authorization| authorization.scope.clone())
            .collect::<Vec<_>>();
        let receipt = receipts
            .begin_batch(
                scopes.clone(),
                "https://api.example/accounts/verify-password".to_owned(),
            )
            .unwrap();
        receipts
            .begin_http_verification(&receipt, "https://api.example/accounts/verify-password")
            .unwrap();
        assert!(receipts.complete_verification(&receipt, true));
        request.reprompt_receipt = Some(receipt.clone());
        let verified = Arc::new(Mutex::new(Vec::new()));
        let verified_calls = Arc::clone(&verified);
        let mut release = move |scope: AutoFillRepromptScope, _: bool, is_verified: bool| {
            verified_calls
                .lock()
                .unwrap()
                .push((scope.field, is_verified));
            Ok(released(scope.field))
        };
        let mut port = RecordingAxPort::default();

        assert!(matches!(
            perform_detected_fill_with(
                "main",
                &contexts,
                &receipts,
                request,
                &mut release,
                &mut port,
            ),
            DetectedFillOutcome::Success { .. }
        ));
        assert_eq!(
            *verified.lock().unwrap(),
            vec![
                (AutoFillSecretField::Username, true),
                (AutoFillSecretField::Password, true),
            ]
        );
        assert!(!receipts.consume_verified_batch(&receipt, &scopes));
    }

    #[test]
    fn wrong_webview_duplicate_field_scope_mismatch_and_oversized_secret_fail_closed() {
        let receipts = AutoFillRepromptReceiptStore::default();

        let (contexts, wrong_window) = fixture(&[AutoFillSecretField::Password]);
        let token = wrong_window.fill_context_token.clone();
        let mut release =
            |scope: AutoFillRepromptScope, _: bool, _: bool| Ok(released(scope.field));
        let mut port = RecordingAxPort::default();
        assert_eq!(
            perform_detected_fill_with(
                "main-copy",
                &contexts,
                &receipts,
                wrong_window,
                &mut release,
                &mut port,
            ),
            DetectedFillOutcome::Error {
                code: "unauthorized"
            }
        );
        assert!(contexts
            .take(&token, &[AutoFillSecretField::Password])
            .is_err());

        let (contexts, mut duplicate) = fixture(&[AutoFillSecretField::Password]);
        duplicate
            .authorizations
            .push(authorization(AutoFillSecretField::Password));
        assert!(matches!(
            perform_detected_fill_with(
                "main",
                &contexts,
                &receipts,
                duplicate,
                &mut release,
                &mut port,
            ),
            DetectedFillOutcome::Error { .. }
        ));

        let (contexts, mut reused_context) = fixture(&[
            AutoFillSecretField::Username,
            AutoFillSecretField::Password,
            AutoFillSecretField::Totp,
        ]);
        reused_context.authorizations[2].scope.context_token =
            reused_context.authorizations[0].scope.context_token.clone();
        assert_eq!(
            perform_detected_fill_with(
                "main",
                &contexts,
                &receipts,
                reused_context,
                &mut release,
                &mut port,
            ),
            DetectedFillOutcome::Error {
                code: "invalid-request"
            }
        );

        let (contexts, mut mismatch) =
            fixture(&[AutoFillSecretField::Username, AutoFillSecretField::Password]);
        mismatch.authorizations[1].scope.candidate_id = "cipher-b".to_owned();
        assert_eq!(
            perform_detected_fill_with(
                "main",
                &contexts,
                &receipts,
                mismatch,
                &mut release,
                &mut port,
            ),
            DetectedFillOutcome::Error {
                code: "invalid-request"
            }
        );

        let (contexts, request) = fixture(&[AutoFillSecretField::Password]);
        let mut oversized = |scope: AutoFillRepromptScope, _: bool, _: bool| {
            Ok(CollectedSecret::new(
                scope.field,
                Zeroizing::new("x".repeat(MAXIMUM_SECRET_BYTES + 1)),
            ))
        };
        assert_eq!(
            perform_detected_fill_with(
                "main",
                &contexts,
                &receipts,
                request,
                &mut oversized,
                &mut port,
            ),
            DetectedFillOutcome::Error {
                code: "secret-release-failed"
            }
        );
    }

    #[test]
    fn request_rejects_unknown_fields_and_outcomes_never_serialize_secret_values() {
        assert!(
            serde_json::from_value::<DetectedFillRequest>(serde_json::json!({
                "fillContextToken": "fill-a",
                "authorizations": [{
                    "scope": {
                        "accountId": "account-a",
                        "candidateId": "cipher-a",
                        "field": "creditCard",
                        "generation": "00000000-0000-4000-8000-000000000004",
                        "contextToken": "context-a"
                    },
                    "mismatchConfirmed": false
                }],
                "repromptReceipt": null
            }))
            .is_err()
        );
        assert!(
            serde_json::from_value::<DetectedFillRequest>(serde_json::json!({
                "fillContextToken": "fill-a",
                "authorizations": [],
                "repromptReceipt": null,
                "secret": "smuggled"
            }))
            .is_err()
        );

        let serialized = serde_json::to_string(&DetectedFillOutcome::Partial {
            filled: vec![AutoFillSecretField::Username],
            failed: AutoFillSecretField::Password,
            code: "fill-failed",
        })
        .unwrap();
        assert_eq!(
            serialized,
            r#"{"status":"partial","filled":["username"],"failed":"password","code":"fill-failed"}"#
        );
    }

    #[test]
    fn raw_fill_boundary_burns_identifiable_context_before_strict_decode_failure() {
        for mutation in [
            "unknown-root",
            "unknown-nested",
            "invalid-enum",
            "oversized",
        ] {
            let (contexts, request) = fixture(&[AutoFillSecretField::Password]);
            let token = request.fill_context_token.clone();
            let mut raw = raw_request(&request);
            match mutation {
                "unknown-root" => {
                    raw.as_object_mut()
                        .unwrap()
                        .insert("secret".into(), "x".into());
                }
                "unknown-nested" => {
                    raw["authorizations"][0]["scope"]["secret"] = "x".into();
                }
                "invalid-enum" => raw["authorizations"][0]["scope"]["field"] = "card".into(),
                "oversized" => {
                    raw["authorizations"][0]["scope"]["accountId"] = "x".repeat(70_000).into();
                }
                _ => unreachable!(),
            }
            let receipts = AutoFillRepromptReceiptStore::default();
            let mut release =
                |scope: AutoFillRepromptScope, _: bool, _: bool| Ok(released(scope.field));
            let mut port = RecordingAxPort::default();

            assert_eq!(
                perform_detected_fill_raw_with(
                    "main",
                    &contexts,
                    &receipts,
                    raw,
                    &mut release,
                    &mut port,
                ),
                DetectedFillOutcome::Error {
                    code: "invalid-request"
                }
            );
            assert_eq!(
                contexts
                    .take(&token, &[AutoFillSecretField::Password])
                    .unwrap_err(),
                crate::autofill_ax_context::DetectedFillError::InvalidToken
            );
            assert!(port.actions.is_empty());
        }
    }

    #[test]
    fn raw_fill_boundary_gates_exact_main_and_burns_identifiable_receipt() {
        let (contexts, mut request) = fixture(&[AutoFillSecretField::Password]);
        let token = request.fill_context_token.clone();
        let receipts = AutoFillRepromptReceiptStore::default();
        let scopes = vec![scope(AutoFillSecretField::Password)];
        let receipt = receipts
            .begin_batch(
                scopes.clone(),
                "https://api.example/accounts/verify-password".to_owned(),
            )
            .unwrap();
        request.reprompt_receipt = Some(receipt.clone());
        let mut raw = raw_request(&request);
        raw["unknown"] = true.into();
        let mut release =
            |scope: AutoFillRepromptScope, _: bool, _: bool| Ok(released(scope.field));
        let mut port = RecordingAxPort::default();

        assert_eq!(
            perform_detected_fill_raw_with(
                "main-copy",
                &contexts,
                &receipts,
                raw,
                &mut release,
                &mut port,
            ),
            DetectedFillOutcome::Error {
                code: "unauthorized"
            }
        );
        assert_eq!(
            contexts
                .take(&token, &[AutoFillSecretField::Password])
                .unwrap_err(),
            crate::autofill_ax_context::DetectedFillError::InvalidToken
        );
        assert!(!receipts.cancel_batch(&receipt, &scopes));
        assert!(port.actions.is_empty());
    }

    #[test]
    fn valid_raw_fill_boundary_preserves_field_scoped_release_and_exact_write() {
        let (contexts, request) = fixture(&[AutoFillSecretField::Password]);
        let receipts = AutoFillRepromptReceiptStore::default();
        let mut released_fields = Vec::new();
        let mut release = |scope: AutoFillRepromptScope, _: bool, _: bool| {
            released_fields.push(scope.field);
            Ok(released(scope.field))
        };
        let mut port = RecordingAxPort::default();

        assert_eq!(
            perform_detected_fill_raw_with(
                "main",
                &contexts,
                &receipts,
                raw_request(&request),
                &mut release,
                &mut port,
            ),
            DetectedFillOutcome::Success {
                fields: vec![AutoFillSecretField::Password]
            }
        );
        assert_eq!(released_fields, vec![AutoFillSecretField::Password]);
        assert_eq!(
            port.actions,
            vec![TestAction::SetValue(AutoFillSecretField::Password)]
        );
    }
}

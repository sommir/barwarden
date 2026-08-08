use serde::{Deserialize, Serialize};
#[cfg(target_os = "macos")]
use tauri::Manager;

const BIOMETRIC_ACCOUNT_PREFIX: &str = crate::brand::BIOMETRIC_ACCOUNT_PREFIX;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BiometricError {
    InvalidAccount,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "kebab-case")]
pub enum BiometricAvailability {
    Available,
    NotEnrolled,
    NotAvailable,
    LockedOut,
    InvalidAccount,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "kebab-case")]
pub enum BiometricOperationOutcome {
    Enabled,
    Disabled,
    Success,
    Cancelled,
    Failed,
    NotEnrolled,
    NotAvailable,
    LockedOut,
    Invalidated,
    StorageUnavailable,
    InvalidAccount,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum BiometricReason {
    Setup,
    Unlock,
}

pub trait BiometricBackend: Send + Sync + 'static {
    fn status(&self) -> BiometricAvailability;
    fn enable(&self, account: &str, reason: BiometricReason) -> BiometricOperationOutcome;
    fn unlock(&self, account: &str, reason: BiometricReason) -> BiometricOperationOutcome;
    fn disable(&self, account: &str) -> BiometricOperationOutcome;
}

#[derive(Clone)]
pub struct BiometricState<B: BiometricBackend>(pub B);

impl<B: BiometricBackend> BiometricState<B> {
    pub fn new(backend: B) -> Self {
        Self(backend)
    }

    pub fn status(&self, account_id: &str) -> BiometricAvailability {
        if validate_account_id(account_id).is_err() {
            return BiometricAvailability::InvalidAccount;
        }
        self.0.status()
    }

    pub fn enable(&self, account_id: &str, reason: BiometricReason) -> BiometricOperationOutcome {
        let Ok(account) = validated_account_name(account_id) else {
            return BiometricOperationOutcome::InvalidAccount;
        };
        self.0.enable(&account, reason)
    }

    pub fn unlock(&self, account_id: &str, reason: BiometricReason) -> BiometricOperationOutcome {
        let Ok(account) = validated_account_name(account_id) else {
            return BiometricOperationOutcome::InvalidAccount;
        };
        self.0.unlock(&account, reason)
    }

    pub fn disable(&self, account_id: &str) -> BiometricOperationOutcome {
        let Ok(account) = validated_account_name(account_id) else {
            return BiometricOperationOutcome::InvalidAccount;
        };
        self.0.disable(&account)
    }
}

fn validated_account_name(account_id: &str) -> Result<String, BiometricError> {
    validate_account_id(account_id)?;
    Ok(biometric_account_name(account_id))
}

fn validate_account_id(account_id: &str) -> Result<(), BiometricError> {
    if account_id.len() == 64
        && account_id
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        Ok(())
    } else {
        Err(BiometricError::InvalidAccount)
    }
}

fn biometric_account_name(account_id: &str) -> String {
    format!("{BIOMETRIC_ACCOUNT_PREFIX}{account_id}")
}

#[cfg(target_os = "macos")]
type PlatformBiometricState = BiometricState<crate::biometric_macos::MacBiometricBackend>;

#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn biometric_status(app: tauri::AppHandle, account_id: String) -> BiometricAvailability {
    let state = app.state::<PlatformBiometricState>().inner().clone();
    run_blocking(
        move || state.status(&account_id),
        BiometricAvailability::NotAvailable,
    )
    .await
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn biometric_enable(
    app: tauri::AppHandle,
    account_id: String,
    reason: BiometricReason,
) -> BiometricOperationOutcome {
    let popup_was_visible = main_popup_is_visible(&app);
    let _popup_visibility = app.state::<crate::window::PopupVisibilityHold>().acquire();
    let state = app.state::<PlatformBiometricState>().inner().clone();
    let outcome = run_blocking(
        move || state.enable(&account_id, reason),
        BiometricOperationOutcome::StorageUnavailable,
    )
    .await;
    restore_popup_after_native_security(popup_was_visible, || refocus_main_popup(&app));
    outcome
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn biometric_unlock(
    app: tauri::AppHandle,
    account_id: String,
    reason: BiometricReason,
) -> BiometricOperationOutcome {
    let popup_was_visible = main_popup_is_visible(&app);
    let _popup_visibility = app.state::<crate::window::PopupVisibilityHold>().acquire();
    let state = app.state::<PlatformBiometricState>().inner().clone();
    let outcome = run_blocking(
        move || state.unlock(&account_id, reason),
        BiometricOperationOutcome::StorageUnavailable,
    )
    .await;
    restore_popup_after_native_security(popup_was_visible, || refocus_main_popup(&app));
    outcome
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn biometric_disable(
    app: tauri::AppHandle,
    account_id: String,
) -> BiometricOperationOutcome {
    let popup_was_visible = main_popup_is_visible(&app);
    let _popup_visibility = app.state::<crate::window::PopupVisibilityHold>().acquire();
    let state = app.state::<PlatformBiometricState>().inner().clone();
    let outcome = run_blocking(
        move || state.disable(&account_id),
        BiometricOperationOutcome::StorageUnavailable,
    )
    .await;
    restore_popup_after_native_security(popup_was_visible, || refocus_main_popup(&app));
    outcome
}

#[cfg(target_os = "macos")]
async fn run_blocking<T, F>(operation: F, unavailable: T) -> T
where
    T: Send + 'static,
    F: FnOnce() -> T + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .unwrap_or(unavailable)
}

#[cfg(target_os = "macos")]
fn main_popup_is_visible(app: &tauri::AppHandle) -> bool {
    app.get_webview_window("main")
        .and_then(|window| window.is_visible().ok())
        .unwrap_or(false)
}

#[cfg(target_os = "macos")]
fn refocus_main_popup(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn restore_popup_after_native_security<F>(was_visible: bool, restore: F)
where
    F: FnOnce(),
{
    if was_visible {
        restore();
    }
}

#[cfg(test)]
mod tests {
    use std::{
        sync::{
            atomic::{AtomicBool, Ordering},
            Arc, Mutex,
        },
        thread,
    };

    use super::*;

    #[test]
    fn visible_popup_is_restored_after_native_biometric_input() {
        let restored = AtomicBool::new(false);

        restore_popup_after_native_security(true, || restored.store(true, Ordering::Release));

        assert!(restored.load(Ordering::Acquire));
    }

    #[test]
    fn hidden_popup_is_not_opened_by_background_biometric_work() {
        let restored = AtomicBool::new(false);

        restore_popup_after_native_security(false, || restored.store(true, Ordering::Release));

        assert!(!restored.load(Ordering::Acquire));
    }

    #[test]
    fn accepts_only_canonical_scoped_account_ids() {
        assert_eq!(validate_account_id(&"a".repeat(64)), Ok(()));
        assert_eq!(validate_account_id(&"0".repeat(64)), Ok(()));

        for invalid in [
            "",
            "account@example.com",
            "A",
            "../secret",
            &"A".repeat(64),
            &"g".repeat(64),
            &"a".repeat(63),
            &"a".repeat(65),
        ] {
            assert_eq!(
                validate_account_id(invalid),
                Err(BiometricError::InvalidAccount)
            );
        }
    }

    #[test]
    fn uses_exact_barwarden_biometric_account_names() {
        let account_id = "a".repeat(64);

        assert_eq!(
            biometric_account_name(&account_id),
            format!("barwarden:biometric:v2:{account_id}")
        );
    }

    #[test]
    fn serializes_only_fixed_sanitized_outcomes() {
        let outcomes = [
            (
                BiometricAvailability::Available,
                r#"{"status":"available"}"#,
            ),
            (
                BiometricAvailability::NotEnrolled,
                r#"{"status":"not-enrolled"}"#,
            ),
            (
                BiometricAvailability::NotAvailable,
                r#"{"status":"not-available"}"#,
            ),
            (
                BiometricAvailability::LockedOut,
                r#"{"status":"locked-out"}"#,
            ),
            (
                BiometricAvailability::InvalidAccount,
                r#"{"status":"invalid-account"}"#,
            ),
        ];
        let operations = [
            (
                BiometricOperationOutcome::Enabled,
                r#"{"status":"enabled"}"#,
            ),
            (
                BiometricOperationOutcome::Disabled,
                r#"{"status":"disabled"}"#,
            ),
            (
                BiometricOperationOutcome::Success,
                r#"{"status":"success"}"#,
            ),
            (
                BiometricOperationOutcome::Cancelled,
                r#"{"status":"cancelled"}"#,
            ),
            (BiometricOperationOutcome::Failed, r#"{"status":"failed"}"#),
            (
                BiometricOperationOutcome::NotEnrolled,
                r#"{"status":"not-enrolled"}"#,
            ),
            (
                BiometricOperationOutcome::NotAvailable,
                r#"{"status":"not-available"}"#,
            ),
            (
                BiometricOperationOutcome::LockedOut,
                r#"{"status":"locked-out"}"#,
            ),
            (
                BiometricOperationOutcome::Invalidated,
                r#"{"status":"invalidated"}"#,
            ),
            (
                BiometricOperationOutcome::StorageUnavailable,
                r#"{"status":"storage-unavailable"}"#,
            ),
            (
                BiometricOperationOutcome::InvalidAccount,
                r#"{"status":"invalid-account"}"#,
            ),
        ];

        for (outcome, expected) in outcomes {
            let serialized = serde_json::to_string(&outcome).unwrap();
            assert_eq!(serialized, expected);
            assert_sanitized(&serialized);
        }
        for (outcome, expected) in operations {
            let serialized = serde_json::to_string(&outcome).unwrap();
            assert_eq!(serialized, expected);
            assert_sanitized(&serialized);
        }
    }

    fn assert_sanitized(serialized: &str) {
        for forbidden in [
            "OSStatus",
            "NSError",
            "accountId",
            "barwarden:biometric:",
            "@example.com",
        ] {
            assert!(!serialized.contains(forbidden));
        }
    }

    #[test]
    fn isolates_backend_calls_by_opaque_account_key() {
        let backend = RecordingBiometricBackend::default();
        let state = BiometricState::new(backend.clone());
        let account = "a".repeat(64);

        assert_eq!(
            state.enable(&account, BiometricReason::Setup),
            BiometricOperationOutcome::Enabled
        );
        assert_eq!(state.status(&account), BiometricAvailability::Available);
        assert_eq!(state.disable(&account), BiometricOperationOutcome::Disabled);
        assert_eq!(
            backend.accounts(),
            vec![
                biometric_account_name(&account),
                biometric_account_name(&account),
            ]
        );
        assert!(!backend.accounts()[0].contains('@'));
        assert_eq!(backend.status_calls(), 1);
    }

    #[test]
    fn rejects_invalid_accounts_before_calling_the_backend() {
        let backend = RecordingBiometricBackend::default();
        let state = BiometricState::new(backend.clone());

        assert_eq!(
            state.unlock("not-an-account", BiometricReason::Unlock),
            BiometricOperationOutcome::InvalidAccount
        );
        assert_eq!(
            state.status("not-an-account"),
            BiometricAvailability::InvalidAccount
        );
        assert!(backend.accounts().is_empty());
        assert_eq!(backend.status_calls(), 0);
    }

    #[test]
    fn dispatches_biometric_operations_off_the_calling_thread() {
        let calling_thread = thread::current().id();

        let dispatched = tauri::async_runtime::block_on(run_blocking(
            move || thread::current().id() != calling_thread,
            false,
        ));

        assert!(dispatched);
    }

    #[derive(Clone, Default)]
    struct RecordingBiometricBackend {
        accounts: Arc<Mutex<Vec<String>>>,
        status_calls: Arc<Mutex<usize>>,
    }

    impl RecordingBiometricBackend {
        fn accounts(&self) -> Vec<String> {
            self.accounts.lock().unwrap().clone()
        }

        fn status_calls(&self) -> usize {
            *self.status_calls.lock().unwrap()
        }
    }

    impl BiometricBackend for RecordingBiometricBackend {
        fn status(&self) -> BiometricAvailability {
            *self.status_calls.lock().unwrap() += 1;
            BiometricAvailability::Available
        }

        fn enable(&self, account: &str, _reason: BiometricReason) -> BiometricOperationOutcome {
            self.accounts.lock().unwrap().push(account.to_owned());
            BiometricOperationOutcome::Enabled
        }

        fn unlock(&self, account: &str, _reason: BiometricReason) -> BiometricOperationOutcome {
            self.accounts.lock().unwrap().push(account.to_owned());
            BiometricOperationOutcome::Success
        }

        fn disable(&self, account: &str) -> BiometricOperationOutcome {
            self.accounts.lock().unwrap().push(account.to_owned());
            BiometricOperationOutcome::Disabled
        }
    }
}

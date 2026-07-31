use std::{sync::mpsc, time::Duration};

use block2::RcBlock;
use objc2::{rc::Retained, runtime::Bool};
use objc2_foundation::{NSError, NSString};
use objc2_local_authentication::{LAContext, LAError, LAPolicy};
use security_framework::{
    item::{ItemClass, ItemSearchOptions, SearchResult},
    passwords::{delete_generic_password_options, set_generic_password_options, PasswordOptions},
};
use security_framework_sys::base::{errSecAuthFailed, errSecItemNotFound};

use crate::biometric::{
    BiometricAvailability, BiometricBackend, BiometricOperationOutcome, BiometricReason,
};

const BIOMETRIC_KEYCHAIN_SERVICE: &str = if cfg!(debug_assertions) {
    crate::brand::DEBUG_KEYCHAIN_SERVICE
} else {
    crate::brand::RELEASE_KEYCHAIN_SERVICE
};
const AUTHENTICATION_TIMEOUT: Duration = Duration::from_secs(120);
const ERR_SEC_ITEM_NOT_FOUND: i32 = errSecItemNotFound;
const ERR_SEC_AUTH_FAILED: i32 = errSecAuthFailed;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum LocalAuthError {
    UserCancel,
    SystemCancel,
    AppCancel,
    BiometryNotEnrolled,
    BiometryNotAvailable,
    BiometryLockout,
    AuthenticationFailed,
    PasscodeNotSet,
    InvalidContext,
    NotInteractive,
    Unavailable,
}

trait LocalAuthenticationPort: Send + Sync + 'static {
    type Context;

    fn status(&self) -> Result<(), LocalAuthError>;
    fn evaluate(&self, reason: BiometricReason) -> Result<Self::Context, LocalAuthError>;
}

#[derive(Clone, Copy, Default)]
pub(crate) struct SystemLocalAuthentication;

impl LocalAuthenticationPort for SystemLocalAuthentication {
    type Context = Retained<LAContext>;

    fn status(&self) -> Result<(), LocalAuthError> {
        let context = unsafe { LAContext::new() };
        unsafe {
            context.canEvaluatePolicy_error(LAPolicy::DeviceOwnerAuthenticationWithBiometrics)
        }
        .map_err(|error| local_auth_error(error.code()))
    }

    fn evaluate(&self, reason: BiometricReason) -> Result<Self::Context, LocalAuthError> {
        let context = unsafe { LAContext::new() };
        unsafe {
            context.canEvaluatePolicy_error(LAPolicy::DeviceOwnerAuthenticationWithBiometrics)
        }
        .map_err(|error| local_auth_error(error.code()))?;

        let (sender, receiver) = mpsc::sync_channel(1);
        let reply = RcBlock::new(move |success: Bool, error: *mut NSError| {
            let result = if success.as_bool() {
                Ok(())
            } else if error.is_null() {
                Err(LocalAuthError::AuthenticationFailed)
            } else {
                Err(local_auth_error(unsafe { &*error }.code()))
            };
            let _ = sender.send(result);
        });
        let localized_reason = NSString::from_str(match reason {
            BiometricReason::Setup => "enable Touch ID unlock for the vault",
            BiometricReason::Unlock => "unlock the vault",
        });

        unsafe {
            context.evaluatePolicy_localizedReason_reply(
                LAPolicy::DeviceOwnerAuthenticationWithBiometrics,
                &localized_reason,
                &reply,
            );
        }

        match receiver.recv_timeout(AUTHENTICATION_TIMEOUT) {
            Ok(Ok(())) => Ok(context),
            Ok(Err(error)) => Err(error),
            Err(_) => {
                unsafe { context.invalidate() };
                Err(LocalAuthError::Unavailable)
            }
        }
    }
}

fn local_auth_error(code: isize) -> LocalAuthError {
    match LAError(code) {
        LAError::UserCancel | LAError::UserFallback => LocalAuthError::UserCancel,
        LAError::SystemCancel => LocalAuthError::SystemCancel,
        LAError::AppCancel => LocalAuthError::AppCancel,
        LAError::BiometryNotEnrolled => LocalAuthError::BiometryNotEnrolled,
        LAError::BiometryNotAvailable => LocalAuthError::BiometryNotAvailable,
        LAError::BiometryLockout => LocalAuthError::BiometryLockout,
        LAError::AuthenticationFailed => LocalAuthError::AuthenticationFailed,
        LAError::PasscodeNotSet => LocalAuthError::PasscodeNotSet,
        LAError::InvalidContext => LocalAuthError::InvalidContext,
        LAError::NotInteractive => LocalAuthError::NotInteractive,
        _ => LocalAuthError::Unavailable,
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ProtectedStoreError {
    Missing,
    Invalidated,
    Cancelled,
    Unavailable,
}

#[derive(Clone, Copy, Default)]
pub(crate) struct KeychainProtectedStore;

impl ProtectedCredentialStore<Retained<LAContext>> for KeychainProtectedStore {
    fn create(
        &self,
        account: &str,
        credential: &[u8],
        _context: &Retained<LAContext>,
    ) -> Result<(), ProtectedStoreError> {
        match delete_generic_password_options(password_options(account)) {
            Ok(()) => {}
            Err(error) => match protected_store_error(error.code()) {
                ProtectedStoreError::Missing => {}
                other => return Err(other),
            },
        }

        match set_generic_password_options(credential, password_options(account)) {
            Ok(()) => Ok(()),
            Err(error) => {
                let _ = delete_generic_password_options(password_options(account));
                Err(protected_store_error(error.code()))
            }
        }
    }

    fn read(
        &self,
        account: &str,
        _context: &Retained<LAContext>,
    ) -> Result<Vec<u8>, ProtectedStoreError> {
        let mut options = marker_item_options(account);
        options.load_data(true);

        match options.search() {
            Ok(results) => results
                .into_iter()
                .find_map(|result| match result {
                    SearchResult::Data(data) => Some(data),
                    _ => None,
                })
                .ok_or(ProtectedStoreError::Missing),
            Err(error) => Err(protected_store_error(error.code())),
        }
    }

    fn delete(&self, account: &str) -> Result<(), ProtectedStoreError> {
        match delete_generic_password_options(password_options(account)) {
            Ok(()) => Ok(()),
            Err(error) => Err(protected_store_error(error.code())),
        }
    }
}

fn protected_store_error(code: i32) -> ProtectedStoreError {
    match code {
        ERR_SEC_ITEM_NOT_FOUND => ProtectedStoreError::Missing,
        ERR_SEC_AUTH_FAILED | -25_304 | -26_275 => ProtectedStoreError::Invalidated,
        -128 => ProtectedStoreError::Cancelled,
        _ => ProtectedStoreError::Unavailable,
    }
}

fn password_options(account: &str) -> PasswordOptions {
    // The menu-bar app is ad-hoc signed for local installation. On macOS,
    // SecAccessControl's biometric policy requires a provisioned data
    // protection keychain access group, which this distribution deliberately
    // does not have. The actual biometric gate is therefore LAContext above;
    // this versioned record is only an enrollment marker in the local keychain.
    let mut options = PasswordOptions::new_generic_password(BIOMETRIC_KEYCHAIN_SERVICE, account);
    options.set_access_synchronized(Some(false));
    options
}

fn marker_item_options(account: &str) -> ItemSearchOptions {
    let mut options = ItemSearchOptions::new();
    options
        .class(ItemClass::generic_password())
        .service(BIOMETRIC_KEYCHAIN_SERVICE)
        .account(account)
        .cloud_sync(Some(false));
    options
}

trait ProtectedCredentialStore<C>: Send + Sync + 'static {
    fn create(
        &self,
        account: &str,
        credential: &[u8],
        context: &C,
    ) -> Result<(), ProtectedStoreError>;
    fn read(&self, account: &str, context: &C) -> Result<Vec<u8>, ProtectedStoreError>;
    fn delete(&self, account: &str) -> Result<(), ProtectedStoreError>;
}

#[derive(Clone)]
pub(crate) struct MacBiometricBackend<A = SystemLocalAuthentication, S = KeychainProtectedStore> {
    authentication: A,
    credentials: S,
}

impl Default for MacBiometricBackend {
    fn default() -> Self {
        Self::with_ports(SystemLocalAuthentication, KeychainProtectedStore)
    }
}

impl<A, S> MacBiometricBackend<A, S> {
    fn with_ports(authentication: A, credentials: S) -> Self {
        Self {
            authentication,
            credentials,
        }
    }
}

impl<A, S> BiometricBackend for MacBiometricBackend<A, S>
where
    A: LocalAuthenticationPort,
    S: ProtectedCredentialStore<A::Context>,
{
    fn status(&self) -> BiometricAvailability {
        match self.authentication.status() {
            Ok(()) => BiometricAvailability::Available,
            Err(LocalAuthError::BiometryNotEnrolled) => BiometricAvailability::NotEnrolled,
            Err(LocalAuthError::BiometryLockout) => BiometricAvailability::LockedOut,
            Err(_) => BiometricAvailability::NotAvailable,
        }
    }

    fn enable(&self, account: &str, reason: BiometricReason) -> BiometricOperationOutcome {
        let context = match self.authentication.evaluate(reason) {
            Ok(context) => context,
            Err(error) => return operation_outcome(error),
        };
        let credential = uuid::Uuid::new_v4().into_bytes();
        match self.credentials.create(account, &credential, &context) {
            Ok(()) => BiometricOperationOutcome::Enabled,
            Err(ProtectedStoreError::Cancelled) => BiometricOperationOutcome::Cancelled,
            Err(_) => BiometricOperationOutcome::StorageUnavailable,
        }
    }

    fn unlock(&self, account: &str, reason: BiometricReason) -> BiometricOperationOutcome {
        let context = match self.authentication.evaluate(reason) {
            Ok(context) => context,
            Err(error) => return operation_outcome(error),
        };
        match self.credentials.read(account, &context) {
            Ok(credential) if !credential.is_empty() => BiometricOperationOutcome::Success,
            Ok(_) | Err(ProtectedStoreError::Missing | ProtectedStoreError::Invalidated) => {
                let _ = self.credentials.delete(account);
                BiometricOperationOutcome::Invalidated
            }
            Err(ProtectedStoreError::Cancelled) => BiometricOperationOutcome::Cancelled,
            Err(ProtectedStoreError::Unavailable) => BiometricOperationOutcome::StorageUnavailable,
        }
    }

    fn disable(&self, account: &str) -> BiometricOperationOutcome {
        match self.credentials.delete(account) {
            Ok(()) | Err(ProtectedStoreError::Missing) => BiometricOperationOutcome::Disabled,
            Err(ProtectedStoreError::Cancelled) => BiometricOperationOutcome::Cancelled,
            Err(ProtectedStoreError::Invalidated | ProtectedStoreError::Unavailable) => {
                BiometricOperationOutcome::StorageUnavailable
            }
        }
    }
}

fn operation_outcome(error: LocalAuthError) -> BiometricOperationOutcome {
    match error {
        LocalAuthError::UserCancel | LocalAuthError::SystemCancel | LocalAuthError::AppCancel => {
            BiometricOperationOutcome::Cancelled
        }
        LocalAuthError::BiometryNotEnrolled => BiometricOperationOutcome::NotEnrolled,
        LocalAuthError::BiometryNotAvailable | LocalAuthError::PasscodeNotSet => {
            BiometricOperationOutcome::NotAvailable
        }
        LocalAuthError::BiometryLockout => BiometricOperationOutcome::LockedOut,
        LocalAuthError::AuthenticationFailed
        | LocalAuthError::InvalidContext
        | LocalAuthError::NotInteractive
        | LocalAuthError::Unavailable => BiometricOperationOutcome::Failed,
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use super::*;

    #[test]
    fn maps_local_authentication_availability_without_prompting() {
        for (result, expected) in [
            (Ok(()), BiometricAvailability::Available),
            (
                Err(LocalAuthError::BiometryNotEnrolled),
                BiometricAvailability::NotEnrolled,
            ),
            (
                Err(LocalAuthError::BiometryNotAvailable),
                BiometricAvailability::NotAvailable,
            ),
            (
                Err(LocalAuthError::BiometryLockout),
                BiometricAvailability::LockedOut,
            ),
            (
                Err(LocalAuthError::AuthenticationFailed),
                BiometricAvailability::NotAvailable,
            ),
        ] {
            let auth = FakeLocalAuth::with_status(result);
            let backend =
                MacBiometricBackend::with_ports(auth.clone(), FakeProtectedStore::default());

            assert_eq!(backend.status(), expected);
            assert_eq!(auth.evaluation_count(), 0);
        }
    }

    #[test]
    fn changed_biometry_maps_to_invalidated_and_deletes_only_that_account() {
        let auth = FakeLocalAuth::success();
        let store = FakeProtectedStore::with_read(Err(ProtectedStoreError::Invalidated));
        let backend = MacBiometricBackend::with_ports(auth, store.clone());
        let account = "barwarden:biometric:v2:".to_owned() + &"a".repeat(64);

        assert_eq!(
            backend.unlock(&account, BiometricReason::Unlock),
            BiometricOperationOutcome::Invalidated
        );
        assert_eq!(store.deleted_accounts(), vec![account]);
    }

    #[test]
    fn missing_protected_credential_is_invalidated_and_cleaned_up() {
        let store = FakeProtectedStore::with_read(Err(ProtectedStoreError::Missing));
        let backend = MacBiometricBackend::with_ports(FakeLocalAuth::success(), store.clone());
        let account = "barwarden:biometric:v2:".to_owned() + &"b".repeat(64);

        assert_eq!(
            backend.unlock(&account, BiometricReason::Unlock),
            BiometricOperationOutcome::Invalidated
        );
        assert_eq!(store.deleted_accounts(), vec![account]);
    }

    #[test]
    fn maps_prompt_errors_to_fixed_operation_outcomes() {
        for (error, expected) in [
            (
                LocalAuthError::UserCancel,
                BiometricOperationOutcome::Cancelled,
            ),
            (
                LocalAuthError::SystemCancel,
                BiometricOperationOutcome::Cancelled,
            ),
            (
                LocalAuthError::AppCancel,
                BiometricOperationOutcome::Cancelled,
            ),
            (
                LocalAuthError::BiometryNotEnrolled,
                BiometricOperationOutcome::NotEnrolled,
            ),
            (
                LocalAuthError::BiometryNotAvailable,
                BiometricOperationOutcome::NotAvailable,
            ),
            (
                LocalAuthError::BiometryLockout,
                BiometricOperationOutcome::LockedOut,
            ),
            (
                LocalAuthError::AuthenticationFailed,
                BiometricOperationOutcome::Failed,
            ),
        ] {
            let backend = MacBiometricBackend::with_ports(
                FakeLocalAuth::with_evaluation(Err(error)),
                FakeProtectedStore::default(),
            );

            assert_eq!(
                backend.unlock(
                    &("barwarden:biometric:v2:".to_owned() + &"c".repeat(64)),
                    BiometricReason::Unlock,
                ),
                expected
            );
        }
    }

    #[test]
    fn enable_stores_a_nonempty_random_credential_only_after_authentication() {
        let auth = FakeLocalAuth::success();
        let store = FakeProtectedStore::default();
        let backend = MacBiometricBackend::with_ports(auth.clone(), store.clone());
        let account = "barwarden:biometric:v2:".to_owned() + &"d".repeat(64);

        assert_eq!(
            backend.enable(&account, BiometricReason::Setup),
            BiometricOperationOutcome::Enabled
        );
        assert_eq!(auth.evaluation_count(), 1);
        let writes = store.writes();
        assert_eq!(writes.len(), 1);
        assert_eq!(writes[0].0, account);
        assert!(!writes[0].1.is_empty());
        assert!(!String::from_utf8_lossy(&writes[0].1).contains("token"));
    }

    #[test]
    fn storage_failures_never_include_native_details() {
        let store = FakeProtectedStore::with_read(Err(ProtectedStoreError::Unavailable));
        let backend = MacBiometricBackend::with_ports(FakeLocalAuth::success(), store);

        let outcome = backend.unlock(
            &("barwarden:biometric:v2:".to_owned() + &"e".repeat(64)),
            BiometricReason::Unlock,
        );

        assert_eq!(outcome, BiometricOperationOutcome::StorageUnavailable);
        let serialized = serde_json::to_string(&outcome).unwrap();
        assert_eq!(serialized, r#"{"status":"storage-unavailable"}"#);
        assert!(!serialized.contains("OSStatus"));
        assert!(!serialized.contains("NSError"));
    }

    #[test]
    fn maps_all_supported_local_authentication_codes_without_native_text() {
        for (code, expected) in [
            (LAError::UserCancel.0, LocalAuthError::UserCancel),
            (LAError::UserFallback.0, LocalAuthError::UserCancel),
            (LAError::SystemCancel.0, LocalAuthError::SystemCancel),
            (LAError::AppCancel.0, LocalAuthError::AppCancel),
            (
                LAError::BiometryNotEnrolled.0,
                LocalAuthError::BiometryNotEnrolled,
            ),
            (
                LAError::BiometryNotAvailable.0,
                LocalAuthError::BiometryNotAvailable,
            ),
            (LAError::BiometryLockout.0, LocalAuthError::BiometryLockout),
            (
                LAError::AuthenticationFailed.0,
                LocalAuthError::AuthenticationFailed,
            ),
            (LAError::PasscodeNotSet.0, LocalAuthError::PasscodeNotSet),
            (LAError::InvalidContext.0, LocalAuthError::InvalidContext),
            (LAError::NotInteractive.0, LocalAuthError::NotInteractive),
            (isize::MIN, LocalAuthError::Unavailable),
        ] {
            assert_eq!(local_auth_error(code), expected);
        }
    }

    #[test]
    fn maps_keychain_status_codes_to_fixed_store_errors() {
        for (code, expected) in [
            (errSecItemNotFound, ProtectedStoreError::Missing),
            (errSecAuthFailed, ProtectedStoreError::Invalidated),
            (-25_304, ProtectedStoreError::Invalidated),
            (-26_275, ProtectedStoreError::Invalidated),
            (-128, ProtectedStoreError::Cancelled),
            (-25_308, ProtectedStoreError::Unavailable),
            (-25_315, ProtectedStoreError::Unavailable),
            (-25_291, ProtectedStoreError::Unavailable),
            (-25_316, ProtectedStoreError::Unavailable),
            (-34_018, ProtectedStoreError::Unavailable),
        ] {
            assert_eq!(protected_store_error(code), expected);
        }
    }

    #[test]
    #[ignore = "requires local Touch ID and macOS Keychain interaction"]
    fn live_touch_id_round_trip_smoke() {
        let backend = MacBiometricBackend::default();
        let account = "barwarden:biometric:v2:".to_owned() + &"f".repeat(64);

        assert_eq!(
            backend.enable(&account, BiometricReason::Setup),
            BiometricOperationOutcome::Enabled
        );
        assert_eq!(
            backend.unlock(&account, BiometricReason::Unlock),
            BiometricOperationOutcome::Success
        );
        assert_eq!(
            backend.disable(&account),
            BiometricOperationOutcome::Disabled
        );
    }

    #[test]
    #[ignore = "requires two local Touch ID approvals and macOS Keychain interaction"]
    fn live_touch_id_reenable_replaces_existing_credential() {
        let backend = MacBiometricBackend::default();
        let account = "barwarden:biometric:v2:".to_owned() + &"9".repeat(64);

        assert_eq!(
            backend.enable(&account, BiometricReason::Setup),
            BiometricOperationOutcome::Enabled
        );
        assert_eq!(
            backend.enable(&account, BiometricReason::Setup),
            BiometricOperationOutcome::Enabled
        );
        assert_eq!(
            backend.unlock(&account, BiometricReason::Unlock),
            BiometricOperationOutcome::Success
        );
        assert_eq!(
            backend.disable(&account),
            BiometricOperationOutcome::Disabled
        );
    }

    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    struct FakeContext;

    #[derive(Clone)]
    struct FakeLocalAuth {
        status: Result<(), LocalAuthError>,
        evaluation: Result<FakeContext, LocalAuthError>,
        evaluations: Arc<Mutex<usize>>,
    }

    impl FakeLocalAuth {
        fn success() -> Self {
            Self::with_evaluation(Ok(FakeContext))
        }

        fn with_status(status: Result<(), LocalAuthError>) -> Self {
            Self {
                status,
                evaluation: Ok(FakeContext),
                evaluations: Arc::new(Mutex::new(0)),
            }
        }

        fn with_evaluation(evaluation: Result<FakeContext, LocalAuthError>) -> Self {
            Self {
                status: Ok(()),
                evaluation,
                evaluations: Arc::new(Mutex::new(0)),
            }
        }

        fn evaluation_count(&self) -> usize {
            *self.evaluations.lock().unwrap()
        }
    }

    impl LocalAuthenticationPort for FakeLocalAuth {
        type Context = FakeContext;

        fn status(&self) -> Result<(), LocalAuthError> {
            self.status
        }

        fn evaluate(&self, _reason: BiometricReason) -> Result<Self::Context, LocalAuthError> {
            *self.evaluations.lock().unwrap() += 1;
            self.evaluation
        }
    }

    #[derive(Clone)]
    struct FakeProtectedStore {
        read: Result<Vec<u8>, ProtectedStoreError>,
        writes: Arc<Mutex<Vec<(String, Vec<u8>)>>>,
        deletes: Arc<Mutex<Vec<String>>>,
    }

    impl Default for FakeProtectedStore {
        fn default() -> Self {
            Self::with_read(Ok(b"protected-credential".to_vec()))
        }
    }

    impl FakeProtectedStore {
        fn with_read(read: Result<Vec<u8>, ProtectedStoreError>) -> Self {
            Self {
                read,
                writes: Arc::new(Mutex::new(Vec::new())),
                deletes: Arc::new(Mutex::new(Vec::new())),
            }
        }

        fn writes(&self) -> Vec<(String, Vec<u8>)> {
            self.writes.lock().unwrap().clone()
        }

        fn deleted_accounts(&self) -> Vec<String> {
            self.deletes.lock().unwrap().clone()
        }
    }

    impl ProtectedCredentialStore<FakeContext> for FakeProtectedStore {
        fn create(
            &self,
            account: &str,
            credential: &[u8],
            _context: &FakeContext,
        ) -> Result<(), ProtectedStoreError> {
            self.writes
                .lock()
                .unwrap()
                .push((account.to_owned(), credential.to_vec()));
            Ok(())
        }

        fn read(
            &self,
            _account: &str,
            _context: &FakeContext,
        ) -> Result<Vec<u8>, ProtectedStoreError> {
            self.read.clone()
        }

        fn delete(&self, account: &str) -> Result<(), ProtectedStoreError> {
            self.deletes.lock().unwrap().push(account.to_owned());
            Ok(())
        }
    }
}

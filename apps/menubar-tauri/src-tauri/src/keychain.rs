use serde::Serialize;
use tauri::Manager;

const KEYCHAIN_SERVICE: &str = if cfg!(debug_assertions) {
    crate::brand::DEBUG_KEYCHAIN_SERVICE
} else {
    crate::brand::RELEASE_KEYCHAIN_SERVICE
};
#[cfg(test)]
use crate::brand::{DEBUG_KEYCHAIN_SERVICE, RELEASE_KEYCHAIN_SERVICE};
const CANONICAL_ACCOUNT_PREFIX: &str = crate::brand::KEYCHAIN_ACCOUNT_PREFIX;
const MAX_KEY_LENGTH: usize = 256;
const LEGACY_KEYCHAIN_SERVICES: [&str; 2] = ["Barwarden Session v19", "Barwarden"];
const MIGRATABLE_LEGACY_KEYS: [&str; 2] =
    ["auth.two-factor-trust.v1", "installation.deviceIdentifier"];
static SECURE_STORAGE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum SecureStorageError {
    Unavailable,
    InvalidKey,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "kebab-case")]
pub enum SecureStorageOutcome<T> {
    Success { value: T },
    Missing,
    Unavailable,
    InvalidKey,
}

impl<T> SecureStorageOutcome<T> {
    fn from_result(result: Result<T, SecureStorageError>) -> Self {
        match result {
            Ok(value) => Self::Success { value },
            Err(SecureStorageError::Unavailable) => Self::Unavailable,
            Err(SecureStorageError::InvalidKey) => Self::InvalidKey,
        }
    }
}

impl<T> SecureStorageOutcome<T> {
    fn from_optional_result(result: Result<Option<T>, SecureStorageError>) -> Self {
        match result {
            Ok(Some(value)) => Self::Success { value },
            Ok(None) => Self::Missing,
            Err(SecureStorageError::Unavailable) => Self::Unavailable,
            Err(SecureStorageError::InvalidKey) => Self::InvalidKey,
        }
    }
}

trait SecureStore {
    fn get(&self, account: &str) -> Result<Option<String>, SecureStorageError>;
    fn set(&self, account: &str, value: &str) -> Result<(), SecureStorageError>;
    fn delete(&self, account: &str) -> Result<(), SecureStorageError>;
}

trait LegacySecureStore {
    fn get_from_service(
        &self,
        service: &str,
        account: &str,
    ) -> Result<Option<String>, SecureStorageError>;
}

#[derive(Clone, Copy)]
struct KeychainStore;

impl SecureStore for KeychainStore {
    fn get(&self, account: &str) -> Result<Option<String>, SecureStorageError> {
        let entry = keyring::Entry::new(KEYCHAIN_SERVICE, account)
            .map_err(|_| SecureStorageError::Unavailable)?;

        map_keychain_get_result(entry.get_password())
    }

    fn set(&self, account: &str, value: &str) -> Result<(), SecureStorageError> {
        let entry = keyring::Entry::new(KEYCHAIN_SERVICE, account)
            .map_err(|_| SecureStorageError::Unavailable)?;
        map_keychain_set_result(entry.set_password(value))
    }

    fn delete(&self, account: &str) -> Result<(), SecureStorageError> {
        let entry = keyring::Entry::new(KEYCHAIN_SERVICE, account)
            .map_err(|_| SecureStorageError::Unavailable)?;

        map_keychain_delete_result(entry.delete_credential())
    }
}

impl LegacySecureStore for KeychainStore {
    fn get_from_service(
        &self,
        service: &str,
        account: &str,
    ) -> Result<Option<String>, SecureStorageError> {
        let entry =
            keyring::Entry::new(service, account).map_err(|_| SecureStorageError::Unavailable)?;

        map_keychain_get_result(entry.get_password())
    }
}

#[tauri::command]
pub async fn secure_get(app: tauri::AppHandle, key: String) -> SecureStorageOutcome<String> {
    let _popup_visibility = app.state::<crate::window::PopupVisibilityHold>().acquire();
    SecureStorageOutcome::from_optional_result(
        run_blocking_secure_store(move || {
            secure_get_with_legacy_migration(&KeychainStore, &KeychainStore, key)
        })
        .await,
    )
}

#[tauri::command]
pub async fn secure_set(
    app: tauri::AppHandle,
    key: String,
    value: String,
) -> SecureStorageOutcome<()> {
    let _popup_visibility = app.state::<crate::window::PopupVisibilityHold>().acquire();
    SecureStorageOutcome::from_result(secure_set_async_with(KeychainStore, key, value).await)
}

#[tauri::command]
pub async fn secure_delete(app: tauri::AppHandle, key: String) -> SecureStorageOutcome<()> {
    let _popup_visibility = app.state::<crate::window::PopupVisibilityHold>().acquire();
    SecureStorageOutcome::from_result(secure_delete_async_with(KeychainStore, key).await)
}

#[tauri::command]
pub async fn secure_compare_and_swap(
    app: tauri::AppHandle,
    key: String,
    expected: Option<String>,
    replacement: Option<String>,
) -> SecureStorageOutcome<bool> {
    let _popup_visibility = app.state::<crate::window::PopupVisibilityHold>().acquire();
    SecureStorageOutcome::from_result(
        run_blocking_secure_store(move || {
            secure_compare_and_swap_with(&KeychainStore, key, expected, replacement)
        })
        .await,
    )
}

#[tauri::command]
pub async fn secure_get_or_create_uuid(
    app: tauri::AppHandle,
    key: String,
) -> SecureStorageOutcome<String> {
    let _popup_visibility = app.state::<crate::window::PopupVisibilityHold>().acquire();
    SecureStorageOutcome::from_result(
        run_blocking_secure_store(move || {
            secure_get_or_create_uuid_with_legacy_migration(&KeychainStore, &KeychainStore, key)
        })
        .await,
    )
}

#[cfg(test)]
async fn secure_get_async_with<S>(
    store: S,
    key: String,
) -> Result<Option<String>, SecureStorageError>
where
    S: SecureStore + Send + 'static,
{
    run_blocking_secure_store(move || secure_get_with(&store, key)).await
}

async fn secure_set_async_with<S>(
    store: S,
    key: String,
    value: String,
) -> Result<(), SecureStorageError>
where
    S: SecureStore + Send + 'static,
{
    run_blocking_secure_store(move || secure_set_with(&store, key, value)).await
}

async fn secure_delete_async_with<S>(store: S, key: String) -> Result<(), SecureStorageError>
where
    S: SecureStore + Send + 'static,
{
    run_blocking_secure_store(move || secure_delete_with(&store, key)).await
}

async fn run_blocking_secure_store<T, F>(operation: F) -> Result<T, SecureStorageError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, SecureStorageError> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|_| SecureStorageError::Unavailable)?
}

#[cfg(test)]
fn secure_get_with(
    store: &impl SecureStore,
    key: String,
) -> Result<Option<String>, SecureStorageError> {
    validate_key(&key)?;
    let _guard = secure_storage_guard()?;
    load_current(store, &key)
}

fn secure_get_with_legacy_migration(
    store: &impl SecureStore,
    legacy_store: &impl LegacySecureStore,
    key: String,
) -> Result<Option<String>, SecureStorageError> {
    validate_key(&key)?;
    let _guard = secure_storage_guard()?;
    load_current_or_migrate_legacy(store, legacy_store, &key)
}

fn secure_set_with(
    store: &impl SecureStore,
    key: String,
    value: String,
) -> Result<(), SecureStorageError> {
    validate_key(&key)?;
    let _guard = secure_storage_guard()?;
    load_current(store, &key)?;
    set_and_confirm(store, &canonical_account_name(&key)?, &value)
}

fn secure_delete_with(store: &impl SecureStore, key: String) -> Result<(), SecureStorageError> {
    validate_key(&key)?;
    let _guard = secure_storage_guard()?;
    delete_current(store, &key)
}

fn secure_compare_and_swap_with(
    store: &impl SecureStore,
    key: String,
    expected: Option<String>,
    replacement: Option<String>,
) -> Result<bool, SecureStorageError> {
    validate_key(&key)?;
    let _guard = secure_storage_guard()?;
    if load_current(store, &key)? != expected {
        return Ok(false);
    }
    match replacement {
        Some(value) => set_and_confirm(store, &canonical_account_name(&key)?, &value)?,
        None => delete_current(store, &key)?,
    }
    Ok(true)
}

#[cfg(test)]
fn secure_get_or_create_uuid_with(
    store: &impl SecureStore,
    key: String,
) -> Result<String, SecureStorageError> {
    validate_key(&key)?;
    let _guard = secure_storage_guard()?;

    if let Some(value) = load_current(store, &key)? {
        return Ok(value);
    }

    let value = uuid::Uuid::new_v4().to_string();
    set_and_confirm(store, &canonical_account_name(&key)?, &value)?;
    Ok(value)
}

fn secure_get_or_create_uuid_with_legacy_migration(
    store: &impl SecureStore,
    legacy_store: &impl LegacySecureStore,
    key: String,
) -> Result<String, SecureStorageError> {
    validate_key(&key)?;
    let _guard = secure_storage_guard()?;

    if let Some(value) = load_current_or_migrate_legacy(store, legacy_store, &key)? {
        return Ok(value);
    }

    let value = uuid::Uuid::new_v4().to_string();
    set_and_confirm(store, &canonical_account_name(&key)?, &value)?;
    Ok(value)
}

fn secure_storage_guard() -> Result<std::sync::MutexGuard<'static, ()>, SecureStorageError> {
    SECURE_STORAGE_LOCK
        .lock()
        .map_err(|_| SecureStorageError::Unavailable)
}

fn load_current(store: &impl SecureStore, key: &str) -> Result<Option<String>, SecureStorageError> {
    store.get(&canonical_account_name(key)?)
}

fn load_current_or_migrate_legacy(
    store: &impl SecureStore,
    legacy_store: &impl LegacySecureStore,
    key: &str,
) -> Result<Option<String>, SecureStorageError> {
    if let Some(value) = load_current(store, key)? {
        return Ok(Some(value));
    }
    if !MIGRATABLE_LEGACY_KEYS.contains(&key) {
        return Ok(None);
    }

    let account = canonical_account_name(key)?;
    for service in LEGACY_KEYCHAIN_SERVICES {
        if let Ok(Some(value)) = legacy_store.get_from_service(service, &account) {
            set_and_confirm(store, &account, &value)?;
            return Ok(Some(value));
        }
    }

    Ok(None)
}

fn delete_current(store: &impl SecureStore, key: &str) -> Result<(), SecureStorageError> {
    delete_and_confirm(store, &canonical_account_name(key)?)
}

fn set_and_confirm(
    store: &impl SecureStore,
    account: &str,
    value: &str,
) -> Result<(), SecureStorageError> {
    match store.set(account, value) {
        Ok(()) => Ok(()),
        Err(_) if store.get(account)? == Some(value.to_owned()) => Ok(()),
        Err(_) => Err(SecureStorageError::Unavailable),
    }
}

fn delete_and_confirm(store: &impl SecureStore, account: &str) -> Result<(), SecureStorageError> {
    match store.delete(account) {
        Ok(()) => Ok(()),
        Err(_) if store.get(account)?.is_none() => Ok(()),
        Err(_) => Err(SecureStorageError::Unavailable),
    }
}

fn validate_key(key: &str) -> Result<(), SecureStorageError> {
    let is_safe = !key.is_empty()
        && key.len() <= MAX_KEY_LENGTH
        && key
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-' | b'%'));
    if !is_safe {
        return Err(SecureStorageError::InvalidKey);
    }

    Ok(())
}

fn canonical_account_name(key: &str) -> Result<String, SecureStorageError> {
    validate_key(key)?;
    Ok(format!("{CANONICAL_ACCOUNT_PREFIX}{key}"))
}

fn map_keychain_get_result(
    result: Result<String, keyring::Error>,
) -> Result<Option<String>, SecureStorageError> {
    match result {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => Err(SecureStorageError::Unavailable),
    }
}

fn map_keychain_set_result(result: Result<(), keyring::Error>) -> Result<(), SecureStorageError> {
    result.map_err(|_| SecureStorageError::Unavailable)
}

fn map_keychain_delete_result(
    result: Result<(), keyring::Error>,
) -> Result<(), SecureStorageError> {
    match result {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err(SecureStorageError::Unavailable),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::sync::{Arc, Mutex};
    use std::thread::{self, ThreadId};

    #[derive(Default)]
    struct MemorySecureStore {
        values: Mutex<HashMap<String, String>>,
    }

    impl SecureStore for MemorySecureStore {
        fn get(&self, key: &str) -> Result<Option<String>, SecureStorageError> {
            Ok(self.values.lock().expect("store lock").get(key).cloned())
        }

        fn set(&self, key: &str, value: &str) -> Result<(), SecureStorageError> {
            self.values
                .lock()
                .expect("store lock")
                .insert(key.to_owned(), value.to_owned());
            Ok(())
        }

        fn delete(&self, key: &str) -> Result<(), SecureStorageError> {
            self.values.lock().expect("store lock").remove(key);
            Ok(())
        }
    }

    #[derive(Default)]
    struct LegacyMemorySecureStore {
        values: Mutex<HashMap<(String, String), String>>,
    }

    impl LegacyMemorySecureStore {
        fn seed(&self, service: &str, account: &str, value: &str) {
            self.values
                .lock()
                .expect("store lock")
                .insert((service.to_owned(), account.to_owned()), value.to_owned());
        }
    }

    impl LegacySecureStore for LegacyMemorySecureStore {
        fn get_from_service(
            &self,
            service: &str,
            account: &str,
        ) -> Result<Option<String>, SecureStorageError> {
            Ok(self
                .values
                .lock()
                .expect("store lock")
                .get(&(service.to_owned(), account.to_owned()))
                .cloned())
        }
    }

    #[test]
    fn migrates_a_trusted_device_record_from_the_previous_release_service() {
        let current = MemorySecureStore::default();
        let legacy = LegacyMemorySecureStore::default();
        let account = canonical_account_name("auth.two-factor-trust.v1").unwrap();
        legacy.seed("Barwarden Session v19", &account, "trusted-token-record");

        assert_eq!(
            secure_get_with_legacy_migration(
                &current,
                &legacy,
                "auth.two-factor-trust.v1".to_owned(),
            ),
            Ok(Some("trusted-token-record".to_owned())),
        );
        assert_eq!(
            current.get(&account),
            Ok(Some("trusted-token-record".to_owned()))
        );
    }

    #[test]
    fn reuses_a_legacy_device_identifier_instead_of_creating_a_new_device() {
        let current = MemorySecureStore::default();
        let legacy = LegacyMemorySecureStore::default();
        let account = canonical_account_name("installation.deviceIdentifier").unwrap();
        legacy.seed("Barwarden Session v19", &account, "legacy-device-id");

        assert_eq!(
            secure_get_or_create_uuid_with_legacy_migration(
                &current,
                &legacy,
                "installation.deviceIdentifier".to_owned(),
            ),
            Ok("legacy-device-id".to_owned()),
        );
        assert_eq!(
            current.get(&account),
            Ok(Some("legacy-device-id".to_owned()))
        );
    }

    #[test]
    fn stores_reads_and_deletes_values() {
        let store = MemorySecureStore::default();

        secure_set_with(&store, "token".to_owned(), "value".to_owned())
            .expect("set should succeed");

        assert_eq!(
            secure_get_with(&store, "token".to_owned()).expect("get should succeed"),
            Some("value".to_owned())
        );

        secure_delete_with(&store, "token".to_owned()).expect("delete should succeed");

        assert_eq!(
            secure_get_with(&store, "token".to_owned()).expect("get should succeed"),
            None
        );
    }

    #[test]
    fn compare_and_swap_updates_only_the_expected_secure_value() {
        let store = MemorySecureStore::default();
        let account = canonical_account_name("history").expect("valid account name");
        store.set(&account, "before").expect("seed should succeed");

        assert_eq!(
            secure_compare_and_swap_with(
                &store,
                "history".to_owned(),
                Some("wrong".to_owned()),
                Some("replacement".to_owned()),
            ),
            Ok(false),
        );
        assert_eq!(store.get(&account).unwrap(), Some("before".to_owned()));
        assert_eq!(
            secure_compare_and_swap_with(
                &store,
                "history".to_owned(),
                Some("before".to_owned()),
                None,
            ),
            Ok(true),
        );
        assert_eq!(store.get(&account).unwrap(), None);
    }

    #[test]
    fn rejects_blank_keys() {
        let result = secure_set_with(
            &MemorySecureStore::default(),
            "  ".to_owned(),
            "value".to_owned(),
        );

        assert_eq!(result, Err(SecureStorageError::InvalidKey));
    }

    #[test]
    fn uses_exact_versioned_keychain_account_names() {
        assert_eq!(
            canonical_account_name("token"),
            Ok("barwarden:v1:token".to_owned())
        );
    }

    #[test]
    fn preserves_exact_debug_and_release_service_names() {
        assert_eq!(RELEASE_KEYCHAIN_SERVICE, "Barwarden Secure Storage");
        assert_eq!(DEBUG_KEYCHAIN_SERVICE, "Barwarden Debug");
    }

    #[test]
    fn serializes_only_fixed_typed_native_outcomes() {
        assert_eq!(
            serde_json::to_value(SecureStorageOutcome::Success { value: "stored" }).unwrap(),
            serde_json::json!({ "status": "success", "value": "stored" })
        );
        assert_eq!(
            serde_json::to_value(SecureStorageOutcome::<String>::Missing).unwrap(),
            serde_json::json!({ "status": "missing" })
        );
        assert_eq!(
            serde_json::to_value(SecureStorageOutcome::<String>::Unavailable).unwrap(),
            serde_json::json!({ "status": "unavailable" })
        );
        assert_eq!(
            serde_json::to_value(SecureStorageOutcome::<String>::InvalidKey).unwrap(),
            serde_json::json!({ "status": "invalid-key" })
        );
        assert_eq!(
            serde_json::to_value(SecureStorageOutcome::Success { value: () }).unwrap(),
            serde_json::json!({ "status": "success", "value": null })
        );
    }

    #[test]
    fn rejects_blank_unsafe_and_unbounded_keys_with_one_fixed_outcome() {
        let invalid_keys = [
            "".to_owned(),
            "  ".to_owned(),
            "auth/session".to_owned(),
            "auth:session".to_owned(),
            "auth\nsession".to_owned(),
            "账户".to_owned(),
            "x".repeat(MAX_KEY_LENGTH + 1),
        ];

        for key in invalid_keys {
            assert_eq!(validate_key(&key), Err(SecureStorageError::InvalidKey));
            assert_eq!(
                secure_set_with(
                    &MemorySecureStore::default(),
                    key,
                    "private-value".to_owned()
                ),
                Err(SecureStorageError::InvalidKey)
            );
        }
    }

    #[test]
    #[cfg(debug_assertions)]
    fn debug_build_uses_an_isolated_keychain_service() {
        assert_eq!(KEYCHAIN_SERVICE, "Barwarden Debug");
    }

    #[test]
    #[cfg(not(debug_assertions))]
    fn release_build_uses_the_product_keychain_service() {
        assert_eq!(KEYCHAIN_SERVICE, "Barwarden Secure Storage");
    }

    #[test]
    fn maps_typed_missing_keychain_get_to_none() {
        assert_eq!(
            map_keychain_get_result(Err(keyring::Error::NoEntry)),
            Ok(None)
        );
    }

    #[test]
    fn maps_typed_missing_keychain_delete_to_success() {
        assert_eq!(
            map_keychain_delete_result(Err(keyring::Error::NoEntry)),
            Ok(())
        );
    }

    #[test]
    fn maps_non_missing_keychain_failures_to_fixed_operation_errors() {
        assert_eq!(
            map_keychain_get_result(Err(keyring::Error::Invalid(
                "account".to_owned(),
                "sensitive platform detail".to_owned(),
            ))),
            Err(SecureStorageError::Unavailable)
        );
        assert_eq!(
            map_keychain_set_result(Err(keyring::Error::Invalid(
                "account".to_owned(),
                "sensitive platform detail".to_owned(),
            ))),
            Err(SecureStorageError::Unavailable)
        );
        assert_eq!(
            map_keychain_delete_result(Err(keyring::Error::Invalid(
                "account".to_owned(),
                "sensitive platform detail".to_owned(),
            ))),
            Err(SecureStorageError::Unavailable)
        );
    }

    #[test]
    fn current_write_failure_before_apply_preserves_the_previous_value() {
        let store = CurrentAccountFaultStore::new(CurrentAccountFault::SetBeforeApply);
        store.seed("auth.session", "current-value");

        assert_eq!(
            secure_set_with(&store, "auth.session".to_owned(), "replacement".to_owned()),
            Err(SecureStorageError::Unavailable)
        );
        assert_eq!(
            store.value_at(&canonical_account_name("auth.session").unwrap()),
            Some("current-value".to_owned())
        );
    }

    #[test]
    fn current_write_failure_after_apply_is_confirmed_as_success() {
        let store = CurrentAccountFaultStore::new(CurrentAccountFault::SetAfterApply);
        store.seed("auth.session", "current-value");

        assert_eq!(
            secure_set_with(&store, "auth.session".to_owned(), "replacement".to_owned()),
            Ok(())
        );
        assert_eq!(
            store.value_at(&canonical_account_name("auth.session").unwrap()),
            Some("replacement".to_owned())
        );
    }

    #[test]
    fn current_delete_failure_before_apply_preserves_the_value() {
        let store = CurrentAccountFaultStore::new(CurrentAccountFault::DeleteBeforeApply);
        store.seed("auth.session", "current-value");

        assert_eq!(
            secure_delete_with(&store, "auth.session".to_owned()),
            Err(SecureStorageError::Unavailable)
        );
        assert_eq!(
            store.value_at(&canonical_account_name("auth.session").unwrap()),
            Some("current-value".to_owned())
        );
    }

    #[test]
    fn current_delete_failure_after_apply_is_confirmed_as_success() {
        let store = CurrentAccountFaultStore::new(CurrentAccountFault::DeleteAfterApply);
        store.seed("auth.session", "current-value");

        assert_eq!(
            secure_delete_with(&store, "auth.session".to_owned()),
            Ok(())
        );
        assert_eq!(
            store.value_at(&canonical_account_name("auth.session").unwrap()),
            None
        );
    }

    #[derive(Clone, Copy, PartialEq, Eq)]
    enum CurrentAccountFault {
        SetBeforeApply,
        SetAfterApply,
        DeleteBeforeApply,
        DeleteAfterApply,
    }

    struct CurrentAccountFaultStore {
        values: Mutex<HashMap<String, String>>,
        fault: CurrentAccountFault,
        fired: Mutex<bool>,
    }

    impl CurrentAccountFaultStore {
        fn new(fault: CurrentAccountFault) -> Self {
            Self {
                values: Mutex::new(HashMap::new()),
                fault,
                fired: Mutex::new(false),
            }
        }

        fn seed(&self, key: &str, value: &str) {
            self.values
                .lock()
                .unwrap()
                .insert(canonical_account_name(key).unwrap(), value.to_owned());
        }

        fn value_at(&self, account: &str) -> Option<String> {
            self.values.lock().unwrap().get(account).cloned()
        }

        fn take_fault(&self, fault: CurrentAccountFault) -> bool {
            let mut fired = self.fired.lock().unwrap();
            if !*fired && self.fault == fault {
                *fired = true;
                return true;
            }
            false
        }
    }

    impl SecureStore for CurrentAccountFaultStore {
        fn get(&self, account: &str) -> Result<Option<String>, SecureStorageError> {
            Ok(self.value_at(account))
        }

        fn set(&self, account: &str, value: &str) -> Result<(), SecureStorageError> {
            if account.starts_with("barwarden:v1:")
                && self.take_fault(CurrentAccountFault::SetBeforeApply)
            {
                return Err(SecureStorageError::Unavailable);
            }
            self.values
                .lock()
                .unwrap()
                .insert(account.to_owned(), value.to_owned());
            if account.starts_with("barwarden:v1:")
                && self.take_fault(CurrentAccountFault::SetAfterApply)
            {
                return Err(SecureStorageError::Unavailable);
            }
            Ok(())
        }

        fn delete(&self, account: &str) -> Result<(), SecureStorageError> {
            if account.starts_with("barwarden:v1:")
                && self.take_fault(CurrentAccountFault::DeleteBeforeApply)
            {
                return Err(SecureStorageError::Unavailable);
            }
            self.values.lock().unwrap().remove(account);
            if account.starts_with("barwarden:v1:")
                && self.take_fault(CurrentAccountFault::DeleteAfterApply)
            {
                return Err(SecureStorageError::Unavailable);
            }
            Ok(())
        }
    }

    #[derive(Clone, Copy)]
    struct CallingThreadRejectingStore {
        calling_thread: ThreadId,
    }

    impl SecureStore for CallingThreadRejectingStore {
        fn get(&self, _key: &str) -> Result<Option<String>, SecureStorageError> {
            if thread::current().id() == self.calling_thread {
                return Err(SecureStorageError::Unavailable);
            }
            Ok(None)
        }

        fn set(&self, _key: &str, _value: &str) -> Result<(), SecureStorageError> {
            if thread::current().id() == self.calling_thread {
                return Err(SecureStorageError::Unavailable);
            }
            Ok(())
        }

        fn delete(&self, _key: &str) -> Result<(), SecureStorageError> {
            if thread::current().id() == self.calling_thread {
                return Err(SecureStorageError::Unavailable);
            }
            Ok(())
        }
    }

    #[test]
    fn dispatches_secure_store_reads_off_the_calling_thread() {
        let store = CallingThreadRejectingStore {
            calling_thread: thread::current().id(),
        };

        let result =
            tauri::async_runtime::block_on(secure_get_async_with(store, "token".to_owned()));

        assert_eq!(result, Ok(None));
    }

    #[test]
    fn dispatches_secure_store_writes_off_the_calling_thread() {
        let store = CallingThreadRejectingStore {
            calling_thread: thread::current().id(),
        };

        let result = tauri::async_runtime::block_on(secure_set_async_with(
            store,
            "token".to_owned(),
            "value".to_owned(),
        ));

        assert_eq!(result, Ok(()));
    }

    #[test]
    fn dispatches_secure_store_deletes_off_the_calling_thread() {
        let store = CallingThreadRejectingStore {
            calling_thread: thread::current().id(),
        };

        let result =
            tauri::async_runtime::block_on(secure_delete_async_with(store, "token".to_owned()));

        assert_eq!(result, Ok(()));
    }

    #[test]
    fn atomically_reuses_one_uuid_for_concurrent_first_reads() {
        use std::sync::{Arc, Barrier};

        #[derive(Clone, Default)]
        struct SharedStore(Arc<MemorySecureStore>);

        impl SecureStore for SharedStore {
            fn get(&self, key: &str) -> Result<Option<String>, SecureStorageError> {
                self.0.get(key)
            }
            fn set(&self, key: &str, value: &str) -> Result<(), SecureStorageError> {
                self.0.set(key, value)
            }
            fn delete(&self, key: &str) -> Result<(), SecureStorageError> {
                self.0.delete(key)
            }
        }

        let store = SharedStore::default();
        let barrier = Arc::new(Barrier::new(2));
        let handles = (0..2)
            .map(|_| {
                let store = store.clone();
                let barrier = Arc::clone(&barrier);
                thread::spawn(move || {
                    barrier.wait();
                    secure_get_or_create_uuid_with(
                        &store,
                        "installation.deviceIdentifier".to_owned(),
                    )
                    .expect("uuid should be available")
                })
            })
            .collect::<Vec<_>>();

        let values = handles
            .into_iter()
            .map(|handle| handle.join().expect("worker should finish"))
            .collect::<Vec<_>>();

        assert_eq!(values[0], values[1]);
        assert_eq!(
            store
                .get(&canonical_account_name("installation.deviceIdentifier").unwrap())
                .unwrap(),
            Some(values[0].clone())
        );
    }

    #[test]
    fn concurrent_compare_and_swap_has_one_winner_under_the_current_account() {
        use std::sync::{Arc, Barrier};

        #[derive(Clone, Default)]
        struct SharedStore(Arc<MemorySecureStore>);

        impl SecureStore for SharedStore {
            fn get(&self, key: &str) -> Result<Option<String>, SecureStorageError> {
                self.0.get(key)
            }
            fn set(&self, key: &str, value: &str) -> Result<(), SecureStorageError> {
                self.0.set(key, value)
            }
            fn delete(&self, key: &str) -> Result<(), SecureStorageError> {
                self.0.delete(key)
            }
        }

        let store = SharedStore::default();
        let account = canonical_account_name("generator.history.account").unwrap();
        store.set(&account, "before").unwrap();
        let barrier = Arc::new(Barrier::new(2));
        let handles = ["first", "second"].map(|replacement| {
            let store = store.clone();
            let barrier = Arc::clone(&barrier);
            thread::spawn(move || {
                barrier.wait();
                secure_compare_and_swap_with(
                    &store,
                    "generator.history.account".to_owned(),
                    Some("before".to_owned()),
                    Some(replacement.to_owned()),
                )
                .unwrap()
            })
        });
        let results = handles.map(|handle| handle.join().unwrap());

        assert_eq!(results.into_iter().filter(|result| *result).count(), 1);
        assert!(matches!(
            store.get(&account).unwrap().as_deref(),
            Some("first" | "second")
        ));
    }

    #[test]
    #[ignore = "requires a local macOS Keychain"]
    fn live_keychain_round_trip_smoke() {
        const DIAGNOSTIC_KEY: &str = "diagnostic.keychain-smoke";
        const DIAGNOSTIC_VALUE: &str = "barwarden-keychain-smoke";

        let current = canonical_account_name(DIAGNOSTIC_KEY).unwrap();
        let entry = keyring::Entry::new(KEYCHAIN_SERVICE, &current)
            .expect("diagnostic keychain entry should be available");

        clear_diagnostic_entry(&entry);
        let cleanup_result = Arc::new(Mutex::new(None));
        let caught_failure = std::panic::catch_unwind(std::panic::AssertUnwindSafe({
            let cleanup_result = Arc::clone(&cleanup_result);
            || {
                let _cleanup = DiagnosticKeychainCleanup {
                    entry: &entry,
                    result: cleanup_result,
                };
                secure_set_with(
                    &KeychainStore,
                    DIAGNOSTIC_KEY.to_owned(),
                    DIAGNOSTIC_VALUE.to_owned(),
                )
                .expect("diagnostic keychain value should be written");
                assert_eq!(
                    entry
                        .get_password()
                        .expect("diagnostic keychain value should be readable"),
                    DIAGNOSTIC_VALUE
                );
                panic!("deliberate caught diagnostic failure");
            }
        }));

        assert!(caught_failure.is_err());
        assert_eq!(cleanup_result.lock().unwrap().take(), Some(Ok(())));
        assert_eq!(map_keychain_get_result(entry.get_password()), Ok(None));
    }

    struct DiagnosticKeychainCleanup<'a> {
        entry: &'a keyring::Entry,
        result: Arc<Mutex<Option<Result<(), SecureStorageError>>>>,
    }

    impl Drop for DiagnosticKeychainCleanup<'_> {
        fn drop(&mut self) {
            *self.result.lock().unwrap() =
                Some(map_keychain_delete_result(self.entry.delete_credential()));
        }
    }

    fn clear_diagnostic_entry(entry: &keyring::Entry) {
        map_keychain_delete_result(entry.delete_credential())
            .expect("diagnostic keychain entry should be cleared");
    }
}

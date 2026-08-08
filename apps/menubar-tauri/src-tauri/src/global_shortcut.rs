use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

const SHORTCUT_DOCUMENT_VERSION: u8 = 1;
const SHORTCUT_FILE_NAME: &str = "global-shortcut.json";

#[derive(Clone, Debug, Eq, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutBinding {
    pub modifiers: Vec<ShortcutModifier>,
    pub code: String,
}

impl ShortcutBinding {
    pub fn option_key(code: impl Into<String>) -> Self {
        Self {
            modifiers: vec![ShortcutModifier::Option],
            code: code.into(),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ShortcutModifier {
    Control,
    Option,
    Shift,
    Command,
}

impl ShortcutModifier {
    fn display_order(self) -> u8 {
        match self {
            Self::Control => 0,
            Self::Option => 1,
            Self::Shift => 2,
            Self::Command => 3,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ShortcutValidationError {
    Invalid,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ShortcutMutationStatus {
    Updated,
    Unchanged,
    Invalid,
    Unavailable,
    Failed,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ShortcutAvailability {
    Active,
    Cleared,
    Unavailable,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ShortcutTriggerAction {
    Ignore,
    OpenAutoFill,
}

pub fn shortcut_trigger_action(state: ShortcutState) -> ShortcutTriggerAction {
    match state {
        ShortcutState::Pressed => ShortcutTriggerAction::OpenAutoFill,
        ShortcutState::Released => ShortcutTriggerAction::Ignore,
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutSnapshot {
    pub shortcut: Option<ShortcutBinding>,
    pub availability: ShortcutAvailability,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutMutationOutcome {
    pub status: ShortcutMutationStatus,
    pub snapshot: ShortcutSnapshot,
}

pub fn default_shortcut() -> ShortcutBinding {
    ShortcutBinding::option_key("KeyB")
}

pub fn validate_binding(
    mut binding: ShortcutBinding,
) -> Result<ShortcutBinding, ShortcutValidationError> {
    binding
        .modifiers
        .sort_by_key(|modifier| modifier.display_order());
    binding.modifiers.dedup();
    let has_primary = binding.modifiers.iter().any(|modifier| {
        matches!(
            modifier,
            ShortcutModifier::Control | ShortcutModifier::Option | ShortcutModifier::Command
        )
    });
    if !has_primary || !supported_code(&binding.code) {
        return Err(ShortcutValidationError::Invalid);
    }
    Ok(binding)
}

fn to_tauri_shortcut(binding: &ShortcutBinding) -> Result<Shortcut, ShortcutValidationError> {
    let binding = validate_binding(binding.clone())?;
    let modifiers = binding
        .modifiers
        .iter()
        .fold(Modifiers::empty(), |modifiers, modifier| {
            modifiers
                | match modifier {
                    ShortcutModifier::Control => Modifiers::CONTROL,
                    ShortcutModifier::Option => Modifiers::ALT,
                    ShortcutModifier::Shift => Modifiers::SHIFT,
                    ShortcutModifier::Command => Modifiers::SUPER,
                }
        });
    let code = Code::from_str(&binding.code).map_err(|_| ShortcutValidationError::Invalid)?;

    Ok(Shortcut::new(Some(modifiers), code))
}

fn supported_code(code: &str) -> bool {
    matches!(
        code,
        "ArrowUp"
            | "ArrowRight"
            | "ArrowDown"
            | "ArrowLeft"
            | "Home"
            | "End"
            | "PageUp"
            | "PageDown"
            | "Space"
            | "Tab"
            | "Enter"
            | "Backspace"
            | "Delete"
            | "Minus"
            | "Equal"
            | "BracketLeft"
            | "BracketRight"
            | "Backslash"
            | "IntlBackslash"
            | "Semicolon"
            | "Quote"
            | "Backquote"
            | "Comma"
            | "Period"
            | "Slash"
    ) || matches_key_code(code)
        || matches_digit_code(code)
        || matches_function_code(code)
}

fn matches_key_code(code: &str) -> bool {
    matches!(code.as_bytes(), [b'K', b'e', b'y', letter] if letter.is_ascii_uppercase())
}

fn matches_digit_code(code: &str) -> bool {
    matches!(code.as_bytes(), [b'D', b'i', b'g', b'i', b't', digit] if digit.is_ascii_digit())
}

fn matches_function_code(code: &str) -> bool {
    matches!(
        code,
        "F1" | "F2" | "F3" | "F4" | "F5" | "F6" | "F7" | "F8" | "F9" | "F10" | "F11" | "F12"
    )
}

#[derive(Deserialize, Serialize)]
struct ShortcutDocument {
    version: u8,
    shortcut: Option<ShortcutBinding>,
}

pub trait ShortcutRepository {
    fn load(&self) -> Result<Option<ShortcutBinding>, ()>;
    fn store(&self, binding: Option<&ShortcutBinding>) -> Result<(), ()>;
}

pub struct FileShortcutRepository {
    root: PathBuf,
}

impl FileShortcutRepository {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    fn target(&self) -> PathBuf {
        self.root.join(SHORTCUT_FILE_NAME)
    }

    fn temporary(&self) -> PathBuf {
        self.root.join(format!("{SHORTCUT_FILE_NAME}.tmp"))
    }
}

impl ShortcutRepository for FileShortcutRepository {
    fn load(&self) -> Result<Option<ShortcutBinding>, ()> {
        let bytes = match fs::read(self.target()) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(Some(default_shortcut()));
            }
            Err(_) => return Err(()),
        };
        let document: ShortcutDocument = match serde_json::from_slice::<ShortcutDocument>(&bytes) {
            Ok(document) if document.version == SHORTCUT_DOCUMENT_VERSION => document,
            Ok(_) | Err(_) => return Ok(Some(default_shortcut())),
        };

        match document.shortcut {
            Some(binding) => validate_binding(binding)
                .map(Some)
                .or_else(|_| Ok(Some(default_shortcut()))),
            None => Ok(None),
        }
    }

    fn store(&self, binding: Option<&ShortcutBinding>) -> Result<(), ()> {
        let shortcut = binding
            .cloned()
            .map(validate_binding)
            .transpose()
            .map_err(|_| ())?;
        let bytes = serde_json::to_vec(&ShortcutDocument {
            version: SHORTCUT_DOCUMENT_VERSION,
            shortcut,
        })
        .map_err(|_| ())?;
        fs::create_dir_all(&self.root).map_err(|_| ())?;

        let temporary = self.temporary();
        match fs::remove_file(&temporary) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err(()),
        }

        let result = (|| {
            let mut file = File::create(&temporary).map_err(|_| ())?;
            file.write_all(&bytes).map_err(|_| ())?;
            file.sync_all().map_err(|_| ())?;
            fs::rename(&temporary, self.target()).map_err(|_| ())?;
            File::open(Path::new(&self.root))
                .and_then(|directory| directory.sync_all())
                .map_err(|_| ())
        })();
        if result.is_err() {
            let _ = fs::remove_file(temporary);
        }
        result
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RegistryError {
    Unavailable,
}

pub trait ShortcutRegistry {
    fn register(&mut self, binding: &ShortcutBinding) -> Result<(), RegistryError>;
    fn unregister(&mut self, binding: &ShortcutBinding) -> Result<(), RegistryError>;
}

struct TauriShortcutRegistry {
    app: AppHandle,
}

impl TauriShortcutRegistry {
    fn new(app: AppHandle) -> Self {
        Self { app }
    }
}

impl ShortcutRegistry for TauriShortcutRegistry {
    fn register(&mut self, binding: &ShortcutBinding) -> Result<(), RegistryError> {
        let shortcut = to_tauri_shortcut(binding).map_err(|_| RegistryError::Unavailable)?;
        self.app
            .global_shortcut()
            .register(shortcut)
            .map_err(|_| RegistryError::Unavailable)
    }

    fn unregister(&mut self, binding: &ShortcutBinding) -> Result<(), RegistryError> {
        let shortcut = to_tauri_shortcut(binding).map_err(|_| RegistryError::Unavailable)?;
        self.app
            .global_shortcut()
            .unregister(shortcut)
            .map_err(|_| RegistryError::Unavailable)
    }
}

pub struct ShortcutManager<R, P> {
    current: Option<ShortcutBinding>,
    availability: ShortcutAvailability,
    owned_bindings: Vec<ShortcutBinding>,
    registry: R,
    repository: P,
}

impl<R, P> ShortcutManager<R, P>
where
    R: ShortcutRegistry,
    P: ShortcutRepository,
{
    pub fn new(current: Option<ShortcutBinding>, registry: R, repository: P) -> Self {
        let availability = if current.is_some() {
            ShortcutAvailability::Active
        } else {
            ShortcutAvailability::Cleared
        };
        let owned_bindings = current.iter().cloned().collect();
        Self {
            current,
            availability,
            owned_bindings,
            registry,
            repository,
        }
    }

    pub fn initialize(current: Option<ShortcutBinding>, mut registry: R, repository: P) -> Self {
        let mut owned_bindings = Vec::new();
        let availability = match current.as_ref() {
            Some(binding) if registry.register(binding).is_ok() => {
                owned_bindings.push(binding.clone());
                ShortcutAvailability::Active
            }
            Some(_) => ShortcutAvailability::Unavailable,
            None => ShortcutAvailability::Cleared,
        };
        let mut manager = Self::new(current, registry, repository);
        manager.availability = availability;
        manager.owned_bindings = owned_bindings;
        manager
    }

    pub fn current(&self) -> Option<&ShortcutBinding> {
        self.current.as_ref()
    }

    pub fn snapshot(&self) -> ShortcutSnapshot {
        ShortcutSnapshot {
            shortcut: self.current().cloned(),
            availability: self.availability,
        }
    }

    pub fn replace(&mut self, binding: ShortcutBinding) -> ShortcutMutationOutcome {
        let binding = match validate_binding(binding) {
            Ok(binding) => binding,
            Err(_) => return self.outcome(ShortcutMutationStatus::Invalid),
        };
        if self.current.as_ref() == Some(&binding)
            && self.owned_bindings.as_slice() == [binding.clone()]
        {
            return self.outcome(ShortcutMutationStatus::Unchanged);
        }

        if !self.unregister_all_owned() {
            self.refresh_availability();
            return self.outcome(ShortcutMutationStatus::Failed);
        }
        if self.register_owned(&binding).is_err() {
            self.restore_current_registration();
            return self.outcome(ShortcutMutationStatus::Unavailable);
        }
        if self.repository.store(Some(&binding)).is_err() {
            self.unregister_all_owned();
            self.restore_current_registration();
            return self.outcome(ShortcutMutationStatus::Failed);
        }

        self.current = Some(binding);
        self.refresh_availability();
        self.outcome(ShortcutMutationStatus::Updated)
    }

    pub fn clear(&mut self) -> ShortcutMutationOutcome {
        if self.current.is_none() && self.owned_bindings.is_empty() {
            self.refresh_availability();
            return self.outcome(ShortcutMutationStatus::Unchanged);
        }
        if !self.unregister_all_owned() {
            self.refresh_availability();
            return self.outcome(ShortcutMutationStatus::Failed);
        }
        if self.repository.store(None).is_err() {
            self.restore_current_registration();
            return self.outcome(ShortcutMutationStatus::Failed);
        }

        self.current = None;
        self.refresh_availability();
        self.outcome(ShortcutMutationStatus::Updated)
    }

    fn register_owned(&mut self, binding: &ShortcutBinding) -> Result<(), RegistryError> {
        if self.owned_bindings.contains(binding) {
            return Ok(());
        }
        self.registry.register(binding)?;
        self.owned_bindings.push(binding.clone());
        Ok(())
    }

    fn unregister_all_owned(&mut self) -> bool {
        let owned_bindings = std::mem::take(&mut self.owned_bindings);
        for binding in owned_bindings {
            if self.registry.unregister(&binding).is_err() {
                self.owned_bindings.push(binding);
            }
        }
        self.owned_bindings.is_empty()
    }

    fn restore_current_registration(&mut self) {
        if let Some(current) = self.current.clone() {
            let _ = self.register_owned(&current);
        }
        self.refresh_availability();
    }

    fn refresh_availability(&mut self) {
        self.availability = match (&self.current, self.owned_bindings.as_slice()) {
            (Some(current), [owned]) if current == owned => ShortcutAvailability::Active,
            (None, []) => ShortcutAvailability::Cleared,
            _ => ShortcutAvailability::Unavailable,
        };
    }

    fn outcome(&self, status: ShortcutMutationStatus) -> ShortcutMutationOutcome {
        ShortcutMutationOutcome {
            status,
            snapshot: self.snapshot(),
        }
    }
}

type ManagedShortcutManager = ShortcutManager<TauriShortcutRegistry, FileShortcutRepository>;

pub struct GlobalShortcutState {
    manager: Mutex<ManagedShortcutManager>,
}

impl GlobalShortcutState {
    pub fn load(app: AppHandle, root: PathBuf) -> Result<Self, ()> {
        let repository = FileShortcutRepository::new(root);
        let current = repository.load()?;
        let registry = TauriShortcutRegistry::new(app);
        Ok(Self {
            manager: Mutex::new(ShortcutManager::initialize(current, registry, repository)),
        })
    }

    fn snapshot(&self) -> ShortcutSnapshot {
        self.manager
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .snapshot()
    }

    fn replace(&self, app: AppHandle, shortcut: ShortcutBinding) -> ShortcutMutationOutcome {
        let mut manager = self
            .manager
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        manager.registry.app = app;
        manager.replace(shortcut)
    }

    fn clear(&self, app: AppHandle) -> ShortcutMutationOutcome {
        let mut manager = self
            .manager
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        manager.registry.app = app;
        manager.clear()
    }
}

#[tauri::command]
pub fn get_global_shortcut(state: State<'_, GlobalShortcutState>) -> ShortcutSnapshot {
    state.snapshot()
}

#[tauri::command]
pub fn set_global_shortcut(
    app: AppHandle,
    state: State<'_, GlobalShortcutState>,
    shortcut: ShortcutBinding,
) -> ShortcutMutationOutcome {
    state.replace(app, shortcut)
}

#[tauri::command]
pub fn clear_global_shortcut(
    app: AppHandle,
    state: State<'_, GlobalShortcutState>,
) -> ShortcutMutationOutcome {
    state.clear(app)
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;
    use std::fs;
    use std::rc::Rc;
    use std::sync::atomic::{AtomicUsize, Ordering};

    use super::*;
    use tauri_plugin_global_shortcut::{Code, Modifiers, ShortcutState};

    static NEXT_TEMP_DIRECTORY: AtomicUsize = AtomicUsize::new(0);

    fn binding(modifiers: &[ShortcutModifier], code: &str) -> ShortcutBinding {
        ShortcutBinding {
            modifiers: modifiers.to_vec(),
            code: code.to_owned(),
        }
    }

    fn default_binding() -> ShortcutBinding {
        default_shortcut()
    }

    fn temp_path() -> std::path::PathBuf {
        let suffix = NEXT_TEMP_DIRECTORY.fetch_add(1, Ordering::Relaxed);
        std::env::temp_dir().join(format!(
            "barwarden-global-shortcut-test-{}-{suffix}",
            std::process::id(),
        ))
    }

    #[test]
    fn released_shortcut_events_are_ignored() {
        assert_eq!(
            shortcut_trigger_action(ShortcutState::Released),
            ShortcutTriggerAction::Ignore
        );
    }

    #[test]
    fn pressed_shortcut_events_open_the_autofill_picker() {
        assert_eq!(
            shortcut_trigger_action(ShortcutState::Pressed),
            ShortcutTriggerAction::OpenAutoFill
        );
    }

    #[test]
    fn main_bootstrap_installs_the_plugin_and_exposes_shortcut_commands() {
        let main = include_str!("main.rs");

        let plugin = main
            .find(".plugin(")
            .expect("global shortcut plugin must be installed");
        let builder = main[plugin..]
            .find("tauri_plugin_global_shortcut::Builder::new()")
            .expect("official global shortcut plugin builder must be used");
        assert!(builder > 0);
        assert!(main.contains("global_shortcut::get_global_shortcut"));
        assert!(main.contains("global_shortcut::set_global_shortcut"));
        assert!(main.contains("global_shortcut::clear_global_shortcut"));
    }

    #[test]
    fn validated_binding_maps_to_official_shortcut_types() {
        let binding = binding(
            &[
                ShortcutModifier::Control,
                ShortcutModifier::Option,
                ShortcutModifier::Shift,
                ShortcutModifier::Command,
            ],
            "KeyB",
        );

        let shortcut = to_tauri_shortcut(&binding).unwrap();

        assert!(shortcut.matches(
            Modifiers::CONTROL | Modifiers::ALT | Modifiers::SHIFT | Modifiers::SUPER,
            Code::KeyB,
        ));
    }

    #[test]
    fn canonicalizes_default_option_b() {
        assert_eq!(
            validate_binding(binding(&[ShortcutModifier::Option], "KeyB")).unwrap(),
            ShortcutBinding {
                modifiers: vec![ShortcutModifier::Option],
                code: "KeyB".into(),
            }
        );
    }

    #[test]
    fn canonicalizes_modifier_order_and_removes_duplicates() {
        assert_eq!(
            validate_binding(binding(
                &[
                    ShortcutModifier::Shift,
                    ShortcutModifier::Option,
                    ShortcutModifier::Command,
                    ShortcutModifier::Option,
                ],
                "Digit4",
            ))
            .unwrap(),
            binding(
                &[
                    ShortcutModifier::Option,
                    ShortcutModifier::Shift,
                    ShortcutModifier::Command,
                ],
                "Digit4",
            )
        );
    }

    #[test]
    fn rejects_unmodified_modifier_only_and_shift_only_bindings() {
        for candidate in [
            binding(&[], "KeyB"),
            binding(&[ShortcutModifier::Shift], "KeyB"),
            binding(&[ShortcutModifier::Option], "AltLeft"),
        ] {
            assert_eq!(
                validate_binding(candidate),
                Err(ShortcutValidationError::Invalid)
            );
        }
    }

    #[test]
    fn accepts_the_supported_physical_code_categories() {
        for code in [
            "KeyA",
            "KeyZ",
            "Digit0",
            "Digit9",
            "F1",
            "F12",
            "ArrowUp",
            "ArrowRight",
            "ArrowDown",
            "ArrowLeft",
            "Home",
            "End",
            "PageUp",
            "PageDown",
            "Space",
            "Tab",
            "Enter",
            "Backspace",
            "Delete",
            "Minus",
            "Equal",
            "BracketLeft",
            "BracketRight",
            "Backslash",
            "Semicolon",
            "Quote",
            "Backquote",
            "Comma",
            "Period",
            "Slash",
        ] {
            assert!(validate_binding(binding(&[ShortcutModifier::Command], code)).is_ok());
        }
    }

    #[test]
    fn accepts_only_canonical_function_key_codes() {
        for code in ["F1", "F9", "F10", "F12"] {
            assert!(validate_binding(binding(&[ShortcutModifier::Command], code)).is_ok());
        }
        for code in ["F01", "F00", "F013"] {
            assert_eq!(
                validate_binding(binding(&[ShortcutModifier::Command], code)),
                Err(ShortcutValidationError::Invalid)
            );
        }
    }

    #[test]
    fn missing_file_resolves_default_but_explicit_null_survives_restart() {
        let root = temp_path();
        let repository = FileShortcutRepository::new(&root);
        assert_eq!(repository.load().unwrap(), Some(default_binding()));

        repository.store(None).unwrap();
        assert_eq!(repository.load().unwrap(), None);

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn corrupt_or_future_version_falls_back_to_default() {
        let root = temp_path();
        fs::create_dir_all(&root).unwrap();
        let target = root.join(SHORTCUT_FILE_NAME);
        let repository = FileShortcutRepository::new(&root);

        fs::write(&target, b"not json").unwrap();
        assert_eq!(repository.load().unwrap(), Some(default_binding()));

        fs::write(&target, br#"{"version":999,"shortcut":null}"#).unwrap();
        assert_eq!(repository.load().unwrap(), Some(default_binding()));

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn store_replaces_stale_temporary_file_with_a_versioned_document() {
        let root = temp_path();
        fs::create_dir_all(&root).unwrap();
        let temporary = root.join(format!("{SHORTCUT_FILE_NAME}.tmp"));
        fs::write(&temporary, b"stale").unwrap();
        let repository = FileShortcutRepository::new(&root);
        let shortcut = binding(&[ShortcutModifier::Command], "KeyP");

        repository.store(Some(&shortcut)).unwrap();

        assert!(!temporary.exists());
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(
                &fs::read(root.join(SHORTCUT_FILE_NAME)).unwrap(),
            )
            .unwrap(),
            serde_json::json!({
                "version": SHORTCUT_DOCUMENT_VERSION,
                "shortcut": { "modifiers": ["command"], "code": "KeyP" },
            })
        );

        fs::remove_dir_all(root).unwrap();
    }

    #[derive(Clone, Debug, Eq, PartialEq)]
    enum RegistryOperation {
        Register(ShortcutBinding),
        Unregister(ShortcutBinding),
    }

    #[derive(Default)]
    struct RegistryState {
        registered: Vec<ShortcutBinding>,
        rejected_registration: Option<ShortcutBinding>,
        rejected_unregistration: Option<ShortcutBinding>,
        registration_failures: Vec<ShortcutBinding>,
        operations: Vec<RegistryOperation>,
    }

    #[derive(Clone)]
    struct FakeRegistry(Rc<RefCell<RegistryState>>);

    impl FakeRegistry {
        fn with_registered(binding: &ShortcutBinding) -> (Self, Rc<RefCell<RegistryState>>) {
            let state = Rc::new(RefCell::new(RegistryState {
                registered: vec![binding.clone()],
                ..RegistryState::default()
            }));
            (Self(state.clone()), state)
        }
    }

    impl ShortcutRegistry for FakeRegistry {
        fn register(&mut self, binding: &ShortcutBinding) -> Result<(), RegistryError> {
            let mut state = self.0.borrow_mut();
            state
                .operations
                .push(RegistryOperation::Register(binding.clone()));
            if state.rejected_registration.as_ref() == Some(binding) {
                return Err(RegistryError::Unavailable);
            }
            if state.registration_failures.first() == Some(binding) {
                state.registration_failures.remove(0);
                return Err(RegistryError::Unavailable);
            }
            if !state.registered.contains(binding) {
                state.registered.push(binding.clone());
            }
            Ok(())
        }

        fn unregister(&mut self, binding: &ShortcutBinding) -> Result<(), RegistryError> {
            let mut state = self.0.borrow_mut();
            state
                .operations
                .push(RegistryOperation::Unregister(binding.clone()));
            if state.rejected_unregistration.as_ref() == Some(binding) {
                return Err(RegistryError::Unavailable);
            }
            state.registered.retain(|registered| registered != binding);
            Ok(())
        }
    }

    #[derive(Default)]
    struct RepositoryState {
        persisted: Option<ShortcutBinding>,
        reject_store: bool,
    }

    #[derive(Clone)]
    struct FakeRepository(Rc<RefCell<RepositoryState>>);

    impl FakeRepository {
        fn with_persisted(binding: &ShortcutBinding) -> (Self, Rc<RefCell<RepositoryState>>) {
            let state = Rc::new(RefCell::new(RepositoryState {
                persisted: Some(binding.clone()),
                ..RepositoryState::default()
            }));
            (Self(state.clone()), state)
        }
    }

    impl ShortcutRepository for FakeRepository {
        fn load(&self) -> Result<Option<ShortcutBinding>, ()> {
            Ok(self.0.borrow().persisted.clone())
        }

        fn store(&self, binding: Option<&ShortcutBinding>) -> Result<(), ()> {
            let mut state = self.0.borrow_mut();
            if state.reject_store {
                return Err(());
            }
            state.persisted = binding.cloned();
            Ok(())
        }
    }

    fn manager_with(
        current: ShortcutBinding,
    ) -> (
        ShortcutManager<FakeRegistry, FakeRepository>,
        Rc<RefCell<RegistryState>>,
        Rc<RefCell<RepositoryState>>,
    ) {
        let (registry, registry_state) = FakeRegistry::with_registered(&current);
        let (repository, repository_state) = FakeRepository::with_persisted(&current);
        (
            ShortcutManager::new(Some(current), registry, repository),
            registry_state,
            repository_state,
        )
    }

    #[test]
    fn startup_registration_conflict_marks_binding_unavailable_without_discarding_it() {
        let current = default_binding();
        let state = Rc::new(RefCell::new(RegistryState {
            rejected_registration: Some(current.clone()),
            ..RegistryState::default()
        }));
        let registry = FakeRegistry(state.clone());
        let repository_state = Rc::new(RefCell::new(RepositoryState {
            persisted: Some(current.clone()),
            ..RepositoryState::default()
        }));
        let repository = FakeRepository(repository_state);

        let manager = ShortcutManager::initialize(Some(current.clone()), registry, repository);

        assert_eq!(manager.current(), Some(&current));
        assert_eq!(
            manager.snapshot(),
            ShortcutSnapshot {
                shortcut: Some(current),
                availability: ShortcutAvailability::Unavailable,
            }
        );
        assert!(state.borrow().registered.is_empty());
    }

    #[test]
    fn unavailable_startup_binding_can_be_replaced_without_unregistration() {
        let current = default_binding();
        let replacement = binding(&[ShortcutModifier::Command], "KeyP");
        let registry_state = Rc::new(RefCell::new(RegistryState {
            rejected_registration: Some(current.clone()),
            rejected_unregistration: Some(current),
            ..RegistryState::default()
        }));
        let repository_state = Rc::new(RefCell::new(RepositoryState {
            persisted: Some(default_binding()),
            ..RepositoryState::default()
        }));
        let mut manager = ShortcutManager::initialize(
            Some(default_binding()),
            FakeRegistry(registry_state.clone()),
            FakeRepository(repository_state.clone()),
        );

        let outcome = manager.replace(replacement.clone());

        assert_eq!(outcome.status, ShortcutMutationStatus::Updated);
        assert_eq!(outcome.snapshot.shortcut, Some(replacement.clone()));
        assert_eq!(outcome.snapshot.availability, ShortcutAvailability::Active);
        assert_eq!(
            registry_state.borrow().registered,
            vec![replacement.clone()]
        );
        assert_eq!(repository_state.borrow().persisted, Some(replacement));
    }

    #[test]
    fn unavailable_startup_binding_can_be_cleared_without_unregistration() {
        let current = default_binding();
        let registry_state = Rc::new(RefCell::new(RegistryState {
            rejected_registration: Some(current.clone()),
            rejected_unregistration: Some(current.clone()),
            ..RegistryState::default()
        }));
        let repository_state = Rc::new(RefCell::new(RepositoryState {
            persisted: Some(current.clone()),
            ..RepositoryState::default()
        }));
        let mut manager = ShortcutManager::initialize(
            Some(current),
            FakeRegistry(registry_state.clone()),
            FakeRepository(repository_state.clone()),
        );

        let outcome = manager.clear();

        assert_eq!(outcome.status, ShortcutMutationStatus::Updated);
        assert_eq!(outcome.snapshot.shortcut, None);
        assert_eq!(outcome.snapshot.availability, ShortcutAvailability::Cleared);
        assert!(registry_state.borrow().registered.is_empty());
        assert_eq!(repository_state.borrow().persisted, None);
    }

    #[test]
    fn replacement_updates_registration_persistence_and_snapshot() {
        let old = default_binding();
        let replacement = binding(&[ShortcutModifier::Command], "KeyP");
        let (mut manager, registry, repository) = manager_with(old.clone());

        let outcome = manager.replace(replacement.clone());

        assert_eq!(outcome.status, ShortcutMutationStatus::Updated);
        assert_eq!(outcome.snapshot.shortcut, Some(replacement.clone()));
        assert_eq!(outcome.snapshot.availability, ShortcutAvailability::Active);
        assert_eq!(manager.current(), Some(&replacement));
        assert_eq!(registry.borrow().registered, vec![replacement.clone()]);
        assert_eq!(repository.borrow().persisted, Some(replacement));
    }

    #[test]
    fn registration_conflict_rolls_back_to_the_old_shortcut() {
        let old = default_binding();
        let replacement = binding(&[ShortcutModifier::Command], "KeyP");
        let (mut manager, registry, repository) = manager_with(old.clone());
        registry.borrow_mut().rejected_registration = Some(replacement.clone());

        let outcome = manager.replace(replacement.clone());

        assert_eq!(outcome.status, ShortcutMutationStatus::Unavailable);
        assert_eq!(manager.current(), Some(&old));
        assert!(registry.borrow().registered.contains(&old));
        assert!(!registry.borrow().registered.contains(&replacement));
        assert_eq!(repository.borrow().persisted, Some(old));
    }

    #[test]
    fn persistence_failure_rolls_back_the_replacement_registration() {
        let old = default_binding();
        let replacement = binding(&[ShortcutModifier::Command], "KeyP");
        let (mut manager, registry, repository) = manager_with(old.clone());
        repository.borrow_mut().reject_store = true;

        let outcome = manager.replace(replacement.clone());

        assert_eq!(outcome.status, ShortcutMutationStatus::Failed);
        assert_eq!(manager.current(), Some(&old));
        assert_eq!(registry.borrow().registered, vec![old.clone()]);
        assert_eq!(repository.borrow().persisted, Some(old));
    }

    #[test]
    fn clear_unregisters_and_persists_an_explicit_null() {
        let old = default_binding();
        let (mut manager, registry, repository) = manager_with(old.clone());

        let outcome = manager.clear();

        assert_eq!(outcome.status, ShortcutMutationStatus::Updated);
        assert_eq!(outcome.snapshot.shortcut, None);
        assert_eq!(outcome.snapshot.availability, ShortcutAvailability::Cleared);
        assert_eq!(manager.current(), None);
        assert!(!registry.borrow().registered.contains(&old));
        assert_eq!(repository.borrow().persisted, None);
    }

    #[test]
    fn clearing_an_already_cleared_shortcut_is_unchanged() {
        let shortcut = default_binding();
        let (registry, _) = FakeRegistry::with_registered(&shortcut);
        let (repository, _) = FakeRepository::with_persisted(&shortcut);
        let mut manager = ShortcutManager::new(None, registry, repository);

        let outcome = manager.clear();

        assert_eq!(outcome.status, ShortcutMutationStatus::Unchanged);
        assert_eq!(outcome.snapshot.availability, ShortcutAvailability::Cleared);
        assert_eq!(manager.current(), None);
    }

    #[test]
    fn clear_persistence_failure_re_registers_the_old_shortcut() {
        let old = default_binding();
        let (mut manager, registry, repository) = manager_with(old.clone());
        repository.borrow_mut().reject_store = true;

        let outcome = manager.clear();

        assert_eq!(outcome.status, ShortcutMutationStatus::Failed);
        assert_eq!(manager.current(), Some(&old));
        assert!(registry.borrow().registered.contains(&old));
        assert_eq!(repository.borrow().persisted, Some(old));
    }

    #[test]
    fn failed_rollback_marks_the_shortcut_unavailable() {
        let old = default_binding();
        let replacement = binding(&[ShortcutModifier::Command], "KeyP");
        let (mut manager, registry, repository) = manager_with(old.clone());
        repository.borrow_mut().reject_store = true;
        registry.borrow_mut().rejected_unregistration = Some(replacement.clone());

        let outcome = manager.replace(replacement.clone());

        assert_eq!(outcome.status, ShortcutMutationStatus::Failed);
        assert_eq!(
            outcome.snapshot.availability,
            ShortcutAvailability::Unavailable
        );
        assert_eq!(manager.current(), Some(&old));
        assert!(registry.borrow().registered.contains(&old));
        assert!(registry.borrow().registered.contains(&replacement));
        assert_eq!(repository.borrow().persisted, Some(old));
    }

    #[test]
    fn chained_cleanup_failure_then_clear_removes_every_owned_registration() {
        let old = default_binding();
        let replacement = binding(&[ShortcutModifier::Command], "KeyP");
        let (mut manager, registry, repository) = manager_with(old.clone());
        repository.borrow_mut().reject_store = true;
        registry.borrow_mut().rejected_unregistration = Some(replacement.clone());

        assert_eq!(
            manager.replace(replacement.clone()).status,
            ShortcutMutationStatus::Failed
        );
        assert_eq!(registry.borrow().registered, vec![replacement.clone(), old]);

        repository.borrow_mut().reject_store = false;
        registry.borrow_mut().rejected_unregistration = None;
        registry.borrow_mut().operations.clear();

        let outcome = manager.clear();

        assert_eq!(outcome.status, ShortcutMutationStatus::Updated);
        assert_eq!(outcome.snapshot.shortcut, None);
        assert_eq!(outcome.snapshot.availability, ShortcutAvailability::Cleared);
        assert!(registry.borrow().registered.is_empty());
        assert_eq!(repository.borrow().persisted, None);
    }

    #[test]
    fn chained_cleanup_failure_then_replace_removes_orphan_before_success() {
        let old = default_binding();
        let orphan = binding(&[ShortcutModifier::Command], "KeyP");
        let replacement = binding(&[ShortcutModifier::Control], "KeyK");
        let (mut manager, registry, repository) = manager_with(old.clone());
        repository.borrow_mut().reject_store = true;
        registry.borrow_mut().rejected_unregistration = Some(orphan.clone());

        assert_eq!(
            manager.replace(orphan.clone()).status,
            ShortcutMutationStatus::Failed
        );
        assert_eq!(registry.borrow().registered, vec![orphan, old]);

        repository.borrow_mut().reject_store = false;
        registry.borrow_mut().rejected_unregistration = None;
        registry.borrow_mut().operations.clear();

        let outcome = manager.replace(replacement.clone());

        assert_eq!(outcome.status, ShortcutMutationStatus::Updated);
        assert_eq!(outcome.snapshot.shortcut, Some(replacement.clone()));
        assert_eq!(outcome.snapshot.availability, ShortcutAvailability::Active);
        assert_eq!(registry.borrow().registered, vec![replacement.clone()]);
        assert_eq!(repository.borrow().persisted, Some(replacement));
    }

    #[test]
    fn chained_restore_failure_next_mutation_uses_actual_owned_sequence() {
        let old = default_binding();
        let conflicted = binding(&[ShortcutModifier::Command], "KeyP");
        let replacement = binding(&[ShortcutModifier::Control], "KeyK");
        let (mut manager, registry, repository) = manager_with(old.clone());
        registry.borrow_mut().registration_failures = vec![conflicted.clone(), old.clone()];

        let failed = manager.replace(conflicted);

        assert_eq!(failed.status, ShortcutMutationStatus::Unavailable);
        assert_eq!(failed.snapshot.shortcut, Some(old.clone()));
        assert_eq!(
            failed.snapshot.availability,
            ShortcutAvailability::Unavailable
        );
        assert!(registry.borrow().registered.is_empty());

        registry.borrow_mut().rejected_unregistration = Some(old);
        registry.borrow_mut().operations.clear();

        let outcome = manager.replace(replacement.clone());

        assert_eq!(outcome.status, ShortcutMutationStatus::Updated);
        assert_eq!(registry.borrow().registered, vec![replacement.clone()]);
        assert_eq!(
            registry.borrow().operations,
            vec![RegistryOperation::Register(replacement)]
        );
        assert_eq!(repository.borrow().persisted, outcome.snapshot.shortcut);
    }

    #[test]
    fn chained_failure_outcome_serializes_only_fixed_command_fields() {
        let old = default_binding();
        let replacement = binding(&[ShortcutModifier::Command], "KeyP");
        let (mut manager, registry, repository) = manager_with(old.clone());
        repository.borrow_mut().reject_store = true;
        registry.borrow_mut().rejected_unregistration = Some(replacement.clone());

        let outcome = manager.replace(replacement);

        assert_eq!(
            serde_json::to_value(outcome).unwrap(),
            serde_json::json!({
                "status": "failed",
                "snapshot": {
                    "shortcut": {
                        "modifiers": ["option"],
                        "code": "KeyB",
                    },
                    "availability": "unavailable",
                },
            })
        );
    }
}

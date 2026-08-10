use std::sync::{Mutex, OnceLock};
use std::time::Instant;

use serde::Serialize;

#[cfg(target_os = "macos")]
use objc2::rc::Retained;
#[cfg(target_os = "macos")]
use objc2::runtime::{AnyObject, NSObjectProtocol};
#[cfg(target_os = "macos")]
use objc2_app_kit::{NSApplicationActivationOptions, NSRunningApplication, NSWorkspace};

pub const APP_BUNDLE_ID: &str = crate::brand::BUNDLE_IDENTIFIER;

#[derive(Clone, Debug)]
pub struct FrontmostApp {
    pub(crate) bundle_id: String,
    app_name: String,
    pub(crate) process_id: i32,
    instance: ApplicationInstance,
    captured_at: Instant,
}

#[derive(Clone, Debug)]
enum ApplicationInstance {
    #[cfg(target_os = "macos")]
    Native(Retained<NSRunningApplication>),
    #[cfg(test)]
    Test(u64),
}

impl PartialEq for ApplicationInstance {
    fn eq(&self, other: &Self) -> bool {
        match (self, other) {
            #[cfg(target_os = "macos")]
            (Self::Native(left), Self::Native(right)) => {
                let left: &NSRunningApplication = left.as_ref();
                let right: &AnyObject = right.as_ref();
                NSObjectProtocol::isEqual(left, Some(right))
            }
            #[cfg(test)]
            (Self::Test(left), Self::Test(right)) => left == right,
            #[allow(unreachable_patterns)]
            _ => false,
        }
    }
}

impl Eq for ApplicationInstance {}

impl PartialEq for FrontmostApp {
    fn eq(&self, other: &Self) -> bool {
        self.bundle_id == other.bundle_id
            && self.app_name == other.app_name
            && self.process_id == other.process_id
            && self.instance == other.instance
    }
}

impl Eq for FrontmostApp {}

#[derive(Default)]
pub(crate) struct TargetAppStore {
    target: Mutex<Option<StoredTargetApp>>,
}

#[derive(Clone)]
struct StoredTargetApp {
    target: FrontmostApp,
    fill_context: Option<crate::autofill_ax_context::FillContextPresentation>,
}

impl TargetAppStore {
    pub(crate) fn replace(&self, target: Option<FrontmostApp>) {
        let mut stored = self
            .target
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        *stored = target.map(|target| StoredTargetApp {
            target,
            fill_context: None,
        });
    }

    fn replace_preserving_context(&self, target: FrontmostApp) {
        let mut stored = self
            .target
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let fill_context = stored
            .as_ref()
            .filter(|stored| stored.target == target)
            .and_then(|stored| stored.fill_context.clone());
        *stored = Some(StoredTargetApp {
            target,
            fill_context,
        });
    }

    fn replace_with_context(
        &self,
        target: FrontmostApp,
        fill_context: crate::autofill_ax_context::FillContextPresentation,
    ) {
        *self
            .target
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(StoredTargetApp {
            target,
            fill_context: Some(fill_context),
        });
    }

    pub(crate) fn current(&self) -> Option<FrontmostApp> {
        self.target
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .as_ref()
            .map(|stored| stored.target.clone())
    }

    fn snapshot(
        &self,
    ) -> Option<(
        FrontmostApp,
        Option<crate::autofill_ax_context::FillContextPresentation>,
    )> {
        self.snapshot_with_hook(|| {})
    }

    fn snapshot_with_hook(
        &self,
        hook: impl FnOnce(),
    ) -> Option<(
        FrontmostApp,
        Option<crate::autofill_ax_context::FillContextPresentation>,
    )> {
        let stored = self
            .target
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        hook();
        stored
            .as_ref()
            .map(|stored| (stored.target.clone(), stored.fill_context.clone()))
    }

    #[cfg(test)]
    fn current_fill_context(&self) -> Option<crate::autofill_ax_context::FillContextPresentation> {
        self.target
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .as_ref()
            .and_then(|stored| stored.fill_context.clone())
    }
}

static LAST_TARGET_APP: OnceLock<TargetAppStore> = OnceLock::new();

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "status", rename_all = "kebab-case")]
pub enum AutoFillEntryContextOutcome {
    Available {
        #[serde(rename = "bundleId")]
        bundle_id: String,
        #[serde(rename = "appName")]
        app_name: String,
        #[serde(flatten)]
        fill_context: crate::autofill_ax_context::FillContextPresentation,
    },
    Unavailable,
}

pub fn capture_current_target_app() {
    capture_current_target_with(target_app_store(), current_frontmost_app, APP_BUNDLE_ID);
}

pub(crate) fn last_target_app() -> Option<FrontmostApp> {
    target_app_store().current()
}

pub(crate) fn replace_target_app(target: FrontmostApp) {
    target_app_store().replace_preserving_context(target);
}

pub(crate) fn replace_target_app_with_context(
    target: FrontmostApp,
    fill_context: crate::autofill_ax_context::FillContextPresentation,
) {
    target_app_store().replace_with_context(target, fill_context);
}

#[tauri::command]
pub fn autofill_entry_context(
    contexts: tauri::State<'_, crate::autofill_ax_context::DetectedFillContextStore>,
) -> AutoFillEntryContextOutcome {
    let Some((target, stored_context)) = target_app_store().snapshot() else {
        return AutoFillEntryContextOutcome::Unavailable;
    };
    let fill_context = stored_context.or_else(|| {
        if !target_is_running(&target) {
            return None;
        }
        fallback_fill_context_with(&contexts, &target, |target, generation| {
            crate::autofill_ax_context::capture_native_fill_context(target, generation)
                .map(|captured| captured.fields)
        })
    });
    autofill_context_with(
        Some(target),
        fill_context,
        Instant::now(),
        target_is_running,
    )
}

fn fallback_fill_context_with<Capture>(
    contexts: &crate::autofill_ax_context::DetectedFillContextStore,
    target: &FrontmostApp,
    capture: Capture,
) -> Option<crate::autofill_ax_context::FillContextPresentation>
where
    Capture: FnOnce(
        &FrontmostApp,
        u64,
    ) -> Result<
        Vec<crate::autofill_ax_context::CapturedFieldFingerprint>,
        crate::autofill_ax_context::AxContextError,
    >,
{
    let generation = contexts.current_observer_generation();
    let fields = capture(target, generation).ok()?;
    contexts
        .try_insert(
            target.clone(),
            fields,
            crate::autofill_field_context::DetectedAction::Choose,
        )
        .ok()
}

fn autofill_context_with<IsRunning>(
    target: Option<FrontmostApp>,
    fill_context: Option<crate::autofill_ax_context::FillContextPresentation>,
    _now: Instant,
    is_running: IsRunning,
) -> AutoFillEntryContextOutcome
where
    IsRunning: FnOnce(&FrontmostApp) -> bool,
{
    let Some(target) = target else {
        return AutoFillEntryContextOutcome::Unavailable;
    };
    if !is_running(&target) {
        return AutoFillEntryContextOutcome::Unavailable;
    }
    let Some(fill_context) = fill_context.filter(|context| !context.fill_context_token.is_empty())
    else {
        return AutoFillEntryContextOutcome::Unavailable;
    };
    AutoFillEntryContextOutcome::Available {
        bundle_id: target.bundle_id,
        app_name: target.app_name,
        fill_context,
    }
}

pub(crate) fn current_frontmost_app() -> Result<Option<FrontmostApp>, String> {
    #[cfg(target_os = "macos")]
    {
        let workspace = NSWorkspace::sharedWorkspace();
        return Ok(workspace
            .frontmostApplication()
            .and_then(capture_running_application));
    }

    #[cfg(not(target_os = "macos"))]
    Ok(None)
}

pub(crate) fn target_is_running(target: &FrontmostApp) -> bool {
    #[cfg(target_os = "macos")]
    {
        return captured_application(target)
            .is_some_and(|application| running_application_matches(application, target));
    }

    #[cfg(not(target_os = "macos"))]
    false
}

pub(crate) fn activate_target_app(target: &FrontmostApp) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let application = captured_application(target)
            .filter(|application| running_application_matches(application, target))
            .ok_or_else(|| "captured application is no longer running".to_owned())?;
        if application.activateWithOptions(NSApplicationActivationOptions::empty()) {
            return Ok(());
        }
        return Err("captured application could not be activated".to_owned());
    }

    #[cfg(not(target_os = "macos"))]
    Err("application activation is unsupported".to_owned())
}

fn validated_running_application_identity(
    bundle_id: Option<&str>,
    process_id: i32,
    terminated: bool,
) -> Option<(String, i32)> {
    let bundle_id = bundle_id?.trim();
    if bundle_id.is_empty() || process_id <= 0 || terminated {
        return None;
    }

    Some((bundle_id.to_owned(), process_id))
}

#[cfg(target_os = "macos")]
fn capture_running_application(
    application: Retained<NSRunningApplication>,
) -> Option<FrontmostApp> {
    let bundle_id = application
        .bundleIdentifier()
        .map(|value| value.to_string());
    let app_name = application
        .localizedName()
        .map(|value| value.to_string())
        .unwrap_or_default();
    let (bundle_id, process_id) = validated_running_application_identity(
        bundle_id.as_deref(),
        application.processIdentifier(),
        application.isTerminated(),
    )?;
    Some(FrontmostApp {
        bundle_id,
        app_name,
        process_id,
        instance: ApplicationInstance::Native(application),
        captured_at: Instant::now(),
    })
}

#[cfg(target_os = "macos")]
fn captured_application(target: &FrontmostApp) -> Option<&NSRunningApplication> {
    match &target.instance {
        ApplicationInstance::Native(application) => Some(application),
        #[cfg(test)]
        ApplicationInstance::Test(_) => None,
    }
}

#[cfg(target_os = "macos")]
fn running_application_matches(application: &NSRunningApplication, target: &FrontmostApp) -> bool {
    let bundle_id = application
        .bundleIdentifier()
        .map(|value| value.to_string());
    validated_running_application_identity(
        bundle_id.as_deref(),
        application.processIdentifier(),
        application.isTerminated(),
    )
    .is_some_and(|(bundle_id, process_id)| {
        bundle_id == target.bundle_id && process_id == target.process_id
    })
}

fn valid_external_target(app: FrontmostApp, self_bundle_id: &str) -> Option<FrontmostApp> {
    let bundle_id = app.bundle_id.trim().to_owned();
    if bundle_id.is_empty() || bundle_id == self_bundle_id || app.process_id <= 0 {
        return None;
    }

    let mut app = app;
    app.bundle_id = bundle_id;
    Some(app)
}

#[cfg(test)]
pub(crate) fn test_frontmost_app(
    bundle_id: &str,
    process_id: i32,
    instance_token: u64,
) -> FrontmostApp {
    test_frontmost_app_named(bundle_id, bundle_id, process_id, instance_token)
}

#[cfg(test)]
pub(crate) fn test_frontmost_app_named(
    bundle_id: &str,
    app_name: &str,
    process_id: i32,
    instance_token: u64,
) -> FrontmostApp {
    FrontmostApp {
        bundle_id: bundle_id.to_owned(),
        app_name: app_name.to_owned(),
        process_id,
        instance: ApplicationInstance::Test(instance_token),
        captured_at: Instant::now(),
    }
}

#[cfg(test)]
fn running_application_identity(
    bundle_id: Option<&str>,
    process_id: i32,
    terminated: bool,
) -> Option<FrontmostApp> {
    validated_running_application_identity(bundle_id, process_id, terminated).map(
        |(bundle_id, process_id)| test_frontmost_app(&bundle_id, process_id, process_id as u64),
    )
}

pub(crate) fn capture_current_target_with<Read>(
    store: &TargetAppStore,
    read_frontmost: Read,
    self_bundle_id: &str,
) where
    Read: FnOnce() -> Result<Option<FrontmostApp>, String>,
{
    let target = read_frontmost()
        .ok()
        .flatten()
        .and_then(|app| valid_external_target(app, self_bundle_id));
    store.replace(target);
}

fn target_app_store() -> &'static TargetAppStore {
    LAST_TARGET_APP.get_or_init(TargetAppStore::default)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::autofill_ax_context::{
        FillContextPresentation, PresentedAction, PresentedActionMode, PresentedField,
        PresentedFieldConfidence, PresentedFieldKind,
    };
    use crate::autofill_contract::AutoFillSecretField;

    fn fill_context(token: &str) -> FillContextPresentation {
        FillContextPresentation {
            fill_context_token: token.to_owned(),
            focused_field: PresentedField {
                kind: PresentedFieldKind::Password,
                confidence: PresentedFieldConfidence::High,
            },
            action: PresentedAction {
                mode: PresentedActionMode::Field,
                fields: vec![crate::autofill_contract::AutoFillSecretField::Password],
            },
        }
    }

    fn app(bundle_id: &str, process_id: i32) -> FrontmostApp {
        test_frontmost_app(bundle_id, process_id, process_id as u64)
    }

    fn app_instance(bundle_id: &str, process_id: i32, instance_token: u64) -> FrontmostApp {
        test_frontmost_app(bundle_id, process_id, instance_token)
    }

    #[test]
    fn capture_replaces_a_stale_target_with_the_current_external_app() {
        let store = TargetAppStore::default();
        store.replace(Some(app("com.example.stale", 10)));

        capture_current_target_with(
            &store,
            || Ok(Some(app("com.example.current", 20))),
            APP_BUNDLE_ID,
        );

        assert_eq!(store.current(), Some(app("com.example.current", 20)));
    }

    #[test]
    fn capture_clears_a_stale_target_when_frontmost_is_missing_error_or_self() {
        let store = TargetAppStore::default();

        for capture in [
            Ok(None),
            Err("private frontmost failure".to_owned()),
            Ok(Some(app(APP_BUNDLE_ID, 20))),
        ] {
            store.replace(Some(app("com.example.stale", 10)));
            capture_current_target_with(&store, || capture, APP_BUNDLE_ID);
            assert_eq!(store.current(), None);
        }
    }

    #[test]
    fn skips_remembering_self_as_target() {
        assert_eq!(
            valid_external_target(app(APP_BUNDLE_ID, 20), APP_BUNDLE_ID),
            None,
        );
    }

    #[test]
    fn instance_identity_rejects_a_reused_pid_for_the_same_bundle() {
        let captured = app_instance("com.example.target", 42, 100);

        assert_eq!(captured, captured.clone());
        assert_ne!(captured, app_instance("com.example.target", 42, 200));
    }

    #[test]
    fn fill_context_is_preserved_only_for_the_exact_captured_app_instance() {
        let store = TargetAppStore::default();
        let captured = app_instance("com.example.target", 42, 100);
        let context = fill_context("0d5d0471-bb6d-47bf-b4b6-b69640c729df");
        store.replace_with_context(captured.clone(), context.clone());

        store.replace_preserving_context(captured);
        assert_eq!(store.current_fill_context(), Some(context));

        store.replace_preserving_context(app_instance("com.example.target", 42, 200));
        assert_eq!(store.current_fill_context(), None);
    }

    #[test]
    fn target_and_context_are_snapshotted_atomically_during_replacement() {
        use std::sync::{mpsc, Arc};

        let store = Arc::new(TargetAppStore::default());
        let app_a = app_instance("com.example.a", 41, 100);
        let context_a = fill_context("0d5d0471-bb6d-47bf-b4b6-b69640c729df");
        store.replace_with_context(app_a.clone(), context_a.clone());

        let (start_writer, writer_start) = mpsc::channel();
        let (writer_attempted, observe_attempt) = mpsc::channel();
        let writer_store = Arc::clone(&store);
        let writer = std::thread::spawn(move || {
            writer_start.recv().unwrap();
            writer_attempted.send(()).unwrap();
            writer_store.replace_with_context(
                app_instance("com.example.b", 42, 200),
                fill_context("4ed01299-ee2f-4878-b62c-4c0a22d05cf2"),
            );
        });

        let snapshot = store.snapshot_with_hook(|| {
            start_writer.send(()).unwrap();
            observe_attempt.recv().unwrap();
            std::thread::yield_now();
        });
        writer.join().unwrap();

        assert_eq!(snapshot, Some((app_a, Some(context_a))));
    }

    #[test]
    fn fallback_uses_current_generation_and_forces_choose_for_a_valid_focus() {
        use crate::accessibility_focus::AxFrame;
        use crate::autofill_ax_context::{
            CapturedFieldFingerprint, DetectedFillContextStore, ObserverGeneration,
            OpaqueAxIdentity,
        };
        use crate::autofill_field_context::{DetectedFieldKind, FieldConfidence};
        use std::cell::Cell;

        let generation = ObserverGeneration::new(11);
        let store = DetectedFillContextStore::for_test_with_generation(
            generation,
            Instant::now,
            |_, _, _| Ok(()),
        );
        let observed_generation = Cell::new(0);
        let target = app_instance("com.example.target", 42, 100);
        let presentation = fallback_fill_context_with(&store, &target, |_, generation| {
            observed_generation.set(generation);
            Ok(vec![CapturedFieldFingerprint {
                process_id: 42,
                role: "AXSecureTextField".to_owned(),
                frame: AxFrame {
                    x: 100.0,
                    y: 100.0,
                    width: 180.0,
                    height: 24.0,
                },
                window_frame: AxFrame {
                    x: 20.0,
                    y: 20.0,
                    width: 800.0,
                    height: 600.0,
                },
                container_path: vec![1],
                traversal_path: vec![1, 1],
                window_identity: OpaqueAxIdentity::for_test(1),
                element_identity: OpaqueAxIdentity::for_test(2),
                kind: DetectedFieldKind::Password,
                secret_field: Some(AutoFillSecretField::Password),
                confidence: FieldConfidence::High,
                focused: true,
                observer_generation: generation,
            }])
        })
        .expect("valid editable focus");

        assert_eq!(observed_generation.get(), 11);
        assert_eq!(presentation.action.mode, PresentedActionMode::Choose);
        assert!(presentation.action.fields.is_empty());

        let invalid = fallback_fill_context_with(&store, &target, |_, generation| {
            Ok(vec![CapturedFieldFingerprint {
                process_id: 42,
                role: "AXSecureTextField".to_owned(),
                frame: AxFrame {
                    x: 100.0,
                    y: 100.0,
                    width: 180.0,
                    height: 24.0,
                },
                window_frame: AxFrame {
                    x: 20.0,
                    y: 20.0,
                    width: 800.0,
                    height: 600.0,
                },
                container_path: vec![1],
                traversal_path: vec![1, 1],
                window_identity: OpaqueAxIdentity::for_test(1),
                element_identity: OpaqueAxIdentity::for_test(2),
                kind: DetectedFieldKind::Password,
                secret_field: Some(AutoFillSecretField::Password),
                confidence: FieldConfidence::High,
                focused: false,
                observer_generation: generation,
            }])
        });
        assert_eq!(invalid, None);
    }

    #[test]
    fn translates_only_live_running_applications_with_a_bundle_and_positive_pid() {
        assert_eq!(
            running_application_identity(Some("com.example.target"), 42, false),
            Some(app("com.example.target", 42)),
        );
        assert_eq!(running_application_identity(None, 42, false), None);
        assert_eq!(running_application_identity(Some(""), 42, false), None);
        assert_eq!(
            running_application_identity(Some("com.example.target"), 0, false),
            None
        );
        assert_eq!(
            running_application_identity(Some("com.example.target"), 42, true),
            None
        );
    }

    #[test]
    fn production_adapter_uses_appkit_pid_identity_without_applescript_or_launch() {
        let source = include_str!("frontmost.rs");

        assert!(source.contains(concat!("NS", "Workspace")));
        assert!(source.contains(concat!("frontmost", "Application")));
        assert!(source.contains(concat!("Retained<NSRunning", "Application>")));
        assert!(source.contains(concat!("NSObject", "Protocol::isEqual")));
        assert!(source.contains(concat!("activateWith", "Options")));
        assert!(!source.contains(concat!("osa", "script")));
        assert!(!source.contains(concat!("System", " Events")));
        assert!(!source.contains(concat!("runningApplicationWith", "ProcessIdentifier")));
        assert!(!source.contains(concat!("runningApplicationsWith", "BundleIdentifier")));
    }

    #[test]
    fn autofill_context_keeps_the_exact_live_target_available_for_the_picker_session() {
        let target = test_frontmost_app_named("com.example.target", "Example", 42, 7);
        let captured_at = target.captured_at;
        let context = fill_context("0d5d0471-bb6d-47bf-b4b6-b69640c729df");

        assert_eq!(
            autofill_context_with(
                Some(target.clone()),
                Some(context.clone()),
                captured_at + std::time::Duration::from_secs(3_600),
                |_| true,
            ),
            AutoFillEntryContextOutcome::Available {
                bundle_id: "com.example.target".to_owned(),
                app_name: "Example".to_owned(),
                fill_context: context,
            }
        );
        assert_eq!(
            autofill_context_with(
                Some(target),
                Some(fill_context("token")),
                captured_at,
                |_| false
            ),
            AutoFillEntryContextOutcome::Unavailable,
        );
    }

    #[test]
    fn entry_context_requires_a_valid_focused_field_context_and_flattens_safe_presentation() {
        let target = test_frontmost_app_named("com.example.target", "Example", 42, 7);
        assert_eq!(
            autofill_context_with(Some(target.clone()), None, Instant::now(), |_| true),
            AutoFillEntryContextOutcome::Unavailable,
        );

        let context = fill_context("0d5d0471-bb6d-47bf-b4b6-b69640c729df");
        let encoded = serde_json::to_value(autofill_context_with(
            Some(target),
            Some(context),
            Instant::now(),
            |_| true,
        ))
        .unwrap();
        assert_eq!(
            encoded,
            serde_json::json!({
                "status": "available",
                "bundleId": "com.example.target",
                "appName": "Example",
                "fillContextToken": "0d5d0471-bb6d-47bf-b4b6-b69640c729df",
                "focusedField": { "kind": "password", "confidence": "high" },
                "action": { "mode": "field", "fields": ["password"] }
            })
        );
        let encoded_text = encoded.to_string();
        for forbidden in ["secretField", "processId", "frame", "windowFrame", "label"] {
            assert!(!encoded_text.contains(forbidden));
        }
    }
}

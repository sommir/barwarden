use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

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
    target: Mutex<Option<FrontmostApp>>,
}

impl TargetAppStore {
    pub(crate) fn replace(&self, target: Option<FrontmostApp>) {
        let mut stored = self
            .target
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        *stored = target;
    }

    pub(crate) fn current(&self) -> Option<FrontmostApp> {
        self.target
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone()
    }
}

static LAST_TARGET_APP: OnceLock<TargetAppStore> = OnceLock::new();
const AUTOFILL_CONTEXT_MAX_AGE: Duration = Duration::from_secs(30);

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "status", rename_all = "kebab-case")]
pub enum AutoFillEntryContextOutcome {
    Available {
        #[serde(rename = "bundleId")]
        bundle_id: String,
        #[serde(rename = "appName")]
        app_name: String,
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
    target_app_store().replace(Some(target));
}

#[tauri::command]
pub fn autofill_entry_context() -> AutoFillEntryContextOutcome {
    autofill_context_with(last_target_app(), Instant::now(), target_is_running)
}

fn autofill_context_with<IsRunning>(
    target: Option<FrontmostApp>,
    now: Instant,
    is_running: IsRunning,
) -> AutoFillEntryContextOutcome
where
    IsRunning: FnOnce(&FrontmostApp) -> bool,
{
    let Some(target) = target else {
        return AutoFillEntryContextOutcome::Unavailable;
    };
    let is_fresh = now
        .checked_duration_since(target.captured_at)
        .is_some_and(|age| age <= AUTOFILL_CONTEXT_MAX_AGE);
    if !is_fresh || !is_running(&target) {
        return AutoFillEntryContextOutcome::Unavailable;
    }
    AutoFillEntryContextOutcome::Available {
        bundle_id: target.bundle_id,
        app_name: target.app_name,
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
    fn autofill_context_exposes_only_fresh_live_external_app_metadata() {
        let target = test_frontmost_app_named("com.example.target", "Example", 42, 7);
        let captured_at = target.captured_at;

        assert_eq!(
            autofill_context_with(
                Some(target.clone()),
                captured_at + std::time::Duration::from_secs(29),
                |_| true,
            ),
            AutoFillEntryContextOutcome::Available {
                bundle_id: "com.example.target".to_owned(),
                app_name: "Example".to_owned(),
            }
        );
        assert_eq!(
            autofill_context_with(
                Some(target.clone()),
                captured_at + std::time::Duration::from_secs(31),
                |_| true,
            ),
            AutoFillEntryContextOutcome::Unavailable,
        );
        assert_eq!(
            autofill_context_with(Some(target), captured_at, |_| false),
            AutoFillEntryContextOutcome::Unavailable,
        );
    }
}

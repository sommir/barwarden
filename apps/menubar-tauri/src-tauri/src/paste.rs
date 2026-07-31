use crate::{clipboard, frontmost, window};
#[cfg(target_os = "macos")]
use core_graphics::event::{CGEvent, CGEventFlags};
#[cfg(target_os = "macos")]
use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};
use serde::Serialize;
use std::future::Future;
use std::thread;
use std::time::Duration;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum PasteFailureCode {
    NoTarget,
    TargetNotActive,
    AccessibilityDenied,
    ActivationFailed,
    KeystrokeFailed,
}

#[derive(Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "status", rename_all = "kebab-case")]
pub enum NativePasteOutcome {
    Success {
        #[serde(rename = "valueCopied")]
        value_copied: bool,
    },
    PasteFailed {
        code: PasteFailureCode,
        #[serde(rename = "valueCopied")]
        value_copied: bool,
    },
}

#[tauri::command]
pub async fn paste_text(
    app: tauri::AppHandle,
    generations: tauri::State<'_, clipboard::ClipboardGeneration>,
    value: String,
    clear_after_seconds: Option<u64>,
) -> Result<NativePasteOutcome, String> {
    paste_text_with(
        move |value, clear_after_seconds| {
            clipboard::copy_text_with_app_generation(
                generations.inner().clone(),
                value,
                clear_after_seconds,
            )
        },
        || paste_into_last_target(&app),
        value,
        clear_after_seconds,
    )
    .await
}

async fn paste_text_with<CopyFn, CopyFuture, PasteFn>(
    copy: CopyFn,
    paste: PasteFn,
    value: String,
    clear_after_seconds: Option<u64>,
) -> Result<NativePasteOutcome, String>
where
    CopyFn: FnOnce(String, Option<u64>) -> CopyFuture,
    CopyFuture: Future<Output = Result<(), String>>,
    PasteFn: FnOnce() -> Result<(), PasteFailureCode>,
{
    copy(value, clear_after_seconds).await?;
    Ok(match paste() {
        Ok(()) => NativePasteOutcome::Success { value_copied: true },
        Err(code) => NativePasteOutcome::PasteFailed {
            code,
            value_copied: true,
        },
    })
}

fn paste_into_last_target(app: &tauri::AppHandle) -> Result<(), PasteFailureCode> {
    paste_into_target_with(
        frontmost::last_target_app(),
        frontmost::APP_BUNDLE_ID,
        &NativePasteEnvironment { app },
    )
}

trait PasteEnvironment {
    fn accessibility_trusted(&self) -> bool;
    fn target_is_running(&self, target: &frontmost::FrontmostApp) -> bool;
    fn hide_popup(&self) -> Result<(), String>;
    fn activate(&self, target: &frontmost::FrontmostApp) -> Result<(), String>;
    fn wait_for_activation(&self);
    fn current_frontmost(&self) -> Result<Option<frontmost::FrontmostApp>, String>;
    fn send_command_v(&self, process_id: i32) -> Result<(), String>;
}

struct NativePasteEnvironment<'a> {
    app: &'a tauri::AppHandle,
}

impl PasteEnvironment for NativePasteEnvironment<'_> {
    fn accessibility_trusted(&self) -> bool {
        accessibility_is_trusted()
    }

    fn target_is_running(&self, target: &frontmost::FrontmostApp) -> bool {
        frontmost::target_is_running(target)
    }

    fn hide_popup(&self) -> Result<(), String> {
        window::hide_popup_window(self.app)
    }

    fn activate(&self, target: &frontmost::FrontmostApp) -> Result<(), String> {
        frontmost::activate_target_app(target)
    }

    fn wait_for_activation(&self) {
        thread::sleep(Duration::from_millis(150));
    }

    fn current_frontmost(&self) -> Result<Option<frontmost::FrontmostApp>, String> {
        frontmost::current_frontmost_app()
    }

    fn send_command_v(&self, process_id: i32) -> Result<(), String> {
        send_command_v_to_pid(process_id)
    }
}

fn paste_into_target_with(
    target: Option<frontmost::FrontmostApp>,
    self_bundle_id: &str,
    environment: &impl PasteEnvironment,
) -> Result<(), PasteFailureCode> {
    let Some(target) = target else {
        return Err(PasteFailureCode::NoTarget);
    };
    if target.bundle_id.trim().is_empty()
        || target.bundle_id == self_bundle_id
        || target.process_id <= 0
    {
        return Err(PasteFailureCode::NoTarget);
    }
    if !environment.accessibility_trusted() {
        return Err(PasteFailureCode::AccessibilityDenied);
    }
    if !environment.target_is_running(&target) {
        return Err(PasteFailureCode::ActivationFailed);
    }

    environment
        .hide_popup()
        .map_err(|_| PasteFailureCode::ActivationFailed)?;
    environment
        .activate(&target)
        .map_err(|_| PasteFailureCode::ActivationFailed)?;
    environment.wait_for_activation();

    if !frontmost_matches(environment.current_frontmost(), &target, self_bundle_id) {
        return Err(PasteFailureCode::TargetNotActive);
    }
    if !environment.target_is_running(&target) {
        return Err(PasteFailureCode::TargetNotActive);
    }
    if !frontmost_matches(environment.current_frontmost(), &target, self_bundle_id) {
        return Err(PasteFailureCode::TargetNotActive);
    }

    environment
        .send_command_v(target.process_id)
        .map_err(|_| PasteFailureCode::KeystrokeFailed)
}

fn frontmost_matches(
    current: Result<Option<frontmost::FrontmostApp>, String>,
    target: &frontmost::FrontmostApp,
    self_bundle_id: &str,
) -> bool {
    matches!(
        current,
        Ok(Some(app))
            if app.bundle_id != self_bundle_id
                && &app == target
    )
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct KeyboardEventSpec {
    key_code: u16,
    command: bool,
    key_down: bool,
}

trait CommandVEventPoster {
    type Event;

    fn build(&self, spec: KeyboardEventSpec) -> Result<Self::Event, String>;
    fn post_to_pid(&self, event: &Self::Event, process_id: i32);
}

fn send_command_v_with(poster: &impl CommandVEventPoster, process_id: i32) -> Result<(), String> {
    if process_id <= 0 {
        return Err("invalid target process".to_owned());
    }

    let key_down = poster.build(KeyboardEventSpec {
        key_code: 9,
        command: true,
        key_down: true,
    })?;
    let key_up = poster.build(KeyboardEventSpec {
        key_code: 9,
        command: true,
        key_down: false,
    })?;
    poster.post_to_pid(&key_down, process_id);
    poster.post_to_pid(&key_up, process_id);
    Ok(())
}

#[cfg(target_os = "macos")]
struct CoreGraphicsEventPoster;

#[cfg(target_os = "macos")]
impl CommandVEventPoster for CoreGraphicsEventPoster {
    type Event = CGEvent;

    fn build(&self, spec: KeyboardEventSpec) -> Result<Self::Event, String> {
        let source = CGEventSource::new(CGEventSourceStateID::HIDSystemState)
            .map_err(|_| "CoreGraphics event source unavailable".to_owned())?;
        let event = CGEvent::new_keyboard_event(source, spec.key_code, spec.key_down)
            .map_err(|_| "CoreGraphics keyboard event unavailable".to_owned())?;
        if spec.command {
            event.set_flags(CGEventFlags::CGEventFlagCommand);
        }
        Ok(event)
    }

    fn post_to_pid(&self, event: &Self::Event, process_id: i32) {
        event.post_to_pid(process_id);
    }
}

#[cfg(target_os = "macos")]
fn send_command_v_to_pid(process_id: i32) -> Result<(), String> {
    send_command_v_with(&CoreGraphicsEventPoster, process_id)
}

#[cfg(not(target_os = "macos"))]
fn send_command_v_to_pid(_process_id: i32) -> Result<(), String> {
    Err("keyboard events are unsupported".to_owned())
}

#[cfg(target_os = "macos")]
fn accessibility_is_trusted() -> bool {
    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXIsProcessTrusted() -> bool;
    }

    // AXIsProcessTrusted is a read-only system trust check and does not prompt or mutate TCC.
    unsafe { AXIsProcessTrusted() }
}

#[cfg(not(target_os = "macos"))]
fn accessibility_is_trusted() -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::clipboard::ClipboardAccess;
    use std::collections::VecDeque;
    use std::sync::{Arc, Mutex};

    struct RecordingPasteEnvironment {
        events: Mutex<Vec<String>>,
        hide_result: Mutex<Result<(), String>>,
        activate_result: Mutex<Result<(), String>>,
        running: Mutex<VecDeque<bool>>,
        current: Mutex<VecDeque<Result<Option<frontmost::FrontmostApp>, String>>>,
        trusted: Mutex<bool>,
        keystroke_result: Mutex<Result<(), String>>,
    }

    impl Default for RecordingPasteEnvironment {
        fn default() -> Self {
            Self {
                events: Mutex::new(Vec::new()),
                hide_result: Mutex::new(Ok(())),
                activate_result: Mutex::new(Ok(())),
                running: Mutex::new(VecDeque::from([false])),
                current: Mutex::new(VecDeque::from([Ok(None)])),
                trusted: Mutex::new(false),
                keystroke_result: Mutex::new(Ok(())),
            }
        }
    }

    impl RecordingPasteEnvironment {
        fn external_target() -> frontmost::FrontmostApp {
            Self::app_instance("com.example.target", 42, 100)
        }

        fn app(bundle_id: &str, process_id: i32) -> frontmost::FrontmostApp {
            Self::app_instance(bundle_id, process_id, process_id as u64)
        }

        fn app_instance(
            bundle_id: &str,
            process_id: i32,
            instance_token: u64,
        ) -> frontmost::FrontmostApp {
            frontmost::test_frontmost_app(bundle_id, process_id, instance_token)
        }

        fn ready() -> Self {
            Self {
                running: Mutex::new(VecDeque::from([true, true])),
                current: Mutex::new(VecDeque::from([
                    Ok(Some(Self::external_target())),
                    Ok(Some(Self::external_target())),
                ])),
                trusted: Mutex::new(true),
                ..Self::default()
            }
        }

        fn events(&self) -> Vec<String> {
            self.events.lock().expect("events lock").clone()
        }
    }

    impl PasteEnvironment for RecordingPasteEnvironment {
        fn accessibility_trusted(&self) -> bool {
            self.events
                .lock()
                .expect("events lock")
                .push("trusted".to_owned());
            *self.trusted.lock().expect("trusted lock")
        }

        fn target_is_running(&self, target: &frontmost::FrontmostApp) -> bool {
            self.events
                .lock()
                .expect("events lock")
                .push(format!("running:{}", target.process_id));
            self.running
                .lock()
                .expect("running lock")
                .pop_front()
                .unwrap_or(false)
        }

        fn hide_popup(&self) -> Result<(), String> {
            self.events
                .lock()
                .expect("events lock")
                .push("hide".to_owned());
            self.hide_result.lock().expect("hide lock").clone()
        }

        fn activate(&self, target: &frontmost::FrontmostApp) -> Result<(), String> {
            self.events
                .lock()
                .expect("events lock")
                .push(format!("activate:{}", target.process_id));
            self.activate_result.lock().expect("activate lock").clone()
        }

        fn wait_for_activation(&self) {
            self.events
                .lock()
                .expect("events lock")
                .push("wait".to_owned());
        }

        fn current_frontmost(&self) -> Result<Option<frontmost::FrontmostApp>, String> {
            self.events
                .lock()
                .expect("events lock")
                .push("frontmost".to_owned());
            self.current
                .lock()
                .expect("current lock")
                .pop_front()
                .unwrap_or(Ok(None))
        }

        fn send_command_v(&self, process_id: i32) -> Result<(), String> {
            self.events
                .lock()
                .expect("events lock")
                .push(format!("event:{process_id}"));
            self.keystroke_result
                .lock()
                .expect("keystroke lock")
                .clone()
        }
    }

    #[derive(Clone, Default)]
    struct MemoryClipboard {
        value: Arc<Mutex<String>>,
    }

    impl MemoryClipboard {
        fn current_value(&self) -> String {
            self.value.lock().expect("clipboard lock").clone()
        }
    }

    impl ClipboardAccess for MemoryClipboard {
        fn set_text(&self, value: &str) -> Result<(), String> {
            *self.value.lock().expect("clipboard lock") = value.to_owned();
            Ok(())
        }

        fn get_text(&self) -> Result<String, String> {
            Ok(self.current_value())
        }
    }

    #[tokio::test]
    async fn paste_reuses_clipboard_validation() {
        let clipboard = MemoryClipboard::default();
        let result = paste_text_with(
            |value, clear_after_seconds| {
                clipboard::copy_text_with(clipboard, value, clear_after_seconds)
            },
            || Ok(()),
            String::new(),
            None,
        )
        .await;

        assert_eq!(result, Err("clipboard value cannot be empty".to_owned()));
    }

    #[tokio::test]
    async fn paste_accepts_single_field_value() {
        let clipboard = MemoryClipboard::default();

        let outcome = paste_text_with(
            |value, clear_after_seconds| {
                clipboard::copy_text_with(clipboard.clone(), value, clear_after_seconds)
            },
            || Ok(()),
            "username@example.com".to_owned(),
            None,
        )
        .await
        .expect("paste should succeed");

        assert_eq!(
            serde_json::to_value(outcome).expect("serialize outcome"),
            serde_json::json!({ "status": "success", "valueCopied": true }),
        );
        assert_eq!(clipboard.current_value(), "username@example.com");
    }

    #[tokio::test]
    async fn paste_resolves_a_structured_failure_after_copying_value() {
        let clipboard = MemoryClipboard::default();
        let outcome = paste_text_with(
            |value, clear_after_seconds| {
                clipboard::copy_text_with(clipboard.clone(), value, clear_after_seconds)
            },
            || Err(PasteFailureCode::AccessibilityDenied),
            "username@example.com".to_owned(),
            None,
        )
        .await
        .expect("paste-stage failure must resolve after copy");

        assert_eq!(
            serde_json::to_value(outcome).expect("serialize outcome"),
            serde_json::json!({
                "status": "paste-failed",
                "code": "accessibility-denied",
                "valueCopied": true,
            }),
        );
        assert_eq!(clipboard.current_value(), "username@example.com");
    }

    #[test]
    fn missing_invalid_and_self_targets_do_not_run_preconditions_or_send_events() {
        for target in [
            None,
            Some(RecordingPasteEnvironment::app("", 42)),
            Some(RecordingPasteEnvironment::app("com.example.target", 0)),
            Some(RecordingPasteEnvironment::app(frontmost::APP_BUNDLE_ID, 42)),
        ] {
            let environment = RecordingPasteEnvironment::ready();

            assert_eq!(
                paste_into_target_with(target, frontmost::APP_BUNDLE_ID, &environment),
                Err(PasteFailureCode::NoTarget),
            );
            assert_eq!(environment.events(), Vec::<String>::new());
        }
    }

    #[test]
    fn accessibility_denial_keeps_the_popup_visible_and_sends_no_event() {
        let environment = RecordingPasteEnvironment::ready();
        *environment.trusted.lock().expect("trusted lock") = false;

        assert_eq!(
            paste_into_target_with(
                Some(RecordingPasteEnvironment::external_target()),
                frontmost::APP_BUNDLE_ID,
                &environment,
            ),
            Err(PasteFailureCode::AccessibilityDenied),
        );
        assert_eq!(environment.events(), vec!["trusted"]);
    }

    #[test]
    fn exited_target_is_rejected_before_hide_without_relaunch() {
        let environment = RecordingPasteEnvironment::ready();
        *environment.running.lock().expect("running lock") = VecDeque::from([false]);

        assert_eq!(
            paste_into_target_with(
                Some(RecordingPasteEnvironment::external_target()),
                frontmost::APP_BUNDLE_ID,
                &environment,
            ),
            Err(PasteFailureCode::ActivationFailed),
        );
        assert_eq!(environment.events(), vec!["trusted", "running:42"]);
    }

    #[test]
    fn hide_and_activation_failures_never_send_an_event() {
        let hidden = RecordingPasteEnvironment::ready();
        *hidden.hide_result.lock().expect("hide lock") = Err("private hide error".to_owned());
        assert_eq!(
            paste_into_target_with(
                Some(RecordingPasteEnvironment::external_target()),
                frontmost::APP_BUNDLE_ID,
                &hidden,
            ),
            Err(PasteFailureCode::ActivationFailed),
        );
        assert_eq!(hidden.events(), vec!["trusted", "running:42", "hide"]);

        let activation = RecordingPasteEnvironment::ready();
        *activation.activate_result.lock().expect("activate lock") =
            Err("private activation error".to_owned());
        assert_eq!(
            paste_into_target_with(
                Some(RecordingPasteEnvironment::external_target()),
                frontmost::APP_BUNDLE_ID,
                &activation,
            ),
            Err(PasteFailureCode::ActivationFailed),
        );
        assert_eq!(
            activation.events(),
            vec!["trusted", "running:42", "hide", "activate:42"],
        );
    }

    #[test]
    fn post_activation_revalidation_rejects_missing_replacement_and_same_bundle_other_pid() {
        for current in [
            Ok(None),
            Err("private current-app error".to_owned()),
            Ok(Some(RecordingPasteEnvironment::app(
                "com.example.stale",
                42,
            ))),
            Ok(Some(RecordingPasteEnvironment::app(
                "com.example.target",
                99,
            ))),
            Ok(Some(RecordingPasteEnvironment::app(
                frontmost::APP_BUNDLE_ID,
                42,
            ))),
        ] {
            let environment = RecordingPasteEnvironment::ready();
            *environment.current.lock().expect("current lock") = VecDeque::from([current]);

            assert_eq!(
                paste_into_target_with(
                    Some(RecordingPasteEnvironment::external_target()),
                    frontmost::APP_BUNDLE_ID,
                    &environment,
                ),
                Err(PasteFailureCode::TargetNotActive),
            );
            assert_eq!(
                environment.events(),
                vec![
                    "trusted",
                    "running:42",
                    "hide",
                    "activate:42",
                    "wait",
                    "frontmost",
                ],
            );
        }
    }

    #[test]
    fn reused_pid_with_the_same_bundle_but_a_different_instance_never_receives_an_event() {
        let environment = RecordingPasteEnvironment::ready();
        let replacement = RecordingPasteEnvironment::app_instance("com.example.target", 42, 200);
        *environment.current.lock().expect("current lock") =
            VecDeque::from([Ok(Some(replacement.clone())), Ok(Some(replacement))]);

        let result = paste_into_target_with(
            Some(RecordingPasteEnvironment::external_target()),
            frontmost::APP_BUNDLE_ID,
            &environment,
        );
        let event_count = environment
            .events()
            .iter()
            .filter(|event| event.as_str() == "event:42")
            .count();

        assert_eq!(
            (result, event_count),
            (Err(PasteFailureCode::TargetNotActive), 0)
        );
    }

    #[test]
    fn target_termination_after_activation_prevents_the_pid_event() {
        let environment = RecordingPasteEnvironment::ready();
        *environment.running.lock().expect("running lock") = VecDeque::from([true, false]);
        *environment.current.lock().expect("current lock") =
            VecDeque::from([Ok(Some(RecordingPasteEnvironment::external_target()))]);

        assert_eq!(
            paste_into_target_with(
                Some(RecordingPasteEnvironment::external_target()),
                frontmost::APP_BUNDLE_ID,
                &environment,
            ),
            Err(PasteFailureCode::TargetNotActive),
        );
        assert!(!environment
            .events()
            .iter()
            .any(|event| event.starts_with("event:")));
    }

    #[test]
    fn final_focus_steal_prevents_the_pid_event() {
        let environment = RecordingPasteEnvironment::ready();
        *environment.current.lock().expect("current lock") = VecDeque::from([
            Ok(Some(RecordingPasteEnvironment::external_target())),
            Ok(Some(RecordingPasteEnvironment::app(
                "com.example.thief",
                77,
            ))),
        ]);

        assert_eq!(
            paste_into_target_with(
                Some(RecordingPasteEnvironment::external_target()),
                frontmost::APP_BUNDLE_ID,
                &environment,
            ),
            Err(PasteFailureCode::TargetNotActive),
        );
        assert!(!environment
            .events()
            .iter()
            .any(|event| event.starts_with("event:")));
    }

    #[test]
    fn event_failures_are_sanitized_and_same_instance_success_targets_one_pid_once() {
        let failed = RecordingPasteEnvironment::ready();
        *failed.keystroke_result.lock().expect("keystroke lock") =
            Err("private CoreGraphics failure".to_owned());
        assert_eq!(
            paste_into_target_with(
                Some(RecordingPasteEnvironment::external_target()),
                frontmost::APP_BUNDLE_ID,
                &failed,
            ),
            Err(PasteFailureCode::KeystrokeFailed),
        );
        assert_eq!(
            failed
                .events()
                .iter()
                .filter(|event| *event == "event:42")
                .count(),
            1
        );

        let succeeded = RecordingPasteEnvironment::ready();
        assert_eq!(
            paste_into_target_with(
                Some(RecordingPasteEnvironment::external_target()),
                frontmost::APP_BUNDLE_ID,
                &succeeded,
            ),
            Ok(()),
        );
        assert_eq!(
            succeeded
                .events()
                .iter()
                .filter(|event| *event == "event:42")
                .count(),
            1,
        );
    }

    #[test]
    fn production_event_adapter_uses_pid_directed_core_graphics_without_automation() {
        let source = include_str!("paste.rs");

        assert!(source.contains(concat!("new_keyboard", "_event")));
        assert!(source.contains(concat!("set_", "flags")));
        assert!(source.contains(concat!("CGEventFlag", "Command")));
        assert!(source.contains(concat!("post_to", "_pid")));
        assert!(!source.contains(concat!("osa", "script")));
        assert!(!source.contains(concat!("System", " Events")));
        assert!(!source.contains(concat!("CGEventTap", "Location")));
    }

    #[derive(Default)]
    struct RecordingCoreGraphicsPoster {
        builds: Mutex<Vec<KeyboardEventSpec>>,
        posts: Mutex<Vec<(i32, KeyboardEventSpec)>>,
    }

    impl CommandVEventPoster for RecordingCoreGraphicsPoster {
        type Event = KeyboardEventSpec;

        fn build(&self, spec: KeyboardEventSpec) -> Result<Self::Event, String> {
            self.builds.lock().expect("builds lock").push(spec);
            Ok(spec)
        }

        fn post_to_pid(&self, event: &Self::Event, process_id: i32) {
            self.posts
                .lock()
                .expect("posts lock")
                .push((process_id, *event));
        }
    }

    #[test]
    fn command_v_event_adapter_posts_exact_down_then_up_to_the_captured_pid() {
        let poster = RecordingCoreGraphicsPoster::default();

        send_command_v_with(&poster, 42).expect("send Command+V");

        let expected = vec![
            KeyboardEventSpec {
                key_code: 9,
                command: true,
                key_down: true,
            },
            KeyboardEventSpec {
                key_code: 9,
                command: true,
                key_down: false,
            },
        ];
        assert_eq!(*poster.builds.lock().expect("builds lock"), expected);
        assert_eq!(
            *poster.posts.lock().expect("posts lock"),
            vec![(42, expected[0]), (42, expected[1])],
        );
    }
}

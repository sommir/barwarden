use crate::accessibility_focus::AxFrame;
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use tauri::Manager;

const PANEL_SIZE: f64 = 28.0;
const PANEL_GAP: f64 = 6.0;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ObserverScope {
    Application,
    FocusedElement,
    Window,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ObserverNotification {
    FocusedElementChanged,
    Moved,
    Resized,
    Destroyed,
}

const fn observer_notification_plan() -> [(ObserverScope, ObserverNotification); 7] {
    [
        (
            ObserverScope::Application,
            ObserverNotification::FocusedElementChanged,
        ),
        (ObserverScope::FocusedElement, ObserverNotification::Moved),
        (ObserverScope::FocusedElement, ObserverNotification::Resized),
        (
            ObserverScope::FocusedElement,
            ObserverNotification::Destroyed,
        ),
        (ObserverScope::Window, ObserverNotification::Moved),
        (ObserverScope::Window, ObserverNotification::Resized),
        (ObserverScope::Window, ObserverNotification::Destroyed),
    ]
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum WorkspaceNotification {
    Activated,
    Terminated,
}

const fn workspace_notification_plan() -> [WorkspaceNotification; 2] {
    [
        WorkspaceNotification::Activated,
        WorkspaceNotification::Terminated,
    ]
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct AppKitFrame {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl AppKitFrame {
    pub fn contains(self, child: Self) -> bool {
        child.x >= self.x
            && child.y >= self.y
            && child.x + child.width <= self.x + self.width
            && child.y + child.height <= self.y + self.height
    }
}

#[cfg(test)]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct PanelContract {
    pub borderless: bool,
    pub nonactivating: bool,
    pub can_become_key: bool,
    pub can_become_main: bool,
    pub fixed_entry_event: &'static str,
}

#[cfg(test)]
pub const PANEL_CONTRACT: PanelContract = PanelContract {
    borderless: true,
    nonactivating: true,
    can_become_key: false,
    can_become_main: false,
    fixed_entry_event: "autofill-floating",
};

pub fn ax_to_appkit(frame: AxFrame, primary_max_y: f64) -> AppKitFrame {
    AppKitFrame {
        x: frame.x,
        y: primary_max_y - frame.y - frame.height,
        width: frame.width,
        height: frame.height,
    }
}

pub fn place_panel(field: AppKitFrame, work_area: AppKitFrame) -> Option<AppKitFrame> {
    if ![
        field.x,
        field.y,
        field.width,
        field.height,
        work_area.x,
        work_area.y,
        work_area.width,
        work_area.height,
    ]
    .into_iter()
    .all(f64::is_finite)
        || field.width <= 0.0
        || field.height <= 0.0
        || work_area.width < PANEL_SIZE
        || work_area.height < PANEL_SIZE
    {
        return None;
    }
    let y = (field.y + (field.height - PANEL_SIZE) / 2.0)
        .clamp(work_area.y, work_area.y + work_area.height - PANEL_SIZE);
    let trailing = AppKitFrame {
        x: field.x + field.width + PANEL_GAP,
        y,
        width: PANEL_SIZE,
        height: PANEL_SIZE,
    };
    if work_area.contains(trailing) {
        return Some(trailing);
    }
    let leading = AppKitFrame {
        x: field.x - PANEL_GAP - PANEL_SIZE,
        y,
        width: PANEL_SIZE,
        height: PANEL_SIZE,
    };
    work_area.contains(leading).then_some(leading)
}

#[derive(Default)]
pub struct FloatingLifecycle {
    generation: u64,
    visible_frame: Option<AppKitFrame>,
}

impl FloatingLifecycle {
    pub fn begin_observation(&mut self) -> u64 {
        self.generation = self.generation.saturating_add(1);
        self.visible_frame = None;
        self.generation
    }

    pub fn invalidate(&mut self) -> u64 {
        self.begin_observation()
    }

    pub fn accept(&mut self, generation: u64, frame: AppKitFrame) {
        if generation == self.generation {
            self.visible_frame = Some(frame);
        }
    }

    #[cfg(test)]
    pub fn visible_frame(&self) -> Option<AppKitFrame> {
        self.visible_frame
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ThrottleDecision {
    RunNow,
    RunAt(u64),
    Discard,
}

pub struct ObservationThrottle {
    interval_ms: u64,
    generation: Option<u64>,
    last_run_ms: Option<u64>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum AccessibilityFallback {
    SystemAutoFill,
    Unsupported,
}

impl AccessibilityFallback {
    fn focus_eligibility(self) -> crate::accessibility_focus::FallbackEligibility {
        match self {
            Self::SystemAutoFill => {
                crate::accessibility_focus::FallbackEligibility::SystemAvailableOrUnknown
            }
            Self::Unsupported => crate::accessibility_focus::FallbackEligibility::SystemUnsupported,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum AccessibilityPermission {
    Granted,
    Denied,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum AccessibilityObservation {
    Stopped,
    Hidden,
    Visible,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AccessibilityDiagnostic {
    reason: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    bundle_id: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AccessibilityStatus {
    permission: AccessibilityPermission,
    observation: AccessibilityObservation,
    #[serde(skip_serializing_if = "Option::is_none")]
    diagnostic: Option<AccessibilityDiagnostic>,
}

struct ControllerState {
    fallback: AccessibilityFallback,
    permission: AccessibilityPermission,
    observation: AccessibilityObservation,
    diagnostic: Option<AccessibilityDiagnostic>,
    active_bundle_id: Option<String>,
    lifecycle: FloatingLifecycle,
}

impl Default for ControllerState {
    fn default() -> Self {
        Self {
            fallback: AccessibilityFallback::SystemAutoFill,
            permission: AccessibilityPermission::Denied,
            observation: AccessibilityObservation::Stopped,
            diagnostic: None,
            active_bundle_id: None,
            lifecycle: FloatingLifecycle::default(),
        }
    }
}

#[derive(Clone, Default)]
pub struct AutoFillFloatingController {
    state: Arc<Mutex<ControllerState>>,
}

impl AutoFillFloatingController {
    pub fn status(&self) -> AccessibilityStatus {
        let state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        AccessibilityStatus {
            permission: state.permission,
            observation: state.observation,
            diagnostic: state.diagnostic.clone(),
        }
    }

    pub fn set_fallback(&self, fallback: AccessibilityFallback) {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        state.fallback = fallback;
        state.lifecycle.invalidate();
        state.active_bundle_id = None;
        state.diagnostic = None;
        state.observation = match fallback {
            AccessibilityFallback::SystemAutoFill => AccessibilityObservation::Stopped,
            AccessibilityFallback::Unsupported => AccessibilityObservation::Hidden,
        };
    }

    fn fallback(&self) -> AccessibilityFallback {
        self.state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .fallback
    }

    fn generation(&self) -> u64 {
        self.state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .lifecycle
            .generation
    }

    fn begin_refresh(&self) -> u64 {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let generation = state.lifecycle.begin_observation();
        state.active_bundle_id = None;
        state.observation = AccessibilityObservation::Hidden;
        state.diagnostic = None;
        generation
    }

    fn publish_visible(&self, generation: u64, bundle_id: String, frame: AppKitFrame) -> bool {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if state.fallback != AccessibilityFallback::Unsupported
            || state.lifecycle.generation != generation
        {
            return false;
        }
        state.lifecycle.accept(generation, frame);
        state.permission = AccessibilityPermission::Granted;
        state.observation = AccessibilityObservation::Visible;
        state.active_bundle_id = Some(bundle_id);
        state.diagnostic = None;
        true
    }

    fn publish_hidden(
        &self,
        generation: u64,
        permission: AccessibilityPermission,
        reason: &'static str,
        bundle_id: Option<String>,
    ) {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if state.lifecycle.generation != generation {
            return;
        }
        state.permission = permission;
        state.observation = AccessibilityObservation::Hidden;
        state.active_bundle_id = None;
        state.diagnostic = Some(AccessibilityDiagnostic { reason, bundle_id });
    }

    fn picker_opened(&self) {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        state.lifecycle.invalidate();
        state.active_bundle_id = None;
        state.observation = AccessibilityObservation::Hidden;
        state.diagnostic = None;
    }

    pub fn permission_lost(&self) {
        self.hide_with_reason(AccessibilityPermission::Denied, "permission-denied");
    }

    fn permission_observed(&self, trusted: bool) {
        if !trusted {
            self.permission_lost();
            return;
        }
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        state.permission = AccessibilityPermission::Granted;
        if state
            .diagnostic
            .as_ref()
            .is_some_and(|diagnostic| diagnostic.reason == "permission-denied")
        {
            state.diagnostic = None;
        }
    }

    pub fn application_changed(&self) {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        state.lifecycle.invalidate();
        state.active_bundle_id = None;
        state.observation = AccessibilityObservation::Hidden;
        state.diagnostic = Some(AccessibilityDiagnostic {
            reason: "application-changed",
            bundle_id: None,
        });
    }

    pub fn hide_with_reason(&self, permission: AccessibilityPermission, reason: &'static str) {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let bundle_id = state.active_bundle_id.take();
        state.lifecycle.invalidate();
        state.permission = permission;
        state.observation = AccessibilityObservation::Hidden;
        state.diagnostic = Some(AccessibilityDiagnostic { reason, bundle_id });
    }

    #[cfg(test)]
    fn show_for_test(&self, bundle_id: &str) {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let generation = state.lifecycle.begin_observation();
        state.lifecycle.accept(
            generation,
            AppKitFrame {
                x: 0.0,
                y: 0.0,
                width: PANEL_SIZE,
                height: PANEL_SIZE,
            },
        );
        state.permission = AccessibilityPermission::Granted;
        state.observation = AccessibilityObservation::Visible;
        state.active_bundle_id = Some(bundle_id.to_owned());
        state.diagnostic = None;
    }
}

trait AccessibilityPermissionPort {
    fn trusted(&self) -> bool;
    fn prompt(&self) -> bool;
}

fn accessibility_status_with(port: &impl AccessibilityPermissionPort) -> bool {
    port.trusted()
}

fn request_accessibility_permission_with(port: &impl AccessibilityPermissionPort) -> bool {
    port.prompt()
}

#[tauri::command]
pub fn autofill_accessibility_status(
    window: tauri::WebviewWindow,
    controller: tauri::State<'_, AutoFillFloatingController>,
) -> Result<AccessibilityStatus, String> {
    require_main_window(&window)?;
    let trusted = accessibility_status_with(&SystemAccessibilityPermission);
    controller.permission_observed(trusted);
    if !trusted {
        schedule_panel_hide(window.app_handle());
    }
    Ok(controller.status())
}

#[tauri::command]
pub fn autofill_set_accessibility_fallback(
    window: tauri::WebviewWindow,
    controller: tauri::State<'_, AutoFillFloatingController>,
    fallback: AccessibilityFallback,
) -> Result<(), String> {
    require_main_window(&window)?;
    controller.set_fallback(fallback);
    if fallback == AccessibilityFallback::SystemAutoFill {
        schedule_panel_hide(window.app_handle());
    }
    Ok(())
}

#[tauri::command]
pub fn autofill_request_accessibility_permission(
    window: tauri::WebviewWindow,
    controller: tauri::State<'_, AutoFillFloatingController>,
) -> Result<AccessibilityStatus, String> {
    require_main_window(&window)?;
    let trusted = request_accessibility_permission_with(&SystemAccessibilityPermission);
    controller.permission_observed(trusted);
    if !trusted {
        schedule_panel_hide(window.app_handle());
    }
    Ok(controller.status())
}

fn require_main_window(window: &tauri::WebviewWindow) -> Result<(), String> {
    (window.label() == "main")
        .then_some(())
        .ok_or_else(|| "autofill-accessibility-unavailable".to_owned())
}

struct SystemAccessibilityPermission;

impl AccessibilityPermissionPort for SystemAccessibilityPermission {
    fn trusted(&self) -> bool {
        native_accessibility_trusted(false)
    }

    fn prompt(&self) -> bool {
        native_accessibility_trusted(true)
    }
}

#[cfg(not(target_os = "macos"))]
fn native_accessibility_trusted(_prompt: bool) -> bool {
    false
}

#[cfg(not(target_os = "macos"))]
pub fn start_native_observer(_app: tauri::AppHandle, _controller: AutoFillFloatingController) {}

#[cfg(not(target_os = "macos"))]
fn schedule_panel_hide(_app: &tauri::AppHandle) {}

#[cfg(target_os = "macos")]
mod macos {
    use super::*;
    use crate::accessibility_focus::{
        classify_focused_field, AppIdentity, FallbackEligibility, FocusRejectReason,
        FocusedFieldObservation, ScreenFrame,
    };
    use crate::{frontmost, window};
    use block2::RcBlock;
    use core_foundation::base::{CFRelease, TCFType};
    use core_foundation::boolean::CFBoolean;
    use core_foundation::dictionary::CFDictionary;
    use core_foundation::runloop::{
        kCFRunLoopDefaultMode, CFRunLoop, CFRunLoopAddSource, CFRunLoopRef, CFRunLoopRemoveSource,
        CFRunLoopSourceRef,
    };
    use core_foundation::string::{CFString, CFStringRef};
    use core_graphics::display::CGDisplay;
    use core_graphics::geometry::{CGPoint, CGSize};
    use objc2::rc::Retained;
    use objc2::runtime::{AnyObject, NSObjectProtocol};
    use objc2::{define_class, msg_send, sel, AnyThread, DefinedClass, MainThreadOnly};
    use objc2_app_kit::{
        NSBackingStoreType, NSButton, NSColor, NSImage, NSImageScaling, NSPanel, NSScreen,
        NSStatusWindowLevel, NSWindowCollectionBehavior, NSWindowStyleMask, NSWorkspace,
        NSWorkspaceDidActivateApplicationNotification,
        NSWorkspaceDidTerminateApplicationNotification,
    };
    use objc2_foundation::{
        MainThreadMarker, NSData, NSNotification, NSObject, NSPoint, NSRect, NSSize, NSString,
    };
    use std::cell::OnceCell;
    use std::ffi::c_void;
    use std::ptr;
    use std::ptr::NonNull;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, OnceLock};
    use std::thread;
    use std::time::{Duration, Instant};
    use tauri::Manager;

    type AXUIElementRef = *const c_void;
    type AXValueRef = *const c_void;
    type AXObserverRef = *const c_void;
    type CFTypeRef = *const c_void;
    type CFDictionaryRef = *const c_void;
    type AXError = i32;
    const AX_ERROR_SUCCESS: AXError = 0;
    const AX_VALUE_CGPOINT: i32 = 1;
    const AX_VALUE_CGSIZE: i32 = 2;
    const PANEL_ICON: &[u8] = include_bytes!("../icons/tray-template@2x.png");

    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXIsProcessTrusted() -> bool;
        fn AXIsProcessTrustedWithOptions(options: CFDictionaryRef) -> bool;
        fn AXUIElementCreateApplication(pid: i32) -> AXUIElementRef;
        fn AXUIElementCopyAttributeValue(
            element: AXUIElementRef,
            attribute: CFStringRef,
            value: *mut CFTypeRef,
        ) -> AXError;
        fn AXUIElementIsAttributeSettable(
            element: AXUIElementRef,
            attribute: CFStringRef,
            settable: *mut bool,
        ) -> AXError;
        fn AXValueGetValue(value: AXValueRef, value_type: i32, output: *mut c_void) -> bool;
        fn AXObserverCreate(
            pid: i32,
            callback: unsafe extern "C" fn(AXObserverRef, AXUIElementRef, CFStringRef, *mut c_void),
            observer: *mut AXObserverRef,
        ) -> AXError;
        fn AXObserverAddNotification(
            observer: AXObserverRef,
            element: AXUIElementRef,
            notification: CFStringRef,
            refcon: *mut c_void,
        ) -> AXError;
        fn AXObserverRemoveNotification(
            observer: AXObserverRef,
            element: AXUIElementRef,
            notification: CFStringRef,
        ) -> AXError;
        fn AXObserverGetRunLoopSource(observer: AXObserverRef) -> CFRunLoopSourceRef;

    }

    #[derive(Default)]
    struct FloatingTargetIvars {
        app: OnceCell<tauri::AppHandle>,
    }

    define_class!(
        #[unsafe(super = NSObject)]
        #[thread_kind = MainThreadOnly]
        #[ivars = FloatingTargetIvars]
        struct FloatingTarget;

        unsafe impl NSObjectProtocol for FloatingTarget {}

        impl FloatingTarget {
            #[unsafe(method(openAutoFill:))]
            fn open_autofill(&self, _sender: Option<&AnyObject>) {
                let Some(app) = self.ivars().app.get() else { return; };
                if let Some(controller) = app.try_state::<AutoFillFloatingController>() {
                    controller.picker_opened();
                }
                hide_panel();
                let _ = window::show_autofill_picker_window(
                    app,
                    window::PopupEntrySource::AutoFillFloating,
                );
            }
        }
    );

    define_class!(
        #[unsafe(super = NSPanel)]
        #[thread_kind = MainThreadOnly]
        struct FloatingPanel;

        unsafe impl NSObjectProtocol for FloatingPanel {}

        impl FloatingPanel {
            #[unsafe(method(canBecomeKeyWindow))]
            fn can_become_key_window(&self) -> bool {
                false
            }

            #[unsafe(method(canBecomeMainWindow))]
            fn can_become_main_window(&self) -> bool {
                false
            }
        }
    );

    impl FloatingTarget {
        fn new(app: tauri::AppHandle, mtm: MainThreadMarker) -> Retained<Self> {
            let this = Self::alloc(mtm).set_ivars(FloatingTargetIvars::default());
            let target: Retained<Self> = unsafe { msg_send![super(this), init] };
            let _ = target.ivars().app.set(app);
            target
        }
    }

    static PANEL: OnceLock<usize> = OnceLock::new();
    static TARGET: OnceLock<usize> = OnceLock::new();
    static WORKSPACE_TOKENS: OnceLock<(usize, usize)> = OnceLock::new();

    pub(super) fn native_accessibility_trusted(prompt: bool) -> bool {
        unsafe {
            if !prompt {
                return AXIsProcessTrusted();
            }
            let key = CFString::from_static_string("AXTrustedCheckOptionPrompt");
            let value = CFBoolean::true_value();
            let options = CFDictionary::from_CFType_pairs(&[(key, value)]);
            AXIsProcessTrustedWithOptions(options.as_concrete_TypeRef().cast())
        }
    }

    pub(crate) fn start_native_observer(
        app: tauri::AppHandle,
        controller: AutoFillFloatingController,
    ) {
        let dirty = Arc::new(AtomicBool::new(true));
        let dirty_for_workspace = Arc::clone(&dirty);
        let _ = app.run_on_main_thread(move || install_workspace_observers(dirty_for_workspace));
        thread::Builder::new()
            .name("barwarden-ax-focus".to_owned())
            .spawn(move || observe_loop(app, controller, dirty))
            .expect("failed to start Accessibility observer");
    }

    fn install_workspace_observers(dirty: Arc<AtomicBool>) {
        WORKSPACE_TOKENS.get_or_init(|| {
            debug_assert_eq!(
                workspace_notification_plan(),
                [
                    WorkspaceNotification::Activated,
                    WorkspaceNotification::Terminated,
                ]
            );
            let center = NSWorkspace::sharedWorkspace().notificationCenter();
            let activated_dirty = Arc::clone(&dirty);
            let activated = RcBlock::new(move |_notification: NonNull<NSNotification>| {
                activated_dirty.store(true, Ordering::Release);
            });
            let terminated = RcBlock::new(move |_notification: NonNull<NSNotification>| {
                dirty.store(true, Ordering::Release);
            });
            let activated_token = unsafe {
                center.addObserverForName_object_queue_usingBlock(
                    Some(NSWorkspaceDidActivateApplicationNotification),
                    None,
                    None,
                    &activated,
                )
            };
            let terminated_token = unsafe {
                center.addObserverForName_object_queue_usingBlock(
                    Some(NSWorkspaceDidTerminateApplicationNotification),
                    None,
                    None,
                    &terminated,
                )
            };
            (
                Retained::into_raw(activated_token) as usize,
                Retained::into_raw(terminated_token) as usize,
            )
        });
    }

    fn observe_loop(
        app: tauri::AppHandle,
        controller: AutoFillFloatingController,
        dirty: Arc<AtomicBool>,
    ) {
        let mut last_app: Option<(String, i32)> = None;
        let mut registration: Option<AxObserverRegistration> = None;
        let mut throttle = ObservationThrottle::new(50);
        let started = Instant::now();
        let mut last_lifecycle_check = Instant::now() - Duration::from_secs(1);
        loop {
            if controller.fallback() != AccessibilityFallback::Unsupported {
                last_app = None;
                registration = None;
                CFRunLoop::run_in_mode(
                    unsafe { kCFRunLoopDefaultMode },
                    Duration::from_millis(100),
                    true,
                );
                continue;
            }
            if !native_accessibility_trusted(false) {
                controller.permission_lost();
                schedule_panel_hide(&app);
                last_app = None;
                registration = None;
                CFRunLoop::run_in_mode(
                    unsafe { kCFRunLoopDefaultMode },
                    Duration::from_millis(100),
                    true,
                );
                continue;
            }
            let lifecycle_due = last_lifecycle_check.elapsed() >= Duration::from_millis(250);
            let notified = dirty.swap(false, Ordering::AcqRel);
            if !notified && !lifecycle_due {
                CFRunLoop::run_in_mode(
                    unsafe { kCFRunLoopDefaultMode },
                    Duration::from_millis(50),
                    true,
                );
                continue;
            }
            if notified {
                registration = None;
                controller.begin_refresh();
                schedule_panel_hide(&app);
            }
            last_lifecycle_check = Instant::now();
            let generation = controller.generation();
            let now_ms = started.elapsed().as_millis().min(u128::from(u64::MAX)) as u64;
            match throttle.schedule(generation, now_ms) {
                ThrottleDecision::Discard => continue,
                ThrottleDecision::RunAt(deadline) if deadline > now_ms => {
                    CFRunLoop::run_in_mode(
                        unsafe { kCFRunLoopDefaultMode },
                        Duration::from_millis(deadline - now_ms),
                        true,
                    );
                    dirty.store(true, Ordering::Release);
                    continue;
                }
                _ => {}
            }
            let Some(target) = frontmost::current_frontmost_app().ok().flatten() else {
                controller.publish_hidden(
                    generation,
                    AccessibilityPermission::Granted,
                    "application-unavailable",
                    None,
                );
                schedule_panel_hide(&app);
                last_app = None;
                registration = None;
                continue;
            };
            let identity = (target.bundle_id.clone(), target.process_id);
            if last_app
                .as_ref()
                .is_some_and(|previous| previous != &identity)
            {
                controller.application_changed();
                schedule_panel_hide(&app);
                registration = None;
            }
            last_app = Some(identity);
            let generation = controller.generation();
            match read_focused_field(&target, controller.fallback().focus_eligibility()) {
                Ok(snapshot) => {
                    if registration.is_none() {
                        registration =
                            AxObserverRegistration::new(target.process_id, Arc::clone(&dirty));
                    }
                    schedule_panel_show(&app, &controller, generation, snapshot)
                }
                Err(reason) => {
                    registration =
                        AxObserverRegistration::new(target.process_id, Arc::clone(&dirty));
                    controller.publish_hidden(
                        generation,
                        AccessibilityPermission::Granted,
                        reason.code(),
                        Some(target.bundle_id.clone()),
                    );
                    schedule_panel_hide(&app);
                }
            }
            CFRunLoop::run_in_mode(
                unsafe { kCFRunLoopDefaultMode },
                Duration::from_millis(50),
                true,
            );
        }
    }

    struct AxObserverRegistration {
        observer: AXObserverRef,
        application: AXUIElementRef,
        focused: Option<AXUIElementRef>,
        window: Option<AXUIElementRef>,
        run_loop: CFRunLoopRef,
        _dirty: Arc<AtomicBool>,
    }

    impl AxObserverRegistration {
        fn new(pid: i32, dirty: Arc<AtomicBool>) -> Option<Self> {
            let application = unsafe { AXUIElementCreateApplication(pid) };
            if application.is_null() {
                return None;
            }
            let mut observer = ptr::null();
            if unsafe { AXObserverCreate(pid, ax_observer_callback, &mut observer) }
                != AX_ERROR_SUCCESS
                || observer.is_null()
            {
                unsafe { CFRelease(application.cast()) };
                return None;
            }
            let focused = copy_named_attribute(application, "AXFocusedUIElement")
                .ok()
                .map(|value| value as AXUIElementRef);
            let window = focused.and_then(|element| {
                copy_named_attribute(element, "AXWindow")
                    .ok()
                    .map(|value| value as AXUIElementRef)
            });
            let refcon = Arc::as_ptr(&dirty).cast_mut().cast::<c_void>();
            for (scope, notification) in observer_notification_plan() {
                let element = match scope {
                    ObserverScope::Application => Some(application),
                    ObserverScope::FocusedElement => focused,
                    ObserverScope::Window => window,
                };
                if let Some(element) = element {
                    let _ = unsafe {
                        AXObserverAddNotification(
                            observer,
                            element,
                            native_observer_notification(notification).as_concrete_TypeRef(),
                            refcon,
                        )
                    };
                }
            }
            let source = unsafe { AXObserverGetRunLoopSource(observer) };
            let run_loop = CFRunLoop::get_current().as_concrete_TypeRef();
            unsafe { CFRunLoopAddSource(run_loop, source, kCFRunLoopDefaultMode) };
            Some(Self {
                observer,
                application,
                focused,
                window,
                run_loop,
                _dirty: dirty,
            })
        }
    }

    impl Drop for AxObserverRegistration {
        fn drop(&mut self) {
            unsafe {
                CFRunLoopRemoveSource(
                    self.run_loop,
                    AXObserverGetRunLoopSource(self.observer),
                    kCFRunLoopDefaultMode,
                );
                for (scope, notification) in observer_notification_plan() {
                    let element = match scope {
                        ObserverScope::Application => Some(self.application),
                        ObserverScope::FocusedElement => self.focused,
                        ObserverScope::Window => self.window,
                    };
                    if let Some(element) = element {
                        let _ = AXObserverRemoveNotification(
                            self.observer,
                            element,
                            native_observer_notification(notification).as_concrete_TypeRef(),
                        );
                    }
                }
                if let Some(focused) = self.focused {
                    CFRelease(focused.cast());
                }
                if let Some(window) = self.window {
                    CFRelease(window.cast());
                }
                CFRelease(self.application.cast());
                CFRelease(self.observer.cast());
            }
        }
    }

    fn native_observer_notification(notification: ObserverNotification) -> CFString {
        match notification {
            ObserverNotification::FocusedElementChanged => {
                CFString::from_static_string("AXFocusedUIElementChanged")
            }
            ObserverNotification::Moved => CFString::from_static_string("AXMoved"),
            ObserverNotification::Resized => CFString::from_static_string("AXResized"),
            ObserverNotification::Destroyed => CFString::from_static_string("AXUIElementDestroyed"),
        }
    }

    unsafe extern "C" fn ax_observer_callback(
        _observer: AXObserverRef,
        _element: AXUIElementRef,
        _notification: CFStringRef,
        refcon: *mut c_void,
    ) {
        if let Some(dirty) = unsafe { refcon.cast::<AtomicBool>().as_ref() } {
            dirty.store(true, Ordering::Release);
        }
    }

    fn read_focused_field(
        target: &frontmost::FrontmostApp,
        fallback_eligibility: FallbackEligibility,
    ) -> Result<crate::accessibility_focus::FocusedFieldSnapshot, FocusRejectReason> {
        debug_assert_eq!(
            crate::accessibility_focus::FOCUSED_FIELD_ATTRIBUTE_ALLOWLIST,
            ["AXRole", "AXSubrole", "AXPosition", "AXSize", "AXWindow"],
        );
        let app_element = unsafe { AXUIElementCreateApplication(target.process_id) };
        if app_element.is_null() {
            return Err(FocusRejectReason::StaleElement);
        }
        let result = (|| {
            let focused =
                copy_named_attribute(app_element, "AXFocusedUIElement")? as AXUIElementRef;
            let role = copy_string_attribute(focused, "AXRole");
            let subrole = copy_optional_string_attribute(focused, "AXSubrole");
            let position = copy_point_attribute(focused, "AXPosition");
            let size = copy_size_attribute(focused, "AXSize");
            let window = copy_named_attribute(focused, "AXWindow");
            let mut editable = false;
            // Privacy boundary: query whether AXValue is settable, but never copy/read AXValue.
            let value_attribute = CFString::from_static_string("AXValue");
            let editable_status = unsafe {
                AXUIElementIsAttributeSettable(
                    focused,
                    value_attribute.as_concrete_TypeRef(),
                    &mut editable,
                )
            };
            let frame = position.zip(size).map(|(point, size)| AxFrame {
                x: point.x,
                y: point.y,
                width: size.width,
                height: size.height,
            });
            let screens = active_screen_frames();
            let observation = FocusedFieldObservation {
                permission_granted: true,
                fallback_eligibility,
                app: AppIdentity {
                    bundle_id: target.bundle_id.clone(),
                    process_id: target.process_id,
                    live: frontmost::target_is_running(target),
                },
                role,
                subrole,
                editable: editable_status == AX_ERROR_SUCCESS && editable,
                frame,
                element_valid: true,
                window_valid: window.is_ok(),
                observed_at: Instant::now(),
            };
            if let Ok(window) = window {
                unsafe { CFRelease(window) }
            }
            unsafe { CFRelease(focused.cast()) }
            classify_focused_field(
                observation,
                &screens,
                crate::frontmost::APP_BUNDLE_ID,
                Instant::now(),
            )
        })();
        unsafe { CFRelease(app_element.cast()) }
        result
    }

    fn copy_attribute(
        element: AXUIElementRef,
        attribute: CFStringRef,
    ) -> Result<CFTypeRef, FocusRejectReason> {
        let mut value = ptr::null();
        let status = unsafe { AXUIElementCopyAttributeValue(element, attribute, &mut value) };
        if status == AX_ERROR_SUCCESS && !value.is_null() {
            Ok(value)
        } else {
            Err(FocusRejectReason::StaleElement)
        }
    }

    fn copy_named_attribute(
        element: AXUIElementRef,
        attribute: &'static str,
    ) -> Result<CFTypeRef, FocusRejectReason> {
        let attribute = CFString::from_static_string(attribute);
        copy_attribute(element, attribute.as_concrete_TypeRef())
    }

    fn copy_string_attribute(element: AXUIElementRef, attribute: &'static str) -> Option<String> {
        copy_optional_string_attribute(element, attribute)
    }

    fn copy_optional_string_attribute(
        element: AXUIElementRef,
        attribute: &'static str,
    ) -> Option<String> {
        let value = copy_named_attribute(element, attribute).ok()?;
        let string = unsafe { CFString::wrap_under_create_rule(value.cast()) }.to_string();
        (!string.is_empty()).then_some(string)
    }

    fn copy_point_attribute(element: AXUIElementRef, attribute: &'static str) -> Option<CGPoint> {
        let value = copy_named_attribute(element, attribute).ok()?;
        let mut point = CGPoint::new(0.0, 0.0);
        let copied = unsafe {
            AXValueGetValue(
                value.cast(),
                AX_VALUE_CGPOINT,
                (&mut point as *mut CGPoint).cast(),
            )
        };
        unsafe { CFRelease(value) }
        copied.then_some(point)
    }

    fn copy_size_attribute(element: AXUIElementRef, attribute: &'static str) -> Option<CGSize> {
        let value = copy_named_attribute(element, attribute).ok()?;
        let mut size = CGSize::new(0.0, 0.0);
        let copied = unsafe {
            AXValueGetValue(
                value.cast(),
                AX_VALUE_CGSIZE,
                (&mut size as *mut CGSize).cast(),
            )
        };
        unsafe { CFRelease(value) }
        copied.then_some(size)
    }

    fn active_screen_frames() -> Vec<ScreenFrame> {
        CGDisplay::active_displays()
            .unwrap_or_default()
            .into_iter()
            .map(CGDisplay::new)
            .map(|display| display.bounds())
            .map(|bounds| ScreenFrame {
                x: bounds.origin.x,
                y: bounds.origin.y,
                width: bounds.size.width,
                height: bounds.size.height,
            })
            .collect()
    }

    fn schedule_panel_show(
        app: &tauri::AppHandle,
        controller: &AutoFillFloatingController,
        generation: u64,
        snapshot: crate::accessibility_focus::FocusedFieldSnapshot,
    ) {
        let app_for_panel = app.clone();
        let controller = controller.clone();
        let primary_max_y = CGDisplay::main().bounds().size.height;
        let field = ax_to_appkit(snapshot.frame, primary_max_y);
        let bundle_id = snapshot.app.bundle_id;
        let _ = app.run_on_main_thread(move || {
            let Some(mtm) = MainThreadMarker::new() else {
                return;
            };
            let Some(work_area) = screen_work_area(field, mtm) else {
                controller.publish_hidden(
                    generation,
                    AccessibilityPermission::Granted,
                    "offscreen",
                    Some(bundle_id),
                );
                hide_panel();
                return;
            };
            let Some(panel_frame) = place_panel(field, work_area) else {
                controller.publish_hidden(
                    generation,
                    AccessibilityPermission::Granted,
                    "unreliable-geometry",
                    Some(bundle_id),
                );
                hide_panel();
                return;
            };
            if controller.publish_visible(generation, bundle_id, panel_frame) {
                show_panel(&app_for_panel, panel_frame, mtm);
            }
        });
    }

    fn screen_work_area(field: AppKitFrame, mtm: MainThreadMarker) -> Option<AppKitFrame> {
        NSScreen::screens(mtm).iter().find_map(|screen| {
            let frame = screen.frame();
            let screen_frame = AppKitFrame {
                x: frame.origin.x,
                y: frame.origin.y,
                width: frame.size.width,
                height: frame.size.height,
            };
            let field_center = AppKitFrame {
                x: field.x + field.width / 2.0,
                y: field.y + field.height / 2.0,
                width: 0.0,
                height: 0.0,
            };
            if field_center.x < screen_frame.x
                || field_center.x > screen_frame.x + screen_frame.width
                || field_center.y < screen_frame.y
                || field_center.y > screen_frame.y + screen_frame.height
            {
                return None;
            }
            let visible = screen.visibleFrame();
            Some(AppKitFrame {
                x: visible.origin.x,
                y: visible.origin.y,
                width: visible.size.width,
                height: visible.size.height,
            })
        })
    }

    fn show_panel(app: &tauri::AppHandle, frame: AppKitFrame, mtm: MainThreadMarker) {
        let panel = panel(app, mtm);
        panel.setFrame_display(
            NSRect::new(
                NSPoint::new(frame.x, frame.y),
                NSSize::new(frame.width, frame.height),
            ),
            true,
        );
        panel.orderFrontRegardless();
    }

    fn panel(app: &tauri::AppHandle, mtm: MainThreadMarker) -> &'static NSPanel {
        let address = *PANEL.get_or_init(|| {
            let target = FloatingTarget::new(app.clone(), mtm);
            let data = unsafe {
                NSData::dataWithBytes_length(PANEL_ICON.as_ptr().cast(), PANEL_ICON.len())
            };
            let image = NSImage::initWithData(NSImage::alloc(), &data)
                .expect("floating icon asset is valid");
            let button = unsafe {
                NSButton::buttonWithImage_target_action(
                    &image,
                    Some(&target),
                    Some(sel!(openAutoFill:)),
                    mtm,
                )
            };
            button.setBordered(false);
            button.setImageScaling(NSImageScaling::ScaleProportionallyDown);
            button.setFrame(NSRect::new(NSPoint::new(2.0, 2.0), NSSize::new(24.0, 24.0)));
            button.setToolTip(Some(&NSString::from_str("Open Barwarden AutoFill")));

            let panel: Retained<FloatingPanel> = unsafe {
                msg_send![
                    FloatingPanel::alloc(mtm),
                    initWithContentRect: NSRect::new(
                        NSPoint::new(0.0, 0.0),
                        NSSize::new(PANEL_SIZE, PANEL_SIZE)
                    ),
                    styleMask: NSWindowStyleMask::Borderless
                        | NSWindowStyleMask::NonactivatingPanel,
                    backing: NSBackingStoreType::Buffered,
                    defer: false
                ]
            };
            unsafe { panel.setReleasedWhenClosed(false) };
            panel.setOpaque(false);
            panel.setBackgroundColor(Some(&NSColor::clearColor()));
            panel.setHasShadow(true);
            panel.setFloatingPanel(true);
            panel.setBecomesKeyOnlyIfNeeded(true);
            panel.setMovable(false);
            panel.setExcludedFromWindowsMenu(true);
            panel.setLevel(NSStatusWindowLevel);
            panel.setCollectionBehavior(
                NSWindowCollectionBehavior::CanJoinAllSpaces
                    | NSWindowCollectionBehavior::Stationary
                    | NSWindowCollectionBehavior::IgnoresCycle,
            );
            panel.setContentView(Some(&button));
            let target_ptr = Retained::into_raw(target) as usize;
            let _ = TARGET.set(target_ptr);
            Retained::into_raw(panel) as usize
        });
        unsafe { &*(address as *const NSPanel) }
    }

    fn hide_panel() {
        if let Some(address) = PANEL.get() {
            unsafe { &*(*address as *const NSPanel) }.orderOut(None);
        }
    }

    pub(super) fn schedule_panel_hide(app: &tauri::AppHandle) {
        let _ = app.run_on_main_thread(hide_panel);
    }

    #[cfg(test)]
    mod live_tests {
        use super::*;

        #[test]
        #[ignore = "requires the local non-sensitive Task 8 AppKit fixture"]
        fn live_external_fixture_yields_reliable_snapshot_and_observer_invalidation() {
            assert!(
                native_accessibility_trusted(false),
                "existing AX permission required"
            );
            let target = (0..30)
                .find_map(|_| {
                    let target = frontmost::current_frontmost_app().ok().flatten();
                    if target.as_ref().is_some_and(|target| {
                        target.bundle_id == "com.sommir.barwarden.task8-ax-fixture"
                    }) {
                        return target;
                    }
                    CFRunLoop::run_in_mode(
                        unsafe { kCFRunLoopDefaultMode },
                        Duration::from_millis(100),
                        true,
                    );
                    std::thread::sleep(Duration::from_millis(100));
                    None
                })
                .expect("frontmost fixture");
            assert_eq!(
                target.bundle_id, "com.sommir.barwarden.task8-ax-fixture",
                "launch the Task 8 fixture immediately before this smoke"
            );
            let snapshot = read_focused_field(&target, FallbackEligibility::SystemUnsupported)
                .expect("reliable focused field snapshot");
            assert!(snapshot.reliable);
            assert!(snapshot.secure);

            let dirty = Arc::new(AtomicBool::new(false));
            let _registration = AxObserverRegistration::new(target.process_id, Arc::clone(&dirty))
                .expect("AX observer registration");
            for _ in 0..30 {
                CFRunLoop::run_in_mode(
                    unsafe { kCFRunLoopDefaultMode },
                    Duration::from_millis(100),
                    true,
                );
                if dirty.load(Ordering::Acquire) {
                    break;
                }
            }
            assert!(
                dirty.load(Ordering::Acquire),
                "move/resize/termination notification"
            );
        }
    }
}

#[cfg(target_os = "macos")]
pub(crate) use macos::start_native_observer;
#[cfg(target_os = "macos")]
use macos::{native_accessibility_trusted, schedule_panel_hide};

impl ObservationThrottle {
    pub fn new(interval_ms: u64) -> Self {
        Self {
            interval_ms,
            generation: None,
            last_run_ms: None,
        }
    }

    pub fn schedule(&mut self, generation: u64, now_ms: u64) -> ThrottleDecision {
        match self.generation {
            Some(current) if generation < current => return ThrottleDecision::Discard,
            Some(current) if generation > current => {
                self.generation = Some(generation);
                self.last_run_ms = None;
            }
            None => self.generation = Some(generation),
            _ => {}
        }
        match self.last_run_ms {
            Some(last) if now_ms < last.saturating_add(self.interval_ms) => {
                ThrottleDecision::RunAt(last.saturating_add(self.interval_ms))
            }
            _ => {
                self.last_run_ms = Some(now_ms);
                ThrottleDecision::RunNow
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn work_area() -> AppKitFrame {
        AppKitFrame {
            x: 0.0,
            y: 23.0,
            width: 1440.0,
            height: 877.0,
        }
    }

    #[test]
    fn converts_ax_top_left_coordinates_across_displays() {
        let primary_max_y = 900.0;
        assert_eq!(
            ax_to_appkit(
                AxFrame {
                    x: 100.0,
                    y: 120.0,
                    width: 300.0,
                    height: 28.0
                },
                primary_max_y
            ),
            AppKitFrame {
                x: 100.0,
                y: 752.0,
                width: 300.0,
                height: 28.0
            },
        );
        assert_eq!(
            ax_to_appkit(
                AxFrame {
                    x: -1200.0,
                    y: -100.0,
                    width: 200.0,
                    height: 30.0
                },
                primary_max_y
            ),
            AppKitFrame {
                x: -1200.0,
                y: 970.0,
                width: 200.0,
                height: 30.0
            },
        );
    }

    #[test]
    fn prefers_trailing_outside_and_never_overlaps_the_field() {
        let field = AppKitFrame {
            x: 100.0,
            y: 400.0,
            width: 300.0,
            height: 28.0,
        };
        let placed = place_panel(field, work_area()).expect("trailing placement");
        assert_eq!(placed.x, 406.0);
        assert!(placed.x >= field.x + field.width);
        assert!(work_area().contains(placed));
    }

    #[test]
    fn uses_safe_leading_outside_when_trailing_has_no_room() {
        let field = AppKitFrame {
            x: 1200.0,
            y: 400.0,
            width: 210.0,
            height: 28.0,
        };
        let placed = place_panel(field, work_area()).expect("leading placement");
        assert_eq!(placed.x + placed.width, 1194.0);
        assert!(placed.x + placed.width <= field.x);
        assert!(work_area().contains(placed));
    }

    #[test]
    fn clamps_vertically_inside_work_area_and_hides_without_safe_horizontal_space() {
        let top = place_panel(
            AppKitFrame {
                x: 100.0,
                y: 895.0,
                width: 300.0,
                height: 20.0,
            },
            work_area(),
        )
        .expect("top clamped");
        assert_eq!(top.y + top.height, 900.0);

        let no_space = place_panel(
            AppKitFrame {
                x: 0.0,
                y: 100.0,
                width: 1440.0,
                height: 30.0,
            },
            work_area(),
        );
        assert_eq!(no_space, None);
    }

    #[test]
    fn panel_contract_is_borderless_nonactivating_and_never_key_or_main() {
        assert_eq!(
            PANEL_CONTRACT,
            PanelContract {
                borderless: true,
                nonactivating: true,
                can_become_key: false,
                can_become_main: false,
                fixed_entry_event: "autofill-floating",
            },
        );
    }

    #[test]
    fn generation_cancels_stale_callbacks_and_invalidations_hide_immediately() {
        let mut lifecycle = FloatingLifecycle::default();
        let first = lifecycle.begin_observation();
        lifecycle.accept(
            first,
            AppKitFrame {
                x: 1.0,
                y: 2.0,
                width: 28.0,
                height: 28.0,
            },
        );
        assert!(lifecycle.visible_frame().is_some());

        let second = lifecycle.invalidate();
        assert_eq!(lifecycle.visible_frame(), None);
        lifecycle.accept(
            first,
            AppKitFrame {
                x: 3.0,
                y: 4.0,
                width: 28.0,
                height: 28.0,
            },
        );
        assert_eq!(lifecycle.visible_frame(), None);
        lifecycle.accept(
            second,
            AppKitFrame {
                x: 5.0,
                y: 6.0,
                width: 28.0,
                height: 28.0,
            },
        );
        assert!(lifecycle.visible_frame().is_some());
    }

    #[test]
    fn throttle_coalesces_bursts_without_accepting_an_old_generation() {
        let mut throttle = ObservationThrottle::new(50);
        let generation = 7;
        assert_eq!(throttle.schedule(generation, 100), ThrottleDecision::RunNow);
        assert_eq!(
            throttle.schedule(generation, 110),
            ThrottleDecision::RunAt(150)
        );
        assert_eq!(
            throttle.schedule(generation - 1, 160),
            ThrottleDecision::Discard
        );
        assert_eq!(throttle.schedule(generation, 160), ThrottleDecision::RunNow);
    }

    #[test]
    fn controller_hides_immediately_for_system_autofill_permission_loss_or_app_change() {
        let controller = AutoFillFloatingController::default();
        assert_eq!(
            controller.status().observation,
            AccessibilityObservation::Stopped
        );

        controller.set_fallback(AccessibilityFallback::Unsupported);
        controller.show_for_test("com.example.editor");
        assert_eq!(
            controller.status().observation,
            AccessibilityObservation::Visible
        );

        controller.set_fallback(AccessibilityFallback::SystemAutoFill);
        assert_eq!(
            controller.status().observation,
            AccessibilityObservation::Stopped
        );

        controller.set_fallback(AccessibilityFallback::Unsupported);
        controller.show_for_test("com.example.editor");
        controller.permission_lost();
        assert_eq!(
            controller.status().observation,
            AccessibilityObservation::Hidden
        );
        assert_eq!(
            controller.status().diagnostic.unwrap().reason,
            "permission-denied"
        );

        controller.show_for_test("com.example.editor");
        controller.application_changed();
        assert_eq!(
            controller.status().observation,
            AccessibilityObservation::Hidden
        );
        assert_eq!(
            controller.status().diagnostic.unwrap().reason,
            "application-changed"
        );
    }

    #[test]
    fn permission_probe_prompts_only_for_the_explicit_command() {
        let permission = RecordingPermission::default();
        assert!(!accessibility_status_with(&permission));
        assert_eq!(permission.prompts(), 0);
        assert!(!request_accessibility_permission_with(&permission));
        assert_eq!(permission.prompts(), 1);
    }

    #[test]
    fn read_only_permission_probe_updates_granted_status_without_starting_observation() {
        let controller = AutoFillFloatingController::default();
        controller.permission_observed(true);
        assert_eq!(
            controller.status(),
            AccessibilityStatus {
                permission: AccessibilityPermission::Granted,
                observation: AccessibilityObservation::Stopped,
                diagnostic: None,
            }
        );
    }

    #[test]
    fn observer_plan_covers_focus_geometry_activation_termination_and_destruction() {
        assert_eq!(
            observer_notification_plan(),
            [
                (
                    ObserverScope::Application,
                    ObserverNotification::FocusedElementChanged
                ),
                (ObserverScope::FocusedElement, ObserverNotification::Moved),
                (ObserverScope::FocusedElement, ObserverNotification::Resized),
                (
                    ObserverScope::FocusedElement,
                    ObserverNotification::Destroyed
                ),
                (ObserverScope::Window, ObserverNotification::Moved),
                (ObserverScope::Window, ObserverNotification::Resized),
                (ObserverScope::Window, ObserverNotification::Destroyed),
            ],
        );
        assert_eq!(
            workspace_notification_plan(),
            [
                WorkspaceNotification::Activated,
                WorkspaceNotification::Terminated
            ],
        );
    }

    #[derive(Default)]
    struct RecordingPermission(std::sync::atomic::AtomicUsize);

    impl RecordingPermission {
        fn prompts(&self) -> usize {
            self.0.load(std::sync::atomic::Ordering::Acquire)
        }
    }

    impl AccessibilityPermissionPort for RecordingPermission {
        fn trusted(&self) -> bool {
            false
        }
        fn prompt(&self) -> bool {
            self.0.fetch_add(1, std::sync::atomic::Ordering::AcqRel);
            false
        }
    }

    #[cfg(target_os = "macos")]
    #[test]
    #[ignore = "live read-only TCC smoke; run explicitly without prompting"]
    fn live_accessibility_denied_smoke_reads_tcc_without_prompting() {
        assert!(
            !native_accessibility_trusted(false),
            "this process already has Accessibility permission; denied-state smoke requires an untrusted process",
        );
        let controller = AutoFillFloatingController::default();
        controller.set_fallback(AccessibilityFallback::Unsupported);
        controller.permission_lost();
        let status = controller.status();
        assert_eq!(status.permission, AccessibilityPermission::Denied);
        assert_eq!(status.observation, AccessibilityObservation::Hidden);
        assert_eq!(status.diagnostic.unwrap().reason, "permission-denied");
    }

    #[cfg(target_os = "macos")]
    #[test]
    #[ignore = "live read-only TCC smoke; run explicitly only when permission already exists"]
    fn live_accessibility_granted_smoke_never_requests_a_prompt() {
        assert!(
            native_accessibility_trusted(false),
            "granted-state smoke is blocked because this process lacks existing permission",
        );
        assert!(accessibility_status_with(&SystemAccessibilityPermission));
    }
}

use crate::accessibility_focus::AxFrame;
use serde::{Deserialize, Serialize};
use std::ffi::c_void;
use std::sync::atomic::{AtomicBool, Ordering};
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

fn observer_creation_succeeded(status: i32, observer_nonnull: bool) -> bool {
    status == 0 && observer_nonnull
}

fn install_notifications(
    plan: &[(ObserverScope, ObserverNotification)],
    mut add: impl FnMut(ObserverScope, ObserverNotification) -> bool,
) -> bool {
    plan.iter()
        .copied()
        .all(|(scope, notification)| add(scope, notification))
}

#[cfg(test)]
fn install_required_notifications(
    add: impl FnMut(ObserverScope, ObserverNotification) -> bool,
) -> bool {
    install_notifications(&observer_notification_plan(), add)
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ObserverRegistrationDecision {
    Create,
    Reuse,
    Replace,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ObserverWork {
    Idle,
    LivenessOnly,
    Refresh,
}

fn observer_work(notified: bool, lifecycle_due: bool) -> ObserverWork {
    match (notified, lifecycle_due) {
        (true, _) => ObserverWork::Refresh,
        (false, true) => ObserverWork::LivenessOnly,
        (false, false) => ObserverWork::Idle,
    }
}

fn observer_registration_decision(
    registered_pid: Option<i32>,
    target_pid: i32,
) -> ObserverRegistrationDecision {
    match registered_pid {
        None => ObserverRegistrationDecision::Create,
        Some(pid) if pid == target_pid => ObserverRegistrationDecision::Reuse,
        Some(_) => ObserverRegistrationDecision::Replace,
    }
}

fn validate_copied_type_with(
    value: *const c_void,
    expected_type: usize,
    type_id: impl FnOnce(*const c_void) -> usize,
    release: impl FnOnce(*const c_void),
) -> Option<*const c_void> {
    if value.is_null() {
        return None;
    }
    if type_id(value) == expected_type {
        Some(value)
    } else {
        release(value);
        None
    }
}

fn validate_ax_value_with(
    value: *const c_void,
    expected_cf_type: usize,
    expected_ax_type: i32,
    type_id: impl FnOnce(*const c_void) -> usize,
    ax_value_type: impl FnOnce(*const c_void) -> i32,
    release: impl FnOnce(*const c_void),
) -> Option<*const c_void> {
    if value.is_null() {
        return None;
    }
    if type_id(value) == expected_cf_type && ax_value_type(value) == expected_ax_type {
        Some(value)
    } else {
        release(value);
        None
    }
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

#[derive(Clone, Debug, Eq, PartialEq)]
struct FloatingClickContext {
    generation: u64,
    target: crate::frontmost::FrontmostApp,
}

#[derive(Clone)]
struct VisibleTarget {
    generation: u64,
    target: crate::frontmost::FrontmostApp,
}

struct ControllerState {
    fallback: AccessibilityFallback,
    permission: AccessibilityPermission,
    observation: AccessibilityObservation,
    diagnostic: Option<AccessibilityDiagnostic>,
    visible_target: Option<VisibleTarget>,
    lifecycle: FloatingLifecycle,
    permission_prompt: PermissionPromptState,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
enum PermissionPromptState {
    #[default]
    Available,
    InFlight,
    Consumed,
}

impl Default for ControllerState {
    fn default() -> Self {
        Self {
            fallback: AccessibilityFallback::SystemAutoFill,
            permission: AccessibilityPermission::Denied,
            observation: AccessibilityObservation::Stopped,
            diagnostic: None,
            visible_target: None,
            lifecycle: FloatingLifecycle::default(),
            permission_prompt: PermissionPromptState::Available,
        }
    }
}

#[derive(Clone, Default)]
pub struct AutoFillFloatingController {
    state: Arc<Mutex<ControllerState>>,
}

struct ObserverInvalidationSignal {
    controller: AutoFillFloatingController,
    dirty: AtomicBool,
    schedule_hide: Arc<dyn Fn() + Send + Sync>,
}

impl ObserverInvalidationSignal {
    fn new(
        controller: AutoFillFloatingController,
        schedule_hide: impl Fn() + Send + Sync + 'static,
    ) -> Self {
        Self {
            controller,
            dirty: AtomicBool::new(false),
            schedule_hide: Arc::new(schedule_hide),
        }
    }

    fn invalidate(&self) {
        self.controller.observer_invalidated();
        (self.schedule_hide)();
        self.dirty.store(true, Ordering::Release);
    }

    fn mark_dirty(&self) {
        self.dirty.store(true, Ordering::Release);
    }

    fn take_dirty(&self) -> bool {
        self.dirty.swap(false, Ordering::AcqRel)
    }

    fn is_dirty(&self) -> bool {
        self.dirty.load(Ordering::Acquire)
    }
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
        state.visible_target = None;
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

    #[cfg(test)]
    fn begin_refresh(&self) -> u64 {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let generation = state.lifecycle.begin_observation();
        state.visible_target = None;
        state.observation = AccessibilityObservation::Hidden;
        state.diagnostic = None;
        generation
    }

    fn publish_visible(
        &self,
        generation: u64,
        target: crate::frontmost::FrontmostApp,
        frame: AppKitFrame,
    ) -> bool {
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
        state.visible_target = Some(VisibleTarget { generation, target });
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
        state.visible_target = None;
        state.diagnostic = Some(AccessibilityDiagnostic {
            reason,
            bundle_id: sanitized_diagnostic_bundle_id(bundle_id),
        });
    }

    fn consume_visible_target(
        &self,
        context: &FloatingClickContext,
    ) -> Option<crate::frontmost::FrontmostApp> {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let target = state.visible_target.as_ref().and_then(|visible| {
            (state.observation == AccessibilityObservation::Visible
                && state.lifecycle.generation == context.generation
                && visible.generation == context.generation
                && visible.target == context.target)
                .then(|| visible.target.clone())
        })?;
        state.lifecycle.invalidate();
        state.visible_target = None;
        state.observation = AccessibilityObservation::Hidden;
        state.diagnostic = None;
        Some(target)
    }

    fn observer_invalidated(&self) {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        state.lifecycle.invalidate();
        state.visible_target = None;
        state.observation = match state.fallback {
            AccessibilityFallback::SystemAutoFill => AccessibilityObservation::Stopped,
            AccessibilityFallback::Unsupported => AccessibilityObservation::Hidden,
        };
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

    fn begin_permission_prompt(&self) -> bool {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if state.permission_prompt != PermissionPromptState::Available {
            return false;
        }
        state.permission_prompt = PermissionPromptState::InFlight;
        true
    }

    fn finish_permission_prompt(&self, trusted: bool) {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        state.permission_prompt = PermissionPromptState::Consumed;
        state.permission = if trusted {
            AccessibilityPermission::Granted
        } else {
            AccessibilityPermission::Denied
        };
        if trusted {
            state.diagnostic = None;
        } else {
            state.lifecycle.invalidate();
            state.visible_target = None;
            state.observation = AccessibilityObservation::Hidden;
            state.diagnostic = Some(AccessibilityDiagnostic {
                reason: "permission-denied",
                bundle_id: None,
            });
        }
    }

    #[cfg(test)]
    pub fn application_changed(&self) {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        state.lifecycle.invalidate();
        state.visible_target = None;
        state.observation = AccessibilityObservation::Hidden;
        state.diagnostic = Some(AccessibilityDiagnostic {
            reason: "application-changed",
            bundle_id: None,
        });
    }

    fn hide_with_reason(&self, permission: AccessibilityPermission, reason: &'static str) {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let bundle_id = state
            .visible_target
            .take()
            .map(|visible| visible.target.bundle_id);
        state.lifecycle.invalidate();
        state.permission = permission;
        state.observation = AccessibilityObservation::Hidden;
        state.diagnostic = Some(AccessibilityDiagnostic {
            reason,
            bundle_id: sanitized_diagnostic_bundle_id(bundle_id),
        });
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
        state.visible_target = Some(VisibleTarget {
            generation,
            target: crate::frontmost::test_frontmost_app(bundle_id, 42, generation),
        });
        state.diagnostic = None;
    }

    #[cfg(test)]
    fn has_visible_target_for_test(&self) -> bool {
        self.state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .visible_target
            .is_some()
    }
}

fn sanitized_diagnostic_bundle_id(bundle_id: Option<String>) -> Option<String> {
    bundle_id.filter(|value| crate::accessibility_focus::valid_bundle_id(value))
}

trait AccessibilityPermissionPort {
    fn trusted(&self) -> bool;
    fn prompt(&self) -> bool;
}

fn accessibility_status_with(port: &impl AccessibilityPermissionPort) -> bool {
    port.trusted()
}

#[cfg(test)]
fn request_accessibility_permission_with(port: &impl AccessibilityPermissionPort) -> bool {
    port.prompt()
}

fn request_accessibility_permission_once_with(
    controller: &AutoFillFloatingController,
    port: &(impl AccessibilityPermissionPort + ?Sized),
) -> bool {
    if port.trusted() {
        controller.permission_observed(true);
        return true;
    }
    if !controller.begin_permission_prompt() {
        controller.permission_lost();
        return false;
    }
    let trusted = port.prompt();
    controller.finish_permission_prompt(trusted);
    trusted
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
    let trusted =
        request_accessibility_permission_once_with(&controller, &SystemAccessibilityPermission);
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
    use core_foundation::base::{CFGetTypeID, CFRelease, CFTypeID, TCFType};
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
    use std::ptr;
    use std::ptr::NonNull;
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
        fn AXUIElementGetTypeID() -> CFTypeID;
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
        fn AXValueGetTypeID() -> CFTypeID;
        fn AXValueGetType(value: AXValueRef) -> i32;
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
        context: Mutex<Option<FloatingClickContext>>,
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
                let Some(context) = self
                    .ivars()
                    .context
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner)
                    .take()
                else {
                    hide_panel();
                    return;
                };
                let Some(controller) = app.try_state::<AutoFillFloatingController>() else {
                    hide_panel();
                    return;
                };
                let Some(target) = controller.consume_visible_target(&context) else {
                    hide_panel();
                    return;
                };
                hide_panel();
                let still_exact_frontmost = frontmost::target_is_running(&target)
                    && frontmost::current_frontmost_app()
                        .ok()
                        .flatten()
                        .is_some_and(|current| current == target);
                if !still_exact_frontmost {
                    return;
                }
                let _ = window::show_autofill_picker_window_for_target(
                    app,
                    window::PopupEntrySource::AutoFillFloating,
                    target,
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

        fn set_context(&self, context: FloatingClickContext) {
            *self
                .ivars()
                .context
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(context);
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
        let app_for_hide = app.clone();
        let signal = Arc::new(ObserverInvalidationSignal::new(
            controller.clone(),
            move || schedule_panel_hide(&app_for_hide),
        ));
        signal.mark_dirty();
        let signal_for_workspace = Arc::clone(&signal);
        let _ = app.run_on_main_thread(move || install_workspace_observers(signal_for_workspace));
        thread::Builder::new()
            .name("barwarden-ax-focus".to_owned())
            .spawn(move || observe_loop(app, controller, signal))
            .expect("failed to start Accessibility observer");
    }

    fn install_workspace_observers(signal: Arc<ObserverInvalidationSignal>) {
        WORKSPACE_TOKENS.get_or_init(|| {
            debug_assert_eq!(
                workspace_notification_plan(),
                [
                    WorkspaceNotification::Activated,
                    WorkspaceNotification::Terminated,
                ]
            );
            let center = NSWorkspace::sharedWorkspace().notificationCenter();
            let activated_signal = Arc::clone(&signal);
            let activated = RcBlock::new(move |_notification: NonNull<NSNotification>| {
                activated_signal.invalidate();
            });
            let terminated = RcBlock::new(move |_notification: NonNull<NSNotification>| {
                signal.invalidate();
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
        signal: Arc<ObserverInvalidationSignal>,
    ) {
        let mut last_app: Option<(String, i32)> = None;
        let mut registration: Option<AxObserverRegistration> = None;
        let mut throttle = ObservationThrottle::new(50);
        let started = Instant::now();
        let mut last_lifecycle_check = Instant::now() - Duration::from_secs(1);
        let mut observing = false;
        loop {
            if controller.fallback() != AccessibilityFallback::Unsupported {
                observing = false;
                last_app = None;
                registration = None;
                CFRunLoop::run_in_mode(
                    unsafe { kCFRunLoopDefaultMode },
                    Duration::from_millis(100),
                    true,
                );
                continue;
            }
            if !observing {
                observing = true;
                signal.mark_dirty();
            }
            let lifecycle_due = last_lifecycle_check.elapsed() >= Duration::from_millis(250);
            let notified = signal.take_dirty();
            let work = observer_work(notified, lifecycle_due);
            if work == ObserverWork::Idle {
                CFRunLoop::run_in_mode(
                    unsafe { kCFRunLoopDefaultMode },
                    Duration::from_millis(50),
                    true,
                );
                continue;
            }
            if !native_accessibility_trusted(false) {
                controller.permission_lost();
                schedule_panel_hide(&app);
                last_app = None;
                registration = None;
                last_lifecycle_check = Instant::now();
                continue;
            }
            last_lifecycle_check = Instant::now();
            if work == ObserverWork::LivenessOnly {
                let current = frontmost::current_frontmost_app().ok().flatten();
                let same_live_app = current.as_ref().is_some_and(|target| {
                    frontmost::target_is_running(target)
                        && last_app.as_ref().is_some_and(|(bundle_id, pid)| {
                            bundle_id == &target.bundle_id && *pid == target.process_id
                        })
                });
                if !same_live_app {
                    signal.invalidate();
                }
                continue;
            }
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
                    signal.mark_dirty();
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
            last_app = Some(identity);
            match observer_registration_decision(
                registration.as_ref().map(AxObserverRegistration::pid),
                target.process_id,
            ) {
                ObserverRegistrationDecision::Reuse => {}
                ObserverRegistrationDecision::Create | ObserverRegistrationDecision::Replace => {
                    registration =
                        AxObserverRegistration::new(target.process_id, Arc::clone(&signal));
                }
            }
            let generation = controller.generation();
            let Some(observer) = registration.as_mut() else {
                controller.publish_hidden(
                    generation,
                    AccessibilityPermission::Granted,
                    "observer-unavailable",
                    Some(target.bundle_id.clone()),
                );
                schedule_panel_hide(&app);
                continue;
            };
            if !observer.bind_focused_elements()
                || signal.is_dirty()
                || controller.generation() != generation
            {
                controller.publish_hidden(
                    generation,
                    AccessibilityPermission::Granted,
                    "observer-unavailable",
                    Some(target.bundle_id.clone()),
                );
                schedule_panel_hide(&app);
                continue;
            }
            let result = read_focused_field(&target, controller.fallback().focus_eligibility());
            if signal.is_dirty() || controller.generation() != generation {
                continue;
            }
            match result {
                Ok(snapshot) => {
                    schedule_panel_show(&app, &controller, generation, snapshot, target)
                }
                Err(reason) => {
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
        pid: i32,
        observer: AXObserverRef,
        application: AXUIElementRef,
        focused: Option<AXUIElementRef>,
        window: Option<AXUIElementRef>,
        run_loop: CFRunLoopRef,
        source_installed: bool,
        installed: Vec<(ObserverScope, ObserverNotification)>,
        _signal: Arc<ObserverInvalidationSignal>,
    }

    impl AxObserverRegistration {
        fn new(pid: i32, signal: Arc<ObserverInvalidationSignal>) -> Option<Self> {
            let application = unsafe { AXUIElementCreateApplication(pid) };
            if application.is_null() {
                return None;
            }
            let mut observer = ptr::null();
            let create_status =
                unsafe { AXObserverCreate(pid, ax_observer_callback, &mut observer) };
            if !observer_creation_succeeded(create_status, !observer.is_null()) {
                unsafe {
                    if !observer.is_null() {
                        CFRelease(observer.cast());
                    }
                    CFRelease(application.cast());
                }
                return None;
            }
            let run_loop = CFRunLoop::get_current().as_concrete_TypeRef();
            let mut registration = Self {
                pid,
                observer,
                application,
                focused: None,
                window: None,
                run_loop,
                source_installed: false,
                installed: Vec::new(),
                _signal: signal,
            };
            if !install_notifications(&observer_notification_plan()[..1], |scope, notification| {
                registration.add_notification(scope, notification)
            }) {
                return None;
            }
            let source = unsafe { AXObserverGetRunLoopSource(observer) };
            if source.is_null() {
                return None;
            }
            unsafe { CFRunLoopAddSource(run_loop, source, kCFRunLoopDefaultMode) };
            registration.source_installed = true;
            Some(registration)
        }

        fn pid(&self) -> i32 {
            self.pid
        }

        fn add_notification(
            &mut self,
            scope: ObserverScope,
            notification: ObserverNotification,
        ) -> bool {
            let element = match scope {
                ObserverScope::Application => Some(self.application),
                ObserverScope::FocusedElement => self.focused,
                ObserverScope::Window => self.window,
            };
            let Some(element) = element else {
                return false;
            };
            let refcon = Arc::as_ptr(&self._signal).cast_mut().cast::<c_void>();
            let status = unsafe {
                AXObserverAddNotification(
                    self.observer,
                    element,
                    native_observer_notification(notification).as_concrete_TypeRef(),
                    refcon,
                )
            };
            if status == AX_ERROR_SUCCESS {
                self.installed.push((scope, notification));
                true
            } else {
                false
            }
        }

        fn bind_focused_elements(&mut self) -> bool {
            self.clear_element_bindings();
            let Ok(focused) = copy_ui_element_attribute(self.application, "AXFocusedUIElement")
            else {
                return false;
            };
            self.focused = Some(focused);
            let Ok(window) = copy_ui_element_attribute(focused, "AXWindow") else {
                self.clear_element_bindings();
                return false;
            };
            self.window = Some(window);
            let installed =
                install_notifications(&observer_notification_plan()[1..], |scope, notification| {
                    self.add_notification(scope, notification)
                });
            if !installed {
                self.clear_element_bindings();
            }
            installed
        }

        fn clear_element_bindings(&mut self) {
            let mut retained = Vec::with_capacity(1);
            for (scope, notification) in self.installed.drain(..) {
                if scope == ObserverScope::Application {
                    retained.push((scope, notification));
                    continue;
                }
                let element = match scope {
                    ObserverScope::FocusedElement => self.focused,
                    ObserverScope::Window => self.window,
                    ObserverScope::Application => None,
                };
                if let Some(element) = element {
                    let _ = unsafe {
                        AXObserverRemoveNotification(
                            self.observer,
                            element,
                            native_observer_notification(notification).as_concrete_TypeRef(),
                        )
                    };
                }
            }
            self.installed = retained;
            if let Some(focused) = self.focused.take() {
                unsafe { CFRelease(focused.cast()) };
            }
            if let Some(window) = self.window.take() {
                unsafe { CFRelease(window.cast()) };
            }
        }
    }

    impl Drop for AxObserverRegistration {
        fn drop(&mut self) {
            self.clear_element_bindings();
            unsafe {
                if self.source_installed {
                    CFRunLoopRemoveSource(
                        self.run_loop,
                        AXObserverGetRunLoopSource(self.observer),
                        kCFRunLoopDefaultMode,
                    );
                }
                for (scope, notification) in self.installed.drain(..) {
                    debug_assert_eq!(scope, ObserverScope::Application);
                    let _ = AXObserverRemoveNotification(
                        self.observer,
                        self.application,
                        native_observer_notification(notification).as_concrete_TypeRef(),
                    );
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
        if let Some(signal) = unsafe { refcon.cast::<ObserverInvalidationSignal>().as_ref() } {
            signal.invalidate();
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
            let focused = copy_ui_element_attribute(app_element, "AXFocusedUIElement")?;
            let role = copy_string_attribute(focused, "AXRole");
            let subrole = copy_optional_string_attribute(focused, "AXSubrole");
            let position = copy_point_attribute(focused, "AXPosition");
            let size = copy_size_attribute(focused, "AXSize");
            let window = copy_ui_element_attribute(focused, "AXWindow");
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

    fn copy_ui_element_attribute(
        element: AXUIElementRef,
        attribute: &'static str,
    ) -> Result<AXUIElementRef, FocusRejectReason> {
        let value = copy_named_attribute(element, attribute)?;
        unsafe {
            validate_copied_type_with(
                value,
                AXUIElementGetTypeID(),
                |value| CFGetTypeID(value.cast()),
                |value| CFRelease(value.cast()),
            )
            .map(|value| value.cast())
            .ok_or(FocusRejectReason::StaleElement)
        }
    }

    fn copy_string_attribute(element: AXUIElementRef, attribute: &'static str) -> Option<String> {
        copy_optional_string_attribute(element, attribute)
    }

    fn copy_optional_string_attribute(
        element: AXUIElementRef,
        attribute: &'static str,
    ) -> Option<String> {
        let value = copy_named_attribute(element, attribute).ok()?;
        let value = unsafe {
            validate_copied_type_with(
                value,
                CFString::type_id(),
                |value| CFGetTypeID(value.cast()),
                |value| CFRelease(value.cast()),
            )?
        };
        let string = unsafe { CFString::wrap_under_create_rule(value.cast()) }.to_string();
        (!string.is_empty()).then_some(string)
    }

    fn copy_point_attribute(element: AXUIElementRef, attribute: &'static str) -> Option<CGPoint> {
        let value = copy_named_attribute(element, attribute).ok()?;
        let value = unsafe {
            validate_ax_value_with(
                value,
                AXValueGetTypeID(),
                AX_VALUE_CGPOINT,
                |value| CFGetTypeID(value.cast()),
                |value| AXValueGetType(value.cast()),
                |value| CFRelease(value.cast()),
            )?
        };
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
        let value = unsafe {
            validate_ax_value_with(
                value,
                AXValueGetTypeID(),
                AX_VALUE_CGSIZE,
                |value| CFGetTypeID(value.cast()),
                |value| AXValueGetType(value.cast()),
                |value| CFRelease(value.cast()),
            )?
        };
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
        target: frontmost::FrontmostApp,
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
            if controller.publish_visible(generation, target.clone(), panel_frame) {
                show_panel(
                    &app_for_panel,
                    panel_frame,
                    FloatingClickContext { generation, target },
                    mtm,
                );
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

    fn show_panel(
        app: &tauri::AppHandle,
        frame: AppKitFrame,
        context: FloatingClickContext,
        mtm: MainThreadMarker,
    ) {
        let panel = panel(app, mtm);
        panel_target().set_context(context);
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
            image.setTemplate(true);
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

    fn panel_target() -> &'static FloatingTarget {
        let address = *TARGET
            .get()
            .expect("floating target initialized with panel");
        unsafe { &*(address as *const FloatingTarget) }
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

            let controller = AutoFillFloatingController::default();
            controller.set_fallback(AccessibilityFallback::Unsupported);
            let signal = Arc::new(ObserverInvalidationSignal::new(controller, || {}));
            let _registration = AxObserverRegistration::new(target.process_id, Arc::clone(&signal))
                .expect("AX observer registration");
            let mut observed = false;
            for _ in 0..30 {
                CFRunLoop::run_in_mode(
                    unsafe { kCFRunLoopDefaultMode },
                    Duration::from_millis(100),
                    true,
                );
                if signal.take_dirty() {
                    observed = true;
                    break;
                }
            }
            assert!(observed, "move/resize/termination notification");
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
    fn observer_callback_synchronously_invalidates_visible_snapshot_before_scheduling_hide() {
        let controller = AutoFillFloatingController::default();
        controller.set_fallback(AccessibilityFallback::Unsupported);
        let target = crate::frontmost::test_frontmost_app("com.example.editor", 41, 7);
        let generation = controller.begin_refresh();
        assert!(controller.publish_visible(
            generation,
            target,
            AppKitFrame {
                x: 5.0,
                y: 6.0,
                width: PANEL_SIZE,
                height: PANEL_SIZE,
            },
        ));
        let hides = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let hides_for_signal = Arc::clone(&hides);
        let signal = ObserverInvalidationSignal::new(controller.clone(), move || {
            hides_for_signal.fetch_add(1, std::sync::atomic::Ordering::AcqRel);
        });

        signal.invalidate();

        assert!(controller.generation() > generation);
        assert_eq!(
            controller.status().observation,
            AccessibilityObservation::Hidden
        );
        assert!(!controller.has_visible_target_for_test());
        assert_eq!(hides.load(std::sync::atomic::Ordering::Acquire), 1);
        assert!(signal.take_dirty());
    }

    #[test]
    fn panel_click_atomically_consumes_only_the_exact_visible_generation_and_app_instance() {
        let controller = AutoFillFloatingController::default();
        controller.set_fallback(AccessibilityFallback::Unsupported);
        let target = crate::frontmost::test_frontmost_app("com.example.editor", 41, 7);
        let generation = controller.begin_refresh();
        assert!(controller.publish_visible(
            generation,
            target.clone(),
            AppKitFrame {
                x: 5.0,
                y: 6.0,
                width: PANEL_SIZE,
                height: PANEL_SIZE,
            },
        ));
        let context = FloatingClickContext {
            generation,
            target: target.clone(),
        };

        assert_eq!(controller.consume_visible_target(&context), Some(target));
        assert_eq!(controller.consume_visible_target(&context), None);
        assert_eq!(
            controller.status().observation,
            AccessibilityObservation::Hidden
        );

        let replacement = crate::frontmost::test_frontmost_app("com.example.editor", 41, 8);
        let next_generation = controller.begin_refresh();
        assert!(controller.publish_visible(
            next_generation,
            replacement,
            AppKitFrame {
                x: 5.0,
                y: 6.0,
                width: PANEL_SIZE,
                height: PANEL_SIZE,
            },
        ));
        assert_eq!(controller.consume_visible_target(&context), None);
        assert!(controller.has_visible_target_for_test());
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
    fn explicit_permission_prompt_is_process_lifetime_one_shot_and_skips_prompt_when_trusted() {
        let controller = AutoFillFloatingController::default();
        let denied = RecordingPermission::default();
        assert!(!request_accessibility_permission_once_with(
            &controller,
            &denied
        ));
        assert!(!request_accessibility_permission_once_with(
            &controller,
            &denied
        ));
        assert_eq!(denied.prompts(), 1);
        assert_eq!(
            controller.status(),
            AccessibilityStatus {
                permission: AccessibilityPermission::Denied,
                observation: AccessibilityObservation::Hidden,
                diagnostic: Some(AccessibilityDiagnostic {
                    reason: "permission-denied",
                    bundle_id: None,
                }),
            }
        );

        let trusted = TrustedRecordingPermission::default();
        let trusted_controller = AutoFillFloatingController::default();
        assert!(request_accessibility_permission_once_with(
            &trusted_controller,
            &trusted
        ));
        assert_eq!(trusted.prompts(), 0);
    }

    #[test]
    fn concurrent_explicit_permission_requests_never_prompt_twice() {
        let controller = AutoFillFloatingController::default();
        let permission = Arc::new(BlockingPermission::default());
        let first_controller = controller.clone();
        let first_permission = Arc::clone(&permission);
        let first = std::thread::spawn(move || {
            request_accessibility_permission_once_with(&first_controller, first_permission.as_ref())
        });
        permission.wait_until_prompting();

        let second_controller = controller.clone();
        let second_permission = Arc::clone(&permission);
        let second = std::thread::spawn(move || {
            request_accessibility_permission_once_with(
                &second_controller,
                second_permission.as_ref(),
            )
        });
        assert!(!second.join().expect("second request"));
        assert_eq!(permission.prompts(), 1);
        assert_eq!(
            controller.status().diagnostic,
            Some(AccessibilityDiagnostic {
                reason: "permission-denied",
                bundle_id: None,
            })
        );
        permission.release_prompt();
        assert!(!first.join().expect("first request"));
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
    fn runtime_diagnostics_redact_invalid_bundle_ids() {
        for invalid in [
            "com.example\nsecret",
            "com.example\u{0}secret",
            "com.example.编辑器",
            "com..example",
            ".com.example",
            "com.example-",
            &"a".repeat(256),
        ] {
            let controller = AutoFillFloatingController::default();
            controller.set_fallback(AccessibilityFallback::Unsupported);
            let generation = controller.begin_refresh();
            controller.publish_hidden(
                generation,
                AccessibilityPermission::Granted,
                "offscreen",
                Some(invalid.to_owned()),
            );
            assert_eq!(
                controller.status().diagnostic.unwrap().bundle_id,
                None,
                "invalid diagnostic bundle id: {invalid:?}",
            );
        }
    }

    #[test]
    fn copied_ax_values_reject_wrong_cf_or_ax_types_and_release_exactly_once() {
        use std::ffi::c_void;

        let value = 1usize as *const c_void;
        let releases = std::cell::Cell::new(0);
        assert_eq!(
            validate_copied_type_with(value, 7, |_| 9, |_| releases.set(releases.get() + 1),),
            None,
        );
        assert_eq!(releases.get(), 1);

        let releases = std::cell::Cell::new(0);
        assert_eq!(
            validate_ax_value_with(
                value,
                7,
                2,
                |_| 7,
                |_| 1,
                |_| releases.set(releases.get() + 1),
            ),
            None,
        );
        assert_eq!(releases.get(), 1);

        let releases = std::cell::Cell::new(0);
        assert_eq!(
            validate_ax_value_with(
                value,
                7,
                2,
                |_| 7,
                |_| 2,
                |_| releases.set(releases.get() + 1),
            ),
            Some(value),
        );
        assert_eq!(releases.get(), 0);
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

    #[test]
    fn observer_creation_and_every_required_notification_fail_closed_under_fault_injection() {
        assert!(!observer_creation_succeeded(1, true));
        assert!(!observer_creation_succeeded(0, false));
        assert!(observer_creation_succeeded(0, true));

        for failed_index in 0..observer_notification_plan().len() {
            let mut calls = 0;
            assert!(!install_required_notifications(|scope, notification| {
                assert_eq!((scope, notification), observer_notification_plan()[calls]);
                let succeeds = calls != failed_index;
                calls += 1;
                succeeds
            }));
            assert_eq!(calls, failed_index + 1);
        }
        let mut calls = 0;
        assert!(install_required_notifications(|scope, notification| {
            assert_eq!((scope, notification), observer_notification_plan()[calls]);
            calls += 1;
            true
        }));
        assert_eq!(calls, observer_notification_plan().len());
    }

    #[test]
    fn same_application_reuses_observer_across_rejected_focus_and_periodic_liveness_checks() {
        assert_eq!(
            observer_registration_decision(Some(41), 41),
            ObserverRegistrationDecision::Reuse
        );
        assert_eq!(
            observer_registration_decision(None, 41),
            ObserverRegistrationDecision::Create
        );
        assert_eq!(
            observer_registration_decision(Some(41), 42),
            ObserverRegistrationDecision::Replace
        );
        let mut observer_builds = 1;
        let mut ax_refreshes = 0;
        for _ in 0..100 {
            if observer_registration_decision(Some(41), 41) != ObserverRegistrationDecision::Reuse {
                observer_builds += 1;
            }
            if observer_work(false, true) == ObserverWork::Refresh {
                ax_refreshes += 1;
            }
        }
        assert_eq!(observer_builds, 1);
        assert_eq!(ax_refreshes, 0);
    }

    #[test]
    fn native_panel_uses_a_template_image_for_current_system_appearance() {
        let source = include_str!("autofill_floating.rs");
        assert_eq!(source.matches("image.setTemplate(true);").count(), 2);
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

    #[derive(Default)]
    struct TrustedRecordingPermission(std::sync::atomic::AtomicUsize);

    impl TrustedRecordingPermission {
        fn prompts(&self) -> usize {
            self.0.load(std::sync::atomic::Ordering::Acquire)
        }
    }

    impl AccessibilityPermissionPort for TrustedRecordingPermission {
        fn trusted(&self) -> bool {
            true
        }

        fn prompt(&self) -> bool {
            self.0.fetch_add(1, std::sync::atomic::Ordering::AcqRel);
            true
        }
    }

    #[derive(Default)]
    struct BlockingPermission {
        prompts: std::sync::atomic::AtomicUsize,
        entered: (std::sync::Mutex<bool>, std::sync::Condvar),
        release: (std::sync::Mutex<bool>, std::sync::Condvar),
    }

    impl BlockingPermission {
        fn prompts(&self) -> usize {
            self.prompts.load(std::sync::atomic::Ordering::Acquire)
        }

        fn wait_until_prompting(&self) {
            let (lock, ready) = &self.entered;
            let entered = lock.lock().unwrap();
            drop(ready.wait_while(entered, |entered| !*entered).unwrap());
        }

        fn release_prompt(&self) {
            let (lock, released) = &self.release;
            *lock.lock().unwrap() = true;
            released.notify_all();
        }
    }

    impl AccessibilityPermissionPort for BlockingPermission {
        fn trusted(&self) -> bool {
            false
        }

        fn prompt(&self) -> bool {
            self.prompts
                .fetch_add(1, std::sync::atomic::Ordering::AcqRel);
            let (entered_lock, entered_ready) = &self.entered;
            *entered_lock.lock().unwrap() = true;
            entered_ready.notify_all();
            let (release_lock, released) = &self.release;
            let release = release_lock.lock().unwrap();
            drop(released.wait_while(release, |released| !*released).unwrap());
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

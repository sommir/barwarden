use crate::accessibility_focus::{validate_copied_type_with, AxFrame};
use serde::{Deserialize, Serialize};
use std::ffi::c_void;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::Manager;

const PILL_WIDTH: f64 = 34.0;
const PILL_HEIGHT: f64 = 30.0;
const PILL_GAP: f64 = 8.0;
const PILL_RADIUS: f64 = 9.0;
const PILL_SIZE: (f64, f64) = (PILL_WIDTH, PILL_HEIGHT);
const PILL_BUTTON_FRAME: (f64, f64, f64, f64) = (0.0, 0.0, PILL_WIDTH, PILL_HEIGHT);
const PILL_BADGE_FRAME: (f64, f64, f64, f64) = (21.0, 1.0, 11.0, 11.0);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ObserverScope {
    Application,
    FocusedElement,
    Window,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ObserverNotification {
    FocusedElementChanged,
    LayoutChanged,
    Moved,
    Resized,
    Destroyed,
}

const fn observer_notification_plan() -> [(ObserverScope, ObserverNotification); 8] {
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
        (ObserverScope::Window, ObserverNotification::LayoutChanged),
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
    pub has_material_background: bool,
    pub has_contrast_border: bool,
    pub has_restrained_shadow: bool,
    pub has_non_template_blue_glyph: bool,
    pub fixed_entry_event: &'static str,
}

#[cfg(test)]
pub const PANEL_CONTRACT: PanelContract = PanelContract {
    borderless: true,
    nonactivating: true,
    can_become_key: false,
    can_become_main: false,
    has_material_background: true,
    has_contrast_border: true,
    has_restrained_shadow: true,
    has_non_template_blue_glyph: true,
    fixed_entry_event: "autofill-floating",
};

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
struct AppearancePreferences {
    reduce_motion: bool,
    reduce_transparency: bool,
    increase_contrast: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct PillAppearance {
    uses_material_background: bool,
    uses_opaque_background: bool,
    uses_contrast_border: bool,
    uses_high_contrast_border: bool,
    interpolates_position: bool,
}

fn pill_appearance(preferences: AppearancePreferences) -> PillAppearance {
    PillAppearance {
        uses_material_background: !preferences.reduce_transparency,
        uses_opaque_background: preferences.reduce_transparency,
        uses_contrast_border: true,
        uses_high_contrast_border: preferences.increase_contrast,
        interpolates_position: !preferences.reduce_motion,
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum PillBadge {
    Person,
    Lock,
    Clock,
    Form,
    Unknown,
}

fn pill_badge(presentation: &crate::autofill_ax_context::FillContextPresentation) -> PillBadge {
    use crate::autofill_ax_context::{PresentedActionMode, PresentedFieldKind};

    if presentation.action.mode == PresentedActionMode::Form {
        return PillBadge::Form;
    }
    match presentation.focused_field.kind {
        PresentedFieldKind::Username | PresentedFieldKind::Email => PillBadge::Person,
        PresentedFieldKind::Password => PillBadge::Lock,
        PresentedFieldKind::OneTimeCode => PillBadge::Clock,
        PresentedFieldKind::Unknown => PillBadge::Unknown,
    }
}

fn visual_presentation(
    detected: &crate::autofill_ax_context::CapturedAxContext,
) -> crate::autofill_ax_context::FillContextPresentation {
    use crate::autofill_ax_context::{
        FillContextPresentation, PresentedAction, PresentedActionMode, PresentedField,
        PresentedFieldConfidence, PresentedFieldKind,
    };
    use crate::autofill_field_context::DetectedAction;

    let focused_field = detected.fields.iter().find(|field| field.focused).map_or(
        PresentedField {
            kind: PresentedFieldKind::Unknown,
            confidence: PresentedFieldConfidence::Low,
        },
        |field| PresentedField {
            kind: field.kind.into(),
            confidence: field.confidence.into(),
        },
    );
    let action = match &detected.action {
        DetectedAction::Field { field } => PresentedAction {
            mode: PresentedActionMode::Field,
            fields: vec![*field],
        },
        DetectedAction::Form { fields } => PresentedAction {
            mode: PresentedActionMode::Form,
            fields: fields.clone(),
        },
        DetectedAction::Choose => PresentedAction {
            mode: PresentedActionMode::Choose,
            fields: Vec::new(),
        },
    };
    FillContextPresentation {
        fill_context_token: String::new(),
        focused_field,
        action,
    }
}

pub fn ax_to_appkit(frame: AxFrame, primary_max_y: f64) -> AppKitFrame {
    AppKitFrame {
        x: frame.x,
        y: primary_max_y - frame.y - frame.height,
        width: frame.width,
        height: frame.height,
    }
}

fn pill_x(
    anchor: AppKitFrame,
    work_area: AppKitFrame,
    accepts_collapsed_width: bool,
) -> Option<f64> {
    if ![
        anchor.x,
        anchor.y,
        anchor.width,
        anchor.height,
        work_area.x,
        work_area.y,
        work_area.width,
        work_area.height,
    ]
    .into_iter()
    .all(f64::is_finite)
        || anchor.width < 0.0
        || (!accepts_collapsed_width && anchor.width == 0.0)
        || anchor.height <= 0.0
        || work_area.width < PILL_WIDTH
        || work_area.height < PILL_HEIGHT
    {
        return None;
    }
    Some(
        (anchor.x + (anchor.width - PILL_WIDTH) / 2.0)
            .clamp(work_area.x, work_area.x + work_area.width - PILL_WIDTH),
    )
}

fn place_above(
    anchor: AppKitFrame,
    work_area: AppKitFrame,
    accepts_collapsed_width: bool,
) -> Option<AppKitFrame> {
    let candidate = AppKitFrame {
        x: pill_x(anchor, work_area, accepts_collapsed_width)?,
        y: anchor.y + anchor.height + PILL_GAP,
        width: PILL_WIDTH,
        height: PILL_HEIGHT,
    };
    work_area.contains(candidate).then_some(candidate)
}

fn place_below(anchor: AppKitFrame, work_area: AppKitFrame) -> Option<AppKitFrame> {
    let candidate = AppKitFrame {
        x: pill_x(anchor, work_area, false)?,
        y: anchor.y - PILL_GAP - PILL_HEIGHT,
        width: PILL_WIDTH,
        height: PILL_HEIGHT,
    };
    work_area.contains(candidate).then_some(candidate)
}

pub fn place_pill(
    caret: Option<AppKitFrame>,
    field: AppKitFrame,
    work_area: AppKitFrame,
) -> Option<AppKitFrame> {
    caret
        .and_then(|caret| place_above(caret, work_area, true))
        .or_else(|| place_above(field, work_area, false))
        .or_else(|| place_below(field, work_area))
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
    detected: Option<crate::autofill_ax_context::CapturedAxContext>,
}

struct ConsumedVisibleTarget {
    target: crate::frontmost::FrontmostApp,
    detected: Option<crate::autofill_ax_context::CapturedAxContext>,
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

#[derive(Clone)]
pub struct AutoFillFloatingController {
    state: Arc<Mutex<ControllerState>>,
    observer_generation: crate::autofill_ax_context::ObserverGeneration,
}

impl Default for AutoFillFloatingController {
    fn default() -> Self {
        Self::with_observer_generation(crate::autofill_ax_context::ObserverGeneration::default())
    }
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
    pub(crate) fn with_observer_generation(
        observer_generation: crate::autofill_ax_context::ObserverGeneration,
    ) -> Self {
        Self {
            state: Arc::new(Mutex::new(ControllerState::default())),
            observer_generation,
        }
    }

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
        let generation = state.lifecycle.invalidate();
        self.observer_generation.set(generation);
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
        self.observer_generation.set(generation);
        state.visible_target = None;
        state.observation = AccessibilityObservation::Hidden;
        state.diagnostic = None;
        generation
    }

    #[cfg(test)]
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
        state.visible_target = Some(VisibleTarget {
            generation,
            target,
            detected: None,
        });
        state.diagnostic = None;
        true
    }

    fn publish_visible_with_context(
        &self,
        generation: u64,
        target: crate::frontmost::FrontmostApp,
        frame: AppKitFrame,
        detected: crate::autofill_ax_context::CapturedAxContext,
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
        state.visible_target = Some(VisibleTarget {
            generation,
            target,
            detected: Some(detected),
        });
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

    fn consume_visible(&self, context: &FloatingClickContext) -> Option<ConsumedVisibleTarget> {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let mut target = state.visible_target.as_ref().and_then(|visible| {
            (state.observation == AccessibilityObservation::Visible
                && state.lifecycle.generation == context.generation
                && visible.generation == context.generation
                && visible.target == context.target)
                .then(|| ConsumedVisibleTarget {
                    target: visible.target.clone(),
                    detected: visible.detected.clone(),
                })
        })?;
        let generation = state.lifecycle.invalidate();
        self.observer_generation.set(generation);
        if let Some(detected) = target.detected.as_mut() {
            for field in &mut detected.fields {
                field.observer_generation = generation;
            }
        }
        state.visible_target = None;
        state.observation = AccessibilityObservation::Hidden;
        state.diagnostic = None;
        Some(target)
    }

    #[cfg(test)]
    fn consume_visible_target(
        &self,
        context: &FloatingClickContext,
    ) -> Option<crate::frontmost::FrontmostApp> {
        self.consume_visible(context).map(|visible| visible.target)
    }

    fn observer_invalidated(&self) {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let generation = state.lifecycle.invalidate();
        self.observer_generation.set(generation);
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
            let generation = state.lifecycle.invalidate();
            self.observer_generation.set(generation);
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
        let generation = state.lifecycle.invalidate();
        self.observer_generation.set(generation);
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
        let generation = state.lifecycle.invalidate();
        self.observer_generation.set(generation);
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
        self.observer_generation.set(generation);
        state.lifecycle.accept(
            generation,
            AppKitFrame {
                x: 0.0,
                y: 0.0,
                width: PILL_WIDTH,
                height: PILL_HEIGHT,
            },
        );
        state.permission = AccessibilityPermission::Granted;
        state.observation = AccessibilityObservation::Visible;
        state.visible_target = Some(VisibleTarget {
            generation,
            target: crate::frontmost::test_frontmost_app(bundle_id, 42, generation),
            detected: None,
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
    use crate::accessibility_focus::FocusRejectReason;
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
    use objc2::rc::{Allocated, Retained};
    use objc2::runtime::{AnyClass, AnyObject, NSObjectProtocol};
    use objc2::{define_class, msg_send, sel, AnyThread, DefinedClass, MainThreadOnly};
    use objc2_app_kit::{
        NSBackingStoreType, NSButton, NSColor, NSImage, NSImageScaling, NSPanel, NSScreen,
        NSStatusWindowLevel, NSView, NSWindowCollectionBehavior, NSWindowStyleMask, NSWorkspace,
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
    type AXObserverRef = *const c_void;
    type CFTypeRef = *const c_void;
    type CFDictionaryRef = *const c_void;
    type AXError = i32;
    const AX_ERROR_SUCCESS: AXError = 0;
    const PANEL_ICON: &[u8] = include_bytes!("../icons/autofill-pill@2x.png");
    // objc2-app-kit gates NSVisualEffectView behind a feature that this target does not enable.
    // These are the stable AppKit enum values used by the dynamic messages below.
    const NS_VISUAL_EFFECT_MATERIAL_POPOVER: isize = 6;
    const NS_VISUAL_EFFECT_BLEND_BEHIND_WINDOW: isize = 0;
    const NS_VISUAL_EFFECT_STATE_ACTIVE: isize = 1;
    const NS_EVENT_MASK_SCROLL_WHEEL: usize = 1usize << 22;

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
                let Some(visible) = controller.consume_visible(&context) else {
                    hide_panel();
                    return;
                };
                let target = visible.target;
                hide_panel();
                let still_exact_frontmost = frontmost::target_is_running(&target)
                    && frontmost::current_frontmost_app()
                        .ok()
                        .flatten()
                        .is_some_and(|current| current == target);
                if !still_exact_frontmost {
                    return;
                }
                let Some(detected) = visible.detected else {
                    return;
                };
                let Some(contexts) = app.try_state::<
                    crate::autofill_ax_context::DetectedFillContextStore,
                >() else {
                    return;
                };
                let Ok(presentation) = contexts.try_insert(
                    target.clone(),
                    detected.fields,
                    detected.action,
                ) else {
                    return;
                };
                frontmost::replace_target_app_with_context(target.clone(), presentation);
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

    define_class!(
        #[unsafe(super = NSButton)]
        #[thread_kind = MainThreadOnly]
        struct FloatingBadge;

        unsafe impl NSObjectProtocol for FloatingBadge {}

        impl FloatingBadge {
            #[unsafe(method(hitTest:))]
            fn hit_test(&self, _point: NSPoint) -> *mut AnyObject {
                ptr::null_mut()
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
    static PANEL_ROOT: OnceLock<usize> = OnceLock::new();
    static MATERIAL_BACKGROUND: OnceLock<usize> = OnceLock::new();
    static BADGE_BUTTON: OnceLock<usize> = OnceLock::new();
    static WORKSPACE_TOKENS: OnceLock<(usize, usize)> = OnceLock::new();
    static SCROLL_MONITOR: OnceLock<usize> = OnceLock::new();

    struct PillContent {
        root: Retained<NSView>,
        material: Retained<AnyObject>,
        button: Retained<NSButton>,
        badge: Retained<FloatingBadge>,
    }

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
        SCROLL_MONITOR.get_or_init(|| {
            let event_class = AnyClass::get(c"NSEvent").expect("NSEvent is available on macOS");
            let scroll_signal = Arc::clone(&signal);
            // The monitor observes only the fact that a scroll occurred. It never reads,
            // stores, or forwards event contents, and installation stays on AppKit's main
            // thread. This covers ancestor scrolling even when AX emits no element move.
            let handler = RcBlock::new(move |_event: NonNull<AnyObject>| {
                scroll_signal.invalidate();
            });
            let token: *mut AnyObject = unsafe {
                msg_send![
                    event_class,
                    addGlobalMonitorForEventsMatchingMask: NS_EVENT_MASK_SCROLL_WHEEL,
                    handler: &*handler
                ]
            };
            unsafe { Retained::retain(token) }
                .map(|token| Retained::into_raw(token) as usize)
                .unwrap_or_default()
        });
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
            let result =
                crate::autofill_ax_context::capture_native_fill_context(&target, generation);
            if signal.is_dirty() || controller.generation() != generation {
                continue;
            }
            match result {
                Ok(detected) => {
                    schedule_panel_show(&app, &controller, generation, detected, target)
                }
                Err(error) => {
                    let reason = match error {
                        crate::autofill_ax_context::AxContextError::Focus(reason) => reason.code(),
                        crate::autofill_ax_context::AxContextError::OversizedMetadata => {
                            "invalid-metadata"
                        }
                        crate::autofill_ax_context::AxContextError::TimeBudgetExceeded => {
                            "observation-timeout"
                        }
                        crate::autofill_ax_context::AxContextError::MissingWindow => "stale-window",
                        crate::autofill_ax_context::AxContextError::NoWritableField => {
                            "not-editable"
                        }
                    };
                    controller.publish_hidden(
                        generation,
                        AccessibilityPermission::Granted,
                        reason,
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
            ObserverNotification::LayoutChanged => CFString::from_static_string("AXLayoutChanged"),
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

    fn schedule_panel_show(
        app: &tauri::AppHandle,
        controller: &AutoFillFloatingController,
        generation: u64,
        detected: crate::autofill_ax_context::CapturedAxContext,
        target: frontmost::FrontmostApp,
    ) {
        let app_for_panel = app.clone();
        let controller = controller.clone();
        let primary_max_y = CGDisplay::main().bounds().size.height;
        let field = ax_to_appkit(detected.focused.frame, primary_max_y);
        let caret = detected
            .caret_frame
            .map(|frame| ax_to_appkit(frame, primary_max_y));
        let badge = pill_badge(&visual_presentation(&detected));
        let bundle_id = detected.focused.app.bundle_id.clone();
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
            let Some(panel_frame) = place_pill(caret, field, work_area) else {
                controller.publish_hidden(
                    generation,
                    AccessibilityPermission::Granted,
                    "unreliable-geometry",
                    Some(bundle_id),
                );
                hide_panel();
                return;
            };
            if controller.publish_visible_with_context(
                generation,
                target.clone(),
                panel_frame,
                detected,
            ) {
                show_panel(
                    &app_for_panel,
                    panel_frame,
                    FloatingClickContext { generation, target },
                    badge,
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
        badge: PillBadge,
        mtm: MainThreadMarker,
    ) {
        let panel = panel(app, mtm);
        panel_target().set_context(context);
        update_badge(badge, mtm);
        let appearance = pill_appearance(current_appearance_preferences());
        update_panel_appearance(appearance);
        let frame = NSRect::new(
            NSPoint::new(frame.x, frame.y),
            NSSize::new(frame.width, frame.height),
        );
        if appearance.interpolates_position && panel.isVisible() {
            let animator: Retained<AnyObject> = unsafe { msg_send![panel, animator] };
            let _: () = unsafe { msg_send![&*animator, setFrame: frame, display: true] };
        } else {
            panel.setFrame_display(frame, true);
        }
        panel.orderFrontRegardless();
    }

    fn current_appearance_preferences() -> AppearancePreferences {
        let workspace = NSWorkspace::sharedWorkspace();
        AppearancePreferences {
            reduce_motion: unsafe {
                msg_send![&*workspace, accessibilityDisplayShouldReduceMotion]
            },
            reduce_transparency: unsafe {
                msg_send![&*workspace, accessibilityDisplayShouldReduceTransparency]
            },
            increase_contrast: unsafe {
                msg_send![&*workspace, accessibilityDisplayShouldIncreaseContrast]
            },
        }
    }

    fn badge_image(badge: PillBadge) -> Option<Retained<NSImage>> {
        let (symbol, description) = match badge {
            PillBadge::Person => ("person.fill", "Username or email field"),
            PillBadge::Lock => ("lock.fill", "Password field"),
            PillBadge::Clock => ("clock.fill", "One-time code field"),
            PillBadge::Form => ("list.bullet.rectangle.fill", "Fill form"),
            PillBadge::Unknown => ("questionmark", "Fill field"),
        };
        let image = NSImage::imageWithSystemSymbolName_accessibilityDescription(
            &NSString::from_str(symbol),
            Some(&NSString::from_str(description)),
        )?;
        image.setTemplate(true);
        image.setSize(NSSize::new(9.0, 9.0));
        Some(image)
    }

    fn apply_badge(button: &NSButton, badge: PillBadge) {
        if let Some(image) = badge_image(badge) {
            button.setImage(Some(&image));
        }
    }

    fn update_badge(badge: PillBadge, _mtm: MainThreadMarker) {
        let Some(address) = BADGE_BUTTON.get() else {
            return;
        };
        let button = unsafe { &*(*address as *const NSButton) };
        apply_badge(button, badge);
    }

    fn apply_panel_appearance(
        root: &NSView,
        material: &NSView,
        badge: &NSButton,
        appearance: PillAppearance,
    ) {
        material.setHidden(!appearance.uses_material_background);
        let effective_appearance: *mut AnyObject = unsafe { msg_send![root, effectiveAppearance] };
        let apply_dynamic_colors = RcBlock::new(|| {
            let layer = root.layer().expect("floating pill root keeps its layer");
            let background = if appearance.uses_opaque_background {
                NSColor::windowBackgroundColor()
            } else {
                NSColor::clearColor()
            };
            let background_cg: *const c_void = unsafe { msg_send![&*background, CGColor] };
            let _: () = unsafe { msg_send![&*layer, setBackgroundColor: background_cg] };

            let border = if appearance.uses_high_contrast_border {
                NSColor::labelColor()
            } else {
                NSColor::separatorColor()
            };
            let border_cg: *const c_void = unsafe { msg_send![&*border, CGColor] };
            let _: () = unsafe { msg_send![&*layer, setBorderColor: border_cg] };
            layer.setBorderWidth(if appearance.uses_contrast_border {
                1.0
            } else {
                0.0
            });
            let badge_tint = if appearance.uses_high_contrast_border {
                NSColor::labelColor()
            } else {
                NSColor::secondaryLabelColor()
            };
            badge.setContentTintColor(Some(&badge_tint));
        });
        let _: () = unsafe {
            msg_send![effective_appearance, performAsCurrentDrawingAppearance: &*apply_dynamic_colors]
        };
    }

    fn update_panel_appearance(appearance: PillAppearance) {
        let (Some(root_address), Some(material_address), Some(badge_address)) = (
            PANEL_ROOT.get(),
            MATERIAL_BACKGROUND.get(),
            BADGE_BUTTON.get(),
        ) else {
            return;
        };
        let root = unsafe { &*(*root_address as *const NSView) };
        let material = unsafe { &*(*material_address as *const NSView) };
        let badge = unsafe { &*(*badge_address as *const NSButton) };
        apply_panel_appearance(root, material, badge, appearance);
    }

    fn build_pill_content(
        target: Option<&AnyObject>,
        badge: PillBadge,
        appearance: PillAppearance,
        mtm: MainThreadMarker,
    ) -> PillContent {
        let data =
            unsafe { NSData::dataWithBytes_length(PANEL_ICON.as_ptr().cast(), PANEL_ICON.len()) };
        let image =
            NSImage::initWithData(NSImage::alloc(), &data).expect("floating icon asset is valid");
        image.setTemplate(false);
        image.setSize(NSSize::new(18.0, 18.0));
        let button = unsafe {
            NSButton::buttonWithImage_target_action(
                &image,
                target,
                target.map(|_| sel!(openAutoFill:)),
                mtm,
            )
        };
        button.setBordered(false);
        button.setImageScaling(NSImageScaling::ScaleProportionallyDown);
        button.setFrame(NSRect::new(
            NSPoint::new(PILL_BUTTON_FRAME.0, PILL_BUTTON_FRAME.1),
            NSSize::new(PILL_BUTTON_FRAME.2, PILL_BUTTON_FRAME.3),
        ));
        button.setToolTip(Some(&NSString::from_str("Open Barwarden AutoFill")));

        let bounds = NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(PILL_WIDTH, PILL_HEIGHT));
        let root = NSView::initWithFrame(NSView::alloc(mtm), bounds);
        root.setWantsLayer(true);
        let root_layer = root.layer().expect("floating pill root has a layer");
        root_layer.setCornerRadius(PILL_RADIUS);
        root_layer.setMasksToBounds(true);
        root_layer.setBorderWidth(1.0);

        let material_class = AnyClass::get(c"NSVisualEffectView")
            .expect("NSVisualEffectView is available on supported macOS");
        let material_allocated: Allocated<AnyObject> = unsafe { msg_send![material_class, alloc] };
        let material: Retained<AnyObject> =
            unsafe { msg_send![material_allocated, initWithFrame: bounds] };
        let _: () =
            unsafe { msg_send![&*material, setMaterial: NS_VISUAL_EFFECT_MATERIAL_POPOVER] };
        let _: () =
            unsafe { msg_send![&*material, setBlendingMode: NS_VISUAL_EFFECT_BLEND_BEHIND_WINDOW] };
        let _: () = unsafe { msg_send![&*material, setState: NS_VISUAL_EFFECT_STATE_ACTIVE] };
        let material_view = unsafe { &*((&*material as *const AnyObject).cast::<NSView>()) };
        root.addSubview(material_view);
        root.addSubview(&button);

        let badge_button: Retained<FloatingBadge> = unsafe {
            msg_send![
                FloatingBadge::alloc(mtm),
                initWithFrame: NSRect::new(
                    NSPoint::new(PILL_BADGE_FRAME.0, PILL_BADGE_FRAME.1),
                    NSSize::new(PILL_BADGE_FRAME.2, PILL_BADGE_FRAME.3)
                )
            ]
        };
        badge_button.setBordered(false);
        badge_button.setRefusesFirstResponder(true);
        badge_button.setImageScaling(NSImageScaling::ScaleProportionallyDown);
        root.addSubview(&badge_button);
        apply_badge(&badge_button, badge);
        apply_panel_appearance(&root, material_view, &badge_button, appearance);

        PillContent {
            root,
            material,
            button,
            badge: badge_button,
        }
    }

    fn panel(app: &tauri::AppHandle, mtm: MainThreadMarker) -> &'static NSPanel {
        let address = *PANEL.get_or_init(|| {
            let target = FloatingTarget::new(app.clone(), mtm);
            let content = build_pill_content(
                Some(&target),
                PillBadge::Unknown,
                pill_appearance(current_appearance_preferences()),
                mtm,
            );

            let panel: Retained<FloatingPanel> = unsafe {
                msg_send![
                    FloatingPanel::alloc(mtm),
                    initWithContentRect: NSRect::new(
                        NSPoint::new(0.0, 0.0),
                        NSSize::new(PILL_SIZE.0, PILL_SIZE.1)
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
            panel.setContentView(Some(&content.root));
            let _ = PANEL_ROOT.set((&*content.root as *const NSView) as usize);
            let _ = MATERIAL_BACKGROUND.set((&*content.material as *const AnyObject) as usize);
            let _ = BADGE_BUTTON
                .set((&*content.badge as *const FloatingBadge).cast::<NSButton>() as usize);
            debug_assert_eq!(
                content.button.frame().size,
                NSSize::new(PILL_WIDTH, PILL_HEIGHT)
            );
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

    #[cfg(debug_assertions)]
    fn set_fixture_appearance(view: &NSView, name: &str) -> Result<(), String> {
        let appearance_class = AnyClass::get(c"NSAppearance")
            .ok_or_else(|| "NSAppearance is unavailable".to_owned())?;
        let name = NSString::from_str(name);
        let appearance: *mut AnyObject =
            unsafe { msg_send![appearance_class, appearanceNamed: &*name] };
        if appearance.is_null() {
            return Err("requested fixture appearance is unavailable".to_owned());
        }
        let _: () = unsafe { msg_send![view, setAppearance: appearance] };
        Ok(())
    }

    #[cfg(debug_assertions)]
    fn set_fixture_application_appearance(
        application: *mut AnyObject,
        name: &str,
    ) -> Result<(), String> {
        let appearance_class = AnyClass::get(c"NSAppearance")
            .ok_or_else(|| "NSAppearance is unavailable".to_owned())?;
        let name = NSString::from_str(name);
        let appearance: *mut AnyObject =
            unsafe { msg_send![appearance_class, appearanceNamed: &*name] };
        if appearance.is_null() {
            return Err("requested fixture appearance is unavailable".to_owned());
        }
        let _: () = unsafe { msg_send![application, setAppearance: appearance] };
        Ok(())
    }

    #[cfg(debug_assertions)]
    fn write_fixture_png(
        view: &NSView,
        output_path: &std::path::Path,
        scale: usize,
    ) -> Result<(), String> {
        let bitmap_class = AnyClass::get(c"NSBitmapImageRep")
            .ok_or_else(|| "NSBitmapImageRep is unavailable".to_owned())?;
        let allocated: Allocated<AnyObject> = unsafe { msg_send![bitmap_class, alloc] };
        let color_space = NSString::from_str("NSDeviceRGBColorSpace");
        let planes: *mut *mut u8 = ptr::null_mut();
        let bitmap: Retained<AnyObject> = unsafe {
            msg_send![
                allocated,
                initWithBitmapDataPlanes: planes,
                pixelsWide: PILL_WIDTH as usize * scale,
                pixelsHigh: PILL_HEIGHT as usize * scale,
                bitsPerSample: 8usize,
                samplesPerPixel: 4usize,
                hasAlpha: true,
                isPlanar: false,
                colorSpaceName: &*color_space,
                bytesPerRow: 0usize,
                bitsPerPixel: 0usize
            ]
        };
        let _: () = unsafe { msg_send![&*bitmap, setSize: NSSize::new(PILL_WIDTH, PILL_HEIGHT)] };
        let _: () = unsafe {
            msg_send![view, cacheDisplayInRect: view.bounds(), toBitmapImageRep: &*bitmap]
        };
        let dictionary_class = AnyClass::get(c"NSDictionary")
            .ok_or_else(|| "NSDictionary is unavailable".to_owned())?;
        let properties: *mut AnyObject = unsafe { msg_send![dictionary_class, dictionary] };
        // NSBitmapImageFileTypePNG has the stable AppKit enum value 4.
        let png: *mut NSData =
            unsafe { msg_send![&*bitmap, representationUsingType: 4usize, properties: properties] };
        let png = unsafe { png.as_ref() }
            .ok_or_else(|| "AppKit could not encode the pill fixture as PNG".to_owned())?;
        let output_path = output_path
            .to_str()
            .ok_or_else(|| "fixture output path is not valid UTF-8".to_owned())?;
        if !png.writeToFile_atomically(&NSString::from_str(output_path), true) {
            return Err(format!("could not write {output_path}"));
        }
        Ok(())
    }

    #[cfg(debug_assertions)]
    pub(super) fn render_pill_fixture(output_dir: &std::path::Path) -> Result<(), String> {
        let mtm = MainThreadMarker::new()
            .ok_or_else(|| "native pill fixture renderer must run on the main thread".to_owned())?;
        let application_class = AnyClass::get(c"NSApplication")
            .ok_or_else(|| "NSApplication is unavailable".to_owned())?;
        let application: *mut AnyObject =
            unsafe { msg_send![application_class, sharedApplication] };
        std::fs::create_dir_all(output_dir).map_err(|error| error.to_string())?;

        for (variant, appearance_name) in [
            ("light", "NSAppearanceNameAqua"),
            ("dark", "NSAppearanceNameDarkAqua"),
        ] {
            set_fixture_application_appearance(application, appearance_name)?;
            let appearance = pill_appearance(AppearancePreferences {
                reduce_motion: true,
                reduce_transparency: true,
                increase_contrast: false,
            });
            let content = build_pill_content(None, PillBadge::Lock, appearance, mtm);
            set_fixture_appearance(&content.root, appearance_name)?;
            let material_view =
                unsafe { &*((&*content.material as *const AnyObject).cast::<NSView>()) };
            apply_panel_appearance(&content.root, material_view, &content.badge, appearance);
            content.root.layoutSubtreeIfNeeded();
            content.root.displayIfNeededIgnoringOpacity();

            let badge_center = NSPoint::new(
                PILL_BADGE_FRAME.0 + PILL_BADGE_FRAME.2 / 2.0,
                PILL_BADGE_FRAME.1 + PILL_BADGE_FRAME.3 / 2.0,
            );
            let hit = content
                .root
                .hitTest(badge_center)
                .ok_or_else(|| "badge-center hit test unexpectedly missed the pill".to_owned())?;
            let hit_address = (&*hit as *const NSView) as usize;
            let button_address = (&*content.button as *const NSButton).cast::<NSView>() as usize;
            if hit_address != button_address {
                return Err(
                    "badge must pass pointer events through to the full-pill button".to_owned(),
                );
            }

            for scale in [1usize, 2usize] {
                write_fixture_png(
                    &content.root,
                    &output_dir.join(format!("autofill-pill-{variant}-{scale}x.png")),
                    scale,
                )?;
            }
            println!(
                "rendered {variant} production opaque-fallback pill: 34x30pt at 1x/2x; badge-center hit=full-pill-button"
            );
        }
        Ok(())
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
            let snapshot = crate::autofill_ax_context::capture_native_fill_context(&target, 1)
                .expect("reliable focused field snapshot");
            assert!(snapshot.focused.reliable);
            assert!(snapshot.focused.secure);

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

#[cfg(all(target_os = "macos", debug_assertions))]
pub(crate) fn render_native_pill_fixture(output_dir: &std::path::Path) -> Result<(), String> {
    macos::render_pill_fixture(output_dir)
}

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
    fn prefers_field_above_and_centers_the_pill_on_the_anchor() {
        let field = AppKitFrame {
            x: 100.0,
            y: 400.0,
            width: 300.0,
            height: 28.0,
        };
        assert_eq!(
            place_pill(None, field, work_area()),
            Some(AppKitFrame {
                x: 233.0,
                y: 436.0,
                width: 34.0,
                height: 30.0,
            })
        );
    }

    #[test]
    fn prefers_caret_above_before_field_above() {
        let caret = AppKitFrame {
            x: 246.0,
            y: 415.0,
            width: 0.0,
            height: 16.0,
        };
        let field = AppKitFrame {
            x: 100.0,
            y: 400.0,
            width: 300.0,
            height: 28.0,
        };
        assert_eq!(
            place_pill(Some(caret), field, work_area()),
            Some(AppKitFrame {
                x: 229.0,
                y: 439.0,
                width: 34.0,
                height: 30.0,
            })
        );
    }

    #[test]
    fn field_above_precedes_below_when_caret_above_is_not_safe() {
        let caret = AppKitFrame {
            x: 245.0,
            y: 870.0,
            width: 2.0,
            height: 20.0,
        };
        let field = AppKitFrame {
            x: 100.0,
            y: 800.0,
            width: 300.0,
            height: 30.0,
        };
        assert_eq!(
            place_pill(Some(caret), field, work_area()),
            Some(AppKitFrame {
                x: 233.0,
                y: 838.0,
                width: 34.0,
                height: 30.0,
            })
        );
    }

    #[test]
    fn flips_below_when_above_is_not_safe() {
        let field = AppKitFrame {
            x: 100.0,
            y: 880.0,
            width: 300.0,
            height: 20.0,
        };
        assert_eq!(
            place_pill(None, field, work_area()),
            Some(AppKitFrame {
                x: 233.0,
                y: 842.0,
                width: 34.0,
                height: 30.0,
            })
        );
    }

    #[test]
    fn clamps_horizontally_after_screen_selection_and_hides_without_vertical_space() {
        let clamped = place_pill(
            None,
            AppKitFrame {
                x: -1450.0,
                y: 400.0,
                width: 40.0,
                height: 20.0,
            },
            AppKitFrame {
                x: -1440.0,
                y: 0.0,
                width: 1440.0,
                height: 900.0,
            },
        )
        .expect("clamped on selected display");
        assert_eq!(
            clamped,
            AppKitFrame {
                x: -1440.0,
                y: 428.0,
                width: 34.0,
                height: 30.0,
            }
        );

        let no_space = place_pill(
            None,
            AppKitFrame {
                x: 100.0,
                y: 125.0,
                width: 200.0,
                height: 10.0,
            },
            AppKitFrame {
                x: 0.0,
                y: 100.0,
                width: 500.0,
                height: 60.0,
            },
        );
        assert_eq!(no_space, None);
    }

    #[test]
    fn pill_contract_is_visible_and_never_activating() {
        assert_eq!(PILL_SIZE, (34.0, 30.0));
        assert_eq!(PILL_RADIUS, 9.0);
        assert_eq!(
            PANEL_CONTRACT,
            PanelContract {
                borderless: true,
                nonactivating: true,
                can_become_key: false,
                can_become_main: false,
                has_material_background: true,
                has_contrast_border: true,
                has_restrained_shadow: true,
                has_non_template_blue_glyph: true,
                fixed_entry_event: "autofill-floating",
            },
        );
    }

    #[test]
    fn pill_content_layout_keeps_one_full_hit_target_under_the_badge() {
        assert_eq!(PILL_BUTTON_FRAME, (0.0, 0.0, 34.0, 30.0));
        let (badge_x, badge_y, badge_width, badge_height) = PILL_BADGE_FRAME;
        assert!(badge_x >= 0.0 && badge_y >= 0.0);
        assert!(badge_x + badge_width <= PILL_WIDTH);
        assert!(badge_y + badge_height <= PILL_HEIGHT);
        // The production FloatingBadge returns nil from hitTest:, leaving this
        // full-size button as the only actionable surface.
        assert_eq!(PILL_BUTTON_FRAME.2 * PILL_BUTTON_FRAME.3, 1020.0);
    }

    #[test]
    fn accessibility_preferences_preserve_legibility_and_disable_motion() {
        assert_eq!(
            pill_appearance(AppearancePreferences::default()),
            PillAppearance {
                uses_material_background: true,
                uses_opaque_background: false,
                uses_contrast_border: true,
                uses_high_contrast_border: false,
                interpolates_position: true,
            }
        );
        assert!(
            !pill_appearance(AppearancePreferences {
                reduce_motion: true,
                ..AppearancePreferences::default()
            })
            .interpolates_position
        );
        let opaque = pill_appearance(AppearancePreferences {
            reduce_transparency: true,
            ..AppearancePreferences::default()
        });
        assert!(!opaque.uses_material_background);
        assert!(opaque.uses_opaque_background);
        assert!(
            pill_appearance(AppearancePreferences {
                increase_contrast: true,
                ..AppearancePreferences::default()
            })
            .uses_high_contrast_border
        );
        assert_eq!(
            pill_appearance(AppearancePreferences {
                reduce_motion: true,
                reduce_transparency: true,
                increase_contrast: true,
            }),
            PillAppearance {
                uses_material_background: false,
                uses_opaque_background: true,
                uses_contrast_border: true,
                uses_high_contrast_border: true,
                interpolates_position: false,
            }
        );
    }

    #[test]
    fn field_presentation_maps_to_person_lock_clock_form_or_unknown_badge() {
        use crate::autofill_ax_context::{
            FillContextPresentation, PresentedAction, PresentedActionMode, PresentedField,
            PresentedFieldConfidence, PresentedFieldKind,
        };

        let presentation = |kind, mode| FillContextPresentation {
            fill_context_token: String::new(),
            focused_field: PresentedField {
                kind,
                confidence: PresentedFieldConfidence::High,
            },
            action: PresentedAction {
                mode,
                fields: Vec::new(),
            },
        };

        for kind in [PresentedFieldKind::Username, PresentedFieldKind::Email] {
            assert_eq!(
                pill_badge(&presentation(kind, PresentedActionMode::Field)),
                PillBadge::Person
            );
        }
        assert_eq!(
            pill_badge(&presentation(
                PresentedFieldKind::Password,
                PresentedActionMode::Field
            )),
            PillBadge::Lock
        );
        assert_eq!(
            pill_badge(&presentation(
                PresentedFieldKind::OneTimeCode,
                PresentedActionMode::Field
            )),
            PillBadge::Clock
        );
        assert_eq!(
            pill_badge(&presentation(
                PresentedFieldKind::Unknown,
                PresentedActionMode::Form
            )),
            PillBadge::Form
        );
        assert_eq!(
            pill_badge(&presentation(
                PresentedFieldKind::Unknown,
                PresentedActionMode::Choose
            )),
            PillBadge::Unknown
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
    fn controller_lifecycle_updates_the_shared_observer_generation() {
        let observer_generation = crate::autofill_ax_context::ObserverGeneration::default();
        let controller =
            AutoFillFloatingController::with_observer_generation(observer_generation.clone());

        assert_eq!(observer_generation.current(), 0);
        controller.set_fallback(AccessibilityFallback::Unsupported);
        assert_eq!(observer_generation.current(), controller.generation());
        let observed = controller.begin_refresh();
        assert_eq!(observer_generation.current(), observed);
        controller.observer_invalidated();
        assert_eq!(observer_generation.current(), controller.generation());
        assert!(observer_generation.current() > observed);
    }

    #[test]
    fn consuming_visible_context_rebinds_it_to_the_shared_generation() {
        use crate::accessibility_focus::{AppIdentity, AxFrame, FocusedFieldSnapshot};
        use crate::autofill_ax_context::{CapturedAxContext, CapturedFieldFingerprint};
        use crate::autofill_contract::AutoFillSecretField;
        use crate::autofill_field_context::{DetectedAction, DetectedFieldKind, FieldConfidence};

        let observer_generation = crate::autofill_ax_context::ObserverGeneration::default();
        let controller =
            AutoFillFloatingController::with_observer_generation(observer_generation.clone());
        controller.set_fallback(AccessibilityFallback::Unsupported);
        let generation = controller.begin_refresh();
        let target = crate::frontmost::test_frontmost_app("com.example.editor", 42, 9);
        let app = AppIdentity {
            bundle_id: "com.example.editor".to_owned(),
            process_id: 42,
            live: true,
        };
        let field = AxFrame {
            x: 100.0,
            y: 100.0,
            width: 180.0,
            height: 24.0,
        };
        let detected = CapturedAxContext {
            focused: FocusedFieldSnapshot {
                app,
                role: "AXSecureTextField".to_owned(),
                subrole: None,
                frame: field,
                secure: true,
                reliable: true,
            },
            caret_frame: None,
            fields: vec![CapturedFieldFingerprint {
                process_id: 42,
                role: "AXSecureTextField".to_owned(),
                frame: field,
                window_frame: AxFrame {
                    x: 20.0,
                    y: 20.0,
                    width: 800.0,
                    height: 600.0,
                },
                kind: DetectedFieldKind::Password,
                secret_field: Some(AutoFillSecretField::Password),
                confidence: FieldConfidence::High,
                focused: true,
                observer_generation: generation,
            }],
            action: DetectedAction::Field {
                field: AutoFillSecretField::Password,
            },
        };
        assert!(controller.publish_visible_with_context(
            generation,
            target.clone(),
            AppKitFrame {
                x: 5.0,
                y: 6.0,
                width: PILL_WIDTH,
                height: PILL_HEIGHT,
            },
            detected,
        ));

        let consumed = controller
            .consume_visible(&FloatingClickContext { generation, target })
            .expect("visible exact context");
        let rebound = consumed.detected.expect("detected context");
        assert_eq!(
            rebound.fields[0].observer_generation,
            controller.generation()
        );
        assert_eq!(observer_generation.current(), controller.generation());
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
                width: PILL_WIDTH,
                height: PILL_HEIGHT,
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
    fn layout_invalidation_rejects_a_queued_show_and_stale_click_before_refresh() {
        assert!(observer_notification_plan()
            .contains(&(ObserverScope::Window, ObserverNotification::LayoutChanged)));
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
                width: PILL_WIDTH,
                height: PILL_HEIGHT,
            },
        ));
        let stale_click = FloatingClickContext {
            generation,
            target: target.clone(),
        };
        let signal = ObserverInvalidationSignal::new(controller.clone(), || {});

        // This is the synchronous callback path used by AXLayoutChanged. The queued
        // refresh may run later, but neither its old show nor the old click can win.
        signal.invalidate();

        assert!(!controller.publish_visible(
            generation,
            target,
            AppKitFrame {
                x: 8.0,
                y: 9.0,
                width: PILL_WIDTH,
                height: PILL_HEIGHT,
            },
        ));
        assert_eq!(controller.consume_visible_target(&stale_click), None);
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
                width: PILL_WIDTH,
                height: PILL_HEIGHT,
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
                width: PILL_WIDTH,
                height: PILL_HEIGHT,
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
    fn scroll_generations_stay_bounded_by_the_same_fifty_millisecond_throttle() {
        let mut throttle = ObservationThrottle::new(50);
        assert_eq!(throttle.schedule(7, 100), ThrottleDecision::RunNow);
        assert_eq!(throttle.schedule(8, 110), ThrottleDecision::RunAt(150));
        assert_eq!(throttle.schedule(7, 120), ThrottleDecision::Discard);
        assert_eq!(throttle.schedule(8, 150), ThrottleDecision::RunNow);
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
    fn observer_plan_covers_focus_field_movement_scroll_app_lifecycle_and_destruction() {
        assert_eq!(observer_notification_plan().len(), 8);
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
                (ObserverScope::Window, ObserverNotification::LayoutChanged),
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
        // Ancestor scrolling and layout changes are explicit window-scoped invalidations;
        // the callback hides synchronously and the bounded 50 ms observer loop refreshes.
        assert!(observer_notification_plan()
            .contains(&(ObserverScope::Window, ObserverNotification::LayoutChanged)));
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
    fn native_panel_asset_is_the_blue_non_template_barwarden_glyph() {
        let image =
            tauri::image::Image::from_bytes(include_bytes!("../icons/autofill-pill@2x.png"))
                .expect("valid autofill pill PNG");
        assert_eq!((image.width(), image.height()), (36, 36));
        let visible: Vec<_> = image
            .rgba()
            .chunks_exact(4)
            .filter(|pixel| pixel[3] > 0)
            .collect();
        assert!(!visible.is_empty());
        assert!(visible.iter().all(|pixel| pixel[..3] == [10, 132, 255]));
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

use crate::frontmost;
#[cfg(target_os = "macos")]
use block2::RcBlock;
#[cfg(target_os = "macos")]
use objc2::rc::Retained;
#[cfg(target_os = "macos")]
use objc2::MainThreadMarker;
#[cfg(target_os = "macos")]
use objc2_app_kit::{
    NSApplication, NSColor, NSEvent, NSEventMask, NSFloatingWindowLevel, NSWindow,
};
#[cfg(target_os = "macos")]
use std::ptr::NonNull;
#[cfg(target_os = "macos")]
use std::sync::OnceLock;
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc, Mutex,
};
use std::time::{Duration, Instant};
use tauri::{
    LogicalPosition, Manager, Monitor, PhysicalPosition, PhysicalRect, PhysicalSize, Position,
    Rect, Size, Url, UserAttentionType, WebviewUrl, WebviewWindow, WebviewWindowBuilder, Window,
    WindowEvent,
};

const MAIN_WINDOW_LABEL: &str = "main";
#[cfg(target_os = "macos")]
const POPUP_CORNER_RADIUS: f64 = 14.0;
const MAIN_TRAY_ID: &str = "main";
const POPOUT_WINDOW_LABEL: &str = "popout";
const POPOUT_WIDTH: f64 = 900.0;
const POPOUT_HEIGHT: f64 = 640.0;
const POPOUT_MIN_WIDTH: f64 = 480.0;
const POPOUT_MIN_HEIGHT: f64 = 600.0;
const POPUP_WIDTH: f64 = 480.0;
const POPUP_MIN_HEIGHT: f64 = 600.0;
const POPUP_WORK_AREA_MARGIN: f64 = 24.0;
const POPUP_WINDOW_NOT_FOUND: &str = "popup window was not found";
const POPUP_WINDOW_ERROR: &str = "popup window operation failed";
const POPOUT_WINDOW_ERROR: &str = "pop-out window operation failed";
// Hidden macOS WebKit views may resume with a live DOM but an evicted layer
// tree. Defer the recovery event twice so the first frame restores the native
// view and the second frame commits the Angular compositing update.
const POPUP_RESET_AFTER: Duration = Duration::from_secs(60);
const TRAY_CLICK_BLUR_WINDOW: Duration = Duration::from_millis(250);
const POPUP_PRESENTATION_BLUR_GRACE: Duration = Duration::from_millis(500);

#[cfg(target_os = "macos")]
static EXTERNAL_CLICK_DISMISS_MONITOR: OnceLock<usize> = OnceLock::new();

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PopupEntrySource {
    Vault,
    AutoFillMenu,
    AutoFillShortcut,
    AutoFillFloating,
}

impl PopupEntrySource {
    fn as_str(self) -> &'static str {
        match self {
            Self::Vault => "vault",
            Self::AutoFillMenu => "autofill-menu",
            Self::AutoFillShortcut => "autofill-shortcut",
            Self::AutoFillFloating => "autofill-floating",
        }
    }
}

fn popup_render_recovery_script(
    reset: bool,
    entry_source: PopupEntrySource,
    suggestion_revision: u64,
) -> String {
    let entry_source = entry_source.as_str();
    format!(
        r#"
(() => {{
  const detail = {{ reset: {reset}, entrySource: "{entry_source}", suggestionRevision: "{suggestion_revision}" }};
  window.dispatchEvent(new CustomEvent("barwarden:popup-entry", {{ detail }}));
  const restore = () => window.dispatchEvent(new CustomEvent("barwarden:popup-shown", {{ detail }}));
  requestAnimationFrame(() => requestAnimationFrame(restore));
}})();
"#,
    )
}

fn suggestion_context_changed_script(suggestion_revision: u64) -> String {
    format!(
        r#"window.dispatchEvent(new CustomEvent("barwarden:suggestion-context-changed", {{ detail: {{ suggestionRevision: "{suggestion_revision}" }} }}));"#,
    )
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PopupLifecycleEvent {
    Focused(bool),
    CloseRequested,
    Opened,
    Destroyed,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PopupLifecycleAction {
    Keep,
    HideAfterDelay,
    PreventCloseAndHide,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PopupToggleAction {
    Show,
    Hide,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum AutoFillPopupShowStrategy {
    TrayPositioned,
    ExistingPosition,
}

fn autofill_popup_show_strategies() -> [AutoFillPopupShowStrategy; 2] {
    [
        AutoFillPopupShowStrategy::TrayPositioned,
        AutoFillPopupShowStrategy::ExistingPosition,
    ]
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PopoutDockVisibilityAction {
    Show,
    Hide,
}

#[derive(Clone, Default)]
pub struct PopupVisibilityHold(Arc<AtomicUsize>);

pub struct PopupVisibilityGuard(Arc<AtomicUsize>);

#[derive(Default)]
struct PopupPresentationTimestamps {
    hidden_at: Option<Instant>,
    blurred_at: Option<Instant>,
    presented_at: Option<Instant>,
    presentation_revision: u64,
    focused_revision: Option<u64>,
}

#[derive(Clone, Default)]
pub struct PopupPresentationState(Arc<Mutex<PopupPresentationTimestamps>>);

impl PopupPresentationState {
    fn mark_hidden_at(&self, hidden_at: Instant) {
        let mut timestamps = self
            .0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        timestamps.hidden_at = Some(hidden_at);
        timestamps.blurred_at = None;
        timestamps.presented_at = None;
        timestamps.focused_revision = None;
    }

    fn mark_hidden(&self) {
        self.mark_hidden_at(Instant::now());
    }

    fn mark_presented_at(&self, presented_at: Instant) {
        let mut timestamps = self
            .0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        timestamps.presentation_revision = timestamps.presentation_revision.wrapping_add(1);
        timestamps.focused_revision = None;
        timestamps.blurred_at = None;
        timestamps.presented_at = Some(presented_at);
    }

    fn mark_presented(&self) {
        self.mark_presented_at(Instant::now());
    }

    fn mark_focused(&self) {
        let mut timestamps = self
            .0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        timestamps.focused_revision = Some(timestamps.presentation_revision);
    }

    fn begin_blur_hide_at(&self, blurred_at: Instant) -> Option<u64> {
        let mut timestamps = self
            .0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let revision = timestamps.presentation_revision;
        if timestamps.focused_revision != Some(revision) {
            return None;
        }
        if let Some(presented_at) = timestamps.presented_at {
            let Some(elapsed) = blurred_at.checked_duration_since(presented_at) else {
                return None;
            };
            if elapsed < POPUP_PRESENTATION_BLUR_GRACE {
                return None;
            }
        }
        timestamps.blurred_at = Some(blurred_at);
        Some(revision)
    }

    fn begin_blur_hide(&self) -> Option<u64> {
        self.begin_blur_hide_at(Instant::now())
    }

    fn blur_hide_is_current(&self, revision: u64) -> bool {
        let timestamps = self
            .0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        timestamps.presentation_revision == revision
            && timestamps.focused_revision == Some(revision)
    }

    fn blurred_for_tray_click_at(&self, clicked_at: Instant) -> bool {
        self.0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .blurred_at
            .and_then(|blurred_at| clicked_at.checked_duration_since(blurred_at))
            .is_some_and(|elapsed| elapsed <= TRAY_CLICK_BLUR_WINDOW)
    }

    fn take_reset_required_at(&self, shown_at: Instant) -> bool {
        let mut timestamps = self
            .0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        timestamps.blurred_at = None;
        timestamps
            .hidden_at
            .take()
            .and_then(|hidden_at| shown_at.checked_duration_since(hidden_at))
            .is_some_and(|elapsed| elapsed >= POPUP_RESET_AFTER)
    }

    fn take_reset_required(&self) -> bool {
        self.take_reset_required_at(Instant::now())
    }
}

impl PopupVisibilityHold {
    pub fn acquire(&self) -> PopupVisibilityGuard {
        self.0.fetch_add(1, Ordering::AcqRel);
        PopupVisibilityGuard(Arc::clone(&self.0))
    }

    pub fn is_held(&self) -> bool {
        self.0.load(Ordering::Acquire) > 0
    }
}

impl Drop for PopupVisibilityGuard {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::AcqRel);
    }
}

#[derive(Clone, Copy, Debug)]
struct MonitorGeometry {
    physical_bounds: PhysicalRect<i32, u32>,
    work_area: PhysicalRect<i32, u32>,
    scale_factor: f64,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PopupWindowMetrics {
    current_height: f64,
    maximum_height: f64,
}

#[cfg(target_os = "macos")]
pub fn configure_native_popup_window(app: &tauri::AppHandle) -> Result<(), String> {
    let popup = app
        .get_webview_window(MAIN_WINDOW_LABEL)
        .ok_or_else(|| POPUP_WINDOW_NOT_FOUND.to_owned())?;
    let raw_window = popup
        .ns_window()
        .map_err(|_| POPUP_WINDOW_ERROR.to_owned())?;
    let ns_window = unsafe {
        // Tauri documents `ns_window` as an NSWindow pointer for the lifetime of the window.
        raw_window
            .cast::<NSWindow>()
            .as_ref()
            .ok_or_else(|| POPUP_WINDOW_ERROR.to_owned())?
    };
    let content_view = ns_window
        .contentView()
        .ok_or_else(|| POPUP_WINDOW_ERROR.to_owned())?;

    ns_window.setOpaque(false);
    ns_window.setBackgroundColor(Some(&NSColor::clearColor()));
    ns_window.setHasShadow(true);
    content_view.setWantsLayer(true);
    let layer = content_view
        .layer()
        .ok_or_else(|| POPUP_WINDOW_ERROR.to_owned())?;
    layer.setCornerRadius(POPUP_CORNER_RADIUS);
    layer.setMasksToBounds(true);
    ns_window.invalidateShadow();
    install_external_click_dismiss_monitor(app)?;
    Ok(())
}

#[cfg(target_os = "macos")]
fn install_external_click_dismiss_monitor(app: &tauri::AppHandle) -> Result<(), String> {
    if EXTERNAL_CLICK_DISMISS_MONITOR.get().is_some() {
        return Ok(());
    }

    let dismiss_app = app.clone();
    let handler = RcBlock::new(move |_event: NonNull<NSEvent>| {
        let Some(window) = dismiss_app.get_webview_window(MAIN_WINDOW_LABEL) else {
            return;
        };
        let visible = matches!(window.is_visible(), Ok(true));
        let visibility_held = dismiss_app.state::<PopupVisibilityHold>().is_held();
        if should_hide_after_external_mouse_down(visible, visibility_held) {
            let _ = hide_popup_window(&dismiss_app);
        }
    });
    let mask =
        NSEventMask::LeftMouseDown | NSEventMask::RightMouseDown | NSEventMask::OtherMouseDown;
    let monitor = NSEvent::addGlobalMonitorForEventsMatchingMask_handler(mask, &handler)
        .ok_or_else(|| POPUP_WINDOW_ERROR.to_owned())?;
    let monitor = Retained::into_raw(monitor) as usize;
    EXTERNAL_CLICK_DISMISS_MONITOR
        .set(monitor)
        .map_err(|_| POPUP_WINDOW_ERROR.to_owned())
}

struct PopupGeometryContext {
    window: WebviewWindow,
    tray_rect: PhysicalRect<i32, u32>,
    monitor: MonitorGeometry,
    window_scale_factor: f64,
    maximum_height: f64,
}

impl From<&Monitor> for MonitorGeometry {
    fn from(monitor: &Monitor) -> Self {
        Self {
            physical_bounds: PhysicalRect {
                position: *monitor.position(),
                size: *monitor.size(),
            },
            work_area: *monitor.work_area(),
            scale_factor: monitor.scale_factor(),
        }
    }
}

#[tauri::command]
pub async fn show_popup(app: tauri::AppHandle) -> Result<(), String> {
    show_popup_window(&app, None)
}

#[tauri::command]
pub async fn hide_popup(app: tauri::AppHandle) -> Result<(), String> {
    hide_popup_window(&app)
}

#[tauri::command]
pub async fn pop_out(app: tauri::AppHandle, route: String) -> Result<(), String> {
    pop_out_window(&app, &route)
}

#[tauri::command]
pub async fn popup_window_metrics(app: tauri::AppHandle) -> Result<PopupWindowMetrics, String> {
    let context = resolve_popup_geometry(&app, None)?;
    let current_height = context
        .window
        .outer_size()
        .map_err(|_| POPUP_WINDOW_ERROR.to_owned())?
        .to_logical::<f64>(context.window_scale_factor)
        .height;
    Ok(PopupWindowMetrics {
        current_height,
        maximum_height: context.maximum_height,
    })
}

#[tauri::command]
pub async fn set_popup_height(
    app: tauri::AppHandle,
    height: f64,
) -> Result<PopupWindowMetrics, String> {
    let context = resolve_popup_geometry(&app, None)?;
    if !height.is_finite() || height < 0.0 {
        return Err(POPUP_WINDOW_ERROR.to_owned());
    }
    let target = height.clamp(POPUP_MIN_HEIGHT, context.maximum_height);
    let logical_size = tauri::LogicalSize::new(POPUP_WIDTH, target);
    context
        .window
        .set_size(Size::Logical(logical_size))
        .map_err(|_| POPUP_WINDOW_ERROR.to_owned())?;
    let (_, physical_origin) = popup_size_and_position(context.tray_rect, target, context.monitor)?;
    context
        .window
        .set_position(Position::Logical(
            physical_origin.to_logical(context.monitor.scale_factor),
        ))
        .map_err(|_| POPUP_WINDOW_ERROR.to_owned())?;
    Ok(PopupWindowMetrics {
        current_height: target,
        maximum_height: context.maximum_height,
    })
}

pub fn show_popup_window(
    app: &tauri::AppHandle,
    event_tray_rect: Option<Rect>,
) -> Result<(), String> {
    show_popup_window_for_entry(app, event_tray_rect, PopupEntrySource::Vault)
}

/// Keeps the hidden or visible vault WebView aligned with the native suggestion monitor.
pub(crate) fn refresh_popup_suggestions(app: &tauri::AppHandle, revision: u64) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        return;
    };

    if let Ok(Some(target)) = frontmost::current_frontmost_app() {
        if target.bundle_id != frontmost::APP_BUNDLE_ID {
            frontmost::replace_target_app(target);
        }
    }

    let _ = window.eval(suggestion_context_changed_script(revision));
}

pub fn show_autofill_picker_window(
    app: &tauri::AppHandle,
    source: PopupEntrySource,
) -> Result<(), String> {
    debug_assert!(source != PopupEntrySource::Vault);
    show_popup_window_for_entry(app, None, source)
}

pub fn show_autofill_picker_window_for_target(
    app: &tauri::AppHandle,
    source: PopupEntrySource,
    target: crate::frontmost::FrontmostApp,
) -> Result<(), String> {
    debug_assert!(source != PopupEntrySource::Vault);
    frontmost::replace_target_app(target);
    let mut last_error = POPUP_WINDOW_ERROR.to_owned();
    for strategy in autofill_popup_show_strategies() {
        let result = match strategy {
            AutoFillPopupShowStrategy::TrayPositioned => {
                show_popup_window_after_target_capture(app, None, source)
            }
            AutoFillPopupShowStrategy::ExistingPosition => {
                show_popup_window_at_existing_position(app, source)
            }
        };
        match result {
            Ok(()) => return Ok(()),
            Err(error) => last_error = error,
        }
    }
    Err(last_error)
}

fn show_popup_window_for_entry(
    app: &tauri::AppHandle,
    event_tray_rect: Option<Rect>,
    entry_source: PopupEntrySource,
) -> Result<(), String> {
    frontmost::capture_current_target_app(app);
    show_popup_window_after_target_capture(app, event_tray_rect, entry_source)
}

fn show_popup_window_after_target_capture(
    app: &tauri::AppHandle,
    event_tray_rect: Option<Rect>,
    entry_source: PopupEntrySource,
) -> Result<(), String> {
    let context = resolve_popup_geometry(app, event_tray_rect)?;
    let current_popup_size = context
        .window
        .outer_size()
        .map_err(|_| POPUP_WINDOW_ERROR.to_owned())?;
    let popup_position = popup_position_for_monitor(
        context.tray_rect,
        current_popup_size,
        context.window_scale_factor,
        context.monitor,
    )
    .ok_or_else(|| POPUP_WINDOW_ERROR.to_owned())?;

    context
        .window
        .set_position(popup_position)
        .map_err(|_| POPUP_WINDOW_ERROR.to_owned())?;
    present_popup_window(app, &context.window, entry_source)
}

fn show_popup_window_at_existing_position(
    app: &tauri::AppHandle,
    entry_source: PopupEntrySource,
) -> Result<(), String> {
    let window = app
        .get_webview_window(MAIN_WINDOW_LABEL)
        .ok_or_else(|| POPUP_WINDOW_NOT_FOUND.to_owned())?;
    let existing_position = window
        .outer_position()
        .map_err(|_| POPUP_WINDOW_ERROR.to_owned())?;
    let size = window
        .outer_size()
        .map_err(|_| POPUP_WINDOW_ERROR.to_owned())?;
    let monitors = window
        .available_monitors()
        .map_err(|_| POPUP_WINDOW_ERROR.to_owned())?;
    let monitor_geometries: Vec<_> = monitors.iter().map(MonitorGeometry::from).collect();
    let primary = window
        .primary_monitor()
        .map_err(|_| POPUP_WINDOW_ERROR.to_owned())?
        .as_ref()
        .map(MonitorGeometry::from)
        .and_then(|primary| {
            monitor_geometries.iter().position(|monitor| {
                monitor.physical_bounds.position == primary.physical_bounds.position
                    && monitor.physical_bounds.size == primary.physical_bounds.size
                    && monitor.work_area.position == primary.work_area.position
                    && monitor.work_area.size == primary.work_area.size
            })
        });
    let safe_position =
        safe_existing_popup_position(existing_position, size, &monitor_geometries, primary)
            .ok_or_else(|| POPUP_WINDOW_ERROR.to_owned())?;
    if safe_position != existing_position {
        window
            .set_position(Position::Physical(safe_position))
            .map_err(|_| POPUP_WINDOW_ERROR.to_owned())?;
    }
    present_popup_window(app, &window, entry_source)
}

fn present_popup_window(
    app: &tauri::AppHandle,
    window: &WebviewWindow,
    entry_source: PopupEntrySource,
) -> Result<(), String> {
    app.state::<PopupPresentationState>().mark_presented();
    window.show().map_err(|_| POPUP_WINDOW_ERROR.to_owned())?;
    order_popup_front_regardless(window)?;
    if window.set_focus().is_err() {
        let _ = window.set_always_on_top(true);
        let _ = window.request_user_attention(Some(UserAttentionType::Informational));
        let _ = window.set_always_on_top(false);
    }
    let reset_required = app.state::<PopupPresentationState>().take_reset_required();
    let suggestion_revision = app
        .state::<crate::suggestion_count::SuggestionCountMonitor>()
        .current_revision();
    // A repaint failure must not prevent users from opening the popup; the
    // frontend treats this event as a best-effort compositor recovery.
    let _ = window.eval(popup_render_recovery_script(
        reset_required,
        entry_source,
        suggestion_revision,
    ));
    Ok(())
}

#[cfg(target_os = "macos")]
fn order_popup_front_regardless(window: &WebviewWindow) -> Result<(), String> {
    if let Some(mtm) = MainThreadMarker::new() {
        return present_native_popup(window, mtm);
    }

    let native_window = window.clone();
    window
        .run_on_main_thread(move || {
            let Some(mtm) = MainThreadMarker::new() else {
                return;
            };
            let _ = present_native_popup(&native_window, mtm);
        })
        .map_err(|_| POPUP_WINDOW_ERROR.to_owned())
}

#[cfg(target_os = "macos")]
fn present_native_popup(window: &WebviewWindow, mtm: MainThreadMarker) -> Result<(), String> {
    let raw_window = window
        .ns_window()
        .map_err(|_| POPUP_WINDOW_ERROR.to_owned())?;
    let ns_window = unsafe {
        raw_window
            .cast::<NSWindow>()
            .as_ref()
            .ok_or_else(|| POPUP_WINDOW_ERROR.to_owned())?
    };
    let application = NSApplication::sharedApplication(mtm);

    ns_window.setLevel(NSFloatingWindowLevel);
    application.activate();
    ns_window.makeKeyAndOrderFront(None);
    ns_window.orderFrontRegardless();
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn order_popup_front_regardless(_window: &WebviewWindow) -> Result<(), String> {
    Ok(())
}

fn safe_existing_popup_position(
    existing_position: PhysicalPosition<i32>,
    popup_size: PhysicalSize<u32>,
    monitors: &[MonitorGeometry],
    primary_monitor_index: Option<usize>,
) -> Option<PhysicalPosition<i32>> {
    let popup_rect = PhysicalRect {
        position: existing_position,
        size: popup_size,
    };
    if monitors.iter().any(|monitor| {
        valid_scale_factor(monitor.scale_factor)
            && physical_rect_fully_contains(monitor.work_area, popup_rect)
    }) {
        return Some(existing_position);
    }

    let monitor = primary_monitor_index
        .and_then(|index| monitors.get(index))
        .filter(|monitor| valid_scale_factor(monitor.scale_factor))
        .or_else(|| {
            monitors
                .iter()
                .find(|monitor| valid_scale_factor(monitor.scale_factor))
        })?;
    Some(PhysicalPosition::new(
        clamped_axis_origin(
            i64::from(existing_position.x),
            monitor.work_area.position.x,
            monitor.work_area.size.width,
            popup_size.width,
        ),
        clamped_axis_origin(
            i64::from(existing_position.y),
            monitor.work_area.position.y,
            monitor.work_area.size.height,
            popup_size.height,
        ),
    ))
}

fn physical_rect_fully_contains(
    outer: PhysicalRect<i32, u32>,
    inner: PhysicalRect<i32, u32>,
) -> bool {
    let outer_left = i64::from(outer.position.x);
    let outer_top = i64::from(outer.position.y);
    let outer_right = outer_left + i64::from(outer.size.width);
    let outer_bottom = outer_top + i64::from(outer.size.height);
    let inner_left = i64::from(inner.position.x);
    let inner_top = i64::from(inner.position.y);
    let inner_right = inner_left + i64::from(inner.size.width);
    let inner_bottom = inner_top + i64::from(inner.size.height);

    inner_left >= outer_left
        && inner_top >= outer_top
        && inner_right <= outer_right
        && inner_bottom <= outer_bottom
}

fn resolve_popup_geometry(
    app: &tauri::AppHandle,
    event_tray_rect: Option<Rect>,
) -> Result<PopupGeometryContext, String> {
    let window = app
        .get_webview_window(MAIN_WINDOW_LABEL)
        .ok_or_else(|| POPUP_WINDOW_NOT_FOUND.to_owned())?;
    let tray_rect = physical_tray_rect(resolve_tray_rect(app, event_tray_rect)?)?;
    let monitors = window
        .available_monitors()
        .map_err(|_| POPUP_WINDOW_ERROR.to_owned())?;
    let monitor_geometries: Vec<_> = monitors.iter().map(MonitorGeometry::from).collect();
    let primary_monitor = window
        .primary_monitor()
        .map_err(|_| POPUP_WINDOW_ERROR.to_owned())?
        .as_ref()
        .map(MonitorGeometry::from);
    let primary_monitor_index = primary_monitor.and_then(|primary| {
        monitor_geometries.iter().position(|monitor| {
            monitor.physical_bounds.position.x == primary.physical_bounds.position.x
                && monitor.physical_bounds.position.y == primary.physical_bounds.position.y
                && monitor.physical_bounds.size.width == primary.physical_bounds.size.width
                && monitor.physical_bounds.size.height == primary.physical_bounds.size.height
        })
    });
    let monitor_index =
        monitor_index_for_tray_or_primary(tray_rect, &monitor_geometries, primary_monitor_index)
            .ok_or_else(|| POPUP_WINDOW_ERROR.to_owned())?;
    let monitor = monitor_geometries[monitor_index];
    let window_scale_factor = window
        .scale_factor()
        .map_err(|_| POPUP_WINDOW_ERROR.to_owned())?;
    if !valid_scale_factor(window_scale_factor) || !valid_scale_factor(monitor.scale_factor) {
        return Err(POPUP_WINDOW_ERROR.to_owned());
    }
    let work_area_logical_height = f64::from(monitor.work_area.size.height) / monitor.scale_factor;
    let maximum_height = popup_maximum_height(work_area_logical_height)?;

    Ok(PopupGeometryContext {
        window,
        tray_rect,
        monitor,
        window_scale_factor,
        maximum_height,
    })
}

pub fn hide_popup_window(app: &tauri::AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window(MAIN_WINDOW_LABEL)
        .ok_or_else(|| POPUP_WINDOW_NOT_FOUND.to_owned())?;

    window.hide().map_err(|_| POPUP_WINDOW_ERROR.to_owned())?;
    app.state::<PopupPresentationState>().mark_hidden();
    Ok(())
}

pub fn popup_toggle_action(
    is_visible: bool,
    _is_focused: bool,
    _blurred_for_tray_click: bool,
) -> PopupToggleAction {
    if is_visible {
        PopupToggleAction::Hide
    } else {
        PopupToggleAction::Show
    }
}

pub fn toggle_popup_window(
    app: &tauri::AppHandle,
    event_tray_rect: Option<Rect>,
) -> Result<(), String> {
    let window = app
        .get_webview_window(MAIN_WINDOW_LABEL)
        .ok_or_else(|| POPUP_WINDOW_NOT_FOUND.to_owned())?;
    let is_visible = window
        .is_visible()
        .map_err(|_| POPUP_WINDOW_ERROR.to_owned())?;

    let is_focused = matches!(window.is_focused(), Ok(true));
    let blurred_for_tray_click = app
        .state::<PopupPresentationState>()
        .blurred_for_tray_click_at(Instant::now());

    match popup_toggle_action(is_visible, is_focused, blurred_for_tray_click) {
        PopupToggleAction::Show => show_popup_window(app, event_tray_rect),
        PopupToggleAction::Hide => hide_popup_window(app),
    }
}

pub fn popup_origin(
    tray_rect: PhysicalRect<i32, u32>,
    popup_size: PhysicalSize<u32>,
    work_area: PhysicalRect<i32, u32>,
) -> PhysicalPosition<i32> {
    let desired_x = i64::from(tray_rect.position.x) + i64::from(tray_rect.size.width) / 2
        - i64::from(popup_size.width) / 2;
    let desired_y = i64::from(tray_rect.position.y) + i64::from(tray_rect.size.height);

    PhysicalPosition::new(
        clamped_axis_origin(
            desired_x,
            work_area.position.x,
            work_area.size.width,
            popup_size.width,
        ),
        clamped_axis_origin(
            desired_y,
            work_area.position.y,
            work_area.size.height,
            popup_size.height,
        ),
    )
}

fn popup_position_for_monitor(
    tray_rect: PhysicalRect<i32, u32>,
    current_popup_size: PhysicalSize<u32>,
    current_scale_factor: f64,
    monitor: MonitorGeometry,
) -> Option<Position> {
    let popup_size = physical_popup_size(
        current_popup_size,
        current_scale_factor,
        monitor.scale_factor,
    )?;
    let physical_origin = popup_origin(tray_rect, popup_size, monitor.work_area);
    let logical_origin: LogicalPosition<f64> = physical_origin.to_logical(monitor.scale_factor);

    Some(Position::Logical(logical_origin))
}

fn monitor_index_for_tray(
    tray_rect: PhysicalRect<i32, u32>,
    monitors: &[MonitorGeometry],
) -> Option<usize> {
    monitors
        .iter()
        .enumerate()
        .filter(|(_, monitor)| valid_scale_factor(monitor.scale_factor))
        .filter_map(|(index, monitor)| {
            let area = intersection_area(tray_rect, monitor.physical_bounds);
            (area > 0).then_some((
                index,
                area,
                logical_work_area_anchor_distance(tray_rect, *monitor),
            ))
        })
        .max_by(|left, right| {
            left.1
                .cmp(&right.1)
                .then_with(|| right.2.total_cmp(&left.2))
                .then_with(|| right.0.cmp(&left.0))
        })
        .map(|(index, _, _)| index)
}

fn monitor_index_for_tray_or_primary(
    tray_rect: PhysicalRect<i32, u32>,
    monitors: &[MonitorGeometry],
    primary_monitor_index: Option<usize>,
) -> Option<usize> {
    monitor_index_for_tray(tray_rect, monitors)
        .or_else(|| {
            primary_monitor_index.filter(|index| {
                monitors
                    .get(*index)
                    .is_some_and(|monitor| valid_scale_factor(monitor.scale_factor))
            })
        })
        .or_else(|| {
            monitors
                .iter()
                .position(|monitor| valid_scale_factor(monitor.scale_factor))
        })
}

fn physical_popup_size(
    current_size: PhysicalSize<u32>,
    current_scale_factor: f64,
    target_scale_factor: f64,
) -> Option<PhysicalSize<u32>> {
    if !valid_scale_factor(current_scale_factor) || !valid_scale_factor(target_scale_factor) {
        return None;
    }

    Some(PhysicalSize::new(
        scaled_physical_dimension(
            current_size.width,
            current_scale_factor,
            target_scale_factor,
        )?,
        scaled_physical_dimension(
            current_size.height,
            current_scale_factor,
            target_scale_factor,
        )?,
    ))
}

fn popup_target_height(requested: f64, work_area_logical_height: f64) -> Result<f64, String> {
    if !requested.is_finite() || requested < 0.0 {
        return Err(POPUP_WINDOW_ERROR.to_owned());
    }
    let maximum_height = popup_maximum_height(work_area_logical_height)?;
    Ok(requested.clamp(POPUP_MIN_HEIGHT, maximum_height))
}

fn popup_maximum_height(work_area_logical_height: f64) -> Result<f64, String> {
    if !work_area_logical_height.is_finite() {
        return Err(POPUP_WINDOW_ERROR.to_owned());
    }
    Ok((work_area_logical_height - POPUP_WORK_AREA_MARGIN).max(POPUP_MIN_HEIGHT))
}

fn popup_size_and_position(
    tray_rect: PhysicalRect<i32, u32>,
    requested_height: f64,
    monitor: MonitorGeometry,
) -> Result<(PhysicalSize<u32>, PhysicalPosition<i32>), String> {
    if !valid_scale_factor(monitor.scale_factor) {
        return Err(POPUP_WINDOW_ERROR.to_owned());
    }
    let logical_height = popup_target_height(
        requested_height,
        f64::from(monitor.work_area.size.height) / monitor.scale_factor,
    )?;
    let size = tauri::LogicalSize::new(POPUP_WIDTH, logical_height)
        .to_physical::<u32>(monitor.scale_factor);
    Ok((size, popup_origin(tray_rect, size, monitor.work_area)))
}

fn valid_scale_factor(scale_factor: f64) -> bool {
    scale_factor.is_finite() && scale_factor > 0.0
}

fn intersection_area(left: PhysicalRect<i32, u32>, right: PhysicalRect<i32, u32>) -> u128 {
    let left_x = i64::from(left.position.x);
    let left_y = i64::from(left.position.y);
    let right_x = i64::from(right.position.x);
    let right_y = i64::from(right.position.y);
    let overlap_width = (left_x + i64::from(left.size.width))
        .min(right_x + i64::from(right.size.width))
        - left_x.max(right_x);
    let overlap_height = (left_y + i64::from(left.size.height))
        .min(right_y + i64::from(right.size.height))
        - left_y.max(right_y);

    if overlap_width <= 0 || overlap_height <= 0 {
        return 0;
    }

    overlap_width as u128 * overlap_height as u128
}

fn logical_work_area_anchor_distance(
    tray_rect: PhysicalRect<i32, u32>,
    monitor: MonitorGeometry,
) -> f64 {
    let tray_bottom = i64::from(tray_rect.position.y) + i64::from(tray_rect.size.height);
    let physical_distance = (tray_bottom - i64::from(monitor.work_area.position.y)).abs();
    physical_distance as f64 / monitor.scale_factor
}

fn scaled_physical_dimension(
    physical_dimension: u32,
    current_scale_factor: f64,
    target_scale_factor: f64,
) -> Option<u32> {
    let scaled = f64::from(physical_dimension) / current_scale_factor * target_scale_factor;
    if !scaled.is_finite() || scaled < 0.0 || scaled > f64::from(u32::MAX) {
        return None;
    }

    Some(scaled.round() as u32)
}

pub fn popup_lifecycle_action(
    window_label: &str,
    event: PopupLifecycleEvent,
) -> PopupLifecycleAction {
    if window_label != MAIN_WINDOW_LABEL {
        return PopupLifecycleAction::Keep;
    }

    match event {
        PopupLifecycleEvent::Focused(false) => PopupLifecycleAction::HideAfterDelay,
        PopupLifecycleEvent::CloseRequested => PopupLifecycleAction::PreventCloseAndHide,
        PopupLifecycleEvent::Focused(true)
        | PopupLifecycleEvent::Opened
        | PopupLifecycleEvent::Destroyed => PopupLifecycleAction::Keep,
    }
}

pub fn should_hide_after_popup_blur(is_focused: bool, visibility_held: bool) -> bool {
    !is_focused && !visibility_held
}

pub fn should_hide_after_external_mouse_down(is_visible: bool, visibility_held: bool) -> bool {
    is_visible && !visibility_held
}

pub fn popout_dock_visibility_action(
    window_label: &str,
    event: PopupLifecycleEvent,
) -> Option<PopoutDockVisibilityAction> {
    match (window_label, event) {
        (POPOUT_WINDOW_LABEL, PopupLifecycleEvent::Opened) => {
            Some(PopoutDockVisibilityAction::Show)
        }
        (POPOUT_WINDOW_LABEL, PopupLifecycleEvent::Destroyed) => {
            Some(PopoutDockVisibilityAction::Hide)
        }
        _ => None,
    }
}

fn apply_popout_dock_visibility(app: &tauri::AppHandle, action: PopoutDockVisibilityAction) {
    #[cfg(target_os = "macos")]
    {
        let policy = match action {
            PopoutDockVisibilityAction::Show => tauri::ActivationPolicy::Regular,
            PopoutDockVisibilityAction::Hide => tauri::ActivationPolicy::Accessory,
        };
        let _ = app.set_activation_policy(policy);
    }

    #[cfg(not(target_os = "macos"))]
    let _ = (app, action);
}

pub fn handle_window_event(window: &Window, event: &WindowEvent) {
    let lifecycle_event = match event {
        WindowEvent::Focused(focused) => PopupLifecycleEvent::Focused(*focused),
        WindowEvent::CloseRequested { .. } => PopupLifecycleEvent::CloseRequested,
        WindowEvent::Destroyed => PopupLifecycleEvent::Destroyed,
        _ => return,
    };

    if let Some(action) = popout_dock_visibility_action(window.label(), lifecycle_event) {
        apply_popout_dock_visibility(window.app_handle(), action);
    }

    if window.label() == MAIN_WINDOW_LABEL && lifecycle_event == PopupLifecycleEvent::Focused(true)
    {
        window
            .app_handle()
            .state::<PopupPresentationState>()
            .mark_focused();
    }

    match popup_lifecycle_action(window.label(), lifecycle_event) {
        PopupLifecycleAction::Keep => {}
        PopupLifecycleAction::HideAfterDelay => {
            let presentation_state = window.app_handle().state::<PopupPresentationState>();
            let Some(presentation_revision) = presentation_state.begin_blur_hide() else {
                return;
            };
            let window = window.clone();
            std::thread::spawn(move || {
                // Let a status-item mouse-up toggle the still-visible popup first.
                std::thread::sleep(std::time::Duration::from_millis(100));
                let focused = matches!(window.is_focused(), Ok(true));
                let visibility_held = window.app_handle().state::<PopupVisibilityHold>().is_held();
                let blur_hide_is_current = window
                    .app_handle()
                    .state::<PopupPresentationState>()
                    .blur_hide_is_current(presentation_revision);
                if blur_hide_is_current && should_hide_after_popup_blur(focused, visibility_held) {
                    if window.hide().is_ok() {
                        window
                            .app_handle()
                            .state::<PopupPresentationState>()
                            .mark_hidden();
                    }
                }
            });
        }
        PopupLifecycleAction::PreventCloseAndHide => {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
            }
            if window.hide().is_ok() {
                window
                    .app_handle()
                    .state::<PopupPresentationState>()
                    .mark_hidden();
            }
        }
    }
}

pub fn pop_out_window(app: &tauri::AppHandle, route: &str) -> Result<(), String> {
    let target = popout_url(route);
    if let Some(action) =
        popout_dock_visibility_action(POPOUT_WINDOW_LABEL, PopupLifecycleEvent::Opened)
    {
        apply_popout_dock_visibility(app, action);
    }

    if let Some(window) = app.get_webview_window(POPOUT_WINDOW_LABEL) {
        let current_url = window.url().map_err(|_| POPOUT_WINDOW_ERROR.to_owned())?;
        window
            .navigate(existing_popout_url(current_url, route))
            .map_err(|_| POPOUT_WINDOW_ERROR.to_owned())?;
        window.show().map_err(|_| POPOUT_WINDOW_ERROR.to_owned())?;
        window
            .set_focus()
            .map_err(|_| POPOUT_WINDOW_ERROR.to_owned())?;
        let _ = hide_popup_window(app);
        return Ok(());
    }

    let created = WebviewWindowBuilder::new(app, POPOUT_WINDOW_LABEL, target)
        .title(crate::brand::PRODUCT_NAME)
        .inner_size(POPOUT_WIDTH, POPOUT_HEIGHT)
        .min_inner_size(POPOUT_MIN_WIDTH, POPOUT_MIN_HEIGHT)
        .resizable(true)
        .decorations(true)
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true)
        .center()
        .build();
    if created.is_err() {
        apply_popout_dock_visibility(app, PopoutDockVisibilityAction::Hide);
    }
    created.map_err(|_| POPOUT_WINDOW_ERROR.to_owned())?;

    let _ = hide_popup_window(app);
    Ok(())
}

fn popout_url(route: &str) -> WebviewUrl {
    WebviewUrl::App(format!("index.html?uilocation=popout#{}", sanitize_route(route)).into())
}

fn existing_popout_url(mut current_url: Url, route: &str) -> Url {
    current_url.set_path("/index.html");
    current_url.set_query(Some("uilocation=popout"));
    current_url.set_fragment(Some(&sanitize_route(route)));
    current_url
}

fn sanitize_route(route: &str) -> String {
    const FALLBACK: &str = "/tabs/vault";
    const STATIC_ROUTES: &[&str] = &[
        "/tabs/vault",
        "/tabs/otp",
        "/tabs/generator",
        "/tabs/send",
        "/tabs/settings",
        "/account-switcher",
        "/vault-settings",
        "/account-security",
        "/settings-password",
        "/autofill",
        "/appearance",
        "/new-item",
        "/folders",
        "/archive",
        "/trash",
        "/generator-history",
        "/keyboard-shortcut",
        "/add-send",
        "/about",
        "/add-cipher",
    ];

    if !route.starts_with('/')
        || route.starts_with("//")
        || route.contains('%')
        || route.contains('#')
        || route.contains('\\')
        || route.contains("://")
    {
        return FALLBACK.to_owned();
    }

    if STATIC_ROUTES.contains(&route) {
        return route.to_owned();
    }

    let retained = match route.split_once('?') {
        Some(("/new-item", query)) => valid_single_id_query(query, "folderId"),
        Some(("/add-cipher", query)) => valid_add_cipher_query(query),
        Some(("/edit-cipher" | "/clone-cipher", query)) => valid_cipher_edit_query(query),
        Some(("/cipher-password-history", query)) => valid_single_id_query(query, "cipherId"),
        Some(("/add-send", "type=text")) => true,
        Some(("/edit-send", query)) => valid_send_edit_query(query),
        Some(("/send-created", query)) => {
            valid_single_id_query(query, "sendId") || valid_send_created_query(query)
        }
        _ if route.starts_with("/view-cipher/") => valid_identifier(&route[13..]),
        _ => false,
    };

    if retained {
        route.to_owned()
    } else {
        FALLBACK.to_owned()
    }
}

fn resolve_tray_rect(
    app: &tauri::AppHandle,
    event_tray_rect: Option<Rect>,
) -> Result<Rect, String> {
    if let Some(rect) = event_tray_rect {
        return Ok(rect);
    }

    app.tray_by_id(MAIN_TRAY_ID)
        .ok_or_else(|| POPUP_WINDOW_ERROR.to_owned())?
        .rect()
        .map_err(|_| POPUP_WINDOW_ERROR.to_owned())?
        .ok_or_else(|| POPUP_WINDOW_ERROR.to_owned())
}

fn physical_tray_rect(rect: Rect) -> Result<PhysicalRect<i32, u32>, String> {
    match (rect.position, rect.size) {
        (Position::Physical(position), Size::Physical(size)) => Ok(PhysicalRect { position, size }),
        _ => Err(POPUP_WINDOW_ERROR.to_owned()),
    }
}

fn clamped_axis_origin(desired: i64, work_start: i32, work_size: u32, popup_size: u32) -> i32 {
    let minimum = i64::from(work_start);
    let maximum = (minimum + i64::from(work_size) - i64::from(popup_size)).max(minimum);
    desired
        .clamp(minimum, maximum)
        .clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32
}

fn valid_single_id_query(query: &str, key: &str) -> bool {
    query
        .strip_prefix(&format!("{key}="))
        .is_some_and(valid_identifier)
}

fn valid_add_cipher_query(query: &str) -> bool {
    match query.split_once("&folderId=") {
        Some((type_query, folder_id)) => {
            valid_cipher_type(type_query) && valid_identifier(folder_id)
        }
        None => valid_cipher_type(query),
    }
}

fn valid_cipher_type(query: &str) -> bool {
    matches!(query, "type=1" | "type=2" | "type=3" | "type=4")
}

fn valid_cipher_edit_query(query: &str) -> bool {
    let Some((cipher_id, type_query)) = query
        .strip_prefix("cipherId=")
        .and_then(|value| value.split_once("&"))
    else {
        return false;
    };

    valid_identifier(cipher_id) && valid_cipher_type(type_query)
}

fn valid_send_edit_query(query: &str) -> bool {
    let Some((send_id, type_query)) = query
        .strip_prefix("sendId=")
        .and_then(|value| value.split_once("&"))
    else {
        return false;
    };

    valid_identifier(send_id) && type_query == "type=text"
}

fn valid_send_created_query(query: &str) -> bool {
    let Some((send_id, type_query)) = query
        .strip_prefix("sendId=")
        .and_then(|value| value.split_once("&"))
    else {
        return false;
    };

    valid_identifier(send_id) && type_query == "type=text"
}

fn valid_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
}

#[cfg(test)]
mod tests {
    use super::{
        autofill_popup_show_strategies, existing_popout_url, monitor_index_for_tray,
        monitor_index_for_tray_or_primary, physical_popup_size, popout_dock_visibility_action,
        popout_url, popup_lifecycle_action, popup_origin, popup_position_for_monitor,
        popup_render_recovery_script, popup_size_and_position, popup_target_height,
        popup_toggle_action, safe_existing_popup_position, sanitize_route,
        should_hide_after_popup_blur, suggestion_context_changed_script, AutoFillPopupShowStrategy,
        MonitorGeometry, PopoutDockVisibilityAction, PopupEntrySource, PopupLifecycleAction,
        PopupLifecycleEvent, PopupPresentationState, PopupToggleAction, PopupVisibilityHold,
        POPOUT_HEIGHT, POPOUT_MIN_HEIGHT, POPOUT_MIN_WIDTH, POPOUT_WIDTH,
        POPUP_PRESENTATION_BLUR_GRACE, POPUP_WINDOW_ERROR,
    };
    use std::time::{Duration, Instant};
    use tauri::{LogicalPosition, PhysicalPosition, PhysicalRect, PhysicalSize, Position, Url};

    fn rect(x: i32, y: i32, width: u32, height: u32) -> PhysicalRect<i32, u32> {
        PhysicalRect {
            position: PhysicalPosition::new(x, y),
            size: PhysicalSize::new(width, height),
        }
    }

    fn monitor(x: i32, y: i32, width: u32, height: u32, scale_factor: f64) -> MonitorGeometry {
        MonitorGeometry {
            physical_bounds: rect(x, y, width, height),
            work_area: rect(x, y, width, height),
            scale_factor,
        }
    }

    #[test]
    fn popout_url_preserves_in_app_hash_routes() {
        assert_eq!(
            format!("{:?}", popout_url("/tabs/settings")),
            r#"App("index.html?uilocation=popout#/tabs/settings")"#
        );
    }

    #[test]
    fn popout_url_rejects_external_routes() {
        assert_eq!(sanitize_route("https://example.com"), "/tabs/vault");
        assert_eq!(
            format!("{:?}", popout_url("https://example.com")),
            r#"App("index.html?uilocation=popout#/tabs/vault")"#
        );
    }

    #[test]
    fn popout_url_rejects_non_retained_and_encoded_routes() {
        for route in [
            "/attachments",
            "/import",
            "/notifications",
            "//host/path",
            "/view-cipher/%2Fsecret",
            "/edit-cipher?cipherId=cipher_1&type=1&token=secret",
        ] {
            assert_eq!(
                format!("{:?}", popout_url(route)),
                r#"App("index.html?uilocation=popout#/tabs/vault")"#,
                "{route}"
            );
        }
    }

    #[test]
    fn popout_url_preserves_retained_static_and_dynamic_routes() {
        for route in [
            "/tabs/vault",
            "/tabs/otp",
            "/tabs/generator",
            "/tabs/send",
            "/tabs/settings",
            "/account-switcher",
            "/vault-settings",
            "/account-security",
            "/settings-password",
            "/autofill",
            "/appearance",
            "/new-item",
            "/new-item?folderId=work_1",
            "/folders",
            "/archive",
            "/trash",
            "/generator-history",
            "/add-send",
            "/add-send?type=text",
            "/about",
            "/view-cipher/cipher_1",
            "/add-cipher",
            "/add-cipher?type=1&folderId=work_1",
            "/edit-cipher?cipherId=cipher_1&type=1",
            "/clone-cipher?cipherId=cipher_1&type=4",
            "/cipher-password-history?cipherId=cipher_1",
            "/edit-send?sendId=send_1&type=text",
            "/send-created?sendId=send_1",
            "/send-created?sendId=send_1&type=text",
        ] {
            assert_eq!(
                format!("{:?}", popout_url(route)),
                format!(r#"App("index.html?uilocation=popout#{route}")"#),
            );
        }
    }

    #[test]
    fn keyboard_shortcut_route_is_retained() {
        assert_eq!(sanitize_route("/keyboard-shortcut"), "/keyboard-shortcut");
    }

    #[test]
    fn existing_popout_navigation_uses_the_latest_retained_route() {
        let current: Url = "https://tauri.localhost/index.html?old=secret#/tabs/vault"
            .parse()
            .unwrap();
        assert_eq!(
            existing_popout_url(current.clone(), "/tabs/settings").as_str(),
            "https://tauri.localhost/index.html?uilocation=popout#/tabs/settings",
        );
        assert_eq!(
            existing_popout_url(current.clone(), "/generator-history").as_str(),
            "https://tauri.localhost/index.html?uilocation=popout#/generator-history",
        );
        assert_eq!(
            existing_popout_url(current, "/attachments").as_str(),
            "https://tauri.localhost/index.html?uilocation=popout#/tabs/vault",
        );
    }

    #[test]
    fn popup_is_centered_below_the_tray_anchor() {
        assert_eq!(
            popup_origin(
                rect(900, 0, 22, 22),
                PhysicalSize::new(480, 600),
                rect(0, 0, 1920, 1080),
            ),
            PhysicalPosition::new(671, 22),
        );
    }

    #[test]
    fn retina_monitor_selection_compares_the_physical_tray_rect_to_physical_bounds() {
        let retina = monitor(0, 0, 3840, 2160, 2.0);
        let physical_tray_rect = rect(3500, 0, 44, 44);
        let unscaled_monitor_width =
            f64::from(retina.physical_bounds.size.width) / retina.scale_factor;

        assert!(f64::from(physical_tray_rect.position.x) > unscaled_monitor_width);
        assert_eq!(
            monitor_index_for_tray(physical_tray_rect, &[retina]),
            Some(0)
        );
    }

    #[test]
    fn mixed_scale_monitor_selection_preserves_negative_physical_coordinates() {
        let monitors = [
            monitor(0, 0, 3024, 1964, 2.0),
            monitor(-1920, -180, 1920, 1080, 1.0),
        ];

        assert_eq!(
            monitor_index_for_tray(rect(-42, -180, 22, 22), &monitors),
            Some(1),
        );
        assert_eq!(
            monitor_index_for_tray(rect(2800, 0, 44, 44), &monitors),
            Some(0),
        );
    }

    #[test]
    fn hidden_status_item_falls_back_to_the_primary_monitor() {
        let monitors = [
            monitor(0, 0, 3024, 1964, 2.0),
            monitor(-1920, -180, 1920, 1080, 1.0),
        ];

        assert_eq!(
            monitor_index_for_tray_or_primary(rect(-4356, 4, 25, 24), &monitors, Some(0)),
            Some(0),
        );
    }

    #[test]
    fn hidden_status_item_uses_the_explicit_primary_monitor_when_it_is_not_first() {
        let monitors = [
            monitor(-1920, -180, 1920, 1080, 1.0),
            monitor(0, 0, 3024, 1964, 2.0),
        ];

        assert_eq!(
            monitor_index_for_tray_or_primary(rect(-4356, 4, 25, 24), &monitors, Some(1)),
            Some(1),
        );
    }

    #[test]
    fn mixed_scale_overlap_uses_each_monitors_physical_work_area_anchor() {
        let monitors = [
            MonitorGeometry {
                physical_bounds: rect(0, 0, 3024, 1964),
                work_area: rect(0, 48, 3024, 1916),
                scale_factor: 2.0,
            },
            MonitorGeometry {
                // The 1x display starts at the Retina display's unscaled right edge.
                physical_bounds: rect(1512, 0, 1920, 1080),
                work_area: rect(1512, 24, 1920, 1056),
                scale_factor: 1.0,
            },
        ];

        assert_eq!(
            monitor_index_for_tray(rect(2000, 0, 22, 22), &monitors),
            Some(1),
        );
        assert_eq!(
            monitor_index_for_tray(rect(2800, 0, 44, 44), &monitors),
            Some(0),
        );
    }

    #[test]
    fn popup_size_is_converted_through_logical_units_for_the_selected_scale() {
        assert_eq!(
            physical_popup_size(PhysicalSize::new(480, 600), 1.0, 2.0),
            Some(PhysicalSize::new(960, 1200)),
        );
        assert_eq!(
            physical_popup_size(PhysicalSize::new(960, 1200), 2.0, 1.0),
            Some(PhysicalSize::new(480, 600)),
        );
    }

    #[test]
    fn popup_position_from_retina_to_standard_display_is_target_logical() {
        let position = popup_position_for_monitor(
            rect(2500, 0, 22, 22),
            PhysicalSize::new(960, 1200),
            2.0,
            monitor(1920, 0, 1920, 1080, 1.0),
        );

        match position {
            Some(Position::Logical(position)) => {
                assert_eq!(position, LogicalPosition::new(2271.0, 22.0));
            }
            other => panic!("expected target logical position, got {other:?}"),
        }
    }

    #[test]
    fn popup_position_from_standard_to_retina_display_is_target_logical() {
        let position = popup_position_for_monitor(
            rect(1800, 0, 44, 44),
            PhysicalSize::new(480, 600),
            1.0,
            monitor(0, 0, 3840, 2160, 2.0),
        );

        match position {
            Some(Position::Logical(position)) => {
                assert_eq!(position, LogicalPosition::new(671.0, 22.0));
            }
            other => panic!("expected target logical position, got {other:?}"),
        }
    }

    #[test]
    fn popup_position_preserves_negative_target_logical_origin() {
        let target_monitor = MonitorGeometry {
            physical_bounds: rect(-3840, -240, 3840, 2160),
            work_area: rect(-3840, -240, 3840, 2160),
            scale_factor: 2.0,
        };
        let position = popup_position_for_monitor(
            rect(-3800, -240, 44, 44),
            PhysicalSize::new(480, 600),
            1.0,
            target_monitor,
        );

        match position {
            Some(Position::Logical(position)) => {
                assert_eq!(position, LogicalPosition::new(-1920.0, -98.0));
            }
            other => panic!("expected target logical position, got {other:?}"),
        }
    }

    #[test]
    fn popup_is_clamped_to_both_horizontal_work_area_edges() {
        let popup_size = PhysicalSize::new(480, 600);
        let work_area = rect(0, 0, 1920, 1080);

        assert_eq!(
            popup_origin(rect(0, 0, 22, 22), popup_size, work_area),
            PhysicalPosition::new(0, 22),
        );
        assert_eq!(
            popup_origin(rect(1900, 0, 22, 22), popup_size, work_area),
            PhysicalPosition::new(1440, 22),
        );
    }

    #[test]
    fn popup_clamping_preserves_negative_display_coordinates() {
        let work_area = rect(-1920, -120, 1920, 1080);

        assert_eq!(
            popup_origin(
                rect(-1918, -120, 22, 22),
                PhysicalSize::new(480, 600),
                work_area,
            ),
            PhysicalPosition::new(-1920, -98),
        );
        assert_eq!(
            popup_origin(
                rect(-20, -120, 22, 22),
                PhysicalSize::new(480, 600),
                work_area,
            ),
            PhysicalPosition::new(-480, -98),
        );
    }

    #[test]
    fn popup_is_clamped_vertically_inside_the_work_area() {
        assert_eq!(
            popup_origin(
                rect(900, 1000, 22, 22),
                PhysicalSize::new(480, 600),
                rect(0, 0, 1920, 1080),
            ),
            PhysicalPosition::new(671, 480),
        );
    }

    #[test]
    fn main_popup_deactivation_defers_hide_until_tray_click_processing_finishes() {
        assert_eq!(
            popup_lifecycle_action("main", PopupLifecycleEvent::Focused(false)),
            PopupLifecycleAction::HideAfterDelay,
        );
        assert_eq!(
            popup_lifecycle_action("main", PopupLifecycleEvent::CloseRequested),
            PopupLifecycleAction::PreventCloseAndHide,
        );
        assert_eq!(
            popup_lifecycle_action("main", PopupLifecycleEvent::Focused(true)),
            PopupLifecycleAction::Keep,
        );
        assert_eq!(
            popup_lifecycle_action("popout", PopupLifecycleEvent::CloseRequested),
            PopupLifecycleAction::Keep,
        );
    }

    #[test]
    fn floating_autofill_open_retries_without_tray_geometry_instead_of_disappearing() {
        assert_eq!(
            autofill_popup_show_strategies(),
            [
                AutoFillPopupShowStrategy::TrayPositioned,
                AutoFillPopupShowStrategy::ExistingPosition,
            ]
        );
    }

    #[test]
    fn floating_autofill_existing_position_is_moved_onto_an_active_monitor() {
        let monitors = [monitor(0, 0, 1440, 900, 2.0)];
        assert_eq!(
            safe_existing_popup_position(
                PhysicalPosition::new(3000, 200),
                PhysicalSize::new(480, 600),
                &monitors,
                Some(0),
            ),
            Some(PhysicalPosition::new(960, 200)),
        );
        assert_eq!(
            safe_existing_popup_position(
                PhysicalPosition::new(100, 100),
                PhysicalSize::new(480, 600),
                &monitors,
                Some(0),
            ),
            Some(PhysicalPosition::new(100, 100)),
        );
        assert_eq!(
            safe_existing_popup_position(
                PhysicalPosition::new(1439, 100),
                PhysicalSize::new(480, 600),
                &monitors,
                Some(0),
            ),
            Some(PhysicalPosition::new(960, 100)),
            "a one-pixel sliver is not an operable fallback window",
        );
    }

    #[test]
    fn secure_input_recovery_orders_popup_front_before_requesting_focus() {
        let source = include_str!("window.rs");
        let presentation = source
            .split("fn present_popup_window(")
            .nth(1)
            .and_then(|source| source.split("fn safe_existing_popup_position(").next())
            .expect("popup presentation implementation should remain discoverable");

        assert!(
            !presentation.contains(
                "let _ = window.hide();\n        return Err(POPUP_WINDOW_ERROR.to_owned());"
            ),
            "secure password fields can deny focus; the popup must remain visible instead of hiding"
        );
        let show = presentation
            .find("window.show()")
            .expect("popup should be made visible first");
        let order_front = presentation
            .find("order_popup_front_regardless(window)")
            .expect("secure-input recovery must force the popup above the active application");
        let focus = presentation
            .find("window.set_focus()")
            .expect("popup should still request keyboard focus");

        assert!(show < order_front && order_front < focus);

        let native_presentation = source
            .split("fn order_popup_front_regardless(")
            .nth(1)
            .and_then(|source| source.split("fn safe_existing_popup_position(").next())
            .expect("native popup presentation implementation should remain discoverable");
        assert!(native_presentation.contains("MainThreadMarker::new()"));
        assert!(native_presentation.contains("NSApplication::sharedApplication"));
        let floating_level = native_presentation
            .find("setLevel(NSFloatingWindowLevel)")
            .expect("menu bar popups must remain above a secure-input browser window");
        let order_front = native_presentation
            .find("orderFrontRegardless")
            .expect("popup should still be ordered to the front within its level");
        assert!(floating_level < order_front);
        assert!(native_presentation.contains("application.activate()"));
        assert!(native_presentation.contains("makeKeyAndOrderFront"));
        assert!(native_presentation.contains("orderFrontRegardless"));
    }

    #[test]
    fn popup_visibility_hold_remains_active_until_every_guard_is_released() {
        let hold = PopupVisibilityHold::default();
        let first = hold.acquire();
        let second = hold.acquire();

        assert!(hold.is_held());
        drop(first);
        assert!(hold.is_held());
        drop(second);
        assert!(!hold.is_held());
    }

    #[test]
    fn focus_denied_after_presentation_does_not_schedule_auto_hide() {
        let state = PopupPresentationState::default();

        state.mark_presented();

        assert_eq!(state.begin_blur_hide(), None);
    }

    #[test]
    fn a_new_presentation_cancels_an_older_delayed_blur_hide() {
        let state = PopupPresentationState::default();
        let first_presentation = Instant::now();
        state.mark_presented_at(first_presentation);
        state.mark_focused();
        let stale_revision = state
            .begin_blur_hide_at(
                first_presentation + POPUP_PRESENTATION_BLUR_GRACE + Duration::from_millis(1),
            )
            .expect("a focused popup may hide after losing focus");

        state.mark_presented_at(
            first_presentation + POPUP_PRESENTATION_BLUR_GRACE + Duration::from_millis(2),
        );

        assert!(!state.blur_hide_is_current(stale_revision));
    }

    #[test]
    fn a_focused_presentation_still_auto_hides_after_losing_focus() {
        let state = PopupPresentationState::default();
        let presented_at = Instant::now();
        state.mark_presented_at(presented_at);
        state.mark_focused();

        let revision = state
            .begin_blur_hide_at(
                presented_at + POPUP_PRESENTATION_BLUR_GRACE + Duration::from_millis(1),
            )
            .expect("a focused popup may hide after losing focus");

        assert!(state.blur_hide_is_current(revision));
    }

    #[test]
    fn transient_focus_loss_during_presentation_grace_does_not_hide_the_popup() {
        let state = PopupPresentationState::default();
        let presented_at = Instant::now();
        state.mark_presented_at(presented_at);
        state.mark_focused();

        assert_eq!(
            state.begin_blur_hide_at(presented_at + Duration::from_millis(100)),
            None,
        );
    }

    #[test]
    fn popup_blur_hides_only_when_no_native_security_operation_is_active() {
        assert!(should_hide_after_popup_blur(false, false));
        assert!(!should_hide_after_popup_blur(false, true));
        assert!(!should_hide_after_popup_blur(true, false));
    }

    #[test]
    fn popout_dock_visibility_tracks_only_popout_open_and_destroy_events() {
        assert_eq!(
            popout_dock_visibility_action("popout", PopupLifecycleEvent::Opened),
            Some(PopoutDockVisibilityAction::Show),
        );
        assert_eq!(
            popout_dock_visibility_action("popout", PopupLifecycleEvent::Destroyed),
            Some(PopoutDockVisibilityAction::Hide),
        );
        assert_eq!(
            popout_dock_visibility_action("main", PopupLifecycleEvent::Focused(false)),
            None,
        );
    }

    #[test]
    fn hidden_popup_toggle_requests_show() {
        assert_eq!(
            popup_toggle_action(false, false, false),
            PopupToggleAction::Show
        );
    }

    #[test]
    fn focused_visible_popup_toggle_requests_hide() {
        assert_eq!(
            popup_toggle_action(true, true, false),
            PopupToggleAction::Hide
        );
    }

    #[test]
    fn unfocused_visible_popup_toggle_requests_hide() {
        assert_eq!(
            popup_toggle_action(true, false, false),
            PopupToggleAction::Hide
        );
    }

    #[test]
    fn native_popup_installs_an_external_click_dismiss_monitor() {
        let source = include_str!("window.rs");
        let native_configuration = source
            .split("fn configure_native_popup_window(")
            .nth(1)
            .and_then(|source| source.split("struct PopupGeometryContext").next())
            .expect("native popup configuration should remain discoverable");

        assert!(native_configuration.contains("install_external_click_dismiss_monitor(app)"));
        assert!(source.contains("addGlobalMonitorForEventsMatchingMask_handler"));
        assert!(source.contains("should_hide_after_external_mouse_down"));
    }

    #[test]
    fn tray_click_that_just_blurred_the_popup_still_requests_hide() {
        assert_eq!(
            popup_toggle_action(true, false, true),
            PopupToggleAction::Hide
        );
    }

    #[test]
    fn popup_hidden_for_one_minute_requests_initial_state_on_next_show() {
        let state = PopupPresentationState::default();
        let hidden_at = std::time::Instant::now();
        state.mark_hidden_at(hidden_at);

        assert!(!state.take_reset_required_at(hidden_at + std::time::Duration::from_secs(59)));
        state.mark_hidden_at(hidden_at);
        assert!(state.take_reset_required_at(hidden_at + std::time::Duration::from_secs(60)));
        assert!(!state.take_reset_required_at(hidden_at + std::time::Duration::from_secs(120)));
    }

    #[test]
    fn popup_show_reports_reset_intent_after_two_render_recovery_frames() {
        let script = popup_render_recovery_script(true, PopupEntrySource::Vault, 42);

        assert!(script.contains("barwarden:popup-entry"));
        assert!(script.contains("barwarden:popup-shown"));
        assert!(script.contains("reset: true"));
        assert!(script.contains("entrySource: \"vault\""));
        assert!(script.contains("suggestionRevision: \"42\""));
        assert_eq!(script.matches("requestAnimationFrame").count(), 2);
        assert!(
            script.find("barwarden:popup-entry").unwrap()
                < script.find("requestAnimationFrame").unwrap(),
            "functional entry delivery must not wait for WebKit compositor frames",
        );
    }

    #[test]
    fn autofill_entry_reports_the_exact_menu_or_shortcut_source() {
        let menu = popup_render_recovery_script(false, PopupEntrySource::AutoFillMenu, 7);
        let shortcut = popup_render_recovery_script(false, PopupEntrySource::AutoFillShortcut, 7);

        assert!(menu.contains("entrySource: \"autofill-menu\""));
        assert!(shortcut.contains("entrySource: \"autofill-shortcut\""));
        let floating = popup_render_recovery_script(false, PopupEntrySource::AutoFillFloating, 7);
        assert!(floating.contains("entrySource: \"autofill-floating\""));
    }

    #[test]
    fn background_suggestion_event_carries_the_revision_as_a_decimal_string() {
        let script = suggestion_context_changed_script(18_446_744_073_709_551_615);

        assert!(script.contains("barwarden:suggestion-context-changed"));
        assert!(script.contains("suggestionRevision: \"18446744073709551615\""));
    }

    #[test]
    fn popout_size_matches_official_layout_reference() {
        assert_eq!((POPOUT_WIDTH, POPOUT_HEIGHT), (900.0, 640.0));
        assert_eq!((POPOUT_MIN_WIDTH, POPOUT_MIN_HEIGHT), (480.0, 600.0));
    }

    #[test]
    fn popup_height_uses_the_minimum_and_work_area_margin() {
        assert_eq!(popup_target_height(100.0, 1080.0), Ok(600.0));
        assert_eq!(popup_target_height(900.0, 700.0), Ok(676.0));
        assert_eq!(popup_target_height(999.0, 400.0), Ok(600.0));
    }

    #[test]
    fn popup_size_and_position_keeps_width_and_tray_top_edge_when_possible() {
        let geometry =
            popup_size_and_position(rect(900, 0, 22, 22), 720.0, monitor(0, 0, 1920, 1080, 1.0))
                .unwrap();

        assert_eq!(geometry.0, PhysicalSize::new(480, 720));
        assert_eq!(geometry.1, PhysicalPosition::new(671, 22));
    }

    #[test]
    fn popup_size_and_position_clamps_the_bottom_and_converts_retina_logical_size() {
        let retina = monitor(0, 0, 3840, 2160, 2.0);
        let geometry = popup_size_and_position(rect(3500, 2000, 44, 44), 1000.0, retina).unwrap();

        assert_eq!(geometry.0, PhysicalSize::new(960, 2000));
        assert_eq!(geometry.1.y, 160);
        assert_eq!(popup_target_height(600.0, 1080.0), Ok(600.0));
    }

    #[test]
    fn popup_height_rejects_invalid_requests_with_the_generic_error() {
        for height in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY, -1.0] {
            assert_eq!(
                popup_target_height(height, 1080.0),
                Err(POPUP_WINDOW_ERROR.to_owned())
            );
        }
    }
}

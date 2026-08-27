use std::ptr::NonNull;
use std::sync::OnceLock;

use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2_app_kit::{
    NSWorkspace, NSWorkspaceDidActivateApplicationNotification,
    NSWorkspaceDidTerminateApplicationNotification,
};
use objc2_foundation::NSNotification;

static WORKSPACE_TOKENS: OnceLock<(usize, usize)> = OnceLock::new();

pub(crate) fn start(
    app: tauri::AppHandle,
    monitor: crate::suggestion_count::SuggestionCountMonitor,
) {
    monitor.start();
    let _ = app.run_on_main_thread(move || install_workspace_observers(monitor));
}

fn install_workspace_observers(monitor: crate::suggestion_count::SuggestionCountMonitor) {
    WORKSPACE_TOKENS.get_or_init(|| {
        let center = NSWorkspace::sharedWorkspace().notificationCenter();
        let activation_monitor = monitor.clone();
        let activated = RcBlock::new(move |_notification: NonNull<NSNotification>| {
            let target = crate::frontmost::current_frontmost_app().ok().flatten();
            activation_monitor.observe_activation(target);
        });
        let terminated = RcBlock::new(move |_notification: NonNull<NSNotification>| {
            monitor.observe_termination();
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
            Retained::into_raw(activated_token) as *mut AnyObject as usize,
            Retained::into_raw(terminated_token) as *mut AnyObject as usize,
        )
    });
}

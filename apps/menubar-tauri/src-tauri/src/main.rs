mod accessibility_focus;
mod autofill_ax_context;
mod autofill_contract;
mod autofill_detected_fill;
mod autofill_field_context;
mod autofill_floating;
mod autofill_ipc;
mod autofill_projection;
mod autofill_reprompt;
mod biometric;
#[cfg(target_os = "macos")]
mod biometric_macos;
mod brand;
mod browser_context;
#[cfg(target_os = "macos")]
mod browser_context_macos;
mod clipboard;
mod frontmost;
mod global_shortcut;
mod http;
mod keychain;
mod lock_intent;
#[cfg(target_os = "macos")]
mod login_item;
mod opener;
mod paste;
mod session_broker;
mod tray;
mod window;

use std::fs;
use std::io;

use tauri::Manager;

fn should_show_popup_on_reopen(has_visible_windows: bool) -> bool {
    !has_visible_windows
}

fn updater_plugin_is_configured(config: &tauri::Config) -> bool {
    config
        .plugins
        .0
        .get("updater")
        .is_some_and(serde_json::Value::is_object)
}

fn main() {
    #[cfg(all(target_os = "macos", debug_assertions))]
    if let Some(output_dir) = std::env::var_os("BARWARDEN_AUTOFILL_PILL_FIXTURE_DIR") {
        autofill_floating::render_native_pill_fixture(std::path::Path::new(&output_dir))
            .expect("render deterministic native AutoFill pill fixture");
        return;
    }

    let context = tauri::generate_context!();
    let observer_generation = autofill_ax_context::ObserverGeneration::default();
    let detected_fill_contexts =
        autofill_ax_context::DetectedFillContextStore::with_observer_generation(
            observer_generation.clone(),
        );
    let floating_controller =
        autofill_floating::AutoFillFloatingController::with_observer_generation(
            observer_generation,
        );
    let mut builder = tauri::Builder::default()
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if global_shortcut::shortcut_trigger_action(event.state)
                        == global_shortcut::ShortcutTriggerAction::OpenAutoFill
                    {
                        let _ = crate::window::show_autofill_picker_window(
                            app,
                            crate::window::PopupEntrySource::AutoFillShortcut,
                        );
                    }
                })
                .build(),
        )
        .plugin(tauri_plugin_process::init())
        .manage(biometric::BiometricState::new(
            biometric_macos::MacBiometricBackend::default(),
        ))
        .manage(clipboard::ClipboardGeneration::default())
        .manage(window::PopupVisibilityHold::default())
        .manage(window::PopupPresentationState::default())
        .manage(floating_controller)
        .manage(detected_fill_contexts.clone())
        .manage(session_broker::SessionBroker::new(
            uuid::Uuid::new_v4().to_string(),
        ))
        .manage(std::sync::Arc::new(
            autofill_reprompt::AutoFillRepromptReceiptStore::default(),
        ))
        .manage(
            autofill_projection::system_projection_manager()
                .unwrap_or_else(|_| panic!("failed to initialize native AutoFill projection")),
        );

    if updater_plugin_is_configured(context.config()) {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }

    let app = builder
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let config_dir = app
                .path()
                .app_config_dir()
                .map_err(|_| io::Error::other("global shortcut setup failed"))?;
            fs::create_dir_all(&config_dir)
                .map_err(|_| io::Error::other("global shortcut setup failed"))?;
            let shortcut_state =
                global_shortcut::GlobalShortcutState::load(app.handle().clone(), config_dir)
                    .map_err(|_| io::Error::other("global shortcut setup failed"))?;
            app.manage(shortcut_state);
            #[cfg(target_os = "macos")]
            window::configure_native_popup_window(app.handle())?;
            let floating = app
                .state::<autofill_floating::AutoFillFloatingController>()
                .inner()
                .clone();
            autofill_floating::start_native_observer(app.handle().clone(), floating);
            tray::setup_tray(app.handle())?;
            Ok(())
        })
        .on_window_event(window::handle_window_event)
        .invoke_handler(tauri::generate_handler![
            window::show_popup,
            window::hide_popup,
            window::popup_window_metrics,
            window::pop_out,
            window::set_popup_height,
            frontmost::autofill_entry_context,
            autofill_floating::autofill_accessibility_status,
            autofill_floating::autofill_set_accessibility_fallback,
            autofill_floating::autofill_set_floating_icon_enabled,
            autofill_floating::autofill_request_accessibility_permission,
            biometric::biometric_status,
            biometric::biometric_enable,
            biometric::biometric_unlock,
            biometric::autofill_biometric_reprompt,
            biometric::biometric_disable,
            autofill_ipc::autofill_agent_probe,
            autofill_ipc::autofill_agent_status,
            autofill_ipc::autofill_agent_lock,
            autofill_ipc::autofill_agent_session,
            autofill_ipc::autofill_query_candidates,
            autofill_ipc::autofill_release_secret,
            autofill_detected_fill::autofill_fill_detected,
            autofill_reprompt::autofill_begin_reprompt,
            autofill_reprompt::autofill_cancel_reprompt,
            autofill_reprompt::autofill_begin_batch_reprompt,
            autofill_reprompt::autofill_cancel_batch_reprompt,
            autofill_projection::autofill_capture_projection_binding,
            autofill_projection::autofill_replace_projection,
            autofill_projection::autofill_clear_projection,
            autofill_projection::autofill_lock_projection,
            autofill_projection::autofill_reset_projection_for_reprojection,
            clipboard::copy_text,
            paste::paste_text,
            keychain::secure_get,
            keychain::secure_set,
            keychain::secure_delete,
            keychain::secure_compare_and_swap,
            keychain::secure_get_or_create_uuid,
            lock_intent::get_account_lock_intents,
            lock_intent::set_account_lock_intents,
            session_broker::session_broker_attach,
            session_broker::session_broker_snapshot,
            session_broker::session_broker_mutate,
            session_broker::session_broker_set_handoff,
            session_broker::session_broker_handoff,
            http::http_fetch_json,
            opener::open_url,
            global_shortcut::get_global_shortcut,
            global_shortcut::set_global_shortcut,
            global_shortcut::clear_global_shortcut,
            browser_context::captured_website_context,
            login_item::get_launch_at_login,
            login_item::set_launch_at_login,
            login_item::autofill_agent_registration_status,
            login_item::autofill_agent_register,
            login_item::autofill_agent_unregister,
        ])
        .build(context)
        .unwrap_or_else(|error| panic!("failed to run {}: {error}", brand::PRODUCT_NAME));

    app.run(|app, event| {
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Reopen {
            has_visible_windows,
            ..
        } = event
        {
            if should_show_popup_on_reopen(has_visible_windows) {
                let _ = window::show_popup_window(app, None);
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::{should_show_popup_on_reopen, updater_plugin_is_configured};

    #[test]
    fn reopen_recovers_a_hidden_menu_bar_popup() {
        assert!(should_show_popup_on_reopen(false));
        assert!(!should_show_popup_on_reopen(true));
    }

    #[test]
    fn updater_plugin_is_disabled_without_an_object_configuration() {
        let mut config = tauri::Config::default();
        assert!(!updater_plugin_is_configured(&config));

        config
            .plugins
            .0
            .insert("updater".into(), serde_json::Value::Null);
        assert!(!updater_plugin_is_configured(&config));
    }

    #[test]
    fn updater_plugin_is_enabled_with_an_object_configuration() {
        let mut config = tauri::Config::default();
        config.plugins.0.insert(
            "updater".into(),
            serde_json::json!({ "pubkey": "public-key", "endpoints": [] }),
        );

        assert!(updater_plugin_is_configured(&config));
    }
}

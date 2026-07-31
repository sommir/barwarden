mod biometric;
#[cfg(target_os = "macos")]
mod biometric_macos;
mod brand;
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
    let context = tauri::generate_context!();
    let mut builder = tauri::Builder::default()
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if global_shortcut::shortcut_trigger_action(event.state)
                        == global_shortcut::ShortcutTriggerAction::Toggle
                    {
                        let _ = crate::window::toggle_popup_window(app, None);
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
        .manage(session_broker::SessionBroker::new(
            uuid::Uuid::new_v4().to_string(),
        ));

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
            biometric::biometric_status,
            biometric::biometric_enable,
            biometric::biometric_unlock,
            biometric::biometric_disable,
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
            login_item::get_launch_at_login,
            login_item::set_launch_at_login,
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

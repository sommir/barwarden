use crate::window::{
    hide_popup_window, show_autofill_picker_window, show_popup_window, toggle_popup_window,
    PopupEntrySource,
};
use tauri::image::Image;
use tauri::menu::MenuBuilder;
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

const MENU_AUTOFILL: &str = "autofill";
const MENU_SHOW: &str = "show";
const MENU_HIDE: &str = "hide";
const MENU_QUIT: &str = "quit";
const BARWARDEN_TEMPLATE_ICON_PNG: &[u8] = include_bytes!("../icons/tray-template@2x.png");

pub fn setup_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    let menu = MenuBuilder::new(app)
        .text(MENU_AUTOFILL, "AutoFill…")
        .separator()
        .text(MENU_SHOW, "Show Popup")
        .text(MENU_HIDE, "Hide Popup")
        .separator()
        .text(MENU_QUIT, "Quit")
        .build()?;
    let icon = template_tray_icon()?;

    TrayIconBuilder::with_id("main")
        .icon(icon)
        .icon_as_template(true)
        .tooltip(crate::brand::PRODUCT_NAME)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if let Some(rect) = primary_click_rect(&event) {
                let _ = toggle_popup_window(tray.app_handle(), Some(rect));
            }
        })
        .on_menu_event(|app, event| match event.id().as_ref() {
            MENU_AUTOFILL => {
                let _ = show_autofill_picker_window(app, PopupEntrySource::AutoFillMenu);
            }
            MENU_SHOW => {
                let _ = show_popup_window(app, None);
            }
            MENU_HIDE => {
                let _ = hide_popup_window(app);
            }
            MENU_QUIT => app.exit(0),
            _ => {}
        })
        .build(app)?;

    Ok(())
}

fn is_primary_click(event: &TrayIconEvent) -> bool {
    matches!(
        event,
        TrayIconEvent::Click {
            button: MouseButton::Left,
            button_state: MouseButtonState::Up,
            ..
        }
    )
}

fn primary_click_rect(event: &TrayIconEvent) -> Option<tauri::Rect> {
    match event {
        TrayIconEvent::Click { rect, .. } if is_primary_click(event) => Some(*rect),
        _ => None,
    }
}

fn template_tray_icon() -> tauri::Result<Image<'static>> {
    Image::from_bytes(BARWARDEN_TEMPLATE_ICON_PNG)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::{PhysicalPosition, PhysicalSize, Position, Rect, Size};

    #[test]
    fn primary_left_button_release_requests_toggle() {
        let event = TrayIconEvent::Click {
            id: "main".into(),
            position: PhysicalPosition::new(0.0, 0.0),
            rect: Rect {
                position: Position::Physical(PhysicalPosition::new(0, 0)),
                size: Size::Physical(PhysicalSize::new(22, 22)),
            },
            button: MouseButton::Left,
            button_state: MouseButtonState::Up,
        };

        assert!(primary_click_rect(&event).is_some());
    }

    #[test]
    fn secondary_click_does_not_request_toggle() {
        let event = TrayIconEvent::Click {
            id: "main".into(),
            position: PhysicalPosition::new(0.0, 0.0),
            rect: Rect {
                position: Position::Physical(PhysicalPosition::new(0, 0)),
                size: Size::Physical(PhysicalSize::new(22, 22)),
            },
            button: MouseButton::Right,
            button_state: MouseButtonState::Up,
        };

        assert!(primary_click_rect(&event).is_none());
    }

    #[test]
    fn primary_left_click_propagates_the_event_tray_rectangle() {
        let expected = Rect {
            position: Position::Physical(PhysicalPosition::new(-1200, -24)),
            size: Size::Physical(PhysicalSize::new(22, 22)),
        };
        let event = TrayIconEvent::Click {
            id: "main".into(),
            position: PhysicalPosition::new(-1189.0, -13.0),
            rect: expected,
            button: MouseButton::Left,
            button_state: MouseButtonState::Up,
        };

        let propagated = primary_click_rect(&event).expect("primary click rectangle");
        assert!(matches!(
            propagated.position,
            Position::Physical(position) if position == PhysicalPosition::new(-1200, -24)
        ));
        assert!(matches!(
            propagated.size,
            Size::Physical(size) if size == PhysicalSize::new(22, 22)
        ));
    }

    #[test]
    fn tray_icon_decodes_the_barwarden_retina_template_asset() {
        let icon = template_tray_icon().expect("Barwarden template icon");

        assert_eq!(icon.width(), 36);
        assert_eq!(icon.height(), 36);
        assert_eq!(icon.rgba().len(), 36 * 36 * 4);
    }

    #[test]
    fn tray_icon_contains_visible_and_transparent_template_pixels() {
        let icon = template_tray_icon().expect("Barwarden template icon");
        let alpha: Vec<_> = icon.rgba().chunks_exact(4).map(|pixel| pixel[3]).collect();

        assert!(alpha.contains(&0));
        assert!(alpha.iter().any(|value| *value > 0));
    }
}

// Notification-area icon: Open, Settings, Pause, Check for updates, Quit.

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter};

use crate::island::WINDOW_LABEL;

pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open Winsle", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?;
    let pause = MenuItem::with_id(app, "pause", "Pause", true, None::<&str>)?;
    let update = MenuItem::with_id(app, "update", "Check for updates", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;

    let menu = Menu::with_items(app, &[&open, &sep1, &settings, &pause, &update, &sep2, &quit])?;

    let update_item = update.clone();
    let mut builder = TrayIconBuilder::with_id("winsle")
        .tooltip("Winsle")
        .menu(&menu)
        .on_menu_event(move |app: &AppHandle, event| match event.id.as_ref() {
            "quit" => app.exit(0),
            "settings" => crate::show_settings_window(app),
            "update" => {
                let (app, item) = (app.clone(), update_item.clone());
                tauri::async_runtime::spawn(async move {
                    let pending = item.text().map(|t| t.starts_with("Install")).unwrap_or(false);
                    if pending {
                        crate::updater::install(&app, &item).await;
                    } else {
                        crate::updater::check(&app, &item, true).await;
                    }
                });
            }
            id => {
                let _ = app.emit_to(WINDOW_LABEL, "tray", id.to_string());
            }
        });

    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }

    builder.build(app)?;
    crate::updater::spawn(app.clone(), update);
    Ok(())
}

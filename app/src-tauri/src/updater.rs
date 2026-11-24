// Signed auto-update from GitHub Releases (latest.json, minisign key in
// tauri.conf.json). Checks a minute after launch, then twice a day; installing is
// always the user's click in the tray, never silent.

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use tauri::menu::MenuItem;
use tauri::{AppHandle, Emitter, Wry};
use tauri_plugin_updater::UpdaterExt;

use crate::log;

const FIRST_CHECK: Duration = Duration::from_secs(60);
const EVERY: Duration = Duration::from_secs(12 * 3600);
const MAX_VERSION_LEN: usize = 32;
const MAX_FLASH_LEN: usize = 160;

static INSTALLING: AtomicBool = AtomicBool::new(false);

/// Sanitizes a remote release version string for safe display in tray menus and toasts.
pub(crate) fn sanitize_version(raw: &str) -> String {
    let cleaned: String = raw
        .trim()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '+'))
        .take(MAX_VERSION_LEN)
        .collect();
    if cleaned.is_empty() {
        "latest".to_string()
    } else {
        cleaned
    }
}

pub(crate) fn format_install_label(version: &str) -> String {
    format!("Install update {}", sanitize_version(version))
}

pub(crate) fn format_available_title(version: &str) -> String {
    format!("Update {} available", sanitize_version(version))
}

struct InstallGuard;
impl Drop for InstallGuard {
    fn drop(&mut self) {
        INSTALLING.store(false, Ordering::Release);
    }
}

pub fn spawn(app: AppHandle, item: MenuItem<Wry>) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(FIRST_CHECK).await;
        loop {
            check(&app, &item, false).await;
            tokio::time::sleep(EVERY).await;
        }
    });
}

/// `manual`: the user clicked "Check for updates", so report "up to date" and errors too.
pub async fn check(app: &AppHandle, item: &MenuItem<Wry>, manual: bool) {
    let found = match app.updater() {
        Ok(u) => u.check().await,
        Err(e) => Err(e),
    };
    match found {
        Ok(Some(update)) => {
            let _ = item.set_text(format_install_label(&update.version));
            let _ = app.emit("live-flash", flash(&format_available_title(&update.version), "Tray icon → Install update"));
        }
        Ok(None) => {
            if manual {
                let _ = app.emit("live-flash", flash("Winsle is up to date", env!("CARGO_PKG_VERSION")));
            }
        }
        Err(e) => {
            log::line(format!("updater: {e}"));
            if manual {
                let _ = app.emit("live-flash", flash("Update check failed", "Check your connection and try again"));
            }
        }
    }
}

/// Downloads, verifies the signature and runs the installer (which closes Winsle and relaunches it).
pub async fn install(app: &AppHandle, item: &MenuItem<Wry>) {
    if INSTALLING
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return;
    }
    let _guard = InstallGuard;

    let update = match app.updater() {
        Ok(u) => u.check().await,
        Err(e) => Err(e),
    };
    let update = match update {
        Ok(Some(u)) => u,
        Ok(None) => return check(app, item, true).await,
        Err(e) => {
            log::line(format!("updater: {e}"));
            let _ = app.emit("live-flash", flash("Update check failed", "Check your connection and try again"));
            return;
        }
    };
    let _ = item.set_text("Downloading update…");
    let _ = item.set_enabled(false);
    if let Err(e) = update.download_and_install(|_, _| {}, || {}).await {
        log::line(format!("updater install: {e}"));
        let _ = item.set_text(format_install_label(&update.version));
        let _ = item.set_enabled(true);
        let _ = app.emit("live-flash", flash("Update failed", "Try again from the tray menu"));
        return;
    }
    app.restart();
}

pub(crate) fn flash(title: &str, sub: &str) -> serde_json::Value {
    let clean = |s: &str| -> String {
        s.chars()
            .filter(|c| !c.is_control())
            .take(MAX_FLASH_LEN)
            .collect()
    };
    serde_json::json!({ "title": clean(title), "sub": clean(sub) })
}

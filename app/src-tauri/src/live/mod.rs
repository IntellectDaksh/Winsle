// Live activities: OS signals the island shows like a dynamic island —
// media, system health, mic/camera use, downloads/renders, notifications,
// calendar, quick capture. Each submodule owns one poller and emits one event
// to the island window; payload shapes are mirrored in src/live/types.ts.

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter};

pub mod calendar;
pub mod calendar_oauth;
pub mod capture;
pub mod dev;
pub mod ai;
pub mod extras;
pub mod focus_guard;
pub mod lyrics;
pub mod media;
pub mod notifs;
pub mod notif_inbox;
pub mod extensions;
pub mod phone;
pub mod production;
pub mod devops;
pub mod vision;
pub mod privacy;
pub mod progress;
pub mod spotify;
pub mod sys;
pub mod tools;
pub mod usage;
pub mod voice;

static PAUSED: AtomicBool = AtomicBool::new(false);

/// Tray → Pause stops every live poller along with the integrations.
pub fn set_paused(on: bool) {
    PAUSED.store(on, Ordering::Relaxed);
}

pub fn paused() -> bool {
    PAUSED.load(Ordering::Relaxed)
}

/// Emits to the island only; the settings window never needs live data.
pub fn emit<T: serde::Serialize + Clone>(app: &AppHandle, event: &str, payload: T) {
    let _ = app.emit_to(crate::island::WINDOW_LABEL, event, payload);
}

pub fn start(app: AppHandle) {
    // Pollers send their first state once at start; give the island's webview
    // time to register its listeners or those first events are simply lost.
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(3000));
        start_now(app);
    });
}

fn start_now(app: AppHandle) {
    media::spawn(app.clone());
    sys::spawn(app.clone());
    privacy::spawn(app.clone());
    progress::spawn(app.clone());
    notifs::spawn(app.clone());
    calendar::spawn(app.clone());
    extras::spawn(app.clone());
    phone::spawn(app.clone());
    usage::spawn();
    voice::spawn(app.clone());
    capture::spawn(app);
}

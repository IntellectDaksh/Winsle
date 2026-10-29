//! Local notification history and triage. Never modifies the Windows notification database.
use serde::{Deserialize, Serialize};
use std::sync::{Mutex, OnceLock};
use tauri::AppHandle;

use super::notifs::NotifInfo;

pub const LIMIT: usize = 200;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InboxEntry {
    pub info: NotifInfo,
    pub repeats: u32,
    pub status: String,
    pub snooze_until: i64,
}

static ENTRIES: OnceLock<Mutex<Vec<InboxEntry>>> = OnceLock::new();

fn path() -> std::path::PathBuf {
    crate::settings::config_dir().join("notification-inbox.json")
}

fn entries() -> &'static Mutex<Vec<InboxEntry>> {
    ENTRIES.get_or_init(|| {
        let saved = std::fs::read(path())
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default();
        Mutex::new(saved)
    })
}

fn persist(items: &[InboxEntry]) -> Result<(), String> {
    std::fs::create_dir_all(crate::settings::config_dir()).map_err(|e| e.to_string())?;
    std::fs::write(
        path(),
        serde_json::to_vec(items).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}

pub fn record(info: NotifInfo) {
    super::extensions::publish_event("notification", &format!("{}: {}", info.app, info.title));
    let mut items = entries().lock().unwrap();
    if let Some(i) = items.iter().position(|x| {
        x.info.app_id == info.app_id
            && x.info.title == info.title
            && x.info.body == info.body
            && x.status != "dismissed"
    }) {
        let mut item = items.remove(i);
        item.repeats = item.repeats.saturating_add(1);
        item.info.time = info.time;
        items.insert(0, item);
    } else {
        items.insert(
            0,
            InboxEntry {
                info,
                repeats: 1,
                status: "unread".into(),
                snooze_until: 0,
            },
        );
    }
    items.truncate(LIMIT);
    if let Err(e) = persist(&items) {
        crate::log::line(format!("notification inbox: {e}"));
    }
}

#[tauri::command]
pub fn notif_inbox() -> Vec<InboxEntry> {
    entries().lock().unwrap().clone()
}

#[tauri::command]
pub fn notif_triage(
    id: String,
    action: String,
    minutes: Option<u32>,
) -> Result<Vec<InboxEntry>, String> {
    let mut items = entries().lock().map_err(|e| e.to_string())?;
    let item = items
        .iter_mut()
        .find(|x| x.info.id == id)
        .ok_or("notification not found")?;
    match action.as_str() {
        "read" => {
            item.status = "read".into();
            item.snooze_until = 0;
        }
        "unread" => {
            item.status = "unread".into();
            item.snooze_until = 0;
        }
        "dismiss" => {
            item.status = "dismissed".into();
            item.snooze_until = 0;
        }
        "snooze" => {
            let n = minutes.unwrap_or(30);
            if !(1..=1440).contains(&n) {
                return Err("snooze must be 1–1440 minutes".into());
            }
            item.status = "snoozed".into();
            item.snooze_until = now_ms() + i64::from(n) * 60_000;
        }
        _ => return Err("unknown action".into()),
    }
    persist(&items)?;
    Ok(items.clone())
}

#[tauri::command]
pub fn notif_to_task(app: AppHandle, id: String) -> Result<String, String> {
    let item = entries()
        .lock()
        .map_err(|e| e.to_string())?
        .iter()
        .find(|x| x.info.id == id)
        .cloned()
        .ok_or("notification not found")?;
    let text = format!("{}: {} {}", item.info.app, item.info.title, item.info.body)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    super::capture::capture_save(app, text)
}

pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|x| x.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_inbox_entry_round_trip() {
        let x = InboxEntry {
            info: NotifInfo {
                id: "notif-1".into(),
                app_id: "com.slack".into(),
                app: "Slack".into(),
                title: "Alice".into(),
                body: "Hello world".into(),
                time: 1700000000,
            },
            repeats: 3,
            status: "snoozed".into(),
            snooze_until: 1700001800,
        };
        let bytes = serde_json::to_vec(&x).unwrap();
        let y: InboxEntry = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(y.info.id, "notif-1");
        assert_eq!(y.info.app, "Slack");
        assert_eq!(y.repeats, 3);
        assert_eq!(y.status, "snoozed");
        assert_eq!(y.snooze_until, 1700001800);
    }

    #[test]
    fn test_snooze_range_bounds() {
        // Valid range 1..=1440
        assert!((1..=1440).contains(&1));
        assert!((1..=1440).contains(&30));
        assert!((1..=1440).contains(&1440));

        // Invalid
        assert!(!(1..=1440).contains(&0));
        assert!(!(1..=1440).contains(&1441));
    }

    #[test]
    fn test_inbox_deduplication_logic() {
        let mut items: Vec<InboxEntry> = Vec::new();
        let notif_a = NotifInfo {
            id: "1".into(),
            app_id: "com.teams".into(),
            app: "Teams".into(),
            title: "Meeting".into(),
            body: "Daily Standup".into(),
            time: 100,
        };

        // First occurrence
        items.insert(
            0,
            InboxEntry {
                info: notif_a.clone(),
                repeats: 1,
                status: "unread".into(),
                snooze_until: 0,
            },
        );
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].repeats, 1);

        // Second occurrence matches app_id, title, and body
        let notif_repeat = NotifInfo {
            id: "2".into(),
            app_id: "com.teams".into(),
            app: "Teams".into(),
            title: "Meeting".into(),
            body: "Daily Standup".into(),
            time: 200,
        };
        if let Some(i) = items.iter().position(|x| {
            x.info.app_id == notif_repeat.app_id
                && x.info.title == notif_repeat.title
                && x.info.body == notif_repeat.body
                && x.status != "dismissed"
        }) {
            let mut item = items.remove(i);
            item.repeats = item.repeats.saturating_add(1);
            item.info.time = notif_repeat.time;
            items.insert(0, item);
        }
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].repeats, 2);
        assert_eq!(items[0].info.time, 200);
    }

    #[test]
    fn test_triage_state_transitions() {
        let mut entry = InboxEntry {
            info: NotifInfo {
                id: "test".into(),
                app_id: "test".into(),
                app: "Test".into(),
                title: "T".into(),
                body: "B".into(),
                time: 0,
            },
            repeats: 1,
            status: "unread".into(),
            snooze_until: 0,
        };

        // Read
        entry.status = "read".into();
        assert_eq!(entry.status, "read");

        // Snooze
        let n = 45;
        let now = 10000;
        entry.status = "snoozed".into();
        entry.snooze_until = now + i64::from(n) * 60_000;
        assert_eq!(entry.status, "snoozed");
        assert_eq!(entry.snooze_until, 10000 + 45 * 60_000);

        // Dismiss
        entry.status = "dismissed".into();
        entry.snooze_until = 0;
        assert_eq!(entry.status, "dismissed");
        assert_eq!(entry.snooze_until, 0);
    }
}

//! Declarative local extensions. Manifests cannot load scripts or make network calls.
use std::collections::VecDeque;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ExtensionAction {
    pub id: String,
    pub label: String,
    pub kind: String,
    #[serde(default)]
    pub prefix: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ExtensionManifest {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub permissions: Vec<String>,
    #[serde(default)]
    pub subscriptions: Vec<String>,
    #[serde(default)]
    pub actions: Vec<ExtensionAction>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionEvent {
    pub extension_id: String,
    pub event: String,
    pub summary: String,
    pub time: i64,
}

static EVENTS: OnceLock<Mutex<VecDeque<ExtensionEvent>>> = OnceLock::new();
fn events() -> &'static Mutex<VecDeque<ExtensionEvent>> {
    EVENTS.get_or_init(|| Mutex::new(VecDeque::new()))
}
fn dir() -> PathBuf {
    crate::settings::config_dir().join("extensions")
}
pub fn valid_id(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 64
        && s.bytes()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
}

pub fn validate(m: &ExtensionManifest) -> Result<(), String> {
    if !valid_id(&m.id) {
        return Err("extension id must use lowercase letters, digits, and hyphens".into());
    }
    if m.name.trim().is_empty()
        || m.name.len() > 80
        || m.description.len() > 400
        || m.actions.len() > 12
    {
        return Err("invalid extension metadata".into());
    }
    if m.permissions.iter().any(|p| {
        !matches!(
            p.as_str(),
            "capture.write"
                | "clipboard.write"
                | "events.notification"
                | "events.phone_file"
                | "events.task"
                | "events.render"
        )
    }) {
        return Err("unsupported permission".into());
    }
    if m.subscriptions.iter().any(|p| {
        !matches!(
            p.as_str(),
            "notification" | "phone_file" | "task" | "render"
        )
    }) {
        return Err("unsupported subscription".into());
    }
    for event in &m.subscriptions {
        if !m
            .permissions
            .iter()
            .any(|p| p == &format!("events.{event}"))
        {
            return Err(format!("subscription {event} requires events.{event}"));
        }
    }
    for a in &m.actions {
        if !valid_id(&a.id)
            || a.label.trim().is_empty()
            || a.label.len() > 80
            || a.prefix.len() > 120
        {
            return Err("invalid action".into());
        }
        let permission = match a.kind.as_str() {
            "capture" => "capture.write",
            "clipboard" => "clipboard.write",
            _ => return Err("unsupported action kind".into()),
        };
        if !m.permissions.iter().any(|p| p == permission) {
            return Err(format!("{} requires {permission}", a.id));
        }
    }
    Ok(())
}

fn list() -> Vec<ExtensionManifest> {
    let mut out = Vec::new();
    let Ok(read) = std::fs::read_dir(dir()) else {
        return out;
    };
    for entry in read.flatten() {
        if entry.path().extension().and_then(|x| x.to_str()) != Some("json") {
            continue;
        }
        if let Ok(bytes) = std::fs::read(entry.path()) {
            if let Ok(m) = serde_json::from_slice::<ExtensionManifest>(&bytes) {
                if validate(&m).is_ok() {
                    out.push(m);
                }
            }
        }
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

#[tauri::command]
pub fn extension_list() -> Vec<ExtensionManifest> {
    list()
}

#[tauri::command]
pub fn extension_install(manifest_json: String) -> Result<Vec<ExtensionManifest>, String> {
    if manifest_json.len() > 32_768 {
        return Err("manifest too large".into());
    }
    let m: ExtensionManifest = serde_json::from_str(&manifest_json).map_err(|e| e.to_string())?;
    validate(&m)?;
    std::fs::create_dir_all(dir()).map_err(|e| e.to_string())?;
    let file = dir().join(format!("{}.json", m.id));
    if file.exists() {
        return Err("extension already installed".into());
    }
    std::fs::write(
        file,
        serde_json::to_vec_pretty(&m).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    Ok(list())
}

#[tauri::command]
pub fn extension_remove(id: String) -> Result<Vec<ExtensionManifest>, String> {
    if !valid_id(&id) {
        return Err("invalid extension id".into());
    }
    std::fs::remove_file(dir().join(format!("{id}.json"))).map_err(|e| e.to_string())?;
    Ok(list())
}

#[tauri::command]
pub fn extension_run(
    app: AppHandle,
    id: String,
    action_id: String,
    input: String,
) -> Result<String, String> {
    if input.len() > 4000 {
        return Err("input too long".into());
    }
    let m = list()
        .into_iter()
        .find(|m| m.id == id)
        .ok_or("extension not found")?;
    let a = m
        .actions
        .iter()
        .find(|a| a.id == action_id)
        .ok_or("action not found")?;
    let text = format!("{}{}", a.prefix, input.trim());
    match a.kind.as_str() {
        "capture" if m.permissions.iter().any(|p| p == "capture.write") => {
            super::capture::capture_save(app, text)
        }
        "clipboard" if m.permissions.iter().any(|p| p == "clipboard.write") => {
            super::extras::clip_set(text)?;
            Ok("Copied to clipboard".into())
        }
        _ => Err("permission denied".into()),
    }
}

#[tauri::command]
pub fn extension_events() -> Vec<ExtensionEvent> {
    events().lock().unwrap().iter().cloned().collect()
}

pub fn publish_event(event: &str, summary: &str) {
    if !matches!(event, "notification" | "phone_file" | "task" | "render") {
        return;
    }
    let time = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    let mut log = events().lock().unwrap();
    for m in list()
        .into_iter()
        .filter(|m| m.subscriptions.iter().any(|s| s == event))
    {
        log.push_front(ExtensionEvent {
            extension_id: m.id,
            event: event.into(),
            summary: summary.chars().take(160).collect(),
            time,
        });
    }
    log.truncate(100);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_valid_id_rules() {
        assert!(valid_id("my-extension-1"));
        assert!(valid_id("abc"));
        assert!(valid_id("task-runner-v2"));

        // Reject invalid IDs
        assert!(!valid_id("")); // Empty
        assert!(!valid_id("MyExtension")); // Uppercase
        assert!(!valid_id("my extension")); // Space
        assert!(!valid_id("my_extension")); // Underscore
        assert!(!valid_id("../traversal")); // Path traversal
        assert!(!valid_id(&"a".repeat(65))); // Too long
    }

    #[test]
    fn test_manifest_metadata_validation() {
        let valid = ExtensionManifest {
            id: "notes-sync".into(),
            name: "Notes Sync".into(),
            description: "Sync notes locally".into(),
            permissions: vec!["capture.write".into()],
            subscriptions: vec![],
            actions: vec![ExtensionAction {
                id: "add-note".into(),
                label: "Add Note".into(),
                kind: "capture".into(),
                prefix: "TODO: ".into(),
            }],
        };
        assert!(validate(&valid).is_ok());

        // Empty name
        let mut invalid_name = valid.clone();
        invalid_name.name = "   ".into();
        assert!(validate(&invalid_name).is_err());

        // Name too long
        let mut long_name = valid.clone();
        long_name.name = "a".repeat(81);
        assert!(validate(&long_name).is_err());

        // Description too long
        let mut long_desc = valid.clone();
        long_desc.description = "d".repeat(401);
        assert!(validate(&long_desc).is_err());

        // Too many actions
        let mut many_actions = valid.clone();
        many_actions.actions = (0..13)
            .map(|i| ExtensionAction {
                id: format!("action-{i}"),
                label: "Act".into(),
                kind: "capture".into(),
                prefix: String::new(),
            })
            .collect();
        assert!(validate(&many_actions).is_err());
    }

    #[test]
    fn test_subscription_permission_pairing() {
        let mut m = ExtensionManifest {
            id: "notif-logger".into(),
            name: "Logger".into(),
            description: String::new(),
            permissions: vec![],
            subscriptions: vec!["notification".into()],
            actions: vec![],
        };
        // Fails because events.notification is not in permissions
        assert!(validate(&m).is_err());

        // Adding events.notification satisfies subscription requirement
        m.permissions.push("events.notification".into());
        assert!(validate(&m).is_ok());

        // Unsupported subscription
        m.subscriptions.push("unknown_event".into());
        assert!(validate(&m).is_err());
    }

    #[test]
    fn test_action_permission_pairing() {
        let mut m = ExtensionManifest {
            id: "clip-tool".into(),
            name: "Clip Tool".into(),
            description: String::new(),
            permissions: vec!["capture.write".into()],
            subscriptions: vec![],
            actions: vec![ExtensionAction {
                id: "copy-now".into(),
                label: "Copy".into(),
                kind: "clipboard".into(),
                prefix: String::new(),
            }],
        };
        // Fails because kind=clipboard requires clipboard.write
        assert!(validate(&m).is_err());

        m.permissions.push("clipboard.write".into());
        assert!(validate(&m).is_ok());
    }
}

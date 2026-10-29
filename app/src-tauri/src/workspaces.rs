//! Explicit, local project workspaces. A snapshot records visible desktop apps;
//! users can add project folders and files before saving. Window positions and
//! unsaved editor buffers are deliberately not claimed to be restorable.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use windows::core::{BOOL, PWSTR};
use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM};
use windows::Win32::System::Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION};
use windows::Win32::UI::WindowsAndMessaging::{EnumWindows, GetWindowTextW, GetWindowThreadProcessId, IsWindowVisible};

static WRITE_LOCK: Mutex<()> = Mutex::new(());
pub const MAX_WORKSPACES: usize = 50;
pub const MAX_ITEMS: usize = 80;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceItem {
    pub kind: String,
    pub path: String,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub id: String,
    pub name: String,
    pub updated_at: u64,
    pub items: Vec<WorkspaceItem>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResumeReport {
    pub opened: usize,
    pub missing: Vec<String>,
    pub failed: Vec<String>,
}

fn path() -> PathBuf { crate::settings::config_dir().join("workspaces.json") }

pub fn read() -> Result<Vec<Workspace>, String> {
    match std::fs::read(path()) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|e| format!("Cannot read workspaces: {e}")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(e) => Err(format!("Cannot read workspaces: {e}")),
    }
}

pub fn write(workspaces: &[Workspace]) -> Result<(), String> {
    let dest = path();
    let dir = dest.parent().ok_or("Invalid workspace directory")?;
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let temp = dest.with_extension("json.tmp");
    std::fs::write(&temp, serde_json::to_vec_pretty(workspaces).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    // `rename` does not replace an existing target on Windows. Stage complete
    // JSON before copying it over the destination.
    std::fs::copy(&temp, &dest).map_err(|e| e.to_string())?;
    std::fs::remove_file(temp).map_err(|e| e.to_string())
}

pub fn stamp() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64
}

fn app_path(hwnd: HWND) -> Option<PathBuf> {
    unsafe {
        let mut pid = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buf = [0u16; 1024];
        let mut len = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(h, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len).is_ok();
        let _ = CloseHandle(h);
        ok.then(|| PathBuf::from(String::from_utf16_lossy(&buf[..len as usize])))
    }
}

unsafe extern "system" fn collect_window(hwnd: HWND, data: LPARAM) -> BOOL {
    let out = unsafe { &mut *(data.0 as *mut Vec<WorkspaceItem>) };
    if !unsafe { IsWindowVisible(hwnd) }.as_bool() || out.len() >= MAX_ITEMS { return BOOL(1); }
    let mut title = [0u16; 512];
    let len = unsafe { GetWindowTextW(hwnd, &mut title) }.max(0) as usize;
    if len == 0 { return BOOL(1); }
    let Some(exe) = app_path(hwnd) else { return BOOL(1) };
    let name = exe.file_name().and_then(|n| n.to_str()).unwrap_or_default().to_ascii_lowercase();
    if matches!(name.as_str(), "winsle.exe" | "explorer.exe" | "applicationframehost.exe" | "textinputhost.exe") {
        return BOOL(1);
    }
    out.push(WorkspaceItem {
        kind: "app".into(),
        path: exe.to_string_lossy().into_owned(),
        label: String::from_utf16_lossy(&title[..len]),
    });
    BOOL(1)
}

pub fn snapshot() -> Vec<WorkspaceItem> {
    let mut items: Vec<WorkspaceItem> = Vec::new();
    unsafe { let _ = EnumWindows(Some(collect_window), LPARAM(&mut items as *mut Vec<_> as isize)); }
    let mut seen = HashSet::new();
    items.retain(|i| seen.insert(i.path.to_ascii_lowercase()));
    items
}

#[tauri::command]
pub fn workspace_snapshot() -> Vec<WorkspaceItem> { snapshot() }

#[tauri::command]
pub fn workspace_list() -> Result<Vec<Workspace>, String> { read() }

#[tauri::command]
pub fn workspace_save(id: Option<String>, name: String, paths: Vec<String>, capture_apps: bool) -> Result<Workspace, String> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 80 { return Err("Name must be 1–80 characters".into()); }
    let mut items = if capture_apps { snapshot() } else { Vec::new() };
    for raw in paths.iter().take(MAX_ITEMS) {
        let p = PathBuf::from(raw).canonicalize().map_err(|_| format!("Path does not exist: {raw}"))?;
        let kind = if p.is_dir() { "folder" } else if p.is_file() { "file" } else { return Err(format!("Unsupported path: {raw}")) };
        items.push(WorkspaceItem {
            kind: kind.into(),
            label: p.file_name().unwrap_or_default().to_string_lossy().into_owned(),
            path: p.to_string_lossy().into_owned(),
        });
    }
    let mut seen = HashSet::new();
    items.retain(|i| seen.insert(i.path.to_ascii_lowercase()));
    items.truncate(MAX_ITEMS);
    if items.is_empty() { return Err("Add a file or folder, or capture open apps".into()); }
    let _guard = WRITE_LOCK.lock().map_err(|e| e.to_string())?;
    let mut all = read()?;
    let now = stamp();
    let id = id.unwrap_or_else(|| format!("ws-{now}-{}", std::process::id()));
    let workspace = Workspace { id: id.clone(), name: name.into(), updated_at: now, items };
    if let Some(existing) = all.iter_mut().find(|w| w.id == id) { *existing = workspace.clone(); }
    else {
        if all.len() >= MAX_WORKSPACES { return Err("Workspace limit reached".into()); }
        all.push(workspace.clone());
    }
    write(&all)?;
    Ok(workspace)
}

#[tauri::command]
pub fn workspace_delete(id: String) -> Result<(), String> {
    let _guard = WRITE_LOCK.lock().map_err(|e| e.to_string())?;
    let mut all = read()?;
    let previous = all.len();
    all.retain(|w| w.id != id);
    if all.len() == previous { return Err("Workspace not found".into()); }
    write(&all)
}

#[tauri::command]
pub fn workspace_resume(id: String) -> Result<ResumeReport, String> {
    let workspace = read()?.into_iter().find(|w| w.id == id).ok_or("Workspace not found")?;
    let mut report = ResumeReport { opened: 0, missing: Vec::new(), failed: Vec::new() };
    for item in workspace.items {
        let p = Path::new(&item.path);
        if !p.exists() { report.missing.push(item.path); continue; }
        match crate::live::tools::shell_open(p) {
            Ok(()) => report.opened += 1,
            Err(e) => report.failed.push(format!("{}: {e}", item.path)),
        }
    }
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_dedupes_items_by_path_case_insensitively() {
        let mut items = vec![
            WorkspaceItem {
                kind: "app".into(),
                path: "C:\\Program Files\\App\\app.exe".into(),
                label: "App".into(),
            },
            WorkspaceItem {
                kind: "app".into(),
                path: "c:\\program files\\app\\app.exe".into(),
                label: "app duplicate".into(),
            },
            WorkspaceItem {
                kind: "folder".into(),
                path: "D:\\Projects\\Winsle".into(),
                label: "Winsle".into(),
            },
        ];
        let mut seen = HashSet::new();
        items.retain(|i| seen.insert(i.path.to_ascii_lowercase()));
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].label, "App");
        assert_eq!(items[1].label, "Winsle");
    }

    #[test]
    fn test_workspace_and_report_serialization() {
        let ws = Workspace {
            id: "ws-123".into(),
            name: "Winsle Dev".into(),
            updated_at: 1700000000,
            items: vec![WorkspaceItem {
                kind: "folder".into(),
                path: "D:\\project x".into(),
                label: "Project X".into(),
            }],
        };
        let bytes = serde_json::to_vec(&ws).unwrap();
        let deserialized: Workspace = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(deserialized.id, "ws-123");
        assert_eq!(deserialized.name, "Winsle Dev");
        assert_eq!(deserialized.items.len(), 1);

        let report = ResumeReport {
            opened: 2,
            missing: vec!["D:\\old_path".into()],
            failed: vec![],
        };
        let report_json = serde_json::to_string(&report).unwrap();
        assert!(report_json.contains("\"opened\":2"));
        assert!(report_json.contains("\"missing\":[\"D:\\\\old_path\"]"));
    }

    #[test]
    fn test_workspace_constants_and_limits() {
        assert_eq!(MAX_WORKSPACES, 50);
        assert_eq!(MAX_ITEMS, 80);

        // Name length boundary tests
        let valid_name = "A".repeat(80);
        assert!(!valid_name.is_empty() && valid_name.chars().count() <= 80);

        let invalid_name = "A".repeat(81);
        assert!(invalid_name.chars().count() > 80);

        let empty_name = "   ";
        assert!(empty_name.trim().is_empty());
    }
}

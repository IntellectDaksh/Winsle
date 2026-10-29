// A bounded inventory of the user's configured render folders. This reports
// observable file facts; an idle output is never assumed to have succeeded.

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Manager};

pub const OUTPUT_EXTS: &[&str] = &[
    "mp4", "mov", "mxf", "avi", "mkv", "m4v", "webm", "wav", "aif", "aiff", "mp3", "aac", "png",
    "exr", "tif", "tiff", "dpx",
];
pub const TEMP_EXTS: &[&str] = &["part", "partial", "tmp", "temp"];
pub const MAX_FOLDERS: usize = 12;
pub const MAX_FILES_PER_FOLDER: usize = 300;
pub const MAX_OUTPUTS: usize = 200;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductionOutput {
    pub path: String,
    pub folder: String,
    pub name: String,
    pub format: String,
    pub bytes: u64,
    pub modified_at: u64,
    pub group: String,
    pub version: Option<u32>,
    /// ready = an output exists; recent = it was modified in the last minute;
    /// empty and partial require inspection. No status implies render success.
    pub state: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductionInventory {
    pub outputs: Vec<ProductionOutput>,
    pub folders: Vec<String>,
    pub inaccessible: Vec<String>,
    pub truncated: bool,
}

pub fn group_version(name: &str) -> (String, Option<u32>) {
    let stem = Path::new(name)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(name);
    let lower = stem.to_ascii_lowercase();
    let bytes = lower.as_bytes();
    let mut start = bytes.len();
    while start > 0 && bytes[start - 1].is_ascii_digit() {
        start -= 1;
    }
    if start < bytes.len() && start > 0 {
        let prefix = &lower[..start];
        let marker = if prefix.ends_with('v') {
            Some(start - 1)
        } else if prefix.ends_with("version") {
            Some(start - "version".len())
        } else {
            None
        };
        if let Some(at) = marker {
            if at == 0 || matches!(bytes[at - 1], b'_' | b'-' | b' ' | b'.') {
                if let Ok(n) = lower[start..].parse::<u32>() {
                    let group = stem[..at].trim_end_matches(['_', '-', ' ', '.']);
                    if !group.is_empty() {
                        return (group.to_string(), Some(n));
                    }
                }
            }
        }
    }
    (stem.to_string(), None)
}

pub fn collect_dir(
    dir: &Path,
    folder: &str,
    now: SystemTime,
    out: &mut Vec<ProductionOutput>,
    truncated: &mut bool,
) -> Result<(), String> {
    let entries = std::fs::read_dir(dir).map_err(|e| e.to_string())?;
    for (n, item) in entries.enumerate() {
        if n >= MAX_FILES_PER_FOLDER {
            *truncated = true;
            break;
        }
        let Ok(item) = item else { continue };
        let path = item.path();
        let Ok(meta) = item.metadata() else { continue };
        if !meta.is_file() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        let Some(ext) = path.extension().and_then(|e| e.to_str()) else {
            continue;
        };
        let ext = ext.to_ascii_lowercase();
        let is_output = OUTPUT_EXTS.contains(&ext.as_str());
        let is_temp = TEMP_EXTS.contains(&ext.as_str());
        if !is_output && !is_temp {
            continue;
        }
        let modified = meta.modified().unwrap_or(UNIX_EPOCH);
        let age = now.duration_since(modified).unwrap_or(Duration::ZERO);
        let (group, version) = group_version(name);
        let state = if is_temp && age >= Duration::from_secs(10 * 60) {
            "stalled"
        } else if is_temp {
            "partial"
        } else if meta.len() == 0 {
            "empty"
        } else if age < Duration::from_secs(60) {
            "recent"
        } else {
            "ready"
        };
        out.push(ProductionOutput {
            path: path.to_string_lossy().into_owned(),
            folder: folder.to_string(),
            name: name.to_string(),
            format: ext,
            bytes: meta.len(),
            modified_at: modified
                .duration_since(UNIX_EPOCH)
                .unwrap_or(Duration::ZERO)
                .as_millis() as u64,
            group,
            version,
            state,
        });
    }
    Ok(())
}

pub fn scan(folders: Vec<String>) -> ProductionInventory {
    let now = SystemTime::now();
    let mut outputs = Vec::new();
    let mut valid = Vec::new();
    let mut inaccessible = Vec::new();
    let mut truncated = folders.len() > MAX_FOLDERS;
    for folder in folders.into_iter().take(MAX_FOLDERS) {
        let folder = folder.trim().to_string();
        if folder.is_empty() {
            continue;
        }
        let path = PathBuf::from(&folder);
        if !path.is_dir() {
            inaccessible.push(folder);
            continue;
        }
        valid.push(folder.clone());
        if collect_dir(&path, &folder, now, &mut outputs, &mut truncated).is_err() {
            inaccessible.push(folder.clone());
            continue;
        }
        if let Ok(entries) = std::fs::read_dir(&path) {
            for child in entries.flatten().take(20) {
                if child.file_type().is_ok_and(|t| t.is_dir()) {
                    let _ = collect_dir(&child.path(), &folder, now, &mut outputs, &mut truncated);
                }
            }
        }
    }
    outputs.sort_by(|a, b| b.modified_at.cmp(&a.modified_at).then(a.path.cmp(&b.path)));
    if outputs.len() > MAX_OUTPUTS {
        outputs.truncate(MAX_OUTPUTS);
        truncated = true;
    }
    ProductionInventory {
        outputs,
        folders: valid,
        inaccessible,
        truncated,
    }
}

/// Uses only directories the user configured in Settings → Live.
#[tauri::command]
pub async fn production_scan(app: AppHandle) -> Result<ProductionInventory, String> {
    let folders = app
        .state::<crate::Shared>()
        .settings
        .lock()
        .map_err(|e| e.to_string())?
        .render_dirs
        .clone();
    tauri::async_runtime::spawn_blocking(move || scan(folders))
        .await
        .map_err(|e| e.to_string())
}

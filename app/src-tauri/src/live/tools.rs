// Small actions the island exposes: open/reveal a file, top memory users.

use std::os::windows::process::CommandExt;
use std::path::Path;
use std::process::Command;

use serde::Serialize;
use windows::Win32::Foundation::CloseHandle;
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};
use windows::Win32::System::ProcessStatus::{K32GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS};
use windows::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const BLOCKED: [&str; 14] =
    ["exe", "msi", "bat", "cmd", "ps1", "vbs", "js", "jse", "wsf", "scr", "com", "lnk", "hta", "reg"];

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct ProcInfo {
    pub name: String,
    pub mb: f64,
    pub count: u32,
}

fn blocked(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| BLOCKED.contains(&e.to_ascii_lowercase().as_str()))
}

/// Shell-opens a path with its default app; no cmd.exe in between.
pub(crate) fn shell_open(path: &Path) -> Result<(), String> {
    Command::new("rundll32.exe")
        .arg("url.dll,FileProtocolHandler")
        .arg(path)
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn file_open(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if !p.is_file() {
        return Err("file not found".into());
    }
    if blocked(p) {
        return Err("open it from the folder instead".into());
    }
    shell_open(p)
}

#[tauri::command]
pub fn file_reveal(path: String) -> Result<(), String> {
    if !Path::new(&path).exists() {
        return Err("file not found".into());
    }
    // raw_arg: explorer wants /select,"path" unquoted as a whole.
    Command::new("explorer.exe")
        .raw_arg(format!("/select,\"{path}\""))
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// "Code.EXE" → "code"; aggregation key, case-insensitive.
fn proc_key(exe: &str) -> String {
    let l = exe.to_ascii_lowercase();
    l.strip_suffix(".exe").unwrap_or(&l).to_string()
}

fn display_name(exe: &str) -> &str {
    if exe.len() > 4 && exe[exe.len() - 4..].eq_ignore_ascii_case(".exe") {
        &exe[..exe.len() - 4]
    } else {
        exe
    }
}

fn top(mut rows: Vec<ProcInfo>, n: usize) -> Vec<ProcInfo> {
    rows.sort_by(|a, b| b.mb.total_cmp(&a.mb));
    rows.truncate(n);
    for r in &mut rows {
        r.mb = (r.mb * 10.0).round() / 10.0;
    }
    rows
}

fn snapshot_procs() -> Vec<ProcInfo> {
    let mut map: std::collections::HashMap<String, ProcInfo> = Default::default();
    unsafe {
        let Ok(snap) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else { return vec![] };
        let mut e = PROCESSENTRY32W { dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32, ..Default::default() };
        let mut ok = Process32FirstW(snap, &mut e).is_ok();
        while ok {
            let len = e.szExeFile.iter().position(|&c| c == 0).unwrap_or(e.szExeFile.len());
            let exe = String::from_utf16_lossy(&e.szExeFile[..len]);
            // Access denied (system/elevated processes) just skips them.
            if let Ok(h) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, e.th32ProcessID) {
                let mut c = PROCESS_MEMORY_COUNTERS::default();
                let cb = std::mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32;
                if K32GetProcessMemoryInfo(h, &mut c, cb).as_bool() {
                    let r = map.entry(proc_key(&exe)).or_insert_with(|| ProcInfo {
                        name: display_name(&exe).to_string(),
                        mb: 0.0,
                        count: 0,
                    });
                    r.mb += c.WorkingSetSize as f64 / (1024.0 * 1024.0);
                    r.count += 1;
                }
                let _ = CloseHandle(h);
            }
            ok = Process32NextW(snap, &mut e).is_ok();
        }
        let _ = CloseHandle(snap);
    }
    top(map.into_values().collect(), 4)
}

#[tauri::command]
pub async fn top_procs() -> Vec<ProcInfo> {
    tauri::async_runtime::spawn_blocking(snapshot_procs).await.unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refuses_executables() {
        assert!(blocked(Path::new("C:/x/setup.EXE")));
        assert!(blocked(Path::new("a.ps1")));
        assert!(!blocked(Path::new("movie.mp4")));
        assert!(!blocked(Path::new("README")));
    }

    #[test]
    fn names() {
        assert_eq!(proc_key("Code.EXE"), "code");
        assert_eq!(display_name("Code.EXE"), "Code");
        assert_eq!(display_name("System"), "System");
        let rows = vec![
            ProcInfo { name: "a".into(), mb: 1.04, count: 1 },
            ProcInfo { name: "b".into(), mb: 9.96, count: 2 },
        ];
        assert_eq!(top(rows, 1), vec![ProcInfo { name: "b".into(), mb: 10.0, count: 2 }]);
    }
}

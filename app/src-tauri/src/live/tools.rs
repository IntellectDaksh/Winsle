// Small actions the island exposes: open/reveal a file, top memory users,
// colour picker, app launcher, system shortcuts.

use std::os::windows::process::CommandExt;
use std::path::Path;
use std::process::Command;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use windows::core::{HSTRING, PCWSTR};
use windows::Win32::Foundation::{CloseHandle, POINT};
use windows::Win32::Graphics::Gdi::{GetDC, GetPixel, ReleaseDC, CLR_INVALID};
use windows::Win32::System::Shutdown::LockWorkStation;
use windows::Win32::UI::Shell::ShellExecuteW;
use windows::Win32::UI::WindowsAndMessaging::{GetCursorPos, SW_SHOWNORMAL};
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};
use windows::Win32::System::ProcessStatus::{K32GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS};
use windows::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const BLOCKED: &[&str] = &[
    "exe", "msi", "msp", "bat", "cmd", "ps1", "psm1", "psd1", "vbs", "vbe", "js", "jse", "wsf", "wsh",
    "scr", "com", "lnk", "hta", "reg", "pif", "cpl", "jar", "msc", "diagcab", "appx", "msix", "iso",
    "vhd", "vhdx", "inf", "scf",
];

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct ProcInfo {
    pub name: String,
    pub mb: f64,
    pub count: u32,
}

fn blocked(path: &Path) -> bool {
    let path_str = path.to_string_lossy();
    let trimmed = path_str.trim_end_matches(['.', ' ', '\t']);
    let clean_path = Path::new(trimmed);
    let ext_blocked = clean_path
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| {
            let clean_ext = e.trim().trim_end_matches('.').to_ascii_lowercase();
            BLOCKED.contains(&clean_ext.as_str())
        });
    if ext_blocked {
        return true;
    }
    // Guard against Windows NTFS Alternate Data Streams (e.g. payload.exe:hidden)
    if clean_path
        .file_name()
        .and_then(|f| f.to_str())
        .is_some_and(|f| f.contains(':'))
    {
        return true;
    }
    false
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

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct ColorInfo {
    pub hex: String,
    pub r: u8,
    pub g: u8,
    pub b: u8,
}

/// COLORREF is 0x00BBGGRR.
fn color_info(c: u32) -> ColorInfo {
    let (r, g, b) = (c as u8, (c >> 8) as u8, (c >> 16) as u8);
    ColorInfo { hex: format!("#{r:02X}{g:02X}{b:02X}"), r, g, b }
}

/// The pixel under the cursor, read from the whole-screen DC.
#[tauri::command]
pub fn pick_color() -> Option<ColorInfo> {
    unsafe {
        let mut p = POINT::default();
        GetCursorPos(&mut p).ok()?;
        let dc = GetDC(None);
        if dc.is_invalid() {
            return None;
        }
        let c = GetPixel(dc, p.x, p.y);
        ReleaseDC(None, dc);
        (c.0 != CLR_INVALID).then(|| color_info(c.0))
    }
}

/// ShellExecuteW "open"; no cmd.exe in between.
fn shell_execute(target: &str) -> Result<(), String> {
    let r = unsafe {
        ShellExecuteW(None, &HSTRING::from("open"), &HSTRING::from(target), PCWSTR::null(), PCWSTR::null(), SW_SHOWNORMAL)
    };
    // Values above 32 mean success.
    if r.0 as usize > 32 { Ok(()) } else { Err(format!("could not open {target}")) }
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct AppEntry {
    pub name: String,
    pub path: String,
}

const APPS_TTL: Duration = Duration::from_secs(600);
static APPS: Mutex<Option<(Instant, Vec<AppEntry>)>> = Mutex::new(None);

fn scan_dir(dir: &Path, out: &mut Vec<AppEntry>) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let p = e.path();
        if p.is_dir() {
            scan_dir(&p, out);
            continue;
        }
        let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
        if ext != "lnk" && ext != "url" {
            continue;
        }
        if let Some(name) = p.file_stem().and_then(|s| s.to_str()) {
            out.push(AppEntry { name: name.to_string(), path: p.to_string_lossy().into_owned() });
        }
    }
}

fn tidy_apps(mut v: Vec<AppEntry>) -> Vec<AppEntry> {
    v.retain(|a| !a.name.to_lowercase().contains("uninstall"));
    let mut seen = std::collections::HashSet::new();
    v.retain(|a| seen.insert(a.name.to_lowercase()));
    v.sort_by_key(|a| a.name.to_lowercase());
    v
}

fn scan_apps() -> Vec<AppEntry> {
    let mut v = Vec::new();
    for var in ["APPDATA", "ProgramData"] {
        if let Some(base) = std::env::var_os(var) {
            scan_dir(&Path::new(&base).join(r"Microsoft\Windows\Start Menu\Programs"), &mut v);
        }
    }
    tidy_apps(v)
}

fn cached_apps() -> Vec<AppEntry> {
    let mut g = APPS.lock().unwrap_or_else(|e| e.into_inner());
    match &*g {
        Some((at, v)) if at.elapsed() < APPS_TTL => v.clone(),
        _ => {
            let v = scan_apps();
            *g = Some((Instant::now(), v.clone()));
            v
        }
    }
}

#[tauri::command]
pub async fn apps_list() -> Vec<AppEntry> {
    tauri::async_runtime::spawn_blocking(cached_apps).await.unwrap_or_default()
}

#[tauri::command]
pub fn app_launch(path: String) -> Result<(), String> {
    let known = APPS
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
        .is_some_and(|(_, v)| v.iter().any(|a| a.path == path));
    if !known {
        return Err("unknown app".into());
    }
    shell_execute(&path)
}

#[tauri::command]
pub fn system_action(action: String) -> Result<(), String> {
    match action.as_str() {
        "lock" => unsafe { LockWorkStation() }.map_err(|e| e.to_string()),
        "snip" => shell_execute("ms-screenclip:"),
        "settings" => shell_execute("ms-settings:"),
        "taskmgr" => shell_execute("taskmgr.exe"),
        _ => Err("unknown action".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refuses_executables() {
        assert!(blocked(Path::new("C:/x/setup.EXE")));
        assert!(blocked(Path::new("a.ps1")));
        // Trailing dot bypass prevention
        assert!(blocked(Path::new("payload.exe.")));
        assert!(blocked(Path::new("payload.bat..")));
        // Trailing space bypass prevention
        assert!(blocked(Path::new("script.cmd ")));
        // Alternate Data Streams
        assert!(blocked(Path::new("test.txt:malicious.exe")));
        // Newly blocked dangerous Windows extensions
        assert!(blocked(Path::new("program.pif")));
        assert!(blocked(Path::new("control.cpl")));
        assert!(blocked(Path::new("tool.msc")));
        assert!(blocked(Path::new("package.appx")));
        assert!(blocked(Path::new("package.msix")));
        assert!(blocked(Path::new("module.psm1")));
        assert!(blocked(Path::new("archive.iso")));
        // Safe files
        assert!(!blocked(Path::new("movie.mp4")));
        assert!(!blocked(Path::new("README")));
        assert!(!blocked(Path::new("notes.txt")));
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

    #[test]
    fn colors_and_apps() {
        assert_eq!(color_info(0x00332211), ColorInfo { hex: "#112233".into(), r: 0x11, g: 0x22, b: 0x33 });
        let e = |n: &str| AppEntry { name: n.into(), path: n.into() };
        let v = tidy_apps(vec![e("zed"), e("Uninstall Foo"), e("Alpha"), e("alpha")]);
        assert_eq!(v.iter().map(|a| a.name.as_str()).collect::<Vec<_>>(), ["Alpha", "zed"]);
    }
}

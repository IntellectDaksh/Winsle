// Quick capture: a global hotkey opens a one-line input on the island; the
// text lands as a Markdown task in inbox.md (Obsidian/any editor friendly).

use std::io::Write;
use std::path::PathBuf;

use tauri::{AppHandle, Manager};
use windows::Win32::System::SystemInformation::GetLocalTime;
use windows::Win32::UI::Input::KeyboardAndMouse::{
    RegisterHotKey, HOT_KEY_MODIFIERS, MOD_ALT, MOD_CONTROL, MOD_NOREPEAT, VK_C, VK_F, VK_K, VK_L, VK_N, VK_SPACE, VK_V, VK_W,
};
use windows::Win32::UI::Shell::FOLDERID_Documents;
use windows::Win32::UI::WindowsAndMessaging::{GetMessageW, MSG, WM_HOTKEY};

const MAX_CHARS: usize = 4000;
const NL: char = 10 as char;
const CR: char = 13 as char;

/// The hotkey that actually registered, for the hint under the capture field.
static ACTIVE_HOTKEY: std::sync::OnceLock<&'static str> = std::sync::OnceLock::new();

#[tauri::command]
pub fn capture_hotkey() -> String {
    ACTIVE_HOTKEY.get().copied().unwrap_or("").to_string()
}

pub fn spawn(app: AppHandle) {
    std::thread::spawn(move || {
        let mods: HOT_KEY_MODIFIERS = MOD_CONTROL | MOD_ALT | MOD_NOREPEAT;
        // RegisterHotKey with no window posts WM_HOTKEY to this thread's queue.
        // A Winsle that is still shutting down can hold the keys for a moment.
        for _ in 0..10 {
            if unsafe { RegisterHotKey(None, 99, mods, VK_SPACE.0 as u32) }.is_ok() {
                let _ = unsafe { windows::Win32::UI::Input::KeyboardAndMouse::UnregisterHotKey(None, 99) };
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(300));
        }
        let active = unsafe {
            if RegisterHotKey(None, 1, mods, VK_SPACE.0 as u32).is_ok() {
                "Ctrl+Alt+Space"
            } else if RegisterHotKey(None, 1, mods, VK_N.0 as u32).is_ok() {
                crate::log::line("capture: Ctrl+Alt+Space is taken, falling back");
                "Ctrl+Alt+N"
            } else {
                crate::log::line("capture: no quick-capture hotkey available");
                return;
            }
        };
        let _ = ACTIVE_HOTKEY.set(active);
        for (id, vk, name) in [(2, VK_W, "W"), (3, VK_F, "F"), (4, VK_V, "V"), (5, VK_L, "L"), (6, VK_C, "C"), (7, VK_K, "K")] {
            if unsafe { RegisterHotKey(None, id, mods, vk.0 as u32) }.is_err() {
                crate::log::line(format!("capture: Ctrl+Alt+{name} is taken"));
            }
        }
        crate::log::line(format!("capture: hotkey {active}"));
        let mut msg = MSG::default();
        while unsafe { GetMessageW(&mut msg, None, 0, 0) }.as_bool() {
            if msg.message == WM_HOTKEY {
                match msg.wParam.0 {
                    1 => crate::live::emit(&app, "capture-open", ()),
                    2 => crate::live::emit(&app, "island-toggle", ()),
                    3 => crate::live::emit(&app, "hotkey-focus", ()),
                    4 => crate::live::emit(&app, "hotkey-clips", ()),
                    5 => crate::live::emit(&app, "hotkey-lock", ()),
                    7 => crate::live::emit(&app, "hotkey-palette", ()),
                    6 => {
                        if let Some(c) = crate::live::tools::pick_color() {
                            crate::live::emit(&app, "color-picked", c);
                        }
                    }
                    _ => {}
                }
            }
        }
    });
}

fn default_dir() -> Option<PathBuf> {
    crate::live::progress::known_folder(&FOLDERID_Documents)
        .or_else(|| std::env::var_os("USERPROFILE").map(|p| PathBuf::from(p).join("Documents")))
        .map(|d| d.join("Winsle"))
}

/// Replaces ASCII/Unicode control characters (newlines, tabs, escape codes) with spaces so tasks stay single-line.
pub fn sanitize_task_text(text: &str) -> String {
    text.chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect()
}

/// One Markdown task line; newlines collapse so the item stays one checkbox.
fn task_line(text: &str, stamp: &str) -> Result<String, String> {
    let sanitized = sanitize_task_text(text);
    let text = sanitized.split_whitespace().collect::<Vec<_>>().join(" ");
    if text.is_empty() {
        return Err("nothing to save".into());
    }
    let text: String = text.chars().take(MAX_CHARS).collect();
    Ok(format!("- [ ] {text}  _({stamp})_\n"))
}

pub fn format_timestamp(year: u16, month: u16, day: u16, hour: u16, minute: u16) -> String {
    format!("{:04}-{:02}-{:02} {:02}:{:02}", year, month, day, hour, minute)
}

/// Resolves target inbox.md path from configured folder or default Documents/Winsle folder,
/// verifying against control characters, null bytes, and directory traversal.
pub fn resolve_inbox_path(configured: &str, default: Option<PathBuf>) -> Result<PathBuf, String> {
    let trimmed = configured.trim();
    if trimmed.is_empty() {
        let base = default.ok_or_else(|| "no Documents folder".to_string())?;
        return Ok(base.join("inbox.md"));
    }
    if trimmed.chars().any(|c| c == '\0' || (c.is_control() && c != '\t')) {
        return Err("invalid characters in capture directory".to_string());
    }
    let dir = PathBuf::from(trimmed);
    if dir.components().any(|c| c == std::path::Component::ParentDir) {
        return Err("directory traversal not permitted in capture directory".to_string());
    }
    Ok(dir.join("inbox.md"))
}

pub(crate) fn inbox_path(app: &AppHandle) -> Result<PathBuf, String> {
    let configured = app
        .state::<crate::Shared>()
        .settings
        .lock()
        .map(|s| s.capture_dir.trim().to_string())
        .unwrap_or_default();
    resolve_inbox_path(&configured, default_dir())
}

#[tauri::command]
pub fn capture_save(app: AppHandle, text: String) -> Result<String, String> {
    let path = inbox_path(&app)?;
    let dir = path.parent().ok_or("bad inbox path")?;
    let t = unsafe { GetLocalTime() };
    let stamp = format_timestamp(t.wYear, t.wMonth, t.wDay, t.wHour, t.wMinute);
    let line = task_line(&text, &stamp)?;
    std::fs::create_dir_all(dir).map_err(|e| format!("cannot create {}: {e}", dir.display()))?;
    std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .and_then(|mut f| f.write_all(line.as_bytes()))
        .map_err(|e| format!("cannot write {}: {e}", path.display()))?;
    Ok(path.to_string_lossy().into_owned())
}

#[derive(serde::Serialize, Clone, Debug, PartialEq)]
pub struct TaskLine {
    pub line: usize,
    pub text: String,
    pub done: bool,
}

/// "- [x] text  _(stamp)_" or "* [ ] text" → (done, "text"); None for non-task lines.
fn parse_task(raw: &str) -> Option<(bool, &str)> {
    let trimmed_end = raw.trim_end_matches([CR, NL]);
    let l = trimmed_end.trim_start();
    let (done, rest) = if let Some(r) = l.strip_prefix("- [ ] ").or_else(|| l.strip_prefix("* [ ] ")) {
        (false, r)
    } else if let Some(r) = l.strip_prefix("- [x] ")
        .or_else(|| l.strip_prefix("- [X] "))
        .or_else(|| l.strip_prefix("* [x] "))
        .or_else(|| l.strip_prefix("* [X] "))
    {
        (true, r)
    } else {
        return None;
    };
    let text = match rest.rfind("  _(") {
        Some(i) if rest.ends_with(")_") => &rest[..i],
        _ => rest,
    };
    Some((done, text.trim()))
}

fn list_tasks(content: &str, n: usize) -> Vec<TaskLine> {
    let all: Vec<TaskLine> = content
        .split_inclusive(NL)
        .enumerate()
        .filter_map(|(i, l)| parse_task(l).map(|(done, t)| TaskLine { line: i, text: t.to_string(), done }))
        .collect();
    all[all.len().saturating_sub(n)..].to_vec()
}

/// Flips one checkbox in place; every other byte (incl. CRLF) is untouched.
fn toggle_in(content: &str, line: usize, text: &str) -> Result<(String, bool), String> {
    let mut lines: Vec<String> = content.split_inclusive(NL).map(String::from).collect();
    let l = lines.get_mut(line).ok_or("inbox changed, reopen")?;
    let done = match parse_task(l) {
        Some((d, t)) if t == text => d,
        _ => return Err("inbox changed, reopen".into()),
    };
    if let Some(bracket) = l.find('[') {
        if bracket + 2 < l.len() && l.as_bytes().get(bracket + 2) == Some(&b']') {
            l.replace_range(bracket + 1..bracket + 2, if done { " " } else { "x" });
            return Ok((lines.concat(), !done));
        }
    }
    Err("invalid task checkbox syntax".into())
}

fn read_inbox(path: &std::path::Path) -> Result<String, String> {
    match std::fs::read_to_string(path) {
        Ok(s) => Ok(s),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(format!("cannot read {}: {e}", path.display())),
    }
}

#[tauri::command]
pub fn capture_list(app: AppHandle) -> Result<Vec<TaskLine>, String> {
    Ok(list_tasks(&read_inbox(&inbox_path(&app)?)?, 8))
}

#[tauri::command]
pub fn capture_toggle(app: AppHandle, line: usize, text: String) -> Result<bool, String> {
    let path = inbox_path(&app)?;
    // Note: read-modify-write without a lock; an editor saving the same instant can lose one edit.
    let (out, done) = toggle_in(&read_inbox(&path)?, line, &text)?;
    std::fs::write(&path, out).map_err(|e| format!("cannot write {}: {e}", path.display()))?;
    Ok(done)
}

#[tauri::command]
pub fn capture_open(app: AppHandle) -> Result<(), String> {
    let path = inbox_path(&app)?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("cannot create {}: {e}", dir.display()))?;
    }
    std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| format!("cannot create {}: {e}", path.display()))?;
    crate::live::tools::shell_open(&path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tasks() {
        let f = "# Inbox\r\n- [ ] a  _(s1)_\r\nnote\n- [x] b c  _(s2)_\n- [ ] no stamp";
        let l = list_tasks(f, 8);
        assert_eq!(l.len(), 3);
        assert_eq!(l[0], TaskLine { line: 1, text: "a".into(), done: false });
        assert_eq!(l[1], TaskLine { line: 3, text: "b c".into(), done: true });
        assert_eq!(l[2].text, "no stamp");
        assert_eq!(list_tasks(f, 1)[0].line, 4);
        let (out, done) = toggle_in(f, 1, "a").unwrap();
        assert!(done);
        assert_eq!(out, f.replacen("- [ ] a", "- [x] a", 1));
        let (back, d2) = toggle_in(&out, 1, "a").unwrap();
        assert!(!d2);
        assert_eq!(back, f);
        assert!(toggle_in(f, 1, "zz").is_err());
        assert!(toggle_in(f, 99, "a").is_err());

        // Asterisk bullets and indentation
        let f2 = "* [ ] star item\r\n  - [ ] indented subtask\r\n";
        let l2 = list_tasks(f2, 8);
        assert_eq!(l2.len(), 2);
        assert_eq!(l2[0].text, "star item");
        assert_eq!(l2[1].text, "indented subtask");
        let (out2, d_star) = toggle_in(f2, 0, "star item").unwrap();
        assert!(d_star);
        assert_eq!(out2, "* [x] star item\r\n  - [ ] indented subtask\r\n");
        let (out3, d_sub) = toggle_in(f2, 1, "indented subtask").unwrap();
        assert!(d_sub);
        assert_eq!(out3, "* [ ] star item\r\n  - [x] indented subtask\r\n");
    }

    #[test]
    fn lines() {
        assert_eq!(task_line(" call\nmom ", "2026-10-01 09:00").unwrap(), "- [ ] call mom  _(2026-10-01 09:00)_\n");
        assert!(task_line(" \n\t", "x").is_err());
        assert_eq!(task_line(&"a".repeat(5000), "x").unwrap().len(), 4000 + "- [ ]   _(x)_\n".len());
    }

    #[test]
    fn test_sanitize_and_inbox_path() {
        let def = Some(PathBuf::from("C:\\Users\\User\\Documents\\Winsle"));
        assert_eq!(
            resolve_inbox_path("", def.clone()).unwrap(),
            PathBuf::from("C:\\Users\\User\\Documents\\Winsle\\inbox.md")
        );
        assert_eq!(
            resolve_inbox_path("   ", def.clone()).unwrap(),
            PathBuf::from("C:\\Users\\User\\Documents\\Winsle\\inbox.md")
        );
        assert_eq!(
            resolve_inbox_path("D:\\Notes", def.clone()).unwrap(),
            PathBuf::from("D:\\Notes\\inbox.md")
        );
        assert!(resolve_inbox_path("   ", None).is_err());
        assert!(resolve_inbox_path("D:\\Invalid\0Path", def).is_err());

        let raw = "hello\x00world\x1b[31mwith\tnewline\nend";
        let cleaned = sanitize_task_text(raw);
        assert!(!cleaned.contains('\0'));
        assert!(!cleaned.contains('\x1b'));
        assert_eq!(
            task_line("hello\x00world\ttask", "2026-10-23").unwrap(),
            "- [ ] hello world task  _(2026-10-23)_\n"
        );
    }
}


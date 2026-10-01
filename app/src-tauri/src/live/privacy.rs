// Which apps are using the mic / camera right now, read from the same
// CapabilityAccessManager consent store that drives the taskbar privacy icon.

use std::collections::BTreeSet;
use std::time::Duration;

use serde::Serialize;
use tauri::AppHandle;
use windows::core::{HSTRING, PWSTR};
use windows::Win32::System::Registry::{
    RegCloseKey, RegEnumKeyExW, RegOpenKeyExW, RegQueryValueExW, HKEY, HKEY_CURRENT_USER, KEY_READ,
};

const STORE: &str = r"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore";

#[derive(Serialize, Clone, PartialEq, Debug, Default)]
pub struct PrivacyInfo {
    pub mic: Vec<String>,
    pub cam: Vec<String>,
}

pub fn spawn(app: AppHandle) {
    let _ = std::thread::Builder::new().name("live-privacy".into()).spawn(move || {
        let mut last: Option<PrivacyInfo> = None;
        loop {
            if !crate::live::paused() {
                let cur = snapshot();
                if last.as_ref() != Some(&cur) {
                    crate::live::emit(&app, "live-privacy", cur.clone());
                    last = Some(cur);
                }
            }
            std::thread::sleep(Duration::from_secs(1));
        }
    });
}

fn snapshot() -> PrivacyInfo {
    PrivacyInfo { mic: in_use("microphone"), cam: in_use("webcam") }
}

struct Key(HKEY);
impl Drop for Key {
    fn drop(&mut self) {
        unsafe {
            let _ = RegCloseKey(self.0);
        }
    }
}

fn open(parent: HKEY, path: &str) -> Option<Key> {
    let mut k = HKEY::default();
    unsafe { RegOpenKeyExW(parent, &HSTRING::from(path), None, KEY_READ, &mut k) }.ok().ok()?;
    Some(Key(k))
}

fn subkeys(k: &Key) -> Vec<String> {
    let mut out = Vec::new();
    let mut buf = [0u16; 512];
    for i in 0.. {
        let mut len = buf.len() as u32;
        let r = unsafe {
            RegEnumKeyExW(k.0, i, Some(PWSTR(buf.as_mut_ptr())), &mut len, None, None, None, None)
        };
        if r.is_err() {
            break; // ERROR_NO_MORE_ITEMS
        }
        out.push(String::from_utf16_lossy(&buf[..len as usize]));
    }
    out
}

fn qword(k: &Key, name: &str) -> u64 {
    let mut v = 0u64;
    let mut len = 8u32;
    let r = unsafe {
        RegQueryValueExW(k.0, &HSTRING::from(name), None, None, Some(&mut v as *mut u64 as *mut u8), Some(&mut len))
    };
    if r.is_ok() && len == 8 { v } else { 0 }
}

fn active(k: &Key) -> bool {
    qword(k, "LastUsedTimeStart") != 0 && qword(k, "LastUsedTimeStop") == 0
}

fn in_use(cap: &str) -> Vec<String> {
    let mut names = BTreeSet::new();
    let Some(root) = open(HKEY_CURRENT_USER, &format!(r"{STORE}\{cap}")) else { return vec![] };
    for sub in subkeys(&root) {
        let Some(k) = open(root.0, &sub) else { continue };
        if sub == "NonPackaged" {
            for exe in subkeys(&k) {
                if open(k.0, &exe).is_some_and(|e| active(&e)) {
                    names.insert(exe_name(&exe));
                }
            }
        } else if active(&k) {
            names.insert(package_name(&sub));
        }
    }
    names.into_iter().filter(|n| !n.is_empty()).collect()
}

fn capitalise(s: &str) -> String {
    let mut c = s.chars();
    c.next().map(|f| f.to_uppercase().chain(c).collect()).unwrap_or_default()
}

/// "C:#Program Files#Google#Chrome#Application#chrome.exe" → "Chrome"
fn exe_name(path: &str) -> String {
    let file = path.rsplit(['#', '\\']).next().unwrap_or(path);
    let stem = file.strip_suffix(".exe").or_else(|| file.strip_suffix(".EXE")).unwrap_or(file);
    match stem.to_ascii_lowercase().as_str() {
        "msedge" | "msedgewebview2" => "Edge".into(),
        "ms-teams" => "Teams".into(),
        _ => capitalise(stem),
    }
}

/// "Microsoft.WindowsCamera_8wekyb3d8bbwe" → "WindowsCamera"
fn package_name(pkg: &str) -> String {
    let base = pkg.split('_').next().unwrap_or(pkg);
    capitalise(base.rsplit('.').next().unwrap_or(base))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names() {
        assert_eq!(exe_name("C:#Program Files#Google#Chrome#Application#chrome.exe"), "Chrome");
        assert_eq!(exe_name("C:#x#msedge.exe"), "Edge");
        assert_eq!(exe_name("C:#Apps#OBS#obs64.exe"), "Obs64");
        assert_eq!(package_name("Microsoft.WindowsCamera_8wekyb3d8bbwe"), "WindowsCamera");
        assert_eq!(package_name("zoom"), "Zoom");
    }

    #[test]
    #[ignore]
    fn print_live() {
        println!("PRIVACY: {:?}", snapshot());
    }
}

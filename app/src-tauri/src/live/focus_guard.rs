// Focus guard: while a focus session runs, a foreground app or browser tab on
// the user's block list is minimised (never killed). Piggybacks on usage.rs's
// 5 s foreground sample — no poller of its own. Also counts seconds spent on
// block-listed things every day (focus or not) for the coach's weekly report,
// in %APPDATA%\Winsle\distract.json ({ "YYYY-MM-DD": { "YouTube": secs } }).

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::AppHandle;
use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowTextW, ShowWindow, SW_MINIMIZE};

use super::usage::{civil, today_num, DayUsage, AppUsage};

const TICK: u64 = 5;
const KEEP_DAYS: i64 = 14;
const BROWSERS: &[&str] = &["chrome", "msedge", "firefox", "brave", "opera", "vivaldi", "arc", "librewolf", "zen"];

#[derive(Default)]
struct Guard {
    active: bool,
    apps: Vec<String>,
    sites: Vec<String>,
    allow_until: Option<Instant>,
}

type Days = BTreeMap<String, BTreeMap<String, u64>>;

static GUARD: Mutex<Guard> = Mutex::new(Guard { active: false, apps: Vec::new(), sites: Vec::new(), allow_until: None });
static DISTRACT: Mutex<Option<Days>> = Mutex::new(None);
static APP: OnceLock<AppHandle> = OnceLock::new();

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Blocked {
    name: String,
}

pub fn norm_exe(s: &str) -> String {
    let stem = std::path::Path::new(s)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(s);
    let trimmed = stem.trim().to_lowercase();
    trimmed.strip_suffix(".exe").map(str::to_string).unwrap_or(trimmed)
}

/// Strips protocols, www prefixes, and trailing slashes so site keywords match browser titles cleanly.
pub fn clean_site_keyword(s: &str) -> &str {
    let s = s.trim();
    let s = s.strip_prefix("https://").unwrap_or(s);
    let s = s.strip_prefix("http://").unwrap_or(s);
    let s = s.strip_prefix("www.").unwrap_or(s);
    s.trim_end_matches('/')
}

/// Returns both the full domain/path ("youtube.com") and its stem ("youtube") for flexible title matching.
pub fn site_keyword_stems(s: &str) -> (&str, &str) {
    let raw = clean_site_keyword(s);
    let stem = match raw.rfind('.') {
        Some(i) if i > 0 => &raw[..i],
        _ => raw,
    };
    (raw, stem)
}

pub fn is_browser(exe: &str) -> bool {
    let norm = norm_exe(exe);
    BROWSERS.contains(&norm.as_str())
}

/// Strips control characters and zero-width spaces from window titles before matching.
pub fn sanitize_window_title(title: &str) -> String {
    title.chars().filter(|c| !c.is_control() && *c != '\u{200b}').collect()
}

/// Which block-list entry the foreground window hits, if any. `exe` is the
/// image stem ("chrome"); site keywords only apply to browser windows.
pub fn matches(apps: &[String], sites: &[String], exe: &str, title: &str) -> Option<String> {
    let exe = norm_exe(exe);
    if let Some(a) = apps.iter().find(|a| !a.trim().is_empty() && norm_exe(a) == exe) {
        return Some(a.trim().to_string());
    }
    if !is_browser(&exe) {
        return None;
    }
    let cleaned_title = sanitize_window_title(title).to_lowercase();
    sites
        .iter()
        .map(|s| s.trim())
        .find(|s| {
            let (raw, stem) = site_keyword_stems(s);
            let raw_lower = raw.to_lowercase();
            let stem_lower = stem.to_lowercase();
            (!raw_lower.is_empty() && cleaned_title.contains(&raw_lower))
                || (!stem_lower.is_empty() && cleaned_title.contains(&stem_lower))
        })
        .map(str::to_string)
}



fn allowed(allow_until: Option<Instant>, now: Instant) -> bool {
    allow_until.is_some_and(|t| now < t)
}

fn file() -> PathBuf {
    crate::settings::config_dir().join("distract.json")
}

fn record(name: &str) {
    let mut g = DISTRACT.lock().unwrap_or_else(|e| e.into_inner());
    let days = g.get_or_insert_with(|| std::fs::read_to_string(file()).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default());
    let today = today_num();
    let oldest = civil(today - KEEP_DAYS + 1);
    days.retain(|d, _| *d >= oldest);
    let secs = days.entry(civil(today)).or_default().entry(name.to_string()).or_default();
    *secs += TICK;
    // Once a minute is plenty; losing <60 s on a crash is fine.
    if *secs % 60 == 0 {
        match serde_json::to_string(&*days) {
            Ok(json) => {
                if let Err(e) = std::fs::write(file(), json) {
                    crate::log::line(format!("focus_guard: cannot save: {e}"));
                }
            }
            Err(e) => crate::log::line(format!("focus_guard: cannot encode: {e}")),
        }
    }
}

/// Called from usage.rs on every foreground sample (not paused, not idle).
pub fn check(exe: &str) {
    let (apps, sites, active, allow) = {
        let g = GUARD.lock().unwrap_or_else(|e| e.into_inner());
        if g.apps.is_empty() && g.sites.is_empty() {
            return;
        }
        (g.apps.clone(), g.sites.clone(), g.active, g.allow_until)
    };
    let hwnd = unsafe { GetForegroundWindow() };
    if hwnd.is_invalid() {
        return;
    }
    let mut buf = [0u16; 512];
    let len = unsafe { GetWindowTextW(hwnd, &mut buf) }.max(0) as usize;
    let title = String::from_utf16_lossy(&buf[..len]);
    let Some(name) = matches(&apps, &sites, exe, &title) else { return };
    record(&name);
    if !active || allowed(allow, Instant::now()) {
        return;
    }
    unsafe {
        let _ = ShowWindow(hwnd, SW_MINIMIZE);
    }
    if let Some(app) = APP.get() {
        super::emit(app, "focus-blocked", Blocked { name });
    }
}

/// The island pushes focus state and block lists whenever either changes.
#[tauri::command]
pub fn focus_guard_set(app: AppHandle, active: bool, apps: Vec<String>, sites: Vec<String>) {
    let _ = APP.set(app);
    let mut g = GUARD.lock().unwrap_or_else(|e| e.into_inner());
    if !active {
        g.allow_until = None;
    }
    g.active = active;
    g.apps = apps;
    g.sites = sites;
}

/// "Allow 5 min": suspends blocking (not counting) for `minutes`.
#[tauri::command]
pub fn focus_guard_allow(minutes: u32) {
    let mins = minutes.clamp(1, 60) as u64;
    GUARD.lock().unwrap_or_else(|e| e.into_inner()).allow_until = Some(Instant::now() + Duration::from_secs(mins * 60));
}

/// Seconds on block-listed things per day, oldest first, `days` long.
#[tauri::command]
pub fn distract_days(days: u32) -> Vec<DayUsage> {
    let mut g = DISTRACT.lock().unwrap_or_else(|e| e.into_inner());
    let d = g.get_or_insert_with(|| std::fs::read_to_string(file()).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default());
    let today = today_num();
    let n = days.clamp(1, KEEP_DAYS as u32) as i64;
    (today - n + 1..=today)
        .map(|x| {
            let day = civil(x);
            let total_secs = d.get(&day).map(|m| m.values().sum()).unwrap_or(0);
            DayUsage { day, total_secs }
        })
        .collect()
}

pub fn aggregate_distractions(days: &BTreeMap<String, BTreeMap<String, u64>>, oldest: &str) -> Vec<AppUsage> {
    let mut sum: BTreeMap<String, u64> = BTreeMap::new();
    for (_, apps) in days.range(oldest.to_string()..) {
        for (n, s) in apps {
            *sum.entry(n.clone()).or_default() += s;
        }
    }
    let mut v: Vec<AppUsage> = sum.into_iter().map(|(name, secs)| AppUsage { name, secs }).collect();
    v.sort_by(|a, b| b.secs.cmp(&a.secs));
    v
}

/// Top distractions over the last `days` days.
#[tauri::command]
pub fn distract_top(days: u32) -> Vec<AppUsage> {
    let mut g = DISTRACT.lock().unwrap_or_else(|e| e.into_inner());
    let d = g.get_or_insert_with(|| std::fs::read_to_string(file()).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default());
    let oldest = civil(today_num() - days.clamp(1, KEEP_DAYS as u32) as i64 + 1);
    aggregate_distractions(d, &oldest)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(x: &[&str]) -> Vec<String> {
        x.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn matcher() {
        let apps = v(&["Discord.exe", " steam "]);
        let sites = v(&["YouTube", "instagram", ""]);
        assert_eq!(matches(&apps, &sites, "discord", "General").as_deref(), Some("Discord.exe"));
        assert_eq!(matches(&apps, &sites, "STEAM", "").as_deref(), Some("steam"));
        assert_eq!(matches(&apps, &sites, "chrome", "Cats - youtube - Google Chrome").as_deref(), Some("YouTube"));
        assert_eq!(matches(&apps, &sites, "msedge", "INSTAGRAM • Reels").as_deref(), Some("instagram"));
        // Keywords only count in browsers; empty entries never match.
        assert_eq!(matches(&apps, &sites, "Code", "youtube.ts - VS Code"), None);
        assert_eq!(matches(&apps, &sites, "chrome", "Docs"), None);
        assert_eq!(matches(&[], &[], "chrome", "YouTube"), None);
    }

    #[test]
    fn allow_window_expires() {
        let now = Instant::now();
        assert!(!allowed(None, now));
        assert!(allowed(Some(now + Duration::from_secs(300)), now));
        assert!(!allowed(Some(now + Duration::from_secs(300)), now + Duration::from_secs(300)));
        assert!(!allowed(Some(now), now + Duration::from_secs(1)));
    }

    #[test]
    fn test_norm_exe_and_keywords() {
        assert_eq!(norm_exe("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"), "chrome");
        assert_eq!(norm_exe("C:\\Users\\User\\AppData\\Local\\Programs\\Zen\\zen.exe"), "zen");
        assert_eq!(norm_exe("DISCORD.EXE"), "discord");

        assert_eq!(clean_site_keyword("https://www.youtube.com/"), "youtube.com");
        assert_eq!(clean_site_keyword("http://reddit.com/r/popular/"), "reddit.com/r/popular");
        assert_eq!(clean_site_keyword("twitter.com"), "twitter.com");

        assert!(is_browser("chrome"));
        assert!(is_browser("msedge.exe"));
        assert!(is_browser("C:\\browsers\\brave.exe"));
        assert!(!is_browser("notepad.exe"));

        let sites = v(&["https://www.youtube.com/", "twitter.com"]);
        assert_eq!(
            matches(&[], &sites, "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "YouTube - Home - Google Chrome").as_deref(),
            Some("https://www.youtube.com/")
        );
    }
}


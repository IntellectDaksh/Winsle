// Screen time: which app is in the foreground, sampled every 5 s, bucketed per
// local day in %APPDATA%\Winsle\usage.json ({ "YYYY-MM-DD": { "App": secs } }).

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use windows::core::PWSTR;
use windows::Win32::Foundation::CloseHandle;
use windows::Win32::System::SystemInformation::GetLocalTime;
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId};

type Days = BTreeMap<String, BTreeMap<String, u64>>;

const TICK: u64 = 5;
const IDLE_SECS: u32 = 120;
const KEEP_DAYS: i64 = 14;
const SAVE_EVERY: Duration = Duration::from_secs(60);

static STATE: Mutex<Days> = Mutex::new(BTreeMap::new());

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppUsage {
    pub name: String,
    pub secs: u64,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DayUsage {
    pub day: String,
    pub total_secs: u64,
}

fn file() -> PathBuf {
    crate::settings::config_dir().join("usage.json")
}

// Civil date <-> day number (Howard Hinnant's algorithm), so "N days ago"
// needs no date crate.
pub(crate) fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    era * 146097 + yoe * 365 + yoe / 4 - yoe / 100 + doy - 719468
}

pub(crate) fn civil(z: i64) -> String {
    let z = z + 719468;
    let era = z.div_euclid(146097);
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    format!("{y:04}-{m:02}-{d:02}")
}

pub(crate) fn today_num() -> i64 {
    let t = unsafe { GetLocalTime() };
    days_from_civil(t.wYear as i64, t.wMonth as i64, t.wDay as i64)
}

/// Drops every day older than the last KEEP_DAYS (today included).
fn prune(days: &mut Days, today: i64) {
    let oldest = civil(today - KEEP_DAYS + 1);
    days.retain(|d, _| *d >= oldest);
}

/// Folds `from` into `into`, adding seconds per app.
fn merge(into: &mut Days, from: Days) {
    for (day, apps) in from {
        let slot = into.entry(day).or_default();
        for (app, secs) in apps {
            *slot.entry(app).or_default() += secs;
        }
    }
}

pub(crate) fn friendly(stem: &str) -> Option<String> {
    let s = stem.trim();
    if s.is_empty() {
        return None;
    }
    let name = match s.to_ascii_lowercase().as_str() {
        "winsle" | "applicationframehost" | "lockapp" | "logonui" | "searchhost" | "shellexperiencehost"
        | "startmenuexperiencehost" | "textinputhost" => return None,
        "chrome" => "Chrome",
        "msedge" => "Edge",
        "code" => "VS Code",
        "explorer" => "File Explorer",
        "windowsterminal" => "Terminal",
        "spotify" => "Spotify",
        "discord" => "Discord",
        "firefox" => "Firefox",
        "afterfx" => "After Effects",
        "adobe premiere pro" => "Premiere Pro",
        "photoshop" => "Photoshop",
        "resolve" => "DaVinci Resolve",
        "figma" => "Figma",
        "whatsapp" => "WhatsApp",
        "notion" => "Notion",
        "slack" => "Slack",
        "obs64" => "OBS Studio",
        _ => s,
    };
    Some(name.to_string())
}

fn foreground_stem() -> Option<String> {
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.is_invalid() {
            return None;
        }
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if pid == 0 {
            return None;
        }
        let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buf = [0u16; 1024];
        let mut len = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(h, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len).is_ok();
        let _ = CloseHandle(h);
        if !ok {
            return None;
        }
        let path = PathBuf::from(String::from_utf16_lossy(&buf[..len as usize]));
        path.file_stem().map(|s| s.to_string_lossy().into_owned())
    }
}

fn save() {
    let json = {
        let mut g = STATE.lock().unwrap_or_else(|e| e.into_inner());
        prune(&mut g, today_num());
        serde_json::to_string(&*g)
    };
    let Ok(json) = json else { return };
    let path = file();
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if let Err(e) = std::fs::write(&path, json) {
        crate::log::line(format!("usage: cannot save: {e}"));
    }
}

pub fn spawn() {
    std::thread::spawn(|| {
        // Merge rather than replace: a sample taken before the load must survive.
        if let Some(loaded) = std::fs::read_to_string(file()).ok().and_then(|s| serde_json::from_str::<Days>(&s).ok()) {
            merge(&mut STATE.lock().unwrap_or_else(|e| e.into_inner()), loaded);
        }
        let mut saved = Instant::now();
        loop {
            std::thread::sleep(Duration::from_secs(TICK));
            if !crate::live::paused() && crate::live::extras::idle_seconds() <= IDLE_SECS {
                if let Some(stem) = foreground_stem() {
                    crate::live::focus_guard::check(&stem);
                    if let Some(name) = friendly(&stem) {
                        let day = civil(today_num());
                        let mut g = STATE.lock().unwrap_or_else(|e| e.into_inner());
                        *g.entry(day).or_default().entry(name).or_default() += TICK;
                    }
                }
            }
            if saved.elapsed() >= SAVE_EVERY {
                save();
                saved = Instant::now();
            }
        }
    });
}

#[tauri::command]
pub fn usage_today() -> Vec<AppUsage> {
    let g = STATE.lock().unwrap_or_else(|e| e.into_inner());
    let mut v: Vec<AppUsage> = g
        .get(&civil(today_num()))
        .map(|m| m.iter().map(|(n, s)| AppUsage { name: n.clone(), secs: *s }).collect())
        .unwrap_or_default();
    v.sort_by(|a, b| b.secs.cmp(&a.secs).then_with(|| a.name.cmp(&b.name)));
    v
}

fn day_totals(days: &Days, today: i64, n: u32) -> Vec<DayUsage> {
    let n = n.clamp(1, KEEP_DAYS as u32) as i64;
    (today - n + 1..=today)
        .map(|d| {
            let day = civil(d);
            let total_secs = days.get(&day).map(|m| m.values().sum()).unwrap_or(0);
            DayUsage { day, total_secs }
        })
        .collect()
}

#[tauri::command]
pub fn usage_days(days: u32) -> Vec<DayUsage> {
    day_totals(&STATE.lock().unwrap_or_else(|e| e.into_inner()), today_num(), days)
}

pub(crate) fn aggregate_top_apps(days: &Days, oldest_day: &str) -> Vec<AppUsage> {
    let mut sum: BTreeMap<String, u64> = BTreeMap::new();
    for (_, apps) in days.range(oldest_day.to_string()..) {
        for (n, s) in apps {
            *sum.entry(n.clone()).or_default() += s;
        }
    }
    let mut v: Vec<AppUsage> = sum.into_iter().map(|(name, secs)| AppUsage { name, secs }).collect();
    v.sort_by(|a, b| b.secs.cmp(&a.secs).then_with(|| a.name.cmp(&b.name)));
    v
}

/// Per-app seconds summed over the last `days` days, biggest first.
#[tauri::command]
pub fn usage_top(days: u32) -> Vec<AppUsage> {
    let oldest = civil(today_num() - days.clamp(1, KEEP_DAYS as u32) as i64 + 1);
    aggregate_top_apps(&STATE.lock().unwrap_or_else(|e| e.into_inner()), &oldest)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn day(apps: &[(&str, u64)]) -> BTreeMap<String, u64> {
        apps.iter().map(|(a, s)| (a.to_string(), *s)).collect()
    }

    #[test]
    fn dates() {
        let t = days_from_civil(2026, 3, 1);
        assert_eq!(civil(t), "2026-03-01");
        assert_eq!(civil(t - 1), "2026-02-28");
        assert_eq!(civil(days_from_civil(2024, 3, 1) - 1), "2024-02-29");
    }

    #[test]
    fn prune_and_merge() {
        let today = days_from_civil(2026, 10, 2);
        let mut d: Days = BTreeMap::new();
        d.insert("2026-09-18".into(), day(&[("Old", 5)]));
        d.insert("2026-09-19".into(), day(&[("Edge", 5)]));
        d.insert("2026-10-02".into(), day(&[("Chrome", 10)]));
        prune(&mut d, today);
        assert_eq!(d.keys().collect::<Vec<_>>(), ["2026-09-19", "2026-10-02"]);

        let mut from: Days = BTreeMap::new();
        from.insert("2026-10-02".into(), day(&[("Chrome", 5), ("Figma", 15)]));
        merge(&mut d, from);
        assert_eq!(d["2026-10-02"], day(&[("Chrome", 15), ("Figma", 15)]));

        let t = day_totals(&d, today, 3);
        assert_eq!(t.len(), 3);
        assert_eq!(t[0], DayUsage { day: "2026-09-30".into(), total_secs: 0 });
        assert_eq!(t[2], DayUsage { day: "2026-10-02".into(), total_secs: 30 });
        assert_eq!(day_totals(&d, today, 99).len(), 14);
    }

    #[test]
    fn names() {
        assert_eq!(friendly("Code").as_deref(), Some("VS Code"));
        assert_eq!(friendly("winsle"), None);
        assert_eq!(friendly("Blender").as_deref(), Some("Blender"));
    }
}

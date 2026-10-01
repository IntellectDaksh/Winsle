// Small OS signals for the island: power, connectivity, clipboard text and
// master volume. Each is a cheap poll on its own thread, emitting on change.

use std::time::Duration;

use serde::Serialize;
use tauri::AppHandle;
use windows::Win32::Foundation::{HANDLE, HGLOBAL};
use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
use windows::Win32::Media::Audio::{eConsole, eRender, IMMDeviceEnumerator, MMDeviceEnumerator};
use windows::Win32::Networking::NetworkListManager::{
    INetworkListManager, NetworkListManager, NLM_CONNECTIVITY_IPV4_INTERNET,
    NLM_CONNECTIVITY_IPV6_INTERNET,
};
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED};
use windows::Win32::System::DataExchange::{
    CloseClipboard, EmptyClipboard, GetClipboardData, GetClipboardSequenceNumber, OpenClipboard,
    SetClipboardData,
};
use windows::Win32::Foundation::GlobalFree;
use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalSize, GlobalUnlock, GMEM_MOVEABLE};
use windows::Win32::System::SystemInformation::GetTickCount;
use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
use windows::Win32::System::Ole::CF_UNICODETEXT;
use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};

const CLIP_MAX: usize = 200;

#[derive(Serialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PowerInfo {
    pub percent: Option<u8>,
    pub charging: bool,
    pub seconds_left: Option<u32>,
}

#[derive(Serialize, Clone, PartialEq, Debug)]
pub struct NetInfo {
    pub online: bool,
}

#[derive(Serialize, Clone, PartialEq, Debug)]
pub struct ClipInfo {
    pub text: String,
}

#[derive(Serialize, Clone, PartialEq, Debug)]
pub struct VolumeInfo {
    pub level: f32,
    pub muted: bool,
}

pub fn spawn(app: AppHandle) {
    let a = app.clone();
    thread("live-power", move || power_loop(a));
    let a = app.clone();
    thread("live-net", move || net_loop(a));
    let a = app.clone();
    thread("live-clip", move || clip_loop(a));
    thread("live-volume", move || volume_loop(app));
}

fn thread(name: &str, f: impl FnOnce() + Send + 'static) {
    if std::thread::Builder::new().name(name.into()).spawn(f).is_err() {
        crate::log::line(format!("extras: cannot spawn {name}"));
    }
}

/// Emits `next` only when it differs from what was last emitted.
fn changed<T: PartialEq + Clone>(last: &mut Option<T>, next: &T) -> bool {
    if last.as_ref() == Some(next) {
        return false;
    }
    *last = Some(next.clone());
    true
}

// ---- power ----

fn power_loop(app: AppHandle) {
    // secondsLeft jitters every sample; only percent/charging count as change.
    let mut last: Option<(Option<u8>, bool)> = None;
    let mut logged = false;
    loop {
        if !crate::live::paused() {
            match power() {
                Some(p) => {
                    if changed(&mut last, &(p.percent, p.charging)) {
                        crate::live::emit(&app, "live-power", p);
                    }
                }
                None if !logged => {
                    logged = true;
                    crate::log::line("extras: GetSystemPowerStatus failed");
                }
                None => {}
            }
        }
        std::thread::sleep(Duration::from_secs(5));
    }
}

fn power() -> Option<PowerInfo> {
    let mut s = SYSTEM_POWER_STATUS::default();
    unsafe { GetSystemPowerStatus(&mut s) }.ok()?;
    Some(power_info(s.ACLineStatus, s.BatteryFlag, s.BatteryLifePercent, s.BatteryLifeTime))
}

fn power_info(ac: u8, flag: u8, pct: u8, secs: u32) -> PowerInfo {
    let no_battery = flag == 128 || pct == 255;
    PowerInfo {
        percent: if no_battery { None } else { Some(pct.min(100)) },
        // ACLineStatus 1 = plugged in; flag bit 8 = charging.
        charging: !no_battery && (ac == 1 || flag & 8 != 0),
        seconds_left: if no_battery || secs == u32::MAX { None } else { Some(secs) },
    }
}

// ---- network ----

/// Flips only after `need` consecutive samples disagree with the current state.
struct Debounce {
    state: Option<bool>,
    streak: u8,
}

impl Debounce {
    fn push(&mut self, sample: bool, need: u8) -> Option<bool> {
        match self.state {
            None => {
                self.state = Some(sample);
                Some(sample)
            }
            Some(s) if s == sample => {
                self.streak = 0;
                None
            }
            Some(_) => {
                self.streak += 1;
                if self.streak >= need {
                    self.streak = 0;
                    self.state = Some(sample);
                    Some(sample)
                } else {
                    None
                }
            }
        }
    }
}

fn net_loop(app: AppHandle) {
    let nlm: INetworkListManager = match unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        CoCreateInstance(&NetworkListManager, None, CLSCTX_ALL)
    } {
        Ok(n) => n,
        Err(e) => {
            crate::log::line(format!("extras: NetworkListManager unavailable: {e}"));
            return;
        }
    };
    let mut deb = Debounce { state: None, streak: 0 };
    let mut logged = false;
    loop {
        match online(&nlm) {
            Some(on) => {
                if let Some(flip) = deb.push(on, 2) {
                    if !crate::live::paused() {
                        crate::live::emit(&app, "live-net", NetInfo { online: flip });
                    }
                }
            }
            None if !logged => {
                logged = true;
                crate::log::line("extras: GetConnectivity failed");
            }
            None => {}
        }
        std::thread::sleep(Duration::from_secs(3));
    }
}

fn online(nlm: &INetworkListManager) -> Option<bool> {
    let c = unsafe { nlm.GetConnectivity() }.ok()?;
    Some(c.0 & (NLM_CONNECTIVITY_IPV4_INTERNET.0 | NLM_CONNECTIVITY_IPV6_INTERNET.0) != 0)
}

// ---- clipboard ----

fn clip_loop(app: AppHandle) {
    // Whatever was on the clipboard before launch isn't news.
    let mut seq = unsafe { GetClipboardSequenceNumber() };
    loop {
        std::thread::sleep(Duration::from_millis(700));
        let now = unsafe { GetClipboardSequenceNumber() };
        if now == seq {
            continue;
        }
        seq = now;
        if crate::live::paused() {
            continue;
        }
        if let Some(text) = read_clipboard().as_deref().and_then(clip_text) {
            crate::live::emit(&app, "live-clip", ClipInfo { text });
        }
    }
}

/// The copying app often still holds the clipboard for a moment.
fn open_clipboard() -> bool {
    for _ in 0..5 {
        if unsafe { OpenClipboard(None) }.is_ok() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(30));
    }
    false
}

fn read_clipboard() -> Option<String> {
    if !open_clipboard() {
        return None;
    }
    let text = unsafe {
        GetClipboardData(CF_UNICODETEXT.0 as u32).ok().and_then(|h: HANDLE| {
            let g = HGLOBAL(h.0);
            let p = GlobalLock(g) as *const u16;
            if p.is_null() {
                return None;
            }
            let max = GlobalSize(g) / 2;
            let mut len = 0;
            while len < max && *p.add(len) != 0 {
                len += 1;
            }
            let s = String::from_utf16_lossy(std::slice::from_raw_parts(p, len));
            let _ = GlobalUnlock(g);
            Some(s)
        })
    };
    let _ = unsafe { CloseClipboard() };
    text
}

/// Trimmed, secret-filtered, truncated text worth showing; None to stay quiet.
fn clip_text(raw: &str) -> Option<String> {
    let t = raw.trim();
    if t.is_empty() || looks_secret(t) {
        return None;
    }
    Some(t.chars().take(CLIP_MAX).collect())
}

fn looks_secret(t: &str) -> bool {
    const PREFIXES: [&str; 5] = ["sk-", "ghp_", "xox", "AKIA", "eyJ"];
    if PREFIXES.iter().any(|p| t.starts_with(p)) {
        return true;
    }
    // Note: heuristic — catches tokens/keys/hashes, not every secret (e.g. short passwords).
    !t.chars().any(char::is_whitespace)
        && t.chars().count() >= 20
        && t.chars().any(|c| c.is_ascii_alphabetic())
        && t.chars().any(|c| c.is_ascii_digit())
}

// ---- volume ----

fn endpoint() -> windows::core::Result<IAudioEndpointVolume> {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let en: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
        en.GetDefaultAudioEndpoint(eRender, eConsole)?.Activate(CLSCTX_ALL, None)
    }
}

fn read_volume(ep: &IAudioEndpointVolume) -> windows::core::Result<VolumeInfo> {
    unsafe {
        Ok(VolumeInfo {
            level: ep.GetMasterVolumeLevelScalar()?,
            muted: ep.GetMute()?.as_bool(),
        })
    }
}

fn volume_loop(app: AppHandle) {
    let mut last: Option<VolumeInfo> = None;
    let mut ep: Option<IAudioEndpointVolume> = None;
    let mut logged = false;
    loop {
        std::thread::sleep(Duration::from_secs(1));
        // Re-resolve each failure: the default device changes (headphones, HDMI).
        if ep.is_none() {
            ep = endpoint().ok();
        }
        let Some(v) = ep.as_ref().and_then(|e| read_volume(e).ok()) else {
            if !logged {
                logged = true;
                crate::log::line("extras: no default audio endpoint");
            }
            ep = None;
            continue;
        };
        let first = last.is_none();
        if changed(&mut last, &v) && !first && !crate::live::paused() {
            crate::live::emit(&app, "live-volume", v);
        }
    }
}

fn step_level(cur: f32, delta: f32) -> f32 {
    (cur + delta).clamp(0.0, 1.0)
}

#[tauri::command]
pub async fn volume_step(delta: f32) -> Result<f32, String> {
    if !delta.is_finite() {
        return Err("bad delta".into());
    }
    tauri::async_runtime::spawn_blocking(move || -> windows::core::Result<f32> {
        let ep = endpoint()?;
        unsafe {
            let next = step_level(ep.GetMasterVolumeLevelScalar()?, delta);
            ep.SetMasterVolumeLevelScalar(next, std::ptr::null())?;
            if delta > 0.0 {
                ep.SetMute(false, std::ptr::null())?;
            }
            Ok(next)
        }
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

const CLIP_SET_MAX: usize = 100_000;

#[tauri::command]
pub fn clip_set(text: String) -> Result<(), String> {
    if text.chars().count() > CLIP_SET_MAX {
        return Err("text too long".into());
    }
    let wide: Vec<u16> = text.encode_utf16().chain(std::iter::once(0)).collect();
    if !open_clipboard() {
        return Err("clipboard busy".into());
    }
    let res = unsafe {
        (|| -> windows::core::Result<()> {
            EmptyClipboard()?;
            let g = GlobalAlloc(GMEM_MOVEABLE, wide.len() * 2)?;
            let p = GlobalLock(g) as *mut u16;
            if p.is_null() {
                let _ = GlobalFree(Some(g));
                return Err(windows::core::Error::from_win32());
            }
            std::ptr::copy_nonoverlapping(wide.as_ptr(), p, wide.len());
            let _ = GlobalUnlock(g);
            // On success the clipboard owns the memory.
            if let Err(e) = SetClipboardData(CF_UNICODETEXT.0 as u32, Some(HANDLE(g.0))) {
                let _ = GlobalFree(Some(g));
                return Err(e);
            }
            Ok(())
        })()
    };
    let _ = unsafe { CloseClipboard() };
    res.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn volume_set(level: f32) -> Result<f32, String> {
    if !level.is_finite() {
        return Err("bad level".into());
    }
    let level = level.clamp(0.0, 1.0);
    tauri::async_runtime::spawn_blocking(move || -> windows::core::Result<f32> {
        let ep = endpoint()?;
        unsafe {
            ep.SetMasterVolumeLevelScalar(level, std::ptr::null())?;
            if level > 0.0 {
                ep.SetMute(false, std::ptr::null())?;
            }
        }
        Ok(level)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn volume_mute() -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(|| -> windows::core::Result<bool> {
        let ep = endpoint()?;
        unsafe {
            let next = !ep.GetMute()?.as_bool();
            ep.SetMute(next, std::ptr::null())?;
            Ok(next)
        }
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn idle_seconds() -> u32 {
    let mut li = LASTINPUTINFO { cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32, dwTime: 0 };
    if !unsafe { GetLastInputInfo(&mut li) }.as_bool() {
        return 0;
    }
    // Both are 32-bit ms tick counts; wrapping_sub survives the 49-day rollover.
    unsafe { GetTickCount() }.wrapping_sub(li.dwTime) / 1000
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn secrets_filtered() {
        assert!(clip_text("sk-abc").is_none());
        assert!(clip_text("  ghp_x  ").is_none());
        assert!(clip_text("eyJhbGciOi").is_none());
        assert!(clip_text("a1b2c3d4e5f6g7h8i9j0").is_none());
        assert!(clip_text("   \n").is_none());
        assert_eq!(clip_text(" hello world 123 "), Some("hello world 123".into()));
        assert_eq!(clip_text("aaaaaaaaaaaaaaaaaaaaaaaaa"), Some("a".repeat(25))); // no digits
        assert_eq!(clip_text("short1"), Some("short1".into()));
    }

    #[test]
    fn truncates() {
        assert_eq!(clip_text(&"é ".repeat(300)).unwrap().chars().count(), 200);
    }

    #[test]
    fn change_detection() {
        let mut last = None;
        assert!(changed(&mut last, &1));
        assert!(!changed(&mut last, &1));
        assert!(changed(&mut last, &2));
    }

    #[test]
    fn debounce() {
        let mut d = Debounce { state: None, streak: 0 };
        assert_eq!(d.push(true, 2), Some(true));
        assert_eq!(d.push(false, 2), None);
        assert_eq!(d.push(true, 2), None); // blip reset
        assert_eq!(d.push(false, 2), None);
        assert_eq!(d.push(false, 2), Some(false));
    }

    #[test]
    fn power_mapping() {
        assert_eq!(power_info(1, 128, 255, u32::MAX), PowerInfo { percent: None, charging: false, seconds_left: None });
        assert_eq!(power_info(0, 1, 80, 3600), PowerInfo { percent: Some(80), charging: false, seconds_left: Some(3600) });
        assert!(power_info(1, 8, 50, u32::MAX).charging);
        assert_eq!(step_level(0.98, 0.05), 1.0);
        assert_eq!(step_level(0.02, -0.05), 0.0);
    }

    #[test]
    #[ignore]
    fn real_values() {
        println!("power: {:?}", power());
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        }
        let nlm: INetworkListManager = unsafe { CoCreateInstance(&NetworkListManager, None, CLSCTX_ALL) }.unwrap();
        println!("online: {:?}", online(&nlm));
        println!("volume: {:?}", endpoint().and_then(|e| read_volume(&e)));
    }
}

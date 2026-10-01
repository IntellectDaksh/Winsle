// Now-playing via the WinRT global media session manager (what the Windows
// volume flyout shows). Polled on a dedicated MTA thread: blocking `.get()` on
// WinRT async ops is only safe off the UI thread.

use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use base64::Engine;
use serde::Serialize;
use tauri::AppHandle;
use windows::core::Result as WinResult;
use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSession as Session,
    GlobalSystemMediaTransportControlsSessionManager as Manager,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status,
};
use windows::Storage::Streams::{DataReader, IRandomAccessStreamReference};
use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};

const ART_MAX_BYTES: u64 = 300 * 1024;
const RESYNC: Duration = Duration::from_secs(5);

#[derive(Serialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MediaInfo {
    pub app: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub playing: bool,
    pub position: Option<f64>,
    pub duration: Option<f64>,
    pub art: Option<String>,
    pub can_prev: bool,
    pub can_next: bool,
}

impl MediaInfo {
    fn track_key(&self) -> (&str, &str, &str, &str) {
        (&self.app, &self.title, &self.artist, &self.album)
    }
    /// Everything except the ever-moving position.
    fn same_state(&self, o: &MediaInfo) -> bool {
        MediaInfo { position: None, ..self.clone() } == MediaInfo { position: None, ..o.clone() }
    }
}

pub fn spawn(app: AppHandle) {
    let _ = std::thread::Builder::new().name("live-media".into()).spawn(move || {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        }
        let mut mgr: Option<Manager> = None;
        let mut last: Option<MediaInfo> = None;
        let mut last_emit = Instant::now();
        let mut sent_once = false;
        // Track whose art the island already holds; it keeps it, so repeats go out without it.
        let mut art_sent_for: Option<String> = None;
        loop {
            std::thread::sleep(Duration::from_secs(1));
            if crate::live::paused() {
                continue;
            }
            if mgr.is_none() {
                mgr = Manager::RequestAsync().and_then(|op| op.get()).ok();
            }
            let Some(m) = &mgr else { continue };
            let cur = match snapshot(m, last.as_ref()) {
                Ok(c) => c,
                Err(_) => {
                    // Manager can go stale (e.g. explorer restart) — rebuild next tick.
                    mgr = None;
                    continue;
                }
            };
            if should_emit(last.as_ref(), cur.as_ref(), last_emit.elapsed()) || !sent_once {
                let mut out = cur.clone();
                match out.as_mut() {
                    Some(info) => {
                        let (a, t, ar, al) = info.track_key();
                        let key = format!("{a}\u{1f}{t}\u{1f}{ar}\u{1f}{al}");
                        if art_sent_for.as_deref() == Some(key.as_str()) {
                            info.art = None;
                        } else {
                            art_sent_for = Some(key);
                        }
                    }
                    None => art_sent_for = None,
                }
                crate::live::emit(&app, "live-media", out);
                last_emit = Instant::now();
                sent_once = true;
            }
            last = cur;
        }
    });
}

fn should_emit(prev: Option<&MediaInfo>, cur: Option<&MediaInfo>, since: Duration) -> bool {
    match (prev, cur) {
        (None, None) => false,
        (Some(p), Some(c)) => {
            if !p.same_state(c) {
                return true;
            }
            if c.playing && since >= RESYNC {
                return true;
            }
            // Seek: position moved more than the 1 s tick could explain.
            match (p.position, c.position) {
                (Some(a), Some(b)) => {
                    let expected = if c.playing { a + 1.0 } else { a };
                    (b - expected).abs() > 2.5
                }
                (a, b) => a.is_some() != b.is_some(),
            }
        }
        _ => true,
    }
}

fn current_session(m: &Manager) -> Option<Session> {
    m.GetCurrentSession().ok()
}

fn snapshot(m: &Manager, prev: Option<&MediaInfo>) -> WinResult<Option<MediaInfo>> {
    let Some(s) = current_session(m) else { return Ok(None) };
    let props = s.TryGetMediaPropertiesAsync()?.get()?;
    let pb = s.GetPlaybackInfo()?;
    let status = pb.PlaybackStatus()?;
    if status == Status::Closed || status == Status::Stopped {
        return Ok(None);
    }
    let playing = status == Status::Playing;
    let (can_prev, can_next) = match pb.Controls() {
        Ok(c) => (c.IsPreviousEnabled().unwrap_or(false), c.IsNextEnabled().unwrap_or(false)),
        Err(_) => (false, false),
    };

    let (mut position, mut duration) = (None, None);
    if let Ok(tl) = s.GetTimelineProperties() {
        let start = tl.StartTime().map(|t| t.Duration).unwrap_or(0);
        let end = tl.EndTime().map(|t| t.Duration).unwrap_or(0);
        if end > start {
            let mut pos = (tl.Position().map(|t| t.Duration).unwrap_or(0) - start) as f64 / 1e7;
            if playing {
                // Apps only push timeline updates occasionally; extrapolate from that stamp.
                if let Ok(upd) = tl.LastUpdatedTime() {
                    let age = (now_filetime() - upd.UniversalTime) as f64 / 1e7;
                    if age > 0.0 && age < 24.0 * 3600.0 {
                        pos += age;
                    }
                }
            }
            let dur = (end - start) as f64 / 1e7;
            position = Some(pos.clamp(0.0, dur));
            duration = Some(dur);
        }
    }

    let mut info = MediaInfo {
        app: friendly_app(&s.SourceAppUserModelId().map(|h| h.to_string()).unwrap_or_default()),
        title: props.Title().map(|h| h.to_string()).unwrap_or_default(),
        artist: props.Artist().map(|h| h.to_string()).unwrap_or_default(),
        album: props.AlbumTitle().map(|h| h.to_string()).unwrap_or_default(),
        playing,
        position,
        duration,
        art: None,
        can_prev,
        can_next,
    };
    if info.title.is_empty() && info.artist.is_empty() {
        return Ok(None);
    }
    // Art is fetched only on track change; the cached copy rides along on every
    // emit so the UI never has to merge partial payloads.
    info.art = match prev {
        Some(p) if p.track_key() == info.track_key() => p.art.clone(),
        _ => props.Thumbnail().ok().and_then(|r| read_art(&r).ok().flatten()),
    };
    Ok(Some(info))
}

fn read_art(r: &IRandomAccessStreamReference) -> WinResult<Option<String>> {
    let stream = r.OpenReadAsync()?.get()?;
    let size = stream.Size()?;
    if size == 0 || size > ART_MAX_BYTES {
        return Ok(None);
    }
    let reader = DataReader::CreateDataReader(&stream.GetInputStreamAt(0)?)?;
    let n = reader.LoadAsync(size as u32)?.get()?;
    let mut buf = vec![0u8; n as usize];
    reader.ReadBytes(&mut buf)?;
    Ok(data_url(&buf))
}

fn data_url(bytes: &[u8]) -> Option<String> {
    let mime = if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
        "image/png"
    } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        "image/jpeg"
    } else {
        return None;
    };
    Some(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
}

fn now_filetime() -> i64 {
    const EPOCH_DIFF_SECS: i64 = 11_644_473_600;
    let d = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    (d.as_secs() as i64 + EPOCH_DIFF_SECS) * 10_000_000 + d.subsec_nanos() as i64 / 100
}

/// "Spotify.exe" → "Spotify", "SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify" → "Spotify",
/// "308046B0AF4A39CB" (Firefox's AUMID) and browsers mapped explicitly.
pub(crate) fn friendly_app(aumid: &str) -> String {
    let lower = aumid.to_ascii_lowercase();
    for (needle, name) in [
        ("chrome", "Chrome"),
        ("msedge", "Edge"),
        ("firefox", "Firefox"),
        ("308046b0af4a39cb", "Firefox"),
        ("brave", "Brave"),
        ("opera", "Opera"),
        ("spotify", "Spotify"),
        ("zunemusic", "Media Player"),
        ("zunevideo", "Movies & TV"),
        ("vlc", "VLC"),
    ] {
        if lower.contains(needle) {
            return name.to_string();
        }
    }
    let mut s = aumid;
    if let Some(i) = s.rfind(['\\', '/']) {
        s = &s[i + 1..];
    }
    if s.len() > 4 && s[s.len() - 4..].eq_ignore_ascii_case(".exe") {
        s = &s[..s.len() - 4];
    }
    // Packaged AUMID: Publisher.App_hash!Entry → App
    if let Some(i) = s.find('_') {
        s = &s[..i];
    }
    if let Some(i) = s.rfind('.') {
        s = &s[i + 1..];
    }
    if s.is_empty() {
        return "Media".into();
    }
    let mut c = s.chars();
    c.next().map(|f| f.to_uppercase().chain(c).collect()).unwrap_or_default()
}

#[tauri::command]
pub async fn media_control(action: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        }
        let mgr = Manager::RequestAsync().and_then(|o| o.get()).map_err(|e| e.to_string())?;
        let s = current_session(&mgr).ok_or("no media session")?;
        let op = match action.as_str() {
            "play_pause" => s.TryTogglePlayPauseAsync(),
            "next" => s.TrySkipNextAsync(),
            "prev" => s.TrySkipPreviousAsync(),
            other => return Err(format!("unknown media action: {other}")),
        };
        match op.and_then(|o| o.get()) {
            Ok(true) => Ok(()),
            Ok(false) => Err("app refused the command".into()),
            Err(e) => Err(e.to_string()),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn media_seek(seconds: f64) -> Result<(), String> {
    if !seconds.is_finite() || seconds < 0.0 {
        return Err("bad position".into());
    }
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        }
        let mgr = Manager::RequestAsync().and_then(|o| o.get()).map_err(|e| e.to_string())?;
        let s = current_session(&mgr).ok_or("no media session")?;
        match s.TryChangePlaybackPositionAsync((seconds * 1e7) as i64).and_then(|o| o.get()) {
            Ok(true) => Ok(()),
            Ok(false) => Err("app refused the command".into()),
            Err(e) => Err(e.to_string()),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_names() {
        assert_eq!(friendly_app("Spotify.exe"), "Spotify");
        assert_eq!(friendly_app("chrome"), "Chrome");
        assert_eq!(friendly_app("MSEdge"), "Edge");
        assert_eq!(friendly_app("foobar2000.exe"), "Foobar2000");
        assert_eq!(friendly_app("Contoso.CoolPlayer_8wekyb3d8bbwe!App"), "CoolPlayer");
        assert_eq!(friendly_app(""), "Media");
    }

    #[test]
    fn art_data_url() {
        assert_eq!(data_url(&[0xFF, 0xD8, 0xFF, 0xE0]).unwrap(), "data:image/jpeg;base64,/9j/4A==");
        assert!(data_url(&[0x89, b'P', b'N', b'G']).unwrap().starts_with("data:image/png;base64,"));
        assert!(data_url(b"GIF89a").is_none());
    }

    #[test]
    fn emit_rules() {
        let a = MediaInfo {
            app: "Spotify".into(), title: "t".into(), artist: "a".into(), album: "".into(),
            playing: true, position: Some(10.0), duration: Some(200.0), art: None,
            can_prev: true, can_next: true,
        };
        let tick = MediaInfo { position: Some(11.0), ..a.clone() };
        assert!(!should_emit(Some(&a), Some(&tick), Duration::from_secs(1)));
        assert!(should_emit(Some(&a), Some(&tick), RESYNC));
        let seek = MediaInfo { position: Some(60.0), ..a.clone() };
        assert!(should_emit(Some(&a), Some(&seek), Duration::from_secs(1)));
        let paused = MediaInfo { playing: false, ..a.clone() };
        assert!(should_emit(Some(&a), Some(&paused), Duration::from_secs(1)));
        assert!(should_emit(Some(&a), None, Duration::ZERO));
        assert!(!should_emit(None, None, Duration::ZERO));
    }

    #[test]
    #[ignore]
    fn print_live() {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        }
        let m = Manager::RequestAsync().unwrap().get().unwrap();
        let mut i = snapshot(&m, None).unwrap();
        if let Some(x) = i.as_mut() {
            x.art = x.art.as_ref().map(|a| format!("{}… ({} chars)", &a[..30.min(a.len())], a.len()));
        }
        println!("MEDIA: {i:?}");
    }
}

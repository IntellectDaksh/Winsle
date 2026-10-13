// Voice commands: hold Ctrl+Alt+<key> (default J), speak, release. Push-to-talk
// only — an always-listening wake word would keep the mic and a model busy all
// day, which a 2GB laptop cannot afford. Audio is captured with waveIn into
// memory, written to a temp WAV, and transcribed by whisper.cpp as a short-lived
// child process, so nothing speech-related holds RAM between commands.
// The transcript goes back to the island, which runs it through the agent.

use std::io::{Read, Write};
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use windows::Win32::Media::Audio::{
    waveInAddBuffer, waveInClose, waveInOpen, waveInPrepareHeader, waveInReset, waveInStart, waveInUnprepareHeader,
    CALLBACK_NULL, HWAVEIN, WAVEFORMATEX, WAVEHDR, WAVE_FORMAT_PCM, WAVE_MAPPER, WHDR_DONE,
};
use windows::Win32::Security::Cryptography::{
    BCryptCreateHash, BCryptDestroyHash, BCryptFinishHash, BCryptHashData, BCRYPT_HASH_HANDLE, BCRYPT_SHA256_ALG_HANDLE,
};
use windows::Win32::System::Threading::GetCurrentThreadId;
use windows::Win32::UI::Input::KeyboardAndMouse::{
    GetAsyncKeyState, RegisterHotKey, UnregisterHotKey, MOD_ALT, MOD_CONTROL, MOD_NOREPEAT,
};
use windows::Win32::UI::WindowsAndMessaging::{GetMessageW, PostThreadMessageW, MSG, WM_HOTKEY, WM_QUIT};

const RATE: u32 = 16_000;
const MAX_SECS: usize = 15;
/// 100 ms of 16-bit mono per buffer.
const BUF_BYTES: usize = (RATE as usize / 10) * 2;
const BUFS: usize = 4;
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

// Pinned downloads. Hashes from the GitHub release asset digest and the
// Hugging Face LFS oid; bump all three together.
const ENGINE_URL: &str = "https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.2/whisper-bin-x64.zip";
const ENGINE_SHA256: &str = "49dcc16de826f20bd53d44f947a1ae49dfa81f86cad67a64d80820cb192d674a";
const MODEL_URL: &str = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin";
const MODEL_SHA256: &str = "921e4cf8686fdd993dcd081a5da5b6c365bfde1162e72b08d75ac75289920b1f";

/// Letters the capture hotkeys already own (Ctrl+Alt+…).
const TAKEN: &str = "NWFVLCK";

static INSTALLING: AtomicBool = AtomicBool::new(false);
static BUSY: AtomicBool = AtomicBool::new(false);
/// Thread id of the hotkey loop, 0 when none is running.
static LOOP_THREAD: AtomicU32 = AtomicU32::new(0);
static LAST_ERROR: std::sync::Mutex<String> = std::sync::Mutex::new(String::new());

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Config {
    enabled: bool,
    key: String,
}

impl Default for Config {
    fn default() -> Self {
        Self { enabled: false, key: "J".into() }
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VoiceStatus {
    enabled: bool,
    key: String,
    installed: bool,
    installing: bool,
    error: Option<String>,
}

/// Island event "voice-state". phase: listening | transcribing | done | error.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct VoiceState {
    phase: &'static str,
    level: f32,
    text: String,
    error: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Progress {
    stage: &'static str,
    done: u64,
    total: u64,
}

fn dir() -> PathBuf {
    crate::settings::local_dir().join("voice")
}

fn model_path() -> PathBuf {
    dir().join("ggml-tiny.en.bin")
}

fn cli_path() -> PathBuf {
    dir().join("engine").join("Release").join("whisper-cli.exe")
}

fn installed() -> bool {
    cli_path().is_file() && model_path().is_file()
}

fn load_config() -> Config {
    std::fs::read(dir().join("config.json"))
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

fn set_error(e: impl Into<String>) {
    let e = e.into();
    if !e.is_empty() {
        crate::log::line(format!("voice: {e}"));
    }
    *LAST_ERROR.lock().unwrap_or_else(|p| p.into_inner()) = e;
}

fn status() -> VoiceStatus {
    let c = load_config();
    let err = LAST_ERROR.lock().unwrap_or_else(|p| p.into_inner()).clone();
    VoiceStatus {
        enabled: c.enabled,
        key: c.key,
        installed: installed(),
        installing: INSTALLING.load(Ordering::Relaxed),
        error: (!err.is_empty()).then_some(err),
    }
}

fn valid_key(key: &str) -> Result<char, String> {
    let k = key.trim().to_ascii_uppercase();
    let mut chars = k.chars();
    match (chars.next(), chars.next()) {
        (Some(c), None) if c.is_ascii_alphanumeric() && !TAKEN.contains(c) => Ok(c),
        (Some(c), None) if TAKEN.contains(c) => Err(format!("Ctrl+Alt+{c} is already used by Winsle")),
        _ => Err("hotkey must be one letter or digit".into()),
    }
}

#[tauri::command]
pub fn voice_status() -> VoiceStatus {
    status()
}

#[tauri::command]
pub fn voice_configure(app: AppHandle, enabled: bool, key: String) -> Result<VoiceStatus, String> {
    let key = valid_key(&key)?.to_string();
    std::fs::create_dir_all(dir()).map_err(|e| format!("cannot create {}: {e}", dir().display()))?;
    let json = serde_json::to_vec(&Config { enabled, key }).map_err(|e| e.to_string())?;
    std::fs::write(dir().join("config.json"), json).map_err(|e| format!("cannot save voice config: {e}"))?;
    apply(app);
    Ok(status())
}

/// Called at startup: registers the hotkey only when voice is on and installed.
pub fn spawn(app: AppHandle) {
    apply(app);
}

/// (Re)starts the hotkey loop to match the saved config.
fn apply(app: AppHandle) {
    let tid = LOOP_THREAD.swap(0, Ordering::SeqCst);
    if tid != 0 {
        let _ = unsafe { PostThreadMessageW(tid, WM_QUIT, Default::default(), Default::default()) };
    }
    let c = load_config();
    if !c.enabled || !installed() {
        set_error("");
        return;
    }
    let Ok(key) = valid_key(&c.key) else {
        set_error(format!("bad hotkey {:?}", c.key));
        return;
    };
    std::thread::spawn(move || hotkey_loop(app, key));
}

fn hotkey_loop(app: AppHandle, key: char) {
    let vk = key as u32; // A-Z / 0-9 virtual-key codes equal their ASCII.
    let mut ok = false;
    // The previous loop may need a moment to drop the same key.
    for _ in 0..10 {
        if unsafe { RegisterHotKey(None, 1, MOD_CONTROL | MOD_ALT | MOD_NOREPEAT, vk) }.is_ok() {
            ok = true;
            break;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    if !ok {
        set_error(format!("Ctrl+Alt+{key} is taken by another app"));
        return;
    }
    set_error("");
    let me = unsafe { GetCurrentThreadId() };
    LOOP_THREAD.store(me, Ordering::SeqCst);
    let mut msg = MSG::default();
    while unsafe { GetMessageW(&mut msg, None, 0, 0) }.as_bool() {
        if msg.message != WM_HOTKEY || crate::live::paused() || BUSY.swap(true, Ordering::SeqCst) {
            continue;
        }
        let pcm = record(&app, vk as i32);
        match pcm {
            Ok(pcm) if pcm.len() < RATE as usize / 3 => {
                BUSY.store(false, Ordering::SeqCst);
                emit(&app, "error", 0.0, "", Some("too short — hold the keys while you speak".into()));
            }
            Ok(pcm) => {
                emit(&app, "transcribing", 0.0, "", None);
                let app = app.clone();
                std::thread::spawn(move || {
                    match transcribe(&pcm) {
                        Ok(t) if t.is_empty() => emit(&app, "error", 0.0, "", Some("didn't catch that".into())),
                        Ok(t) => emit(&app, "done", 0.0, &t, None),
                        Err(e) => emit(&app, "error", 0.0, "", Some(e)),
                    }
                    BUSY.store(false, Ordering::SeqCst);
                });
            }
            Err(e) => {
                BUSY.store(false, Ordering::SeqCst);
                emit(&app, "error", 0.0, "", Some(e));
            }
        }
    }
    let _ = unsafe { UnregisterHotKey(None, 1) };
    let _ = LOOP_THREAD.compare_exchange(me, 0, Ordering::SeqCst, Ordering::SeqCst);
}

fn emit(app: &AppHandle, phase: &'static str, level: f32, text: &str, error: Option<String>) {
    crate::live::emit(app, "voice-state", VoiceState { phase, level, text: text.into(), error });
}

/// Closes the device on every exit path; buffers must outlive the handle.
struct Mic {
    h: HWAVEIN,
    hdrs: Box<[WAVEHDR; BUFS]>,
    _bufs: Vec<Vec<u8>>,
}

impl Drop for Mic {
    fn drop(&mut self) {
        let size = std::mem::size_of::<WAVEHDR>() as u32;
        unsafe {
            waveInReset(self.h);
            for hdr in self.hdrs.iter_mut() {
                waveInUnprepareHeader(self.h, hdr, size);
            }
            waveInClose(self.h);
        }
    }
}

/// Records while the hotkey letter is held, up to MAX_SECS, emitting the level.
fn record(app: &AppHandle, vk: i32) -> Result<Vec<i16>, String> {
    let fmt = WAVEFORMATEX {
        wFormatTag: WAVE_FORMAT_PCM as u16,
        nChannels: 1,
        nSamplesPerSec: RATE,
        nAvgBytesPerSec: RATE * 2,
        nBlockAlign: 2,
        wBitsPerSample: 16,
        cbSize: 0,
    };
    let mut h = HWAVEIN::default();
    let rc = unsafe { waveInOpen(Some(&mut h), WAVE_MAPPER, &fmt, None, None, CALLBACK_NULL) };
    if rc != 0 {
        return Err(format!("no microphone available (waveIn error {rc})"));
    }
    let mut bufs: Vec<Vec<u8>> = (0..BUFS).map(|_| vec![0u8; BUF_BYTES]).collect();
    let mut hdrs: Box<[WAVEHDR; BUFS]> = Box::new(std::array::from_fn(|_| WAVEHDR::default()));
    for (hdr, buf) in hdrs.iter_mut().zip(bufs.iter_mut()) {
        hdr.lpData = windows::core::PSTR(buf.as_mut_ptr());
        hdr.dwBufferLength = BUF_BYTES as u32;
    }
    let mut mic = Mic { h, hdrs, _bufs: bufs };
    let size = std::mem::size_of::<WAVEHDR>() as u32;
    for hdr in mic.hdrs.iter_mut() {
        let rc = unsafe {
            let r = waveInPrepareHeader(h, hdr, size);
            if r != 0 { r } else { waveInAddBuffer(h, hdr, size) }
        };
        if rc != 0 {
            return Err(format!("microphone buffer error {rc}"));
        }
    }
    if unsafe { waveInStart(h) } != 0 {
        return Err("could not start the microphone".into());
    }
    emit(app, "listening", 0.0, "", None);
    let max = RATE as usize * MAX_SECS;
    let mut pcm: Vec<i16> = Vec::with_capacity(RATE as usize * 3);
    let started = Instant::now();
    let held = || unsafe { GetAsyncKeyState(vk) } as u16 & 0x8000 != 0;
    while held() && pcm.len() < max && started.elapsed() < Duration::from_secs(MAX_SECS as u64 + 1) {
        std::thread::sleep(Duration::from_millis(30));
        let mut fresh = false;
        for hdr in mic.hdrs.iter_mut() {
            if hdr.dwFlags & WHDR_DONE == 0 {
                continue;
            }
            let n = hdr.dwBytesRecorded as usize;
            let data = unsafe { std::slice::from_raw_parts(hdr.lpData.0, n) };
            let before = pcm.len();
            pcm.extend(data.chunks_exact(2).map(|b| i16::from_le_bytes([b[0], b[1]])));
            if !fresh {
                emit(app, "listening", level(&pcm[before..]), "", None);
                fresh = true;
            }
            hdr.dwFlags &= !WHDR_DONE;
            if unsafe { waveInAddBuffer(h, hdr, size) } != 0 {
                return Err("microphone stopped".into());
            }
        }
    }
    pcm.truncate(max);
    Ok(pcm)
}

/// RMS mapped to a 0–1 meter; speech sits around 0.3–0.8.
fn level(s: &[i16]) -> f32 {
    if s.is_empty() {
        return 0.0;
    }
    let sum: f64 = s.iter().map(|&v| (v as f64) * (v as f64)).sum();
    ((sum / s.len() as f64).sqrt() / 32768.0 * 6.0).min(1.0) as f32
}

fn wav_header(data_bytes: u32) -> [u8; 44] {
    let mut h = [0u8; 44];
    let mut put = |at: usize, b: &[u8]| h[at..at + b.len()].copy_from_slice(b);
    put(0, b"RIFF");
    put(4, &(36 + data_bytes).to_le_bytes());
    put(8, b"WAVEfmt ");
    put(16, &16u32.to_le_bytes());
    put(20, &1u16.to_le_bytes()); // PCM
    put(22, &1u16.to_le_bytes()); // mono
    put(24, &RATE.to_le_bytes());
    put(28, &(RATE * 2).to_le_bytes());
    put(32, &2u16.to_le_bytes());
    put(34, &16u16.to_le_bytes());
    put(36, b"data");
    put(40, &data_bytes.to_le_bytes());
    h
}

/// whisper output → one command line: drops [BLANK_AUDIO], (noises), timestamps,
/// collapses whitespace and trailing punctuation.
fn clean_transcript(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut depth = 0i32;
    for c in raw.chars() {
        match c {
            '[' | '(' => depth += 1,
            ']' | ')' if depth > 0 => depth -= 1,
            _ if depth == 0 => out.push(c),
            _ => {}
        }
    }
    let joined = out.split_whitespace().collect::<Vec<_>>().join(" ");
    joined.trim_end_matches(['.', '!', '?', ',', ';', ':', ' ']).to_string()
}

fn transcribe(pcm: &[i16]) -> Result<String, String> {
    let wav = std::env::temp_dir().join(format!("winsle-voice-{}.wav", std::process::id()));
    let bytes: Vec<u8> = pcm.iter().flat_map(|s| s.to_le_bytes()).collect();
    std::fs::File::create(&wav)
        .and_then(|mut f| {
            f.write_all(&wav_header(bytes.len() as u32))?;
            f.write_all(&bytes)
        })
        .map_err(|e| format!("cannot write temp audio: {e}"))?;
    let threads = std::thread::available_parallelism().map(|n| n.get().min(4)).unwrap_or(2).to_string();
    let child = std::process::Command::new(cli_path())
        .args(["-m"])
        .arg(model_path())
        .arg("-f")
        .arg(&wav)
        .args(["-nt", "-np", "-l", "en", "-t", &threads])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .creation_flags(CREATE_NO_WINDOW)
        .spawn();
    let out = child.map_err(|e| format!("cannot start whisper: {e}")).and_then(wait_whisper);
    let _ = std::fs::remove_file(&wav);
    let out = out?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        let last = err.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or("unknown error");
        return Err(format!("whisper failed: {last}"));
    }
    Ok(clean_transcript(&String::from_utf8_lossy(&out.stdout)))
}

/// Pipes are drained on threads so a chatty whisper can't block on a full pipe while we poll.
fn wait_whisper(mut child: std::process::Child) -> Result<std::process::Output, String> {
    fn drain<R: Read + Send + 'static>(r: Option<R>) -> std::thread::JoinHandle<Vec<u8>> {
        std::thread::spawn(move || {
            let mut v = Vec::new();
            if let Some(mut r) = r {
                let _ = r.read_to_end(&mut v);
            }
            v
        })
    }
    let (so, se) = (drain(child.stdout.take()), drain(child.stderr.take()));
    let deadline = Instant::now() + Duration::from_secs(30);
    let status = loop {
        match child.try_wait() {
            Ok(Some(st)) => break st,
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(50)),
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("whisper timed out".into());
            }
            Err(e) => return Err(format!("whisper wait failed: {e}")),
        }
    };
    Ok(std::process::Output { status, stdout: so.join().unwrap_or_default(), stderr: se.join().unwrap_or_default() })
}

// ── Engine download ───────────────────────────────────────────────────────────

struct Sha256(BCRYPT_HASH_HANDLE);

// A CNG hash object has no thread affinity; only one owner touches it at a time.
unsafe impl Send for Sha256 {}

impl Sha256 {
    fn new() -> Result<Self, String> {
        let mut h = BCRYPT_HASH_HANDLE::default();
        unsafe { BCryptCreateHash(BCRYPT_SHA256_ALG_HANDLE, &mut h, None, None, 0) }
            .ok()
            .map_err(|e| format!("sha256: {e}"))?;
        Ok(Self(h))
    }
    fn update(&mut self, b: &[u8]) -> Result<(), String> {
        unsafe { BCryptHashData(self.0, b, 0) }.ok().map_err(|e| format!("sha256: {e}"))
    }
    fn hex(self) -> Result<String, String> {
        let mut out = [0u8; 32];
        unsafe { BCryptFinishHash(self.0, &mut out, 0) }.ok().map_err(|e| format!("sha256: {e}"))?;
        Ok(out.iter().map(|b| format!("{b:02x}")).collect())
    }
}

impl Drop for Sha256 {
    fn drop(&mut self) {
        let _ = unsafe { BCryptDestroyHash(self.0) };
    }
}

/// Streams `url` to `dest` via a .part file, verifying SHA-256 before the rename.
async fn download(app: &AppHandle, stage: &'static str, url: &str, sha: &str, dest: &Path) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .user_agent(concat!("Winsle/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| e.to_string())?;
    let mut resp = client
        .get(url)
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("download failed: {e}"))?;
    let total = resp.content_length().unwrap_or(0);
    let part = dest.with_extension("part");
    let mut file = std::fs::File::create(&part).map_err(|e| format!("cannot write {}: {e}", part.display()))?;
    let mut hash = Sha256::new()?;
    let mut done = 0u64;
    let mut last = Instant::now();
    let result: Result<(), String> = async {
        while let Some(chunk) = resp.chunk().await.map_err(|e| format!("download interrupted: {e}"))? {
            hash.update(&chunk)?;
            file.write_all(&chunk).map_err(|e| format!("disk write failed: {e}"))?;
            done += chunk.len() as u64;
            if last.elapsed() > Duration::from_millis(250) {
                last = Instant::now();
                // Settings window shows the progress, so this goes to every window.
                let _ = app.emit("voice-progress", Progress { stage, done, total });
            }
        }
        Ok(())
    }
    .await;
    drop(file);
    let result = result.and_then(|_| {
        let got = hash.hex()?;
        if got != sha {
            return Err(format!("{stage} checksum mismatch — download corrupted or tampered"));
        }
        std::fs::rename(&part, dest).map_err(|e| format!("cannot save {}: {e}", dest.display()))
    });
    if result.is_err() {
        let _ = std::fs::remove_file(&part);
    }
    let _ = app.emit("voice-progress", Progress { stage, done, total });
    result
}

fn file_sha256(path: &Path) -> Result<String, String> {
    let mut f = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut hash = Sha256::new()?;
    let mut buf = vec![0u8; 1 << 16];
    loop {
        let n = f.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        hash.update(&buf[..n])?;
    }
    hash.hex()
}

fn extract(zip: &Path, to: &Path) -> Result<(), String> {
    let _ = std::fs::remove_dir_all(to);
    std::fs::create_dir_all(to).map_err(|e| format!("cannot create {}: {e}", to.display()))?;
    // Windows 10+ ships bsdtar, which reads zip; no unzip crate needed.
    let tar = std::env::var_os("SystemRoot")
        .map(|r| PathBuf::from(r).join("System32").join("tar.exe"))
        .unwrap_or_else(|| PathBuf::from("tar.exe"));
    let out = std::process::Command::new(tar)
        .arg("-xf")
        .arg(zip)
        .arg("-C")
        .arg(to)
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| format!("cannot run tar.exe: {e}"))?;
    if !out.status.success() {
        return Err(format!("unzip failed: {}", String::from_utf8_lossy(&out.stderr).trim()));
    }
    Ok(())
}

async fn install(app: &AppHandle) -> Result<(), String> {
    let d = dir();
    std::fs::create_dir_all(&d).map_err(|e| format!("cannot create {}: {e}", d.display()))?;
    if !cli_path().is_file() {
        let zip = d.join("engine.zip");
        download(app, "engine", ENGINE_URL, ENGINE_SHA256, &zip).await?;
        let r = extract(&zip, &d.join("engine"));
        let _ = std::fs::remove_file(&zip);
        r?;
        if !cli_path().is_file() {
            return Err("whisper-cli.exe missing from the release zip".into());
        }
    }
    let model = model_path();
    if model.is_file() && file_sha256(&model)? != MODEL_SHA256 {
        let _ = std::fs::remove_file(&model);
    }
    if !model.is_file() {
        download(app, "model", MODEL_URL, MODEL_SHA256, &model).await?;
    }
    Ok(())
}

/// Downloads whisper.cpp + tiny.en (~85 MB total) into %LOCALAPPDATA%\Winsle\voice.
#[tauri::command]
pub async fn voice_install(app: AppHandle) -> Result<VoiceStatus, String> {
    if INSTALLING.swap(true, Ordering::SeqCst) {
        return Err("already downloading".into());
    }
    let r = install(&app).await;
    INSTALLING.store(false, Ordering::SeqCst);
    match r {
        Ok(()) => {
            apply(app);
            Ok(status())
        }
        Err(e) => {
            set_error(e.clone());
            Err(e)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wav() {
        let h = wav_header(32000);
        assert_eq!(&h[0..4], b"RIFF");
        assert_eq!(u32::from_le_bytes(h[4..8].try_into().unwrap()), 32036);
        assert_eq!(&h[8..16], b"WAVEfmt ");
        assert_eq!(u16::from_le_bytes([h[22], h[23]]), 1);
        assert_eq!(u32::from_le_bytes(h[24..28].try_into().unwrap()), 16000);
        assert_eq!(u32::from_le_bytes(h[28..32].try_into().unwrap()), 32000);
        assert_eq!(u16::from_le_bytes([h[34], h[35]]), 16);
        assert_eq!(&h[36..40], b"data");
        assert_eq!(u32::from_le_bytes(h[40..44].try_into().unwrap()), 32000);
    }

    #[test]
    fn transcript() {
        assert_eq!(clean_transcript(" Pause music.\n"), "Pause music");
        assert_eq!(clean_transcript("[BLANK_AUDIO]\n"), "");
        assert_eq!(clean_transcript("[00:00:00.000 --> 00:00:02.000]  Timer 10!\n"), "Timer 10");
        assert_eq!(clean_transcript(" (wind blowing) Remind me in 5 minutes\n to stretch..."), "Remind me in 5 minutes to stretch");
        assert_eq!(clean_transcript("What's next?"), "What's next");
    }

    #[test]
    fn keys() {
        assert_eq!(valid_key("j"), Ok('J'));
        assert!(valid_key("K").is_err());
        assert!(valid_key("JJ").is_err());
        assert!(valid_key("").is_err());
    }

    #[test]
    fn meter() {
        assert_eq!(level(&[]), 0.0);
        assert!(level(&[i16::MAX; 10]) == 1.0);
        assert!(level(&[100; 10]) < 0.05);
    }
}

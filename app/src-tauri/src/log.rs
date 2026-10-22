// Small append-only log at %LOCALAPPDATA%\Winsle\winsle.log — the Windows
// equivalent of nbLog() in HookServer.swift. Nothing leaves the machine.

use std::io::Write;

use windows::Win32::System::SystemInformation::GetLocalTime;

use crate::settings;

pub const MAX_LOG_BYTES: u64 = 1_000_000;

/// Rotates log file to `<file>.1` when its size exceeds max_bytes to preserve recent logs.
pub fn rotate_if_needed(path: &std::path::Path, max_bytes: u64) -> std::io::Result<bool> {
    if let Ok(m) = std::fs::metadata(path) {
        if m.len() >= max_bytes {
            let backup = path.with_extension("log.1");
            let _ = std::fs::remove_file(&backup);
            let _ = std::fs::rename(path, &backup);
            return Ok(true);
        }
    }
    Ok(false)
}

pub fn line(message: impl AsRef<str>) {
    let t = unsafe { GetLocalTime() };
    let stamp = format!(
        "{:04}-{:02}-{:02} {:02}:{:02}:{:02}",
        t.wYear, t.wMonth, t.wDay, t.wHour, t.wMinute, t.wSecond
    );
    let dir = settings::local_dir();
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }
    let path = dir.join("winsle.log");
    let _ = rotate_if_needed(&path, MAX_LOG_BYTES);
    if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{stamp} {}", message.as_ref());
    }
}

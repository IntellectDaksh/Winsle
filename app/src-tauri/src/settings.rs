// Preferences, stored as plain JSON in %APPDATA%\Winsle\settings.json.
// No secret ever lands here — API keys live in the Windows Credential Manager.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    pub sound_enabled: bool,
    pub sound_volume: f64,
    pub auto_close_interval: f64,
    pub absence_interval: f64,
    pub active_integrations: Vec<String>,
    /// "primary" = the main display, "cursor" = whichever display the mouse is on.
    pub screen: String,
    pub autostart: bool,
    pub hooks_installed: bool,
    /// Claude model used by the chat. Changeable in the settings window.
    /// Defaulted explicitly so a settings.json written by an older build still loads.
    #[serde(default = "default_model")]
    pub model: String,
    /// Folders watched for growing render outputs (Premiere, After Effects, Resolve…).
    #[serde(default)]
    pub render_dirs: Vec<String>,
    /// Folder quick-capture notes are appended to (inbox.md). Empty = Documents\Winsle.
    #[serde(default)]
    pub capture_dir: String,
    /// Home tiles shown next to the VS Code card, in order.
    #[serde(default = "default_home_widgets")]
    pub home_widgets: Vec<String>,
}

fn default_home_widgets() -> Vec<String> {
    vec!["media".into(), "calendar".into(), "integrations".into()]
}

fn default_model() -> String {
    crate::claude::DEFAULT_MODEL.to_string()
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            sound_enabled: true,
            sound_volume: 0.12,
            auto_close_interval: 6.0,
            absence_interval: 180.0,
            active_integrations: vec![
                "integration_resend".into(),
                "integration_n8n".into(),
                "integration_vercel".into(),
                "integration_github".into(),
            ],
            screen: "primary".into(),
            autostart: true,
            hooks_installed: false,
            model: default_model(),
            render_dirs: Vec::new(),
            capture_dir: String::new(),
            home_widgets: default_home_widgets(),
        }
    }
}

impl Settings {
    /// Validates and clamps settings fields to safe operational boundaries.
    pub fn sanitize(&mut self) {
        if !self.sound_volume.is_finite() || self.sound_volume < 0.0 {
            self.sound_volume = 0.12;
        } else if self.sound_volume > 1.0 {
            self.sound_volume = 1.0;
        }

        if !self.auto_close_interval.is_finite() || self.auto_close_interval < 1.0 {
            self.auto_close_interval = 6.0;
        } else if self.auto_close_interval > 60.0 {
            self.auto_close_interval = 60.0;
        }

        if !self.absence_interval.is_finite() || self.absence_interval < 10.0 {
            self.absence_interval = 180.0;
        } else if self.absence_interval > 3600.0 {
            self.absence_interval = 3600.0;
        }

        let scr = self.screen.trim().to_lowercase();
        if scr != "primary" && scr != "cursor" {
            self.screen = "primary".into();
        } else {
            self.screen = scr;
        }

        if self.model.trim().is_empty() {
            self.model = default_model();
        }

        if self.home_widgets.is_empty() {
            self.home_widgets = default_home_widgets();
        }

        self.render_dirs.retain(|d| !d.trim().is_empty());
        self.render_dirs.dedup();
        self.active_integrations.retain(|i| !i.trim().is_empty());
        self.active_integrations.dedup();
        self.capture_dir = self.capture_dir.trim().to_string();
    }
}

/// %APPDATA%\Winsle
pub fn config_dir() -> PathBuf {
    let base = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    base.join("Winsle")
}

/// %LOCALAPPDATA%\Winsle — where winsle-hook.exe and the log live.
pub fn local_dir() -> PathBuf {
    let base = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    base.join("Winsle")
}

pub fn hook_exe_path() -> PathBuf {
    local_dir().join("bin").join("winsle-hook.exe")
}

fn settings_path() -> PathBuf {
    config_dir().join("settings.json")
}

#[allow(dead_code)]
pub fn load_from_bytes(bytes: &[u8]) -> Settings {
    let mut s: Settings = serde_json::from_slice(bytes).unwrap_or_default();
    s.sanitize();
    s
}

#[allow(dead_code)]
pub fn from_json_str(json: &str) -> Settings {
    load_from_bytes(json.as_bytes())
}

pub fn load() -> Settings {
    match std::fs::read(settings_path()) {
        Ok(bytes) => load_from_bytes(&bytes),
        Err(_) => Settings::default(),
    }
}

pub fn save(settings: &Settings) -> std::io::Result<()> {
    let mut s = settings.clone();
    s.sanitize();
    let dir = config_dir();
    std::fs::create_dir_all(&dir)?;
    let json = serde_json::to_vec_pretty(&s)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    std::fs::write(settings_path(), json)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_settings() {
        let s = Settings::default();
        assert_eq!(s.sound_volume, 0.12);
        assert_eq!(s.auto_close_interval, 6.0);
        assert_eq!(s.absence_interval, 180.0);
        assert_eq!(s.screen, "primary");
        assert!(!s.home_widgets.is_empty());
    }

    #[test]
    fn test_sanitize_clamps_values() {
        let mut s = Settings {
            sound_volume: 5.0,
            auto_close_interval: 0.1,
            absence_interval: -10.0,
            screen: "invalid_screen".into(),
            model: "".into(),
            home_widgets: Vec::new(),
            ..Settings::default()
        };

        s.sanitize();

        assert_eq!(s.sound_volume, 1.0);
        assert_eq!(s.auto_close_interval, 6.0);
        assert_eq!(s.absence_interval, 180.0);
        assert_eq!(s.screen, "primary");
        assert_eq!(s.model, default_model());
        assert_eq!(s.home_widgets, default_home_widgets());
    }

    #[test]
    fn test_sanitize_guards_nan() {
        let mut s = Settings {
            sound_volume: f64::NAN,
            auto_close_interval: f64::NAN,
            absence_interval: f64::INFINITY,
            screen: "CURSOR".into(),
            ..Settings::default()
        };

        s.sanitize();

        assert_eq!(s.sound_volume, 0.12);
        assert_eq!(s.auto_close_interval, 6.0);
        assert_eq!(s.absence_interval, 180.0);
        assert_eq!(s.screen, "cursor");

        let mut large = Settings {
            absence_interval: 10_000.0,
            ..Settings::default()
        };
        large.sanitize();
        assert_eq!(large.absence_interval, 3600.0);
    }

    #[test]
    fn test_load_from_bytes_corrupted_fallback() {
        let corrupt = b"not a json document at all {]][";
        let loaded = load_from_bytes(corrupt);
        assert_eq!(loaded.sound_volume, 0.12);
        assert_eq!(loaded.screen, "primary");
        assert_eq!(loaded.auto_close_interval, 6.0);
    }

    #[test]
    fn test_from_json_str_and_deduplication() {
        let raw = r#"{
            "soundVolume": 0.5,
            "renderDirs": ["C:\\Videos", "   ", "C:\\Videos", "D:\\Renders"],
            "activeIntegrations": ["github", "", "github", "resend"],
            "captureDir": "  E:\\Notes  "
        }"#;
        let s = from_json_str(raw);
        assert_eq!(s.sound_volume, 0.5);
        assert_eq!(s.render_dirs, vec!["C:\\Videos", "D:\\Renders"]);
        assert_eq!(s.active_integrations, vec!["github", "resend"]);
        assert_eq!(s.capture_dir, "E:\\Notes");
    }
}

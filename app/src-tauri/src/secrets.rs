// API keys live in the Windows Credential Manager, never in source and never in
// the front end — the island can only ask whether a key is present.
// Fallback: a `.env` file (see .env.example) next to the exe or in the working
// directory, e.g. `WINSLE_CALENDAR_ICS_URL=...`. Real environment variables win
// over the file. Keys saved in Settings always win over both.

use keyring::Entry;

const SERVICE: &str = "com.winsle.app";

/// Every key Winsle may store. Anything outside this list is refused.
pub const KNOWN_KEYS: &[&str] = &[
    "anthropic-api-key",
    "n8n-url",
    "n8n-api-key",
    "vercel-token",
    "github-token",
    "stripe-api-key",
    "resend-api-key",
    "notion-api-key",
    "calcom-api-key",
    // A private calendar feed URL (Google "secret address in iCal format") is a credential.
    "calendar-ics-url",
    // Calendar sign-in: app client IDs (normally baked in at build) and per-user refresh tokens.
    "google-client-id",
    "google-client-secret",
    "microsoft-client-id",
    "google-calendar-refresh-token",
    "microsoft-calendar-refresh-token",
    "spotify-client-id",
    "spotify-refresh-token",
];

fn entry(key: &str) -> Option<Entry> {
    if !KNOWN_KEYS.contains(&key) {
        return None;
    }
    Entry::new(SERVICE, key).ok()
}

pub fn get(key: &str) -> Option<String> {
    entry(key)?.get_password().ok().filter(|v| !v.is_empty()).or_else(|| from_env(key))
}

/// "calendar-ics-url" -> "WINSLE_CALENDAR_ICS_URL".
fn env_name(key: &str) -> String {
    format!("WINSLE_{}", key.to_ascii_uppercase().replace('-', "_"))
}

fn from_env(key: &str) -> Option<String> {
    let name = env_name(key);
    std::env::var(&name).ok().or_else(|| dotenv().get(&name).cloned()).filter(|v| !v.trim().is_empty())
}

/// Parsed once; edits to .env need an app restart.
fn dotenv() -> &'static std::collections::HashMap<String, String> {
    static FILE: std::sync::OnceLock<std::collections::HashMap<String, String>> = std::sync::OnceLock::new();
    FILE.get_or_init(|| {
        let exe_dir = std::env::current_exe().ok().and_then(|p| p.parent().map(|d| d.join(".env")));
        let text = exe_dir
            .into_iter()
            .chain(std::iter::once(std::path::PathBuf::from(".env")))
            .find_map(|p| std::fs::read_to_string(p).ok())
            .unwrap_or_default();
        parse_env(&text)
    })
}

fn parse_env(text: &str) -> std::collections::HashMap<String, String> {
    text.lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !l.starts_with('#'))
        .filter_map(|l| l.split_once('='))
        .map(|(k, v)| {
            let v = v.trim();
            let v = v.strip_prefix('"').and_then(|v| v.strip_suffix('"')).unwrap_or(v);
            (k.trim().trim_start_matches("export ").to_string(), v.to_string())
        })
        .collect()
}

pub fn set(key: &str, value: &str) -> Result<(), String> {
    let entry = entry(key).ok_or_else(|| format!("unknown key {key}"))?;
    if value.is_empty() {
        let _ = entry.delete_credential();
        return Ok(());
    }
    entry.set_password(value).map_err(|e| e.to_string())
}

pub fn clear(key: &str) -> Result<(), String> {
    let entry = entry(key).ok_or_else(|| format!("unknown key {key}"))?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

pub fn present(key: &str) -> bool {
    get(key).is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn env_parsing() {
        assert_eq!(env_name("calendar-ics-url"), "WINSLE_CALENDAR_ICS_URL");
        let m = parse_env("# c
export WINSLE_A = \"x=y\"

WINSLE_B=
bad line
");
        assert_eq!(m["WINSLE_A"], "x=y");
        assert_eq!(m["WINSLE_B"], "");
        assert_eq!(m.len(), 2);
    }
}

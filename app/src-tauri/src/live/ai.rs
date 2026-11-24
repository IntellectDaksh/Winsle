// Local assistant: talks to Ollama on 127.0.0.1 only. Nothing leaves the PC.
// The model is loaded on demand and unloaded a few minutes after the last
// request (keep_alive), so an idle Winsle never holds GPU or RAM for it.

use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::time::Duration;

use serde::Serialize;
use serde_json::{json, Value};

const BASE: &str = "http://127.0.0.1:11434";
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
/// How long Ollama keeps the model in memory after a request.
const KEEP_ALIVE: &str = "3m";
const MAX_MODEL_LEN: usize = 128;
const MAX_SYSTEM_LEN: usize = 8_000;
const MAX_PROMPT_LEN: usize = 20_000;
const MAX_JOURNAL_CHARS: usize = 8_000;

/// Validates an Ollama model identifier (e.g. `llama3.2:latest`, `qwen2.5-coder:7b`).
pub(crate) fn is_valid_model_name(raw: &str) -> bool {
    let s = raw.trim();
    !s.is_empty()
        && s.len() <= MAX_MODEL_LEN
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | ':' | '/'))
}

/// Validates model, system prompt, and user prompt lengths before calling Ollama.
pub(crate) fn validate_chat_request(model: &str, system: &str, prompt: &str) -> Result<String, String> {
    if !is_valid_model_name(model) {
        return Err("invalid model name".into());
    }
    if system.len() > MAX_SYSTEM_LEN {
        return Err("system prompt too large".into());
    }
    if prompt.trim().is_empty() || prompt.len() > MAX_PROMPT_LEN {
        return Err("bad request".into());
    }
    Ok(model.trim().to_string())
}

/// Strips `<think>…</think>` reasoning blocks emitted by local reasoning models.
pub(crate) fn strip_think_tags(raw: &str) -> String {
    let trimmed = raw.trim();
    match trimmed.rfind("</think>") {
        Some(i) => trimmed[i + "</think>".len()..].trim().to_string(),
        None => trimmed.to_string(),
    }
}

/// Ensures a shortcut path is strictly a direct `.lnk` child of `recent_dir` with no traversal segments.
pub(crate) fn is_safe_recent_shortcut(path: &std::path::Path, recent_dir: &std::path::Path) -> bool {
    if path
        .components()
        .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return false;
    }
    path.parent().is_some_and(|d| d == recent_dir)
        && path
            .extension()
            .is_some_and(|e| e.eq_ignore_ascii_case("lnk"))
}

/// Caps and trims a journal entry; returns `None` if nothing non-whitespace remains.
pub(crate) fn sanitize_journal_entry(text: &str) -> Option<String> {
    let bounded: String = text.chars().take(MAX_JOURNAL_CHARS).collect();
    let trimmed = bounded.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiStatus {
    pub running: bool,
    pub installed: bool,
    pub models: Vec<String>,
}

/// One shared client (pooled connections) instead of a new one per call; timeouts are per request.
fn client() -> Result<&'static reqwest::Client, String> {
    static C: std::sync::OnceLock<reqwest::Client> = std::sync::OnceLock::new();
    if let Some(c) = C.get() {
        return Ok(c);
    }
    let c = reqwest::Client::builder().build().map_err(|e| e.to_string())?;
    Ok(C.get_or_init(|| c))
}

fn app_path() -> Option<PathBuf> {
    let base = std::env::var_os("LOCALAPPDATA")?;
    let p = PathBuf::from(base).join(r"Programs\Ollama\ollama app.exe");
    p.is_file().then_some(p)
}

async fn models() -> Option<Vec<String>> {
    let v: Value = client().ok()?.get(format!("{BASE}/api/tags")).timeout(Duration::from_millis(1500)).send().await.ok()?.json().await.ok()?;
    Some(
        v["models"]
            .as_array()?
            .iter()
            .filter_map(|m| m["name"].as_str().map(str::to_string))
            .collect(),
    )
}

#[tauri::command]
pub async fn ai_status() -> AiStatus {
    let models = models().await;
    AiStatus { running: models.is_some(), installed: app_path().is_some(), models: models.unwrap_or_default() }
}

/// Starts the Ollama tray app (which runs the server) and waits up to ~15 s for it.
#[tauri::command]
pub async fn ai_start() -> Result<bool, String> {
    if models().await.is_some() {
        return Ok(true);
    }
    let exe = app_path().ok_or("Ollama is not installed")?;
    // The tray app only supervises ollama.exe; without it nothing will ever answer.
    if !exe.with_file_name("ollama.exe").is_file() {
        return Err("Ollama's server (ollama.exe) is missing — reinstall Ollama from ollama.com".into());
    }
    std::process::Command::new(exe)
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map_err(|e| e.to_string())?;
    for _ in 0..30 {
        tokio::time::sleep(Duration::from_millis(500)).await;
        if models().await.is_some() {
            return Ok(true);
        }
    }
    Ok(false)
}

/// One non-streaming chat turn. `json: true` asks Ollama to constrain the reply to JSON.
#[tauri::command]
pub async fn ai_chat(model: String, system: String, prompt: String, json: bool) -> Result<String, String> {
    let model = validate_chat_request(&model, &system, &prompt)?;
    let mut body = json!({
        "model": model,
        "stream": false,
        "keep_alive": KEEP_ALIVE,
        "options": { "temperature": 0.2, "num_ctx": 4096 },
        "messages": [
            { "role": "system", "content": system },
            { "role": "user", "content": prompt },
        ],
    });
    if json {
        body["format"] = json!("json");
    }
    let resp = client()?
        .post(format!("{BASE}/api/chat"))
        .timeout(Duration::from_secs(90))
        .json(&body)
        .send()
        .await
        .map_err(|e| if e.is_connect() { "Ollama is not running".to_string() } else { e.to_string() })?;
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("Ollama {status}: {}", text.chars().take(200).collect::<String>()));
    }
    let v: Value = resp.json().await.map_err(|e| e.to_string())?;
    let content = v["message"]["content"].as_str().unwrap_or("");
    Ok(strip_think_tags(content))
}

// ── Recent files and the journal ─────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentFile {
    pub name: String,
    pub path: String,
    pub time: i64,
}

fn recent_dir() -> Option<PathBuf> {
    std::env::var_os("APPDATA").map(|a| PathBuf::from(a).join(r"Microsoft\Windows\Recent"))
}

/// Shortcuts in the shell's Recent folder, newest first (files only, no folders).
#[tauri::command]
pub fn recent_files() -> Vec<RecentFile> {
    let Some(dir) = recent_dir() else { return Vec::new() };
    let Ok(rd) = std::fs::read_dir(dir) else { return Vec::new() };
    let mut out: Vec<RecentFile> = rd
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            let stem = name.strip_suffix(".lnk")?;
            // "Folder.lnk" has no extension of its own; keep real files only.
            if !stem.contains('.') {
                return None;
            }
            let time = e
                .metadata()
                .ok()?
                .modified()
                .ok()?
                .duration_since(std::time::UNIX_EPOCH)
                .ok()?
                .as_millis() as i64;
            Some(RecentFile { name: stem.to_string(), path: e.path().to_string_lossy().into_owned(), time })
        })
        .collect();
    out.sort_by(|a, b| b.time.cmp(&a.time));
    out.truncate(40);
    out
}

/// Opens a shortcut from the Recent folder (and only from there).
#[tauri::command]
pub fn recent_open(path: String) -> Result<(), String> {
    let dir = recent_dir().ok_or("no Recent folder")?;
    let p = PathBuf::from(&path);
    if !is_safe_recent_shortcut(&p, &dir) || !p.is_file() {
        return Err("not a recent file".into());
    }
    std::process::Command::new("explorer.exe")
        .arg(&p)
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Appends a Markdown block to journal.md next to the capture inbox.
#[tauri::command]
pub fn journal_append(app: tauri::AppHandle, text: String) -> Result<String, String> {
    use std::io::Write;
    let entry = sanitize_journal_entry(&text).ok_or("empty journal entry")?;
    let inbox = crate::live::capture::inbox_path(&app)?;
    let path = inbox.with_file_name("journal.md");
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .and_then(|mut f| f.write_all(format!("{entry}\n\n").as_bytes()))
        .map_err(|e| format!("cannot write {}: {e}", path.display()))?;
    Ok(path.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn model_name_validation_accepts_tags_and_rejects_injection() {
        assert!(is_valid_model_name("llama3.2:latest"));
        assert!(is_valid_model_name("  qwen2.5-coder:7b  "));
        assert!(is_valid_model_name("hf.co/org/model_v1:q4"));
        assert!(!is_valid_model_name(""));
        assert!(!is_valid_model_name("   "));
        assert!(!is_valid_model_name("llama3; rm -rf /"));
        assert!(!is_valid_model_name("model\nname"));
        assert!(!is_valid_model_name(&"a".repeat(MAX_MODEL_LEN + 1)));
    }

    #[test]
    fn validate_chat_request_enforces_bounds() {
        assert_eq!(
            validate_chat_request(" llama3:8b ", "system", "hello").unwrap(),
            "llama3:8b"
        );
        assert!(validate_chat_request("bad model!", "sys", "hi").is_err());
        assert!(validate_chat_request("llama3", &"s".repeat(MAX_SYSTEM_LEN + 1), "hi").is_err());
        assert!(validate_chat_request("llama3", "sys", "   ").is_err());
        assert!(validate_chat_request("llama3", "sys", &"p".repeat(MAX_PROMPT_LEN + 1)).is_err());
    }

    #[test]
    fn strip_think_tags_removes_reasoning_prefix() {
        assert_eq!(
            strip_think_tags("<think>step 1\nstep 2</think>\nFinal answer."),
            "Final answer."
        );
        assert_eq!(strip_think_tags("  Plain response  "), "Plain response");
        assert_eq!(strip_think_tags("<think>a</think>mid</think>  end "), "end");
    }

    #[test]
    fn is_safe_recent_shortcut_blocks_traversal_and_non_lnk() {
        let dir = Path::new(r"C:\Users\Test\AppData\Roaming\Microsoft\Windows\Recent");
        assert!(is_safe_recent_shortcut(&dir.join("notes.txt.lnk"), dir));
        assert!(is_safe_recent_shortcut(&dir.join("notes.LNK"), dir));
        assert!(!is_safe_recent_shortcut(&dir.join("notes.exe"), dir));
        assert!(!is_safe_recent_shortcut(&dir.join(r"..\Desktop\notes.lnk"), dir));
        assert!(!is_safe_recent_shortcut(Path::new(r"C:\Windows\System32\cmd.lnk"), dir));
    }

    #[test]
    fn sanitize_journal_entry_trims_and_rejects_blank() {
        assert_eq!(sanitize_journal_entry("   \n\t "), None);
        assert_eq!(
            sanitize_journal_entry("  Daily note  \n"),
            Some("Daily note".to_string())
        );
        let long = "x".repeat(MAX_JOURNAL_CHARS + 50);
        assert_eq!(sanitize_journal_entry(&long).unwrap().len(), MAX_JOURNAL_CHARS);
    }
}

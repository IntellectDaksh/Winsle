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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiStatus {
    pub running: bool,
    pub installed: bool,
    pub models: Vec<String>,
}

fn client(timeout: Duration) -> Result<reqwest::Client, String> {
    reqwest::Client::builder().timeout(timeout).build().map_err(|e| e.to_string())
}

fn app_path() -> Option<PathBuf> {
    let base = std::env::var_os("LOCALAPPDATA")?;
    let p = PathBuf::from(base).join(r"Programs\Ollama\ollama app.exe");
    p.is_file().then_some(p)
}

async fn models() -> Option<Vec<String>> {
    let v: Value = client(Duration::from_millis(1500)).ok()?.get(format!("{BASE}/api/tags")).send().await.ok()?.json().await.ok()?;
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
    if model.trim().is_empty() || prompt.len() > 20_000 {
        return Err("bad request".into());
    }
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
    let resp = client(Duration::from_secs(90))?
        .post(format!("{BASE}/api/chat"))
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
    let content = v["message"]["content"].as_str().unwrap_or("").trim();
    // Reasoning models wrap their thinking in <think>…</think>; drop it.
    let content = match content.rfind("</think>") {
        Some(i) => content[i + 8..].trim(),
        None => content,
    };
    Ok(content.to_string())
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
    let ok = p.parent().is_some_and(|d| d == dir) && p.extension().is_some_and(|e| e.eq_ignore_ascii_case("lnk")) && p.is_file();
    if !ok {
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
    let inbox = crate::live::capture::inbox_path(&app)?;
    let path = inbox.with_file_name("journal.md");
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let text: String = text.chars().take(8000).collect();
    std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .and_then(|mut f| f.write_all(format!("{}\n\n", text.trim_end()).as_bytes()))
        .map_err(|e| format!("cannot write {}: {e}", path.display()))?;
    Ok(path.to_string_lossy().into_owned())
}

// ai_assistant Code session stats from its transcript (.jsonl under ~/.ai_assistant/projects).

use std::io::{Read, Seek, SeekFrom};
use std::path::PathBuf;

use serde::Serialize;
use serde_json::Value;

const TAIL_BYTES: u64 = 1024 * 1024;
const MAX_TEXT: usize = 800;

#[derive(Serialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptStats {
    pub model: Option<String>,
    pub context_tokens: u64,
    pub output_tokens: u64,
    pub last_text: Option<String>,
    pub assistant_turns: u32,
}

fn checked_path(path: &str) -> Result<PathBuf, String> {
    let home = std::env::var_os("USERPROFILE").ok_or("no USERPROFILE")?;
    let root = PathBuf::from(home).join(".ai_assistant").join("projects").canonicalize().map_err(|e| e.to_string())?;
    let p = PathBuf::from(path).canonicalize().map_err(|e| e.to_string())?;
    let jsonl = p.extension().is_some_and(|e| e.eq_ignore_ascii_case("jsonl"));
    if !jsonl || !p.starts_with(&root) || !p.is_file() {
        return Err("not a ai_assistant Code transcript".into());
    }
    Ok(p)
}

/// Note: only the last 1 MB is read, so output_tokens/assistant_turns cover
/// that window, not the whole session; the first (partial) line is skipped.
fn stats(text: &str) -> TranscriptStats {
    let mut s = TranscriptStats::default();
    for line in text.lines() {
        let Ok(v) = serde_json::from_str::<Value>(line) else { continue };
        if v.get("type").and_then(Value::as_str) != Some("assistant") {
            continue;
        }
        let Some(msg) = v.get("message") else { continue };
        s.assistant_turns += 1;
        if let Some(m) = msg.get("model").and_then(Value::as_str) {
            s.model = Some(m.to_string());
        }
        if let Some(u) = msg.get("usage") {
            let n = |k: &str| u.get(k).and_then(Value::as_u64).unwrap_or(0);
            s.context_tokens = n("input_tokens") + n("cache_read_input_tokens") + n("cache_creation_input_tokens");
            s.output_tokens += n("output_tokens");
        }
        let text: Vec<&str> = msg
            .get("content")
            .and_then(Value::as_array)
            .map(|c| {
                c.iter()
                    .filter(|b| b.get("type").and_then(Value::as_str) == Some("text"))
                    .filter_map(|b| b.get("text").and_then(Value::as_str))
                    .collect()
            })
            .unwrap_or_default();
        let joined = text.join("\n");
        let joined = joined.trim();
        if !joined.is_empty() {
            s.last_text = Some(joined.chars().take(MAX_TEXT).collect());
        }
    }
    s
}

fn read_tail(path: &std::path::Path) -> Result<String, String> {
    let mut f = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let len = f.metadata().map_err(|e| e.to_string())?.len();
    f.seek(SeekFrom::Start(len.saturating_sub(TAIL_BYTES))).map_err(|e| e.to_string())?;
    let mut buf = Vec::new();
    f.read_to_end(&mut buf).map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&buf).into_owned())
}

#[tauri::command]
pub async fn transcript_stats(path: String) -> Result<TranscriptStats, String> {
    tauri::async_runtime::spawn_blocking(move || Ok(stats(&read_tail(&checked_path(&path)?)?)))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_sample() {
        let t = r#"tial garbage line
{"type":"user","message":{"content":"hi"}}
{"type":"assistant","message":{"model":"ai_assistant-x","content":[{"type":"text","text":" first "}],"usage":{"input_tokens":10,"cache_read_input_tokens":100,"cache_creation_input_tokens":5,"output_tokens":7}}}
not json
{"type":"assistant","message":{"model":"ai_assistant-y","content":[{"type":"tool_use","name":"Read"}],"usage":{"input_tokens":1,"cache_read_input_tokens":200,"output_tokens":3}}}
"#;
        let s = stats(t);
        assert_eq!(s.model.as_deref(), Some("ai_assistant-y"));
        assert_eq!(s.context_tokens, 201);
        assert_eq!(s.output_tokens, 10);
        assert_eq!(s.last_text.as_deref(), Some("first"));
        assert_eq!(s.assistant_turns, 2);
    }
}

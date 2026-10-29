//! Private, explicitly enabled file search. No background scanner or network.

use std::collections::VecDeque;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection};
use serde::Serialize;
use tauri::AppHandle;

static DB_LOCK: Mutex<()> = Mutex::new(());
pub const MAX_FILES: usize = 5000;
pub const MAX_BYTES: u64 = 512 * 1024;
pub const MAX_JSONL_BYTES: u64 = 32 * 1024 * 1024;
pub const EXTENSIONS: &[&str] = &[
    "txt", "md", "markdown", "json", "jsonl", "toml", "yaml", "yml", "rs", "ts", "tsx", "js", "jsx", "py", "html", "css", "scss", "sql", "csv", "log"
];
pub const SKIP_DIRS: &[&str] = &[
    ".git", "node_modules", "target", "target-dist", "dist", "build", ".next", ".venv", "venv", ".cache"
];
pub const SKIP_FILES: &[&str] = &[
    "credentials.json", "secrets.json", "token.json", "service-account.json"
];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemorySource { pub id: i64, pub path: String, pub indexed_at: i64, pub file_count: i64 }

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryHit { pub path: String, pub title: String, pub excerpt: String, pub score: f64 }

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexReport { pub indexed: usize, pub skipped: usize }

pub fn db_path() -> PathBuf { crate::settings::local_dir().join("memory.sqlite3") }

pub fn open() -> Result<Connection, String> {
    let p = db_path();
    std::fs::create_dir_all(p.parent().ok_or("Invalid database path")?).map_err(|e| e.to_string())?;
    let db = Connection::open(p).map_err(|e| e.to_string())?;
    db.execute_batch("CREATE TABLE IF NOT EXISTS sources (id INTEGER PRIMARY KEY, path TEXT NOT NULL UNIQUE, indexed_at INTEGER NOT NULL DEFAULT 0, file_count INTEGER NOT NULL DEFAULT 0);\
        CREATE VIRTUAL TABLE IF NOT EXISTS docs USING fts5(source_id UNINDEXED, path UNINDEXED, title, body);")
        .map_err(|e| e.to_string())?;
    Ok(db)
}

pub fn now() -> i64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs() as i64 }

pub fn source_rows(db: &Connection) -> Result<Vec<MemorySource>, String> {
    let mut query = db.prepare("SELECT id, path, indexed_at, file_count FROM sources ORDER BY path").map_err(|e| e.to_string())?;
    let rows = query.query_map([], |row| Ok(MemorySource { id: row.get(0)?, path: row.get(1)?, indexed_at: row.get(2)?, file_count: row.get(3)? }))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
    Ok(rows)
}

#[tauri::command]
pub fn memory_sources() -> Result<Vec<MemorySource>, String> {
    let _guard = DB_LOCK.lock().map_err(|e| e.to_string())?;
    source_rows(&open()?)
}

#[tauri::command]
pub fn memory_add_source(path: String) -> Result<MemorySource, String> {
    let p = PathBuf::from(path).canonicalize().map_err(|e| e.to_string())?;
    if !p.is_dir() && !p.is_file() { return Err("Choose a file or folder".into()); }
    let _guard = DB_LOCK.lock().map_err(|e| e.to_string())?;
    let db = open()?;
    db.execute("INSERT OR IGNORE INTO sources(path) VALUES (?1)", [p.to_string_lossy().as_ref()]).map_err(|e| e.to_string())?;
    let id: i64 = db.query_row("SELECT id FROM sources WHERE path=?1", [p.to_string_lossy().as_ref()], |row| row.get(0)).map_err(|e| e.to_string())?;
    Ok(MemorySource { id, path: p.to_string_lossy().into_owned(), indexed_at: 0, file_count: 0 })
}

#[tauri::command]
pub fn memory_add_builtin(app: AppHandle, kind: String) -> Result<MemorySource, String> {
    let path = match kind.as_str() {
        "captures" => crate::live::capture::inbox_path(&app)?,
        "claude" => std::env::var_os("USERPROFILE")
            .map(PathBuf::from).ok_or("Cannot find user profile")?
            .join(".claude").join("projects"),
        _ => return Err("Unknown memory source".into()),
    };
    memory_add_source(path.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn memory_remove_source(id: i64) -> Result<(), String> {
    let _guard = DB_LOCK.lock().map_err(|e| e.to_string())?;
    let mut db = open()?;
    let tx = db.transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM docs WHERE source_id=?1", [id]).map_err(|e| e.to_string())?;
    let count = tx.execute("DELETE FROM sources WHERE id=?1", [id]).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    if count == 0 { Err("Source not found".into()) } else { Ok(()) }
}

pub fn eligible(p: &Path) -> bool {
    let ext = p.extension().and_then(|e| e.to_str()).unwrap_or_default().to_ascii_lowercase();
    p.is_file() && EXTENSIONS.contains(&ext.as_str()) && p.metadata().is_ok_and(|m| {
        m.len() <= if ext == "jsonl" { MAX_JSONL_BYTES } else { MAX_BYTES }
    })
}

pub fn read_document(path: &Path) -> Result<String, String> {
    if path.extension().is_some_and(|e| e.eq_ignore_ascii_case("jsonl")) {
        let mut file = std::fs::File::open(path).map_err(|e| e.to_string())?;
        let len = file.metadata().map_err(|e| e.to_string())?.len();
        let offset = len.saturating_sub(MAX_BYTES);
        file.seek(SeekFrom::Start(offset)).map_err(|e| e.to_string())?;
        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes).map_err(|e| e.to_string())?;
        let text = String::from_utf8_lossy(&bytes);
        // The tail may start midway through a JSON object. Search only complete lines.
        return Ok(if offset == 0 { text.into_owned() } else { text.split_once('\n').map(|(_, rest)| rest.to_string()).unwrap_or_default() });
    }
    std::fs::read_to_string(path).map_err(|e| e.to_string())
}

pub fn gather(root: &Path) -> (Vec<PathBuf>, usize) {
    let mut queue = VecDeque::from([root.to_path_buf()]);
    let mut files = Vec::new();
    let mut skipped = 0;
    while let Some(path) = queue.pop_front() {
        if files.len() >= MAX_FILES { skipped += 1; continue; }
        let Ok(meta) = std::fs::symlink_metadata(&path) else { skipped += 1; continue };
        if meta.file_type().is_symlink() { skipped += 1; continue; }
        if meta.is_file() {
            if eligible(&path) { files.push(path); } else { skipped += 1; }
        } else if meta.is_dir() {
            let Ok(entries) = std::fs::read_dir(&path) else { skipped += 1; continue };
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_ascii_lowercase();
                if name.starts_with('.') || SKIP_DIRS.contains(&name.as_str()) || SKIP_FILES.contains(&name.as_str()) {
                    skipped += 1; continue;
                }
                queue.push_back(entry.path());
            }
        }
    }
    (files, skipped)
}

#[tauri::command]
pub async fn memory_reindex(id: i64) -> Result<IndexReport, String> {
    tauri::async_runtime::spawn_blocking(move || reindex(id)).await.map_err(|e| e.to_string())?
}

pub fn reindex(id: i64) -> Result<IndexReport, String> {
    let _guard = DB_LOCK.lock().map_err(|e| e.to_string())?;
    let mut db = open()?;
    let raw: String = db.query_row("SELECT path FROM sources WHERE id=?1", [id], |row| row.get(0)).map_err(|_| "Source not found".to_string())?;
    let root = PathBuf::from(&raw);
    if !root.exists() { return Err("Source no longer exists".into()); }
    let (files, mut skipped) = gather(&root);
    let tx = db.transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM docs WHERE source_id=?1", [id]).map_err(|e| e.to_string())?;
    let mut indexed = 0;
    {
        let mut insert = tx.prepare("INSERT INTO docs(source_id,path,title,body) VALUES (?1,?2,?3,?4)").map_err(|e| e.to_string())?;
        for path in files {
            let Ok(body) = read_document(&path) else { skipped += 1; continue };
            if body.trim().is_empty() { skipped += 1; continue; }
            let title = path.file_name().unwrap_or_default().to_string_lossy();
            insert.execute(params![id, path.to_string_lossy().as_ref(), title.as_ref(), body]).map_err(|e| e.to_string())?;
            indexed += 1;
        }
    }
    tx.execute("UPDATE sources SET indexed_at=?1,file_count=?2 WHERE id=?3", params![now(), indexed as i64, id]).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(IndexReport { indexed, skipped })
}

#[tauri::command]
pub fn memory_search(query: String) -> Result<Vec<MemoryHit>, String> {
    let query = query.trim();
    if query.is_empty() { return Ok(Vec::new()); }
    if query.chars().count() > 200 { return Err("Search is too long".into()); }
    let phrase = format!("\"{}\"", query.replace('"', "\"\""));
    let _guard = DB_LOCK.lock().map_err(|e| e.to_string())?;
    let db = open()?;
    let mut statement = db.prepare("SELECT path,title,snippet(docs,3,'','',' … ',24),bm25(docs) FROM docs WHERE docs MATCH ?1 ORDER BY bm25(docs) LIMIT 30")
        .map_err(|e| e.to_string())?;
    let rows = statement.query_map([phrase], |row| Ok(MemoryHit { path: row.get(0)?, title: row.get(1)?, excerpt: row.get(2)?, score: row.get(3)? }))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
    Ok(rows)
}

#[tauri::command]
pub fn memory_clear() -> Result<(), String> {
    let _guard = DB_LOCK.lock().map_err(|e| e.to_string())?;
    let p = db_path();
    if p.exists() { std::fs::remove_file(p).map_err(|e| e.to_string())?; }
    Ok(())
}

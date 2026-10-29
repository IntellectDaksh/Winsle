// Local repository health and explicit, allowlisted project checks.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;

pub const MAX_LOG_BYTES: usize = 128 * 1024;
pub const STATUS_TIMEOUT: Duration = Duration::from_secs(10);
pub const RUN_TIMEOUT: Duration = Duration::from_secs(120);
pub const TASK_IDS: &[&str] = &["build", "test", "lint", "typecheck", "check"];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DevopsSnapshot {
    pub path: String,
    pub project: String,
    pub branch: Option<String>,
    pub changed_files: u32,
    pub staged_files: u32,
    pub untracked_files: u32,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub tasks: Vec<String>,
    pub git_error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DevopsRunResult {
    pub task: String,
    pub exit_code: Option<i32>,
    pub timed_out: bool,
    pub duration_ms: u64,
    pub stdout: String,
    pub stderr: String,
}

pub fn checked_dir(path: &str) -> Result<PathBuf, String> {
    if path.trim().is_empty() {
        return Err("Choose a project folder".into());
    }
    let canonical = Path::new(path)
        .canonicalize()
        .map_err(|e| format!("Project folder: {e}"))?;
    if !canonical.is_dir() {
        return Err("Project path is not a folder".into());
    }
    Ok(canonical)
}

pub fn tasks_for(path: &Path) -> Vec<String> {
    let mut tasks = Vec::new();
    if let Ok(text) = std::fs::read_to_string(path.join("package.json")) {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) {
            if let Some(scripts) = json.get("scripts").and_then(|v| v.as_object()) {
                for id in TASK_IDS {
                    if scripts.get(*id).and_then(|v| v.as_str()).is_some() {
                        tasks.push(format!("npm:{id}"));
                    }
                }
            }
        }
    }
    if path.join("Cargo.toml").is_file() {
        tasks.extend(["cargo:check", "cargo:build", "cargo:test"].map(str::to_string));
    }
    tasks
}

pub struct Captured {
    pub status: std::process::ExitStatus,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
}

pub fn run_with_timeout(mut cmd: Command, timeout: Duration) -> Result<(Captured, bool), String> {
    let mut child = cmd
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    // Drain both streams while the process runs. A full pipe must not turn a
    // successful build into a timeout.
    let mut out_pipe = child.stdout.take().ok_or("No stdout pipe")?;
    let mut err_pipe = child.stderr.take().ok_or("No stderr pipe")?;
    let out_reader = thread::spawn(move || read_tail(&mut out_pipe));
    let err_reader = thread::spawn(move || read_tail(&mut err_pipe));
    let deadline = Instant::now() + timeout;
    let mut timed_out = false;
    loop {
        if child.try_wait().map_err(|e| e.to_string())?.is_some() {
            break;
        }
        if Instant::now() >= deadline {
            timed_out = true;
            #[cfg(windows)]
            {
                // npm.cmd can have a child process holding our output pipes.
                // End that tree before joining the reader threads.
                use std::os::windows::process::CommandExt;
                let _ = Command::new("taskkill")
                    .args(["/PID", &child.id().to_string(), "/T", "/F"])
                    .creation_flags(0x0800_0000)
                    .output();
            }
            let _ = child.kill();
            break;
        }
        thread::sleep(Duration::from_millis(100));
    }
    let status = child.wait().map_err(|e| e.to_string())?;
    let stdout = out_reader.join().map_err(|_| "Stdout reader failed")?;
    let stderr = err_reader.join().map_err(|_| "Stderr reader failed")?;
    Ok((
        Captured {
            status,
            stdout,
            stderr,
        },
        timed_out,
    ))
}

pub fn read_tail(reader: &mut impl Read) -> Vec<u8> {
    let mut bytes = Vec::new();
    let mut chunk = [0u8; 8192];
    loop {
        match reader.read(&mut chunk) {
            Ok(0) | Err(_) => break,
            Ok(n) => {
                bytes.extend_from_slice(&chunk[..n]);
                if bytes.len() > MAX_LOG_BYTES {
                    bytes.drain(..bytes.len() - MAX_LOG_BYTES);
                }
            }
        }
    }
    bytes
}

pub fn text_output(bytes: &[u8]) -> String {
    let take = bytes.len().min(MAX_LOG_BYTES);
    String::from_utf8_lossy(&bytes[bytes.len() - take..]).into_owned()
}

pub fn git(path: &Path, args: &[&str]) -> Result<String, String> {
    let mut cmd = Command::new("git");
    cmd.arg("-C").arg(path).args(args);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    let (out, timed_out) = run_with_timeout(cmd, STATUS_TIMEOUT)?;
    if timed_out {
        return Err("Git status timed out".into());
    }
    if !out.status.success() {
        return Err(text_output(&out.stderr).trim().to_string());
    }
    Ok(text_output(&out.stdout))
}

pub fn snapshot(path: &Path) -> DevopsSnapshot {
    let project = path
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.display().to_string());
    let mut snap = DevopsSnapshot {
        path: path.display().to_string(),
        project,
        branch: None,
        changed_files: 0,
        staged_files: 0,
        untracked_files: 0,
        upstream: None,
        ahead: 0,
        behind: 0,
        tasks: tasks_for(path),
        git_error: None,
    };
    match git(
        path,
        &["status", "--porcelain=v1", "--untracked-files=normal"],
    ) {
        Ok(status) => {
            for line in status.lines() {
                let bytes = line.as_bytes();
                if bytes.len() < 2 {
                    continue;
                }
                snap.changed_files += 1;
                if bytes[0] == b'?' && bytes[1] == b'?' {
                    snap.untracked_files += 1;
                } else if bytes[0] != b' ' {
                    snap.staged_files += 1;
                }
            }
        }
        Err(err) => snap.git_error = Some(err),
    }
    snap.branch = git(path, &["branch", "--show-current"])
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    if let Ok(upstream) = git(
        path,
        &[
            "rev-parse",
            "--abbrev-ref",
            "--symbolic-full-name",
            "@{upstream}",
        ],
    ) {
        snap.upstream = Some(upstream.trim().to_string());
        if let Ok(counts) = git(
            path,
            &["rev-list", "--left-right", "--count", "HEAD...@{upstream}"],
        ) {
            let values: Vec<u32> = counts
                .split_whitespace()
                .filter_map(|v| v.parse().ok())
                .collect();
            if values.len() == 2 {
                snap.ahead = values[0];
                snap.behind = values[1];
            }
        }
    }
    snap
}

#[tauri::command]
pub async fn devops_snapshot(path: String) -> Result<DevopsSnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || Ok(snapshot(&checked_dir(&path)?)))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn devops_run(path: String, task: String) -> Result<DevopsRunResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = checked_dir(&path)?;
        if !tasks_for(&path).contains(&task) {
            return Err("This task is not available in the selected project".into());
        }
        let (tool, id) = task.split_once(':').ok_or("Invalid task")?;
        let mut cmd = match tool {
            "npm" => {
                let mut c = Command::new(if cfg!(windows) { "npm.cmd" } else { "npm" });
                c.arg("run").arg(id);
                c
            }
            "cargo" => {
                let mut c = Command::new("cargo");
                c.arg(id).arg("--color").arg("never");
                c
            }
            _ => return Err("Invalid task".into()),
        };
        cmd.current_dir(&path);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000);
        }
        let start = Instant::now();
        let (out, timed_out) = run_with_timeout(cmd, RUN_TIMEOUT)?;
        Ok(DevopsRunResult {
            task,
            exit_code: out.status.code(),
            timed_out,
            duration_ms: start.elapsed().as_millis() as u64,
            stdout: text_output(&out.stdout),
            stderr: text_output(&out.stderr),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

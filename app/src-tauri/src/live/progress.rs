// Growing files: browser downloads (partial files in Downloads) and renders
// (media files growing in the user's render folders). Plain metadata polling —
// a watcher would fire on every chunk write and still need size sampling.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Manager};
use windows::core::GUID;
use windows::Win32::System::Com::CoTaskMemFree;
use windows::Win32::UI::Shell::{SHGetKnownFolderPath, FOLDERID_Downloads, KNOWN_FOLDER_FLAG};

const TICK: Duration = Duration::from_secs(1);
const RENDER_IDLE_DONE: Duration = Duration::from_secs(6);
const PARTIAL_SUFFIXES: &[&str] = &[".crdownload", ".partial", ".download", ".part"];
const RENDER_EXTS: &[&str] = &[
    "mp4", "mov", "mxf", "avi", "mkv", "m4v", "webm", "wav", "aif", "aiff", "mp3", "aac", "png",
    "exr", "tif", "tiff", "dpx",
];

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProgressItem {
    pub id: String,
    pub name: String,
    pub kind: &'static str,
    pub bytes: u64,
    pub total_bytes: Option<u64>,
    pub speed: f64,
    pub done: bool,
}

#[derive(Serialize, Clone)]
struct ProgressInfo {
    items: Vec<ProgressItem>,
}

/// Resolves a shell known folder (handles OneDrive/relocated folders).
pub(crate) fn known_folder(id: &GUID) -> Option<PathBuf> {
    unsafe {
        let p = SHGetKnownFolderPath(id, KNOWN_FOLDER_FLAG(0), None).ok()?;
        let s = p.to_string().ok();
        CoTaskMemFree(Some(p.0 as *const _));
        s.map(PathBuf::from)
    }
}

fn downloads_dir() -> Option<PathBuf> {
    known_folder(&FOLDERID_Downloads)
        .or_else(|| std::env::var_os("USERPROFILE").map(|p| PathBuf::from(p).join("Downloads")))
}

/// "movie.mkv.crdownload" → "movie.mkv"; None if not a partial download.
fn strip_partial(name: &str) -> Option<&str> {
    let lower = name.to_ascii_lowercase();
    PARTIAL_SUFFIXES
        .iter()
        .find(|s| lower.ends_with(*s) && lower.len() > s.len())
        .map(|s| &name[..name.len() - s.len()])
}

fn is_temp(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower == "desktop.ini" || lower.starts_with("~$") || lower.starts_with('.') || lower.ends_with(".tmp")
}

fn is_render_file(name: &str) -> bool {
    name.rsplit_once('.')
        .map(|(_, ext)| RENDER_EXTS.contains(&ext.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

#[derive(Clone)]
struct Candidate {
    kind: &'static str,
    name: String,
    size: u64,
}

fn scan(downloads: Option<&Path>, render_dirs: &[String]) -> HashMap<PathBuf, Candidate> {
    let mut out = HashMap::new();
    if let Some(dir) = downloads {
        for (path, name, size) in files_in(dir) {
            if let Some(stem) = strip_partial(&name) {
                out.insert(path, Candidate { kind: "download", name: stem.to_string(), size });
            } else if !is_temp(&name) {
                // Finished files too: a small download can start and finish
                // between two ticks, so its partial file is never seen.
                out.insert(path, Candidate { kind: "file", name, size });
            }
        }
    }
    for dir in render_dirs.iter().filter(|d| !d.trim().is_empty()) {
        let dir = Path::new(dir);
        let mut dirs = vec![dir.to_path_buf()];
        if let Ok(rd) = std::fs::read_dir(dir) {
            dirs.extend(rd.flatten().filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false)).map(|e| e.path()));
        }
        for d in dirs {
            for (path, name, size) in files_in(&d) {
                if is_render_file(&name) && strip_partial(&name).is_none() {
                    out.insert(path, Candidate { kind: "render", name, size });
                }
            }
        }
    }
    out
}

fn files_in(dir: &Path) -> Vec<(PathBuf, String, u64)> {
    let Ok(rd) = std::fs::read_dir(dir) else { return Vec::new() };
    rd.flatten()
        .filter_map(|e| {
            let meta = e.metadata().ok()?;
            meta.is_file().then(|| (e.path(), e.file_name().to_string_lossy().into_owned(), meta.len()))
        })
        .collect()
}

struct Track {
    kind: &'static str,
    name: String,
    bytes: u64,
    speed: f64,
    last_change: Instant,
}

/// Pure tick state machine, separated from the filesystem so it's testable.
struct Tracker {
    /// Sizes of files we're not tracking; a file only becomes active once its size moves.
    baseline: HashMap<PathBuf, u64>,
    tracks: HashMap<PathBuf, Track>,
}

impl Tracker {
    fn new(initial: &HashMap<PathBuf, Candidate>) -> Self {
        Self {
            baseline: initial.iter().map(|(p, c)| (p.clone(), c.size)).collect(),
            tracks: HashMap::new(),
        }
    }

    /// Returns the items to emit when something changed.
    fn tick(
        &mut self,
        seen: HashMap<PathBuf, Candidate>,
        now: Instant,
        dt: f64,
        exists: impl Fn(&Path) -> bool,
    ) -> Option<Vec<ProgressItem>> {
        let mut changed = false;
        let mut finished = Vec::new();

        for (path, c) in &seen {
            if c.kind == "file" {
                continue;
            }
            if let Some(t) = self.tracks.get_mut(path) {
                if c.size != t.bytes {
                    let inst = c.size.saturating_sub(t.bytes) as f64 / dt;
                    t.speed = if t.speed == 0.0 { inst } else { 0.3 * inst + 0.7 * t.speed };
                    t.bytes = c.size;
                    t.last_change = now;
                    changed = true;
                }
            } else if self.baseline.get(path) != Some(&c.size) {
                self.baseline.remove(path);
                self.tracks.insert(
                    path.clone(),
                    Track { kind: c.kind, name: c.name.clone(), bytes: c.size, speed: 0.0, last_change: now },
                );
                changed = true;
            }
        }

        let paths: Vec<PathBuf> = self.tracks.keys().cloned().collect();
        for path in paths {
            let gone = !seen.contains_key(&path);
            let t = &self.tracks[&path];
            let done = match t.kind {
                "download" if gone => {
                    let final_path = path.with_file_name(&t.name);
                    Some(exists(&final_path).then_some(final_path))
                }
                "render" if gone => Some(None),
                "render" if now.duration_since(t.last_change) >= RENDER_IDLE_DONE => Some(Some(path.clone())),
                _ => None,
            };
            if let Some(final_path) = done {
                let t = self.tracks.remove(&path).unwrap();
                changed = true;
                if let Some(fp) = final_path {
                    if t.kind == "render" {
                        self.baseline.insert(path.clone(), t.bytes);
                    }
                    finished.push(ProgressItem {
                        id: fp.to_string_lossy().into_owned(),
                        name: t.name,
                        kind: t.kind,
                        bytes: t.bytes,
                        total_bytes: None,
                        speed: 0.0,
                        done: true,
                    });
                }
            } else if let Some(t) = self.tracks.get_mut(&path) {
                if t.last_change != now {
                    t.speed *= 0.7;
                }
            }
        }

        // New finished files in Downloads that no partial announced (fast
        // downloads, or a browser renaming "Unconfirmed 123.crdownload").
        for (path, c) in &seen {
            if c.kind != "file" || self.baseline.contains_key(path) {
                continue;
            }
            self.baseline.insert(path.clone(), c.size);
            let id = path.to_string_lossy().into_owned();
            if finished.iter().any(|f| f.id == id) {
                continue;
            }
            changed = true;
            finished.push(ProgressItem {
                id,
                name: c.name.clone(),
                kind: "download",
                bytes: c.size,
                total_bytes: None,
                speed: 0.0,
                done: true,
            });
        }

        // Files that vanished without being tracked shouldn't block a later re-track.
        self.baseline.retain(|p, _| seen.contains_key(p));

        if !changed {
            return None;
        }
        let mut items: Vec<ProgressItem> = self
            .tracks
            .iter()
            .map(|(p, t)| ProgressItem {
                id: p.to_string_lossy().into_owned(),
                name: t.name.clone(),
                kind: t.kind,
                bytes: t.bytes,
                total_bytes: None,
                speed: t.speed.round(),
                done: false,
            })
            .collect();
        items.sort_by(|a, b| a.id.cmp(&b.id));
        items.extend(finished);
        Some(items)
    }
}

fn render_dirs(app: &AppHandle) -> Vec<String> {
    app.state::<crate::Shared>()
        .settings
        .lock()
        .map(|s| s.render_dirs.clone())
        .unwrap_or_default()
}

pub fn spawn(app: AppHandle) {
    std::thread::spawn(move || {
        let downloads = downloads_dir();
        let mut tracker = Tracker::new(&scan(downloads.as_deref(), &render_dirs(&app)));
        let mut last = Instant::now();
        loop {
            std::thread::sleep(TICK);
            if crate::live::paused() {
                continue;
            }
            let now = Instant::now();
            let dt = now.duration_since(last).as_secs_f64().max(0.001);
            last = now;
            let seen = scan(downloads.as_deref(), &render_dirs(&app));
            if let Some(items) = tracker.tick(seen, now, dt, |p| p.exists()) {
                crate::live::emit(&app, "live-progress", ProgressInfo { items });
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cand(kind: &'static str, name: &str, size: u64) -> Candidate {
        Candidate { kind, name: name.into(), size }
    }

    #[test]
    fn partial_suffixes() {
        assert_eq!(strip_partial("movie.mkv.crdownload"), Some("movie.mkv"));
        assert_eq!(strip_partial("Unconfirmed 123.crdownload"), Some("Unconfirmed 123"));
        assert_eq!(strip_partial("a.zip.PART"), Some("a.zip"));
        assert_eq!(strip_partial("x.partial"), Some("x"));
        assert_eq!(strip_partial(".part"), None);
        assert_eq!(strip_partial("movie.mkv"), None);
        assert!(is_render_file("Final.MOV"));
        assert!(!is_render_file("notes.txt"));
    }

    #[test]
    fn download_and_render_lifecycle() {
        let dl = PathBuf::from(r"C:\D\a.zip.crdownload");
        let static_file = PathBuf::from(r"C:\R\old.mp4");
        let render = PathBuf::from(r"C:\R\new.mov");
        let mut init = HashMap::new();
        init.insert(static_file.clone(), cand("render", "old.mp4", 100));
        let mut tr = Tracker::new(&init);
        let t0 = Instant::now();
        let at = |s| t0 + Duration::from_secs(s);

        let mk = |dl_size: Option<u64>, r_size: u64| {
            let mut m = HashMap::new();
            m.insert(static_file.clone(), cand("render", "old.mp4", 100));
            m.insert(render.clone(), cand("render", "new.mov", r_size));
            if let Some(s) = dl_size {
                m.insert(dl.clone(), cand("download", "a.zip", s));
            }
            m
        };

        let items = tr.tick(mk(Some(10), 50), at(1), 1.0, |_| false).unwrap();
        assert_eq!(items.len(), 2, "static file ignored");
        let items = tr.tick(mk(Some(1010), 150), at(2), 1.0, |_| false).unwrap();
        let d = items.iter().find(|i| i.kind == "download").unwrap();
        assert_eq!((d.bytes, d.speed), (1010, 1000.0));
        assert!(tr.tick(mk(Some(1010), 150), at(3), 1.0, |_| false).is_none());

        // Download finished: partial gone, final exists.
        let items = tr.tick(mk(None, 150), at(4), 1.0, |_| true).unwrap();
        let d = items.iter().find(|i| i.kind == "download").unwrap();
        assert!(d.done);
        assert_eq!(d.id, r"C:\D\a.zip");

        // Render idle 6 s → done once, then never again.
        let items = tr.tick(mk(None, 150), at(8), 1.0, |_| true).unwrap();
        assert!(items.iter().any(|i| i.kind == "render" && i.done));
        assert!(tr.tick(mk(None, 150), at(9), 1.0, |_| true).is_none());
    }

    #[test]
    fn fast_download_is_announced_once() {
        let old = PathBuf::from(r"C:\D\old.pdf");
        let mut init = HashMap::new();
        init.insert(old.clone(), cand("file", "old.pdf", 5));
        let mut tr = Tracker::new(&init);
        let t0 = Instant::now();
        let mut m = HashMap::new();
        m.insert(old.clone(), cand("file", "old.pdf", 5));
        assert!(tr.tick(m.clone(), t0, 1.0, |_| true).is_none(), "existing files ignored");
        let new = PathBuf::from(r"C:\D
ew.pdf");
        m.insert(new.clone(), cand("file", "new.pdf", 9));
        let items = tr.tick(m.clone(), t0, 1.0, |_| true).unwrap();
        assert_eq!(items.len(), 1);
        assert!(items[0].done && items[0].id == r"C:\D
ew.pdf");
        assert!(tr.tick(m, t0, 1.0, |_| true).is_none(), "announced once");
        assert!(is_temp("desktop.ini") && is_temp("~$doc.docx") && !is_temp("a.zip"));
    }

    #[test]
    #[ignore]
    fn real_downloads() {
        let d = downloads_dir();
        println!("downloads = {d:?}");
        for (p, c) in scan(d.as_deref(), &[]) {
            println!("{} {} {} {}", c.kind, c.name, c.size, p.display());
        }
    }
}

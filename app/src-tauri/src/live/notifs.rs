// New Windows toasts, read from the notification platform's own SQLite store
// (%LOCALAPPDATA%\Microsoft\Windows\Notifications\wpndatabase.db). There is no
// public API for other apps' toasts without a UserNotificationListener package
// identity, so we read the db read-only and never write to it.

use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::time::Duration;

use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use tauri::AppHandle;

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const POLL: Duration = Duration::from_secs(2);

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NotifInfo {
    pub id: String,
    pub app_id: String,
    pub app: String,
    pub title: String,
    pub body: String,
    pub time: i64,
}

fn db_path() -> Option<PathBuf> {
    let base = std::env::var_os("LOCALAPPDATA")?;
    Some(PathBuf::from(base).join(r"Microsoft\Windows\Notifications\wpndatabase.db"))
}

fn open() -> Result<Connection, String> {
    let path = db_path().ok_or("LOCALAPPDATA not set")?;
    if !path.exists() {
        return Err(format!("{} not found", path.display()));
    }
    // URI with forward slashes; the db is WAL so read-only still sees fresh rows.
    let uri = format!("file:{}?mode=ro", path.to_string_lossy().replace('\\', "/"));
    let conn = Connection::open_with_flags(
        uri,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_URI | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|e| e.to_string())?;
    conn.busy_timeout(Duration::from_millis(500)).map_err(|e| e.to_string())?;
    Ok(conn)
}

struct Row {
    id: i64,
    app_id: String,
    payload: Vec<u8>,
    arrival: i64,
}

fn fetch_after(conn: &Connection, after: i64) -> rusqlite::Result<Vec<Row>> {
    let mut stmt = conn.prepare_cached(
        "SELECT n.Id, h.PrimaryId, n.Payload, n.ArrivalTime
         FROM Notification n JOIN NotificationHandler h ON h.RecordId = n.HandlerId
         WHERE n.Id > ?1 AND n.Type = 'toast'
         ORDER BY n.Id LIMIT 50",
    )?;
    let rows = stmt.query_map([after], |r| {
        Ok(Row {
            id: r.get(0)?,
            app_id: r.get::<_, Option<String>>(1)?.unwrap_or_default(),
            payload: r.get::<_, Option<Vec<u8>>>(2)?.unwrap_or_default(),
            arrival: r.get::<_, Option<i64>>(3)?.unwrap_or(0),
        })
    })?;
    rows.collect()
}

fn max_id(conn: &Connection) -> rusqlite::Result<i64> {
    conn.query_row("SELECT COALESCE(MAX(Id), 0) FROM Notification", [], |r| r.get(0))
}

pub fn spawn(app: AppHandle) {
    std::thread::spawn(move || {
        let mut conn: Option<Connection> = None;
        let mut last_id: Option<i64> = None;
        let mut logged = false;
        loop {
            std::thread::sleep(POLL);
            if conn.is_none() {
                match open() {
                    Ok(c) => conn = Some(c),
                    Err(e) => {
                        if !logged {
                            crate::log::line(format!("notifs: cannot open toast db: {e}"));
                            logged = true;
                        }
                        continue;
                    }
                }
            }
            let c = conn.as_ref().unwrap();
            let after = match last_id {
                Some(id) => id,
                None => match max_id(c) {
                    // Startup: everything already in the db is history.
                    Ok(id) => {
                        last_id = Some(id);
                        continue;
                    }
                    Err(e) => {
                        if !logged {
                            crate::log::line(format!("notifs: read failed: {e}"));
                            logged = true;
                        }
                        conn = None;
                        continue;
                    }
                },
            };
            let rows = match fetch_after(c, after) {
                Ok(r) => r,
                Err(e) => {
                    if !logged {
                        crate::log::line(format!("notifs: read failed: {e}"));
                        logged = true;
                    }
                    conn = None;
                    continue;
                }
            };
            logged = false;
            for row in rows {
                last_id = Some(row.id);
                if crate::live::paused() {
                    continue;
                }
                if let Some(info) = to_info(row) {
                    crate::live::emit(&app, "live-notif", info);
                }
            }
        }
    });
}

fn to_info(row: Row) -> Option<NotifInfo> {
    if row.app_id.to_ascii_lowercase().contains("winsle") {
        return None;
    }
    let texts = xml_texts(&String::from_utf8_lossy(&row.payload));
    let mut it = texts.into_iter();
    let title = it.next().unwrap_or_default();
    let body = it.collect::<Vec<_>>().join("\n");
    if title.is_empty() && body.is_empty() {
        return None;
    }
    Some(NotifInfo {
        id: row.id.to_string(),
        app: friendly_name(&row.app_id),
        app_id: row.app_id,
        title,
        body,
        time: filetime_to_ms(row.arrival),
    })
}

/// FILETIME (100 ns ticks since 1601) → Unix epoch ms.
fn filetime_to_ms(ft: i64) -> i64 {
    if ft <= 0 {
        return 0;
    }
    ft / 10_000 - 11_644_473_600_000
}

/// Inner text of every non-empty `<text ...>` element, in document order.
fn xml_texts(xml: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut rest = xml;
    while let Some(i) = rest.find("<text") {
        rest = &rest[i + 5..];
        // Must be exactly the `text` tag, not e.g. `<textBox`.
        match rest.chars().next() {
            Some('>') | Some(' ') | Some('\t') | Some('\r') | Some('\n') | Some('/') => {}
            _ => continue,
        }
        let Some(gt) = rest.find('>') else { break };
        if rest[..gt].ends_with('/') {
            rest = &rest[gt + 1..];
            continue;
        }
        rest = &rest[gt + 1..];
        let Some(end) = rest.find("</text>") else { break };
        let t = unescape(rest[..end].trim());
        if !t.is_empty() {
            out.push(t);
        }
        rest = &rest[end + 7..];
    }
    out
}

fn unescape(s: &str) -> String {
    s.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&#39;", "'")
        .replace("&amp;", "&")
}

fn friendly_name(app_id: &str) -> String {
    const KNOWN: &[(&str, &str)] = &[
        ("whatsapp", "WhatsApp"),
        ("windowsterminal", "Terminal"),
        ("msedge", "Edge"),
        ("chrome", "Chrome"),
        ("firefox", "Firefox"),
        ("discord", "Discord"),
        ("slack", "Slack"),
        ("teams", "Teams"),
        ("outlook", "Outlook"),
        ("spotify", "Spotify"),
        ("telegram", "Telegram"),
        ("screensketch", "Snipping Tool"),
        ("vscode", "VS Code"),
        ("code.exe", "VS Code"),
        ("powertoys", "PowerToys"),
        ("nvidia", "NVIDIA"),
        ("antigravity", "Antigravity"),
        ("securitycenter", "Windows Security"),
        ("defender", "Windows Security"),
        ("creativecloud", "Creative Cloud"),
        ("acrobat", "Acrobat"),
        ("powershell", "PowerShell"),
        ("asussurvey", "ASUS"),
        ("asuspcassistant", "MyASUS"),
        ("armourycrate", "Armoury Crate"),
        ("glidex", "GlideX"),
        ("platformexperienceshelper", "Windows"),
    ];
    let lower = app_id.to_ascii_lowercase();
    if let Some((_, name)) = KNOWN.iter().find(|(k, _)| lower.contains(k)) {
        return (*name).to_string();
    }
    // AUMID "Publisher.AppName_hash!App" or a path "...\\app.exe".
    let s = app_id.split('!').next().unwrap_or(app_id);
    let s = s.rsplit(['\\', '/']).next().unwrap_or(s);
    let s = s.split('_').next().unwrap_or(s);
    let s = s.strip_suffix(".exe").unwrap_or(s);
    let s = s.rsplit('.').next().unwrap_or(s);
    let s = s.strip_suffix("Desktop").filter(|x| !x.is_empty()).unwrap_or(s);
    let s = s.strip_suffix("Win32").filter(|x| !x.is_empty()).unwrap_or(s);
    if s.is_empty() || s.starts_with('{') {
        return "Windows".to_string();
    }
    split_camel(s)
}

/// "ArmouryCrate" → "Armoury Crate"; acronyms ("NVIDIAApp") stay together.
fn split_camel(s: &str) -> String {
    let chars: Vec<char> = s.chars().collect();
    let mut out = String::with_capacity(s.len() + 4);
    for (i, &c) in chars.iter().enumerate() {
        if i > 0 && c.is_uppercase() {
            let prev = chars[i - 1];
            let next_lower = chars.get(i + 1).is_some_and(|n| n.is_lowercase());
            if prev.is_lowercase() || (prev.is_uppercase() && next_lower) {
                out.push(' ');
            }
        }
        out.push(c);
    }
    out
}

fn valid_app_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 512
        && id.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '!' | '-'))
}

#[tauri::command]
pub fn notif_open(app_id: String) -> Result<(), String> {
    if !valid_app_id(&app_id) {
        return Err("invalid app id".into());
    }
    std::process::Command::new("explorer.exe")
        .arg(format!("shell:AppsFolder\\{app_id}"))
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn texts() {
        let x = r#"<toast><visual><binding template="ToastGeneric"><text id="1">Mom</text><text>Dinner &amp; a &lt;movie&gt;?</text><text hint-style="x">see &quot;you&quot;</text><text/><textBox>no</textBox></binding></visual></toast>"#;
        assert_eq!(xml_texts(x), vec!["Mom", "Dinner & a <movie>?", "see \"you\""]);
        assert!(xml_texts("<toast/>").is_empty());
    }

    #[test]
    fn names() {
        assert_eq!(friendly_name("5319275A.WhatsAppDesktop_cv1g1gvanyjgm!App"), "WhatsApp");
        assert_eq!(friendly_name("Microsoft.WindowsTerminal_8wekyb3d8bbwe!App"), "Terminal");
        assert_eq!(friendly_name("MSEdge"), "Edge");
        assert_eq!(friendly_name("Chrome"), "Chrome");
        assert_eq!(friendly_name("B9ECED6F.ArmouryCrate_qmba6cd70vzyy!App"), "Armoury Crate");
        assert_eq!(friendly_name("Microsoft.PowerToysWin32"), "PowerToys");
        assert_eq!(friendly_name("SomeVendor.CoolAppWin32"), "Cool App");
        assert_eq!(friendly_name("{1AC14E77-02E7}"), "Windows");
        assert_eq!(friendly_name(r"C:\Tools\Foo.exe"), "Foo");
    }

    #[test]
    fn app_id_validation() {
        assert!(valid_app_id("5319275A.WhatsAppDesktop_cv1g1gvanyjgm!App"));
        assert!(!valid_app_id("x & calc"));
        assert!(!valid_app_id(r"..\x"));
        assert!(!valid_app_id(""));
    }

    #[test]
    fn filetime() {
        assert_eq!(filetime_to_ms(116_444_736_000_000_000), 0);
    }

    #[test]
    #[ignore]
    fn real_db() {
        let c = open().expect("open");
        for t in ["Notification", "NotificationHandler"] {
            let mut s = c.prepare(&format!("PRAGMA table_info({t})")).unwrap();
            let cols: Vec<String> = s.query_map([], |r| r.get(1)).unwrap().map(|r| r.unwrap()).collect();
            println!("{t}: {cols:?}");
        }
        let max = max_id(&c).unwrap();
        for row in fetch_after(&c, max - 3).unwrap() {
            println!("{:?}", to_info(row));
        }
    }
}

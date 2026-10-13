// Phone link: a tiny LAN-only HTTP/1.1 server (port 8899) so a paired phone can
// push notifications and clipboard text to the PC and drive media. Off by
// default; nothing listens until the user enables it in Settings. Every request
// is treated as hostile: private source IPs only, bounded reads with timeouts,
// 64 KB body cap, bearer tokens stored only as SHA-256 hashes, rate-limited
// pairing with a rotating 6-digit code.

use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr, UdpSocket};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::AppHandle;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::Semaphore;

pub const PORT: u16 = 8899;
const MAX_HEAD: usize = 8 * 1024;
const MAX_BODY: usize = 64 * 1024;
const IO_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_CONNS: usize = 16;
const PAIR_PER_MIN: usize = 5;
/// Wrong codes before the code rotates, so a slow brute force restarts from scratch.
const ROTATE_AFTER_FAILS: u32 = 10;
const MAX_DEVICES: usize = 10;
const PAGE: &str = include_str!("phone.html");

#[derive(Serialize, Deserialize, Clone, Default)]
struct Device {
    id: String,
    name: String,
    /// Hex SHA-256 of the bearer token; the token itself is never stored.
    hash: String,
    paired: i64,
}

#[derive(Serialize, Deserialize, Default)]
struct Store {
    enabled: bool,
    devices: Vec<Device>,
}

struct State {
    store: Store,
    code: String,
    fails: u32,
    attempts: HashMap<IpAddr, Vec<Instant>>,
    error: Option<String>,
    server: Option<tauri::async_runtime::JoinHandle<()>>,
}

static STATE: OnceLock<Mutex<State>> = OnceLock::new();
static APP: OnceLock<AppHandle> = OnceLock::new();
static NOTIF_SEQ: AtomicU64 = AtomicU64::new(0);

fn state() -> &'static Mutex<State> {
    STATE.get_or_init(|| {
        Mutex::new(State {
            store: load(),
            code: new_code(),
            fails: 0,
            attempts: HashMap::new(),
            error: None,
            server: None,
        })
    })
}

fn path() -> PathBuf {
    crate::settings::config_dir().join("phone.json")
}

fn load() -> Store {
    std::fs::read(path())
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

fn persist(store: &Store) -> Result<(), String> {
    std::fs::create_dir_all(crate::settings::config_dir()).map_err(|e| e.to_string())?;
    let json = serde_json::to_vec_pretty(store).map_err(|e| e.to_string())?;
    std::fs::write(path(), json).map_err(|e| e.to_string())
}

fn random<const N: usize>() -> [u8; N] {
    let mut b = [0u8; N];
    // OS CSPRNG failing means the system is broken; refuse to mint weak secrets.
    getrandom::fill(&mut b).expect("OS random source unavailable");
    b
}

fn new_code() -> String {
    let n = u32::from_le_bytes(random::<4>()) % 1_000_000;
    format!("{n:06}")
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn hash_token(token: &str) -> String {
    hex(&Sha256::digest(token.as_bytes()))
}

fn ct_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// Returns the matching device id. Scans every device so timing doesn't leak which one matched.
fn check_token(devices: &[Device], token: &str) -> Option<String> {
    if token.len() != 64 {
        return None;
    }
    let h = hash_token(token);
    let mut found = None;
    for d in devices {
        if ct_eq(d.hash.as_bytes(), h.as_bytes()) {
            found = Some(d.id.clone());
        }
    }
    found
}

fn is_private(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => v4.is_private() || v4.is_loopback() || v4.is_link_local(),
        IpAddr::V6(v6) => {
            if let Some(v4) = v6.to_ipv4_mapped() {
                return is_private(IpAddr::V4(v4));
            }
            let s = v6.segments()[0];
            v6.is_loopback() || (s & 0xfe00) == 0xfc00 || (s & 0xffc0) == 0xfe80
        }
    }
}

/// The address the default route leaves from. UDP connect sends no packets.
fn lan_ip() -> Option<IpAddr> {
    let sock = UdpSocket::bind("0.0.0.0:0").ok()?;
    sock.connect("192.0.2.1:80").ok()?;
    let ip = sock.local_addr().ok()?.ip();
    (!ip.is_unspecified()).then_some(ip)
}

fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

// ---- HTTP ----

#[derive(Debug, PartialEq)]
struct Request {
    method: String,
    path: String,
    headers: HashMap<String, String>,
    content_length: usize,
}

/// Parses the head (request line + headers, without the blank line).
fn parse_head(head: &[u8]) -> Result<Request, (u16, &'static str)> {
    let text = std::str::from_utf8(head).map_err(|_| (400, "bad encoding"))?;
    let mut lines = text.split("\r\n");
    let line = lines.next().ok_or((400, "empty request"))?;
    let mut parts = line.split(' ');
    let (method, target, version) = match (parts.next(), parts.next(), parts.next(), parts.next()) {
        (Some(m), Some(t), Some(v), None) => (m, t, v),
        _ => return Err((400, "bad request line")),
    };
    if version != "HTTP/1.1" && version != "HTTP/1.0" {
        return Err((505, "unsupported version"));
    }
    if !target.starts_with('/') {
        return Err((400, "bad target"));
    }
    let path = target.split('?').next().unwrap_or("/").to_string();
    let mut headers = HashMap::new();
    for l in lines {
        if l.is_empty() {
            continue;
        }
        let (k, v) = l.split_once(':').ok_or((400, "bad header"))?;
        if k.is_empty() || k.contains(' ') {
            return Err((400, "bad header"));
        }
        let k = k.to_ascii_lowercase();
        // Duplicate framing headers are a request-smuggling signal.
        if headers.contains_key(&k) && (k == "content-length" || k == "authorization") {
            return Err((400, "duplicate header"));
        }
        headers.insert(k, v.trim().to_string());
    }
    if headers.contains_key("transfer-encoding") {
        return Err((501, "chunked bodies not supported"));
    }
    let content_length = match headers.get("content-length") {
        Some(v) => v.parse::<usize>().map_err(|_| (400, "bad content-length"))?,
        None => 0,
    };
    if content_length > MAX_BODY {
        return Err((413, "body too large"));
    }
    Ok(Request { method: method.to_string(), path, headers, content_length })
}

fn find_head_end(buf: &[u8]) -> Option<usize> {
    buf.windows(4).position(|w| w == b"\r\n\r\n")
}

async fn read_request(sock: &mut TcpStream) -> Result<(Request, Vec<u8>), (u16, &'static str)> {
    let mut buf = Vec::with_capacity(1024);
    let mut chunk = [0u8; 2048];
    let end = loop {
        if let Some(i) = find_head_end(&buf) {
            break i;
        }
        if buf.len() > MAX_HEAD {
            return Err((431, "headers too large"));
        }
        let n = sock.read(&mut chunk).await.map_err(|_| (400, "read failed"))?;
        if n == 0 {
            return Err((400, "connection closed"));
        }
        buf.extend_from_slice(&chunk[..n]);
    };
    let req = parse_head(&buf[..end])?;
    let mut body = buf[end + 4..].to_vec();
    if body.len() > req.content_length {
        return Err((400, "unexpected bytes after body"));
    }
    let need = req.content_length - body.len();
    if need > 0 {
        let start = body.len();
        body.resize(req.content_length, 0);
        sock.read_exact(&mut body[start..]).await.map_err(|_| (400, "short body"))?;
    }
    Ok((req, body))
}

async fn respond(sock: &mut TcpStream, status: u16, ctype: &str, body: &[u8]) {
    let reason = match status {
        200 => "OK",
        204 => "No Content",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        413 => "Payload Too Large",
        415 => "Unsupported Media Type",
        429 => "Too Many Requests",
        431 => "Request Header Fields Too Large",
        501 => "Not Implemented",
        503 => "Service Unavailable",
        505 => "HTTP Version Not Supported",
        _ => "Error",
    };
    let head = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: {ctype}\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nX-Frame-Options: DENY\r\nReferrer-Policy: no-referrer\r\nContent-Security-Policy: default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'\r\n\r\n",
        body.len()
    );
    let _ = sock.write_all(head.as_bytes()).await;
    let _ = sock.write_all(body).await;
    let _ = sock.shutdown().await;
}

async fn json(sock: &mut TcpStream, status: u16, v: serde_json::Value) {
    respond(sock, status, "application/json", v.to_string().as_bytes()).await;
}

async fn err(sock: &mut TcpStream, status: u16, msg: &str) {
    json(sock, status, serde_json::json!({ "error": msg })).await;
}

// ---- routes ----

#[derive(Deserialize)]
struct PairBody {
    code: String,
    #[serde(default)]
    name: String,
}
#[derive(Deserialize)]
struct NotifyBody {
    #[serde(default)]
    app: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    body: String,
}
#[derive(Deserialize)]
struct ClipBody {
    text: String,
}
#[derive(Deserialize)]
struct MediaBody {
    action: String,
}

fn clean(s: &str, max: usize) -> String {
    s.chars().filter(|c| !c.is_control() || *c == '\n').take(max).collect::<String>().trim().to_string()
}

fn pair(ip: IpAddr, code: &str, name: &str) -> Result<String, (u16, &'static str)> {
    let mut st = state().lock().unwrap();
    let now = Instant::now();
    st.attempts.retain(|_, v| {
        v.retain(|t| now.duration_since(*t) < Duration::from_secs(60));
        !v.is_empty()
    });
    // ponytail: map bounded by distinct LAN peers seen in 60s; worst case a /16 sweep, still small.
    let mine = st.attempts.entry(ip).or_default();
    if mine.len() >= PAIR_PER_MIN {
        return Err((429, "too many attempts, wait a minute"));
    }
    mine.push(now);
    if !ct_eq(code.trim().as_bytes(), st.code.as_bytes()) {
        st.fails += 1;
        if st.fails >= ROTATE_AFTER_FAILS {
            st.code = new_code();
            st.fails = 0;
        }
        return Err((403, "wrong code"));
    }
    if st.store.devices.len() >= MAX_DEVICES {
        return Err((403, "too many paired devices, revoke one in Settings"));
    }
    let token = hex(&random::<32>());
    let name = match clean(name, 40) {
        n if n.is_empty() => "Phone".to_string(),
        n => n,
    };
    st.store.devices.push(Device {
        id: hex(&random::<8>()),
        name,
        hash: hash_token(&token),
        paired: now_ms(),
    });
    // Single use: the next phone needs the new code shown in Settings.
    st.code = new_code();
    st.fails = 0;
    persist(&st.store).map_err(|_| (500, "could not save pairing"))?;
    Ok(token)
}

fn host_ok(host: &str) -> bool {
    let ip = host.strip_suffix(":8899").unwrap_or(host);
    ip.parse::<std::net::Ipv4Addr>().is_ok()
}

async fn handle(mut sock: TcpStream, peer: SocketAddr) {
    if !is_private(peer.ip()) {
        return; // drop silently; don't even answer
    }
    let (req, body) = match tokio::time::timeout(IO_TIMEOUT, read_request(&mut sock)).await {
        Ok(Ok(r)) => r,
        Ok(Err((s, m))) => return err(&mut sock, s, m).await,
        Err(_) => return,
    };
    // DNS-rebinding guard: a hostile name resolving to us would carry that name in Host.
    if !host_ok(req.headers.get("host").map(String::as_str).unwrap_or("")) {
        return err(&mut sock, 421, "bad host").await;
    }
    if req.method == "GET" && (req.path == "/" || req.path == "/index.html") {
        return respond(&mut sock, 200, "text/html; charset=utf-8", PAGE.as_bytes()).await;
    }
    if req.method == "POST" {
        // Cross-origin pages can't send application/json without a preflight we never answer.
        let ctype = req.headers.get("content-type").map(|s| s.to_ascii_lowercase()).unwrap_or_default();
        if !ctype.starts_with("application/json") {
            return err(&mut sock, 415, "content-type must be application/json").await;
        }
    }
    if req.method == "POST" && req.path == "/pair" {
        let Ok(b) = serde_json::from_slice::<PairBody>(&body) else {
            return err(&mut sock, 400, "bad json").await;
        };
        return match pair(peer.ip(), &b.code, &b.name) {
            Ok(token) => json(&mut sock, 200, serde_json::json!({ "token": token })).await,
            Err((s, m)) => err(&mut sock, s, m).await,
        };
    }

    let token = req
        .headers
        .get("authorization")
        .and_then(|v| v.strip_prefix("Bearer "))
        .unwrap_or("")
        .trim();
    let authed = check_token(&state().lock().unwrap().store.devices, token).is_some();
    if !authed {
        return err(&mut sock, 401, "not paired").await;
    }
    if crate::live::paused() {
        return err(&mut sock, 503, "Winsle is paused").await;
    }

    match (req.method.as_str(), req.path.as_str()) {
        ("GET", "/ping") => json(&mut sock, 200, serde_json::json!({ "ok": true })).await,
        ("POST", "/notify") => {
            let Ok(b) = serde_json::from_slice::<NotifyBody>(&body) else {
                return err(&mut sock, 400, "bad json").await;
            };
            let (title, text) = (clean(&b.title, 200), clean(&b.body, 1000));
            if title.is_empty() && text.is_empty() {
                return err(&mut sock, 400, "title or body required").await;
            }
            let app_name = match clean(&b.app, 64) {
                a if a.is_empty() => "Phone".to_string(),
                a => a,
            };
            if let Some(app) = APP.get() {
                let seq = NOTIF_SEQ.fetch_add(1, Ordering::Relaxed);
                crate::live::emit(
                    app,
                    "live-notif",
                    super::notifs::NotifInfo {
                        id: format!("phone-{}-{seq}", now_ms()),
                        app_id: String::new(),
                        app: app_name,
                        title,
                        body: text,
                        time: now_ms(),
                    },
                );
            }
            respond(&mut sock, 204, "text/plain", b"").await
        }
        ("POST", "/clip") => {
            let Ok(b) = serde_json::from_slice::<ClipBody>(&body) else {
                return err(&mut sock, 400, "bad json").await;
            };
            let res = tauri::async_runtime::spawn_blocking(move || super::extras::clip_set(b.text)).await;
            match res {
                Ok(Ok(())) => respond(&mut sock, 204, "text/plain", b"").await,
                Ok(Err(e)) => err(&mut sock, 500, &e).await,
                Err(_) => err(&mut sock, 500, "clipboard task failed").await,
            }
        }
        ("GET", "/clip") => {
            let text = tauri::async_runtime::spawn_blocking(super::extras::read_clipboard)
                .await
                .ok()
                .flatten()
                .unwrap_or_default();
            json(&mut sock, 200, serde_json::json!({ "text": text })).await
        }
        ("POST", "/media") => {
            let Ok(b) = serde_json::from_slice::<MediaBody>(&body) else {
                return err(&mut sock, 400, "bad json").await;
            };
            if !matches!(b.action.as_str(), "play_pause" | "next" | "prev") {
                return err(&mut sock, 400, "action must be play_pause, next or prev").await;
            }
            match super::media::media_control(b.action).await {
                Ok(()) => respond(&mut sock, 204, "text/plain", b"").await,
                Err(e) => err(&mut sock, 409, &e).await,
            }
        }
        (_, "/notify" | "/clip" | "/media" | "/ping") => err(&mut sock, 405, "method not allowed").await,
        _ => err(&mut sock, 404, "not found").await,
    }
}

async fn serve(listener: TcpListener) {
    let permits = Arc::new(Semaphore::new(MAX_CONNS));
    loop {
        let Ok((sock, peer)) = listener.accept().await else {
            tokio::time::sleep(Duration::from_millis(200)).await;
            continue;
        };
        let Ok(permit) = permits.clone().try_acquire_owned() else {
            continue; // over capacity: drop the connection
        };
        tauri::async_runtime::spawn(async move {
            let _ = tokio::time::timeout(IO_TIMEOUT * 2, handle(sock, peer)).await;
            drop(permit);
        });
    }
}

fn start_server(st: &mut State) {
    if st.server.is_some() {
        return;
    }
    // Bind synchronously so the error reaches Settings immediately (port in use, firewall policy).
    let std_listener = match std::net::TcpListener::bind(("0.0.0.0", PORT)) {
        Ok(l) => l,
        Err(e) => {
            st.error = Some(format!("cannot listen on port {PORT}: {e}"));
            return;
        }
    };
    if let Err(e) = std_listener.set_nonblocking(true) {
        st.error = Some(e.to_string());
        return;
    }
    st.error = None;
    st.server = Some(tauri::async_runtime::spawn(async move {
        match TcpListener::from_std(std_listener) {
            Ok(l) => serve(l).await,
            Err(e) => crate::log::line(format!("phone: listener failed: {e}")),
        }
    }));
}

fn stop_server(st: &mut State) {
    if let Some(h) = st.server.take() {
        h.abort();
    }
}

pub fn spawn(app: AppHandle) {
    let _ = APP.set(app);
    let mut st = state().lock().unwrap();
    if st.store.enabled {
        start_server(&mut st);
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhoneDevice {
    id: String,
    name: String,
    paired: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhoneStatus {
    enabled: bool,
    running: bool,
    url: Option<String>,
    code: String,
    qr_svg: Option<String>,
    devices: Vec<PhoneDevice>,
    error: Option<String>,
}

fn qr_svg(text: &str) -> Option<String> {
    use qrcodegen::{QrCode, QrCodeEcc};
    let qr = QrCode::encode_text(text, QrCodeEcc::Medium).ok()?;
    let n = qr.size();
    let border = 2;
    let mut path = String::new();
    for y in 0..n {
        for x in 0..n {
            if qr.get_module(x, y) {
                path.push_str(&format!("M{},{}h1v1h-1z", x + border, y + border));
            }
        }
    }
    let dim = n + border * 2;
    Some(format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 {dim} {dim}\" shape-rendering=\"crispEdges\"><rect width=\"100%\" height=\"100%\" fill=\"#fff\"/><path d=\"{path}\" fill=\"#000\"/></svg>"
    ))
}

fn status(st: &State) -> PhoneStatus {
    let running = st.server.is_some();
    let url = if running { lan_ip().map(|ip| format!("http://{ip}:{PORT}/")) } else { None };
    let error = st.error.clone().or_else(|| {
        (running && url.is_none()).then(|| "no network connection found".to_string())
    });
    PhoneStatus {
        enabled: st.store.enabled,
        running,
        qr_svg: url.as_deref().and_then(qr_svg),
        url,
        code: if running { st.code.clone() } else { String::new() },
        devices: st
            .store
            .devices
            .iter()
            .map(|d| PhoneDevice { id: d.id.clone(), name: d.name.clone(), paired: d.paired })
            .collect(),
        error,
    }
}

#[tauri::command]
pub fn phone_status() -> PhoneStatus {
    status(&state().lock().unwrap())
}

#[tauri::command]
pub fn phone_set_enabled(on: bool) -> Result<PhoneStatus, String> {
    let mut st = state().lock().unwrap();
    st.store.enabled = on;
    persist(&st.store)?;
    if on {
        st.code = new_code();
        st.fails = 0;
        start_server(&mut st);
    } else {
        stop_server(&mut st);
        st.error = None;
    }
    Ok(status(&st))
}

#[tauri::command]
pub fn phone_revoke(id: String) -> Result<PhoneStatus, String> {
    let mut st = state().lock().unwrap();
    st.store.devices.retain(|d| d.id != id);
    persist(&st.store)?;
    Ok(status(&st))
}

#[tauri::command]
pub fn phone_new_code() -> PhoneStatus {
    let mut st = state().lock().unwrap();
    st.code = new_code();
    st.fails = 0;
    status(&st)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn host_guard() {
        assert!(host_ok("192.168.1.2"));
        assert!(host_ok("192.168.1.2:8899"));
        assert!(!host_ok("192.168.1.2:80"));
        assert!(!host_ok("evil.example"));
        assert!(!host_ok("evil.example:8899"));
        assert!(!host_ok(""));
    }

    #[test]
    fn parses_request() {
        let r = parse_head(b"POST /clip?x=1 HTTP/1.1\r\nHost: a\r\nContent-Type: application/json\r\nContent-Length: 12\r\nAuthorization: Bearer abc").unwrap();
        assert_eq!(r.method, "POST");
        assert_eq!(r.path, "/clip");
        assert_eq!(r.content_length, 12);
        assert_eq!(r.headers["authorization"], "Bearer abc");
    }

    #[test]
    fn rejects_bad_requests() {
        assert_eq!(parse_head(b"GET / HTTP/2").unwrap_err().0, 505);
        assert_eq!(parse_head(b"GET /a b HTTP/1.1").unwrap_err().0, 400);
        assert_eq!(parse_head(b"GET http://x/ HTTP/1.1").unwrap_err().0, 400);
        assert_eq!(parse_head(b"POST / HTTP/1.1\r\nContent-Length: 70000").unwrap_err().0, 413);
        assert_eq!(parse_head(b"POST / HTTP/1.1\r\nContent-Length: -1").unwrap_err().0, 400);
        assert_eq!(parse_head(b"POST / HTTP/1.1\r\nTransfer-Encoding: chunked").unwrap_err().0, 501);
        assert_eq!(
            parse_head(b"POST / HTTP/1.1\r\nContent-Length: 1\r\ncontent-length: 2").unwrap_err().0,
            400
        );
        assert_eq!(parse_head(b"GET / HTTP/1.1\r\nnocolon").unwrap_err().0, 400);
        assert_eq!(find_head_end(b"GET / HTTP/1.1\r\n\r\nbody"), Some(14));
    }

    #[test]
    fn token_check() {
        let token = hex(&[7u8; 32]);
        let devs = vec![
            Device { id: "a".into(), hash: hash_token(&hex(&[1u8; 32])), ..Default::default() },
            Device { id: "b".into(), hash: hash_token(&token), ..Default::default() },
        ];
        assert_eq!(check_token(&devs, &token).as_deref(), Some("b"));
        assert_eq!(check_token(&devs, &hex(&[8u8; 32])), None);
        assert_eq!(check_token(&devs, ""), None);
        assert_eq!(check_token(&devs, &devs[1].hash), None); // the hash is not the token
        assert!(ct_eq(b"abc", b"abc") && !ct_eq(b"abc", b"abd") && !ct_eq(b"ab", b"abc"));
    }

    #[test]
    fn private_ips() {
        for ip in ["192.168.1.5", "10.0.0.1", "172.16.0.1", "172.31.255.1", "127.0.0.1", "169.254.1.1", "::1", "fe80::1", "fd00::1", "::ffff:192.168.0.2"] {
            assert!(is_private(ip.parse().unwrap()), "{ip}");
        }
        for ip in ["8.8.8.8", "172.32.0.1", "100.64.0.1", "2001:4860::1", "::ffff:8.8.8.8"] {
            assert!(!is_private(ip.parse().unwrap()), "{ip}");
        }
    }

    #[test]
    fn code_and_qr() {
        let c = new_code();
        assert!(c.len() == 6 && c.chars().all(|d| d.is_ascii_digit()));
        assert!(qr_svg("http://192.168.1.2:8899/").unwrap().starts_with("<svg"));
    }
}

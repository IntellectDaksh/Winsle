// Optional Spotify account link. Now-playing still comes from SMTC (media.rs) and
// needs no account; this only adds what SMTC cannot do: like/unlike, search,
// queue and playlists. Authorization Code + PKCE on a fixed loopback port
// (Spotify wants the redirect URI to match exactly). Nothing polls: every call
// is user-initiated, so this costs nothing while disconnected.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use base64::Engine;
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

const REDIRECT: &str = "http://127.0.0.1:8898/callback";
const PORT: u16 = 8898;
const SCOPES: &str = "user-library-read user-library-modify user-modify-playback-state user-read-playback-state playlist-read-private";
const API: &str = "https://api.spotify.com/v1";
const TOKEN_URL: &str = "https://accounts.spotify.com/api/token";
const KEY_REFRESH: &str = "spotify-refresh-token";
const KEY_CLIENT: &str = "spotify-client-id";
const LOGIN_TIMEOUT: Duration = Duration::from_secs(180);

struct Access {
    token: String,
    expires: Instant,
}

static ACCESS: Mutex<Option<Access>> = Mutex::new(None);
static ACCOUNT: Mutex<Option<String>> = Mutex::new(None);

fn client_id() -> Option<String> {
    crate::secrets::get(KEY_CLIENT).or_else(|| option_env!("WINSLE_SPOTIFY_CLIENT_ID").map(str::to_string)).filter(|s| !s.trim().is_empty())
}

fn http() -> Result<reqwest::Client, String> {
    reqwest::Client::builder().timeout(Duration::from_secs(15)).build().map_err(|e| e.to_string())
}

fn enc(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || b"-_.~".contains(&b) {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

fn form(pairs: &[(&str, &str)]) -> String {
    pairs.iter().map(|(k, v)| format!("{k}={}", enc(v))).collect::<Vec<_>>().join("&")
}

fn b64url(bytes: &[u8]) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

/// RFC 7636 S256: BASE64URL(SHA256(ascii(verifier))).
fn challenge(verifier: &str) -> String {
    b64url(&Sha256::digest(verifier.as_bytes()))
}

fn random_token(n: usize) -> Result<String, String> {
    let mut buf = vec![0u8; n];
    getrandom::fill(&mut buf).map_err(|e| e.to_string())?;
    Ok(b64url(&buf))
}

fn norm(s: &str) -> String {
    // "Song - Remastered 2011" / "Song (feat. X)" → "song"
    let s = s.split(" - ").next().unwrap_or(s);
    let s = s.split(" (").next().unwrap_or(s);
    s.chars().filter(|c| c.is_alphanumeric()).flat_map(char::to_lowercase).collect()
}

/// Whether the track SMTC reports is the one the Web API says is playing.
/// SMTC gives only text, so the Spotify track id is trusted only on a match.
fn same_track(smtc_title: &str, smtc_artist: &str, api_title: &str, api_artists: &[String]) -> bool {
    let t = norm(smtc_title);
    if t.is_empty() || t != norm(api_title) {
        return false;
    }
    let a = norm(smtc_artist);
    a.is_empty() || api_artists.iter().any(|x| { let x = norm(x); !x.is_empty() && (a.contains(&x) || x.contains(&a)) })
}

fn parse_callback(request_line: &str, expected: &str) -> Result<String, String> {
    let path = request_line.split_whitespace().nth(1).ok_or("bad request")?;
    let query = path.split_once('?').map(|(_, q)| q).unwrap_or("");
    let mut code = None;
    let mut state = None;
    let mut error = None;
    for (k, v) in query.split('&').filter_map(|p| p.split_once('=')) {
        match k {
            "code" => code = Some(v.to_string()),
            "state" => state = Some(v.to_string()),
            "error" => error = Some(v.to_string()),
            _ => {}
        }
    }
    let state = state.unwrap_or_default();
    if state != expected {
        return Err("Sign-in response did not match this request; try again.".into());
    }
    if let Some(e) = error {
        return Err(if e == "access_denied" { "Spotify sign-in was cancelled.".into() } else { format!("Spotify sign-in failed: {e}") });
    }
    code.ok_or_else(|| "Spotify did not return a code.".into())
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;").replace('\'', "&#39;")
}

async fn wait_for_code(listener: tokio::net::TcpListener, state: &str) -> Result<String, String> {
    loop {
        let (mut sock, _) = listener.accept().await.map_err(|e| e.to_string())?;
        let mut buf = vec![0u8; 4096];
        let Ok(n) = tokio::time::timeout(Duration::from_secs(2), sock.read(&mut buf)).await else { continue };
        let n = n.unwrap_or(0);
        let text = String::from_utf8_lossy(&buf[..n]);
        let line = text.lines().next().unwrap_or("");
        // Browsers also ask for /favicon.ico; ignore anything that isn't the callback.
        if !line.contains("/callback") {
            let _ = sock.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").await;
            continue;
        }
        let result = parse_callback(line, state);
        let msg = match &result {
            Ok(_) => "Spotify connected. You can close this tab.",
            Err(e) => e.as_str(),
        };
        let body = format!("<!doctype html><meta charset=utf-8><title>Winsle</title><body style=\"font:16px system-ui;padding:40px\">{}</body>", html_escape(msg));
        let resp = format!("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
        let _ = sock.write_all(resp.as_bytes()).await;
        return result;
    }
}

async fn token_request(body: String) -> Result<Value, String> {
    let r = http()?
        .post(TOKEN_URL)
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(body)
        .send()
        .await
        .map_err(|e| format!("Spotify unreachable: {e}"))?;
    let ok = r.status().is_success();
    let j: Value = r.json().await.map_err(|e| e.to_string())?;
    if !ok {
        let why = j["error_description"].as_str().or(j["error"].as_str()).unwrap_or("token request failed");
        return Err(format!("Spotify: {why}"));
    }
    Ok(j)
}

fn store_tokens(j: &Value) -> Result<String, String> {
    let token = j["access_token"].as_str().ok_or("Spotify returned no access token")?.to_string();
    let secs = j["expires_in"].as_u64().unwrap_or(3600);
    if let Some(rt) = j["refresh_token"].as_str() {
        crate::secrets::set(KEY_REFRESH, rt)?;
    }
    *ACCESS.lock().unwrap() = Some(Access { token: token.clone(), expires: Instant::now() + Duration::from_secs(secs.saturating_sub(60)) });
    Ok(token)
}

async fn access_token(force_refresh: bool) -> Result<String, String> {
    if !force_refresh {
        if let Some(a) = ACCESS.lock().unwrap().as_ref().filter(|a| a.expires > Instant::now()) {
            return Ok(a.token.clone());
        }
    }
    let id = client_id().ok_or("Spotify is not configured in this build.")?;
    let rt = crate::secrets::get(KEY_REFRESH).ok_or("Spotify is not connected. Connect it in Settings → Live.")?;
    let j = token_request(form(&[("grant_type", "refresh_token"), ("refresh_token", &rt), ("client_id", &id)])).await;
    match j {
        Ok(j) => store_tokens(&j),
        Err(e) if e.contains("invalid_grant") || e.contains("revoked") => {
            let _ = crate::secrets::clear(KEY_REFRESH);
            Err("Spotify access was revoked. Connect again in Settings.".into())
        }
        Err(e) => Err(e),
    }
}

fn api_error(status: reqwest::StatusCode, body: &str) -> String {
    let j: Value = serde_json::from_str(body).unwrap_or(Value::Null);
    let reason = j["error"]["reason"].as_str().unwrap_or("");
    match (status.as_u16(), reason) {
        (403, "PREMIUM_REQUIRED") => "Spotify Premium is required for playback control.".into(),
        (404, _) if reason == "NO_ACTIVE_DEVICE" || body.contains("active device") => {
            "No active Spotify device. Start playing something in Spotify first.".into()
        }
        (429, _) => "Spotify is rate limiting requests; try again in a moment.".into(),
        _ => format!("Spotify {}: {}", status.as_u16(), j["error"]["message"].as_str().unwrap_or("request failed")),
    }
}

/// One Web API call with a single retry after refreshing on 401.
async fn api(method: reqwest::Method, path: &str, body: Option<Value>) -> Result<Value, String> {
    let mut refreshed = false;
    loop {
        let token = access_token(refreshed).await?;
        let mut req = http()?.request(method.clone(), format!("{API}{path}")).bearer_auth(&token);
        req = match &body {
            Some(b) => req.json(b),
            None => req.header("Content-Length", "0"),
        };
        let r = req.send().await.map_err(|e| format!("Spotify unreachable: {e}"))?;
        let status = r.status();
        if status.as_u16() == 401 && !refreshed {
            refreshed = true;
            continue;
        }
        let text = r.text().await.unwrap_or_default();
        if !status.is_success() {
            return Err(api_error(status, &text));
        }
        return Ok(serde_json::from_str(&text).unwrap_or(Value::Null));
    }
}

async fn load_account() -> Result<String, String> {
    let me = api(reqwest::Method::GET, "/me", None).await?;
    let name = me["display_name"].as_str().or(me["id"].as_str()).unwrap_or("Spotify").to_string();
    *ACCOUNT.lock().unwrap() = Some(name.clone());
    Ok(name)
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SpotifyStatus {
    pub configured: bool,
    pub connected: bool,
    pub account: Option<String>,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn spotify_status() -> SpotifyStatus {
    let configured = client_id().is_some();
    let connected = configured && crate::secrets::present(KEY_REFRESH);
    if !connected {
        return SpotifyStatus { configured, connected, account: None, error: None };
    }
    let cached = ACCOUNT.lock().unwrap().clone();
    let (account, error) = match cached {
        Some(a) => (Some(a), None),
        None => match load_account().await {
            Ok(a) => (Some(a), None),
            Err(e) => (None, Some(e)),
        },
    };
    SpotifyStatus { configured, connected: crate::secrets::present(KEY_REFRESH), account, error }
}

#[tauri::command]
pub async fn spotify_connect() -> Result<String, String> {
    let id = client_id().ok_or("Spotify is not configured in this build.")?;
    let verifier = random_token(48)?;
    let state = random_token(16)?;
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", PORT))
        .await
        .map_err(|_| format!("Port {PORT} is busy (another sign-in open?). Close it and try again."))?;
    let url = format!(
        "https://accounts.spotify.com/authorize?{}",
        form(&[
            ("response_type", "code"),
            ("client_id", &id),
            ("scope", SCOPES),
            ("redirect_uri", REDIRECT),
            ("code_challenge_method", "S256"),
            ("code_challenge", &challenge(&verifier)),
            ("state", &state),
        ])
    );
    crate::open_url(url);
    let code = tokio::time::timeout(LOGIN_TIMEOUT, wait_for_code(listener, &state))
        .await
        .map_err(|_| "Spotify sign-in timed out.".to_string())??;
    let j = token_request(form(&[
        ("grant_type", "authorization_code"),
        ("code", &code),
        ("redirect_uri", REDIRECT),
        ("client_id", &id),
        ("code_verifier", &verifier),
    ]))
    .await?;
    store_tokens(&j)?;
    load_account().await
}

#[tauri::command]
pub fn spotify_disconnect() -> Result<(), String> {
    *ACCESS.lock().unwrap() = None;
    *ACCOUNT.lock().unwrap() = None;
    crate::secrets::clear(KEY_REFRESH)
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SpotifyTrack {
    pub id: String,
    pub liked: bool,
}

/// The Spotify id + liked state of what SMTC shows, or None when the Web API's
/// current track is a different one (another device, an ad, a podcast…).
#[tauri::command]
pub async fn spotify_current(title: String, artist: String) -> Result<Option<SpotifyTrack>, String> {
    let cur = api(reqwest::Method::GET, "/me/player/currently-playing", None).await?;
    let item = &cur["item"];
    let (Some(id), Some(name)) = (item["id"].as_str(), item["name"].as_str()) else { return Ok(None) };
    let artists: Vec<String> = item["artists"].as_array().into_iter().flatten().filter_map(|a| a["name"].as_str().map(str::to_string)).collect();
    if !same_track(&title, &artist, name, &artists) {
        return Ok(None);
    }
    let liked = api(reqwest::Method::GET, &format!("/me/tracks/contains?ids={}", enc(id)), None).await?;
    Ok(Some(SpotifyTrack { id: id.to_string(), liked: liked[0].as_bool().unwrap_or(false) }))
}

#[tauri::command]
pub async fn spotify_like(id: String, like: bool) -> Result<(), String> {
    let method = if like { reqwest::Method::PUT } else { reqwest::Method::DELETE };
    api(method, &format!("/me/tracks?ids={}", enc(&id)), None).await.map(|_| ())
}

/// Searches a track and plays it now or adds it to the queue; returns "Title · Artist".
#[tauri::command]
pub async fn spotify_search_play(query: String, queue: bool) -> Result<String, String> {
    let q = query.trim();
    if q.is_empty() {
        return Err("Say what to play.".into());
    }
    let res = api(reqwest::Method::GET, &format!("/search?type=track&limit=1&q={}", enc(q)), None).await?;
    let t = &res["tracks"]["items"][0];
    let uri = t["uri"].as_str().ok_or_else(|| format!("Nothing on Spotify for \"{q}\"."))?;
    let label = format!("{} · {}", t["name"].as_str().unwrap_or("?"), t["artists"][0]["name"].as_str().unwrap_or(""));
    if queue {
        api(reqwest::Method::POST, &format!("/me/player/queue?uri={}", enc(uri)), None).await?;
    } else {
        api(reqwest::Method::PUT, "/me/player/play", Some(serde_json::json!({ "uris": [uri] }))).await?;
    }
    Ok(label)
}

#[derive(Serialize, Clone)]
pub struct SpotifyPlaylist {
    pub name: String,
    pub uri: String,
}

#[tauri::command]
pub async fn spotify_playlists() -> Result<Vec<SpotifyPlaylist>, String> {
    // ponytail: first 50 only; page with `next` if people have more and miss them.
    let j = api(reqwest::Method::GET, "/me/playlists?limit=50", None).await?;
    Ok(j["items"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|p| Some(SpotifyPlaylist { name: p["name"].as_str()?.to_string(), uri: p["uri"].as_str()?.to_string() }))
        .collect())
}

#[tauri::command]
pub async fn spotify_play_playlist(uri: String) -> Result<(), String> {
    if !uri.starts_with("spotify:") {
        return Err("Not a Spotify playlist.".into());
    }
    api(reqwest::Method::PUT, "/me/player/play", Some(serde_json::json!({ "context_uri": uri }))).await.map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pkce_challenge_rfc7636() {
        // Appendix B of RFC 7636.
        assert_eq!(challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
        let v = random_token(48).unwrap();
        assert!(v.len() >= 43 && v.len() <= 128);
    }

    #[test]
    fn track_matching() {
        let a = |s: &[&str]| s.iter().map(|x| x.to_string()).collect::<Vec<_>>();
        assert!(same_track("Bohemian Rhapsody", "Queen", "Bohemian Rhapsody - Remastered 2011", &a(&["Queen"])));
        assert!(same_track("Peaches (feat. Daniel Caesar)", "Justin Bieber, Daniel Caesar", "Peaches (feat. Daniel Caesar & Giveon)", &a(&["Justin Bieber", "Giveon"])));
        assert!(!same_track("Yesterday", "The Beatles", "Let It Be", &a(&["The Beatles"])));
        assert!(!same_track("Hello", "Adele", "Hello", &a(&["Lionel Richie"])));
        assert!(!same_track("", "", "Anything", &a(&["X"])));
    }

    #[test]
    fn callback_parsing() {
        assert_eq!(parse_callback("GET /callback?code=abc&state=xyz HTTP/1.1", "xyz").unwrap(), "abc");
        assert!(parse_callback("GET /callback?error=access_denied&state=x HTTP/1.1", "x").unwrap_err().contains("cancelled"));
        assert!(parse_callback("GET /callback?error=access_denied&state=bad HTTP/1.1", "x").unwrap_err().contains("did not match"));
    }
}

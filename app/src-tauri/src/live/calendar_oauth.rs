// Google Calendar and Outlook (Microsoft Graph) sign-in. Authorization Code +
// PKCE over a loopback redirect; refresh tokens live in the Credential Manager,
// access tokens only in memory. Events join the ICS feed's list in calendar.rs.

use std::os::windows::process::CommandExt;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use reqwest::{Method, StatusCode, Url};
use serde::Serialize;
use serde_json::{json, Value};
use tauri::AppHandle;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use windows::Win32::Security::Cryptography::{
    BCryptGenRandom, BCryptHash, BCRYPT_SHA256_ALG_HANDLE, BCRYPT_USE_SYSTEM_PREFERRED_RNG,
};

use super::calendar::{civil_from_days, days_from_civil, join_url, local_to_utc, now_ms, CalendarEvent, DAY_MS};

const SIGN_IN_TIMEOUT: Duration = Duration::from_secs(300);
const GOOGLE_API: &str = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const GRAPH_API: &str = "https://graph.microsoft.com/v1.0/me";

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Provider {
    Google,
    Microsoft,
}
use Provider::*;

impl Provider {
    fn parse(s: &str) -> Result<Self, String> {
        match s {
            "google" => Ok(Google),
            "microsoft" | "outlook" => Ok(Microsoft),
            _ => Err(format!("unknown calendar provider {s}")),
        }
    }
    fn key(self) -> &'static str {
        match self {
            Google => "google",
            Microsoft => "microsoft",
        }
    }
    fn name(self) -> &'static str {
        match self {
            Google => "Google Calendar",
            Microsoft => "Outlook",
        }
    }
    fn token_key(self) -> &'static str {
        match self {
            Google => "google-calendar-refresh-token",
            Microsoft => "microsoft-calendar-refresh-token",
        }
    }
    /// Build-time ID from release CI, overridable at runtime via the Credential Manager / .env.
    fn client_id(self) -> Option<String> {
        let (key, built) = match self {
            Google => ("google-client-id", option_env!("WINSLE_GOOGLE_CLIENT_ID")),
            Microsoft => ("microsoft-client-id", option_env!("WINSLE_MICROSOFT_CLIENT_ID")),
        };
        crate::secrets::get(key).or(built.map(str::to_string)).filter(|s| !s.trim().is_empty())
    }
    /// Google desktop clients get a secret Google documents as non-confidential; Microsoft public clients have none.
    fn client_secret(self) -> Option<String> {
        match self {
            Google => crate::secrets::get("google-client-secret")
                .or(option_env!("WINSLE_GOOGLE_CLIENT_SECRET").map(str::to_string))
                .filter(|s| !s.trim().is_empty()),
            Microsoft => None,
        }
    }
    fn auth_url(self) -> &'static str {
        match self {
            Google => "https://accounts.google.com/o/oauth2/v2/auth",
            Microsoft => "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
        }
    }
    fn token_url(self) -> &'static str {
        match self {
            Google => "https://oauth2.googleapis.com/token",
            Microsoft => "https://login.microsoftonline.com/common/oauth2/v2.0/token",
        }
    }
    fn scope(self) -> &'static str {
        match self {
            Google => "https://www.googleapis.com/auth/calendar.events",
            Microsoft => "Calendars.ReadWrite offline_access User.Read",
        }
    }
    fn connected(self) -> bool {
        crate::secrets::get(self.token_key()).is_some()
    }
}

// ---- token cache (access tokens never touch disk) ----

static TOKENS: Mutex<Vec<(Provider, String, Instant)>> = Mutex::new(Vec::new());
static SIGNING_IN: AtomicBool = AtomicBool::new(false);

fn cache(p: Provider, access: String, expires_in: u64) {
    let mut t = TOKENS.lock().unwrap();
    t.retain(|(q, ..)| *q != p);
    // Refresh a minute early so a request never races the expiry.
    t.push((p, access, Instant::now() + Duration::from_secs(expires_in.saturating_sub(60))));
}

fn forget(p: Provider) {
    TOKENS.lock().unwrap().retain(|(q, ..)| *q != p);
}

fn cached(p: Provider) -> Option<String> {
    let now = Instant::now();
    TOKENS.lock().unwrap().iter().find(|(q, _, exp)| *q == p && *exp > now).map(|(_, a, _)| a.clone())
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder().timeout(Duration::from_secs(20)).build().map_err(|e| e.to_string())
}

struct Tokens {
    access: String,
    refresh: Option<String>,
    expires_in: u64,
}

async fn token_request(p: Provider, grant: &[(&str, &str)]) -> Result<Tokens, String> {
    let client_id = p.client_id().ok_or("Not configured in this build")?;
    let secret = p.client_secret();
    let mut form: Vec<(&str, &str)> = vec![("client_id", &client_id)];
    if let Some(s) = secret.as_deref() {
        form.push(("client_secret", s));
    }
    if p == Microsoft {
        form.push(("scope", p.scope()));
    }
    form.extend_from_slice(grant);
    let resp = client()?
        .post(p.token_url())
        .form(&form)
        .send()
        .await
        .map_err(|_| format!("{} sign-in server unreachable", p.name()))?;
    let status = resp.status();
    let body: Value = resp.json().await.unwrap_or(Value::Null);
    if !status.is_success() {
        let code = body["error"].as_str().unwrap_or("");
        if code == "invalid_grant" {
            // Revoked, expired (Google "Testing" apps: 7 days) or password changed.
            let _ = crate::secrets::set(p.token_key(), "");
            forget(p);
            return Err(format!("{} sign-in expired — reconnect in Settings", p.name()));
        }
        return Err(format!("{} sign-in failed ({})", p.name(), if code.is_empty() { status.as_str() } else { code }));
    }
    Ok(Tokens {
        access: body["access_token"].as_str().ok_or("sign-in returned no access token")?.to_string(),
        refresh: body["refresh_token"].as_str().map(str::to_string),
        expires_in: body["expires_in"].as_u64().unwrap_or(3600),
    })
}

async fn access_token(p: Provider) -> Result<String, String> {
    if let Some(a) = cached(p) {
        return Ok(a);
    }
    let refresh = crate::secrets::get(p.token_key()).ok_or_else(|| format!("{} isn't connected", p.name()))?;
    let tok = token_request(p, &[("grant_type", "refresh_token"), ("refresh_token", &refresh)]).await?;
    // Microsoft rotates refresh tokens; keep the newest.
    if let Some(r) = tok.refresh.filter(|r| *r != refresh) {
        crate::secrets::set(p.token_key(), &r)?;
    }
    cache(p, tok.access.clone(), tok.expires_in);
    Ok(tok.access)
}

/// Authenticated JSON call; one retry with a fresh token on 401.
async fn api(p: Provider, method: Method, url: Url, body: Option<Value>) -> Result<Value, String> {
    for attempt in 0..2 {
        let token = access_token(p).await?;
        let mut req = client()?.request(method.clone(), url.clone()).bearer_auth(token);
        if p == Microsoft {
            req = req.header("Prefer", "outlook.timezone=\"UTC\"");
        }
        if let Some(b) = &body {
            req = req.json(b);
        }
        let resp = req.send().await.map_err(|e| {
            if e.is_timeout() { format!("{} timed out", p.name()) } else { format!("{} unreachable", p.name()) }
        })?;
        let status = resp.status();
        if status == StatusCode::UNAUTHORIZED && attempt == 0 {
            forget(p);
            continue;
        }
        let text = resp.text().await.unwrap_or_default();
        let json: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
        if !status.is_success() {
            let msg = json["error"]["message"].as_str().unwrap_or("");
            return Err(format!("{} returned HTTP {}{}{}", p.name(), status.as_u16(), if msg.is_empty() { "" } else { ": " }, msg));
        }
        return Ok(json);
    }
    Err(format!("{} rejected the sign-in — reconnect in Settings", p.name()))
}

fn endpoint(base: &str, segments: &[&str], query: &[(&str, &str)]) -> Result<Url, String> {
    let mut url = Url::parse(base).map_err(|e| e.to_string())?;
    url.path_segments_mut().map_err(|_| "bad endpoint")?.extend(segments);
    if !query.is_empty() {
        url.query_pairs_mut().extend_pairs(query);
    }
    Ok(url)
}

// ---- PKCE + loopback sign-in ----

fn random<const N: usize>() -> Result<[u8; N], String> {
    let mut b = [0u8; N];
    unsafe { BCryptGenRandom(None, &mut b, BCRYPT_USE_SYSTEM_PREFERRED_RNG) }.ok().map_err(|e| e.to_string())?;
    Ok(b)
}

fn sha256(data: &[u8]) -> Result<[u8; 32], String> {
    let mut out = [0u8; 32];
    unsafe { BCryptHash(BCRYPT_SHA256_ALG_HANDLE, None, data, &mut out) }.ok().map_err(|e| e.to_string())?;
    Ok(out)
}

fn pkce_challenge(verifier: &str) -> Result<String, String> {
    Ok(URL_SAFE_NO_PAD.encode(sha256(verifier.as_bytes())?))
}

fn open_browser(url: &str) {
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let _ = std::process::Command::new("rundll32.exe")
        .args(["url.dll,FileProtocolHandler", url])
        .creation_flags(CREATE_NO_WINDOW)
        .spawn();
}

async fn sign_in(p: Provider) -> Result<(), String> {
    let client_id = p.client_id().ok_or("Not configured in this build")?;
    let listener = TcpListener::bind("127.0.0.1:0").await.map_err(|e| format!("could not open the sign-in port: {e}"))?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let redirect = format!("http://127.0.0.1:{port}/callback");
    let verifier = URL_SAFE_NO_PAD.encode(random::<32>()?);
    let state = URL_SAFE_NO_PAD.encode(random::<16>()?);
    let challenge = pkce_challenge(&verifier)?;
    let mut params = vec![
        ("client_id", client_id.as_str()),
        ("response_type", "code"),
        ("redirect_uri", &redirect),
        ("scope", p.scope()),
        ("state", &state),
        ("code_challenge", &challenge),
        ("code_challenge_method", "S256"),
    ];
    match p {
        // offline + consent: Google only issues a refresh token on first consent otherwise.
        Google => params.extend([("access_type", "offline"), ("prompt", "consent")]),
        Microsoft => params.push(("prompt", "select_account")),
    }
    let url = Url::parse_with_params(p.auth_url(), &params).map_err(|e| e.to_string())?;
    open_browser(url.as_str());
    let code = tokio::time::timeout(SIGN_IN_TIMEOUT, wait_for_code(&listener, &state))
        .await
        .map_err(|_| "Sign-in timed out — click Connect to try again.".to_string())??;
    let tok = token_request(
        p,
        &[("grant_type", "authorization_code"), ("code", &code), ("redirect_uri", &redirect), ("code_verifier", &verifier)],
    )
    .await?;
    let refresh = tok.refresh.ok_or_else(|| format!("{} didn't grant offline access — try again", p.name()))?;
    crate::secrets::set(p.token_key(), &refresh)?;
    cache(p, tok.access, tok.expires_in);
    Ok(())
}

async fn wait_for_code(listener: &TcpListener, state: &str) -> Result<String, String> {
    loop {
        let (mut sock, _) = listener.accept().await.map_err(|e| e.to_string())?;
        let mut buf = vec![0u8; 8192];
        let mut n = 0;
        let read_head = async {
            while n < buf.len() {
                match sock.read(&mut buf[n..]).await {
                    Ok(0) | Err(_) => break,
                    Ok(k) => n += k,
                }
                if buf[..n].windows(4).any(|w| w == b"\r\n\r\n") {
                    break;
                }
            }
        };
        if tokio::time::timeout(Duration::from_secs(2), read_head).await.is_err() {
            continue;
        }
        let head = String::from_utf8_lossy(&buf[..n]);
        let target = head.split_whitespace().nth(1).unwrap_or("/");
        let Ok(url) = Url::parse(&format!("http://127.0.0.1{target}")) else { continue };
        if url.path() != "/callback" {
            let _ = sock.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").await;
            continue;
        }
        let get = |k: &str| url.query_pairs().find(|(q, _)| q == k).map(|(_, v)| v.into_owned());
        // A stale tab from an earlier attempt must not complete this one.
        if get("state").as_deref() != Some(state) {
            reply(&mut sock, "This sign-in link is out of date. Go back to Winsle and click Connect again.").await;
            continue;
        }
        if let Some(err) = get("error") {
            reply(&mut sock, "Sign-in was cancelled. You can close this tab.").await;
            return Err(if err == "access_denied" { "Sign-in was cancelled".into() } else { format!("Sign-in failed: {err}") });
        }
        let Some(code) = get("code") else { continue };
        reply(&mut sock, "Winsle is connected. You can close this tab.").await;
        return Ok(code);
    }
}

async fn reply(sock: &mut tokio::net::TcpStream, text: &str) {
    let body = format!(
        "<!doctype html><meta charset=utf-8><title>Winsle</title><body style=\"font:16px system-ui;padding:48px;background:#111;color:#eee\">{text}</body>"
    );
    let resp = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = sock.write_all(resp.as_bytes()).await;
}

// ---- commands ----

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    provider: &'static str,
    configured: bool,
    connected: bool,
}

#[tauri::command]
pub fn calendar_accounts() -> Vec<Account> {
    [Google, Microsoft]
        .into_iter()
        .map(|p| Account { provider: p.key(), configured: p.client_id().is_some(), connected: p.connected() })
        .collect()
}

#[tauri::command]
pub async fn calendar_connect(app: AppHandle, provider: String) -> Result<(), String> {
    let p = Provider::parse(&provider)?;
    if SIGNING_IN.swap(true, Ordering::SeqCst) {
        return Err("A sign-in is already open in your browser.".into());
    }
    let result = sign_in(p).await;
    SIGNING_IN.store(false, Ordering::SeqCst);
    if let Err(e) = &result {
        crate::log::line(format!("calendar {}: {e}", p.key()));
    }
    result?;
    super::calendar::calendar_refresh(app);
    Ok(())
}

#[tauri::command]
pub async fn calendar_disconnect(app: AppHandle, provider: String) -> Result<(), String> {
    let p = Provider::parse(&provider)?;
    let token = crate::secrets::get(p.token_key());
    crate::secrets::set(p.token_key(), "")?;
    forget(p);
    if let (Google, Some(t)) = (p, token) {
        // Best effort: also drop the grant on Google's side. Microsoft has no revoke endpoint for public clients.
        if let Ok(c) = client() {
            let _ = c.post("https://oauth2.googleapis.com/revoke").form(&[("token", t)]).send().await;
        }
    }
    super::calendar::calendar_refresh(app);
    Ok(())
}

#[tauri::command]
pub async fn calendar_rsvp(app: AppHandle, id: String, accept: bool) -> Result<(), String> {
    let (tag, raw) = id.split_once(':').ok_or("This event can't be answered from Winsle.")?;
    match tag {
        "g" => {
            let url = endpoint(GOOGLE_API, &[raw], &[])?;
            let ev = api(Google, Method::GET, url, None).await?;
            let mut attendees = ev["attendees"].as_array().cloned().unwrap_or_default();
            let me = attendees
                .iter_mut()
                .find(|a| a["self"].as_bool() == Some(true))
                .ok_or("You're not an invitee of this event.")?;
            me["responseStatus"] = json!(if accept { "accepted" } else { "declined" });
            let url = endpoint(GOOGLE_API, &[raw], &[("sendUpdates", "all")])?;
            api(Google, Method::PATCH, url, Some(json!({ "attendees": attendees }))).await?;
        }
        "m" => {
            let url = endpoint(GRAPH_API, &["events", raw, if accept { "accept" } else { "decline" }], &[])?;
            api(Microsoft, Method::POST, url, Some(json!({ "sendResponse": true }))).await?;
        }
        _ => return Err("Feed events are read-only — connect Google or Outlook in Settings to RSVP.".into()),
    }
    super::calendar::calendar_refresh(app);
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Created {
    title: String,
    start: i64,
    provider: &'static str,
}

/// "event tomorrow 3pm Call with Sam". `tz_offset_min` is the UI's current UTC offset.
#[tauri::command]
pub async fn calendar_quick_create(app: AppHandle, text: String, tz_offset_min: i64) -> Result<Created, String> {
    let q = parse_quick(&text, now_ms() + tz_offset_min * 60_000)
        .ok_or("Couldn't read a time. Try: event tomorrow 3pm Call with Sam")?;
    let p = [Google, Microsoft]
        .into_iter()
        .find(|p| p.connected())
        .ok_or("Connect Google Calendar or Outlook in Settings → Live to add events.")?;
    let start = local_to_utc(q.start_wall);
    let end = start + q.minutes * 60_000;
    let (url, body) = match p {
        Google => (
            endpoint(GOOGLE_API, &[], &[])?,
            json!({ "summary": q.title, "start": { "dateTime": fmt_rfc3339(start) }, "end": { "dateTime": fmt_rfc3339(end) } }),
        ),
        Microsoft => (
            endpoint(GRAPH_API, &["events"], &[])?,
            json!({
                "subject": q.title,
                "start": { "dateTime": fmt_rfc3339(start).trim_end_matches('Z'), "timeZone": "UTC" },
                "end": { "dateTime": fmt_rfc3339(end).trim_end_matches('Z'), "timeZone": "UTC" },
            }),
        ),
    };
    api(p, Method::POST, url, Some(body)).await?;
    super::calendar::calendar_refresh(app);
    Ok(Created { title: q.title, start, provider: p.key() })
}

// ---- polling (called from calendar.rs every 5 min, only for connected accounts) ----

pub(super) fn any_connected() -> bool {
    Google.connected() || Microsoft.connected()
}

pub(super) async fn fetch_all(now: i64) -> (Vec<CalendarEvent>, Vec<String>) {
    let (mut events, mut errors) = (Vec::new(), Vec::new());
    for p in [Google, Microsoft] {
        if !p.connected() {
            continue;
        }
        match fetch(p, now).await {
            Ok(evs) => merge(&mut events, evs),
            Err(e) => {
                crate::log::line(format!("calendar {}: {e}", p.key()));
                errors.push(e);
            }
        }
    }
    (events, errors)
}

async fn fetch(p: Provider, now: i64) -> Result<Vec<CalendarEvent>, String> {
    let (from, to) = (fmt_rfc3339(now), fmt_rfc3339(now + DAY_MS));
    // ponytail: first page only (50 events / 24 h); follow nextPageToken/@odata.nextLink if anyone hits it.
    let json = match p {
        Google => {
            let q = [("timeMin", from.as_str()), ("timeMax", &to), ("singleEvents", "true"), ("orderBy", "startTime"), ("maxResults", "50")];
            api(p, Method::GET, endpoint(GOOGLE_API, &[], &q)?, None).await?
        }
        Microsoft => {
            let q = [
                ("startDateTime", from.as_str()),
                ("endDateTime", &to),
                ("$top", "50"),
                ("$orderby", "start/dateTime"),
                ("$select", "id,subject,start,end,isAllDay,isCancelled,isOrganizer,location,onlineMeeting,onlineMeetingUrl,bodyPreview,responseStatus"),
            ];
            api(p, Method::GET, endpoint(GRAPH_API, &["calendarView"], &q)?, None).await?
        }
    };
    Ok(match p {
        Google => parse_google(&json),
        Microsoft => parse_graph(&json),
    })
}

fn s(v: &Value) -> &str {
    v.as_str().unwrap_or("")
}

fn opt(v: &Value) -> Option<String> {
    Some(s(v).trim().to_string()).filter(|x| !x.is_empty())
}

fn parse_google(json: &Value) -> Vec<CalendarEvent> {
    let Some(items) = json["items"].as_array() else { return vec![] };
    items
        .iter()
        .filter(|it| s(&it["status"]) != "cancelled")
        .filter_map(|it| {
            // All-day events carry `date` instead of `dateTime`; the island skips them like the ICS path.
            let start = parse_rfc3339(s(&it["start"]["dateTime"]))?;
            let end = parse_rfc3339(s(&it["end"]["dateTime"])).unwrap_or(start + 3_600_000);
            let video = it["conferenceData"]["entryPoints"]
                .as_array()
                .and_then(|eps| eps.iter().find(|e| s(&e["entryPointType"]) == "video"))
                .and_then(|e| opt(&e["uri"]));
            let location = opt(&it["location"]);
            let join = opt(&it["hangoutLink"])
                .or(video)
                .or_else(|| join_url(&[location.as_deref().unwrap_or(""), s(&it["description"])]));
            let rsvp = if it["organizer"]["self"].as_bool() == Some(true) {
                None
            } else {
                it["attendees"].as_array().and_then(|a| a.iter().find(|a| a["self"].as_bool() == Some(true))).map(|me| {
                    match s(&me["responseStatus"]) {
                        "accepted" => "accepted",
                        "declined" => "declined",
                        "tentative" => "tentative",
                        _ => "pending",
                    }
                    .to_string()
                })
            };
            Some(CalendarEvent {
                id: format!("g:{}", s(&it["id"])),
                title: opt(&it["summary"]).unwrap_or_else(|| "Busy".into()),
                start,
                end,
                join_url: join,
                location,
                rsvp,
            })
        })
        .collect()
}

fn parse_graph(json: &Value) -> Vec<CalendarEvent> {
    let Some(items) = json["value"].as_array() else { return vec![] };
    items
        .iter()
        .filter(|it| it["isCancelled"].as_bool() != Some(true) && it["isAllDay"].as_bool() != Some(true))
        .filter_map(|it| {
            // Prefer: outlook.timezone="UTC" makes these offset-less UTC wall times.
            let start = parse_rfc3339(s(&it["start"]["dateTime"]))?;
            let end = parse_rfc3339(s(&it["end"]["dateTime"])).unwrap_or(start + 3_600_000);
            let location = opt(&it["location"]["displayName"]);
            let join = opt(&it["onlineMeeting"]["joinUrl"])
                .or_else(|| opt(&it["onlineMeetingUrl"]))
                .or_else(|| join_url(&[location.as_deref().unwrap_or(""), s(&it["bodyPreview"])]));
            let rsvp = (it["isOrganizer"].as_bool() == Some(false)).then(|| {
                match s(&it["responseStatus"]["response"]) {
                    "accepted" => "accepted",
                    "declined" => "declined",
                    "tentativelyAccepted" => "tentative",
                    _ => "pending",
                }
                .to_string()
            });
            Some(CalendarEvent {
                id: format!("m:{}", s(&it["id"])),
                title: opt(&it["subject"]).unwrap_or_else(|| "Busy".into()),
                start,
                end,
                join_url: join,
                location,
                rsvp,
            })
        })
        .collect()
}

/// Adds `more` unless an event with the same id, or the same title at the same
/// start (one calendar seen through both the ICS feed and an account), is in.
pub(super) fn merge(into: &mut Vec<CalendarEvent>, more: Vec<CalendarEvent>) {
    for e in more {
        if !into.iter().any(|x| x.id == e.id || (x.start == e.start && x.title == e.title)) {
            into.push(e);
        }
    }
}

// ---- time ----

/// "2026-10-01T09:30:00+05:30", "…Z", or Graph's "2026-10-01T09:30:00.0000000" (UTC).
fn parse_rfc3339(v: &str) -> Option<i64> {
    let b = v.as_bytes();
    if b.len() < 19 || b[4] != b'-' || b[10] != b'T' || !v.is_ascii() {
        return None;
    }
    let n = |r: std::ops::Range<usize>| v[r].parse::<i64>().ok();
    let days = days_from_civil(n(0..4)?, n(5..7)?, n(8..10)?);
    let mut ms = days * DAY_MS + (n(11..13)? * 3600 + n(14..16)? * 60 + n(17..19)?) * 1000;
    let mut rest = &v[19..];
    if let Some(frac) = rest.strip_prefix('.') {
        let digits = frac.bytes().take_while(u8::is_ascii_digit).count();
        rest = &frac[digits..];
    }
    if let Some(sign) = rest.chars().next().filter(|c| *c == '+' || *c == '-') {
        let off = &rest[1..];
        if off.len() < 5 {
            return None;
        }
        let mins = off[0..2].parse::<i64>().ok()? * 60 + off[3..5].parse::<i64>().ok()?;
        ms -= if sign == '+' { mins } else { -mins } * 60_000;
    }
    Some(ms)
}

fn fmt_rfc3339(ms: i64) -> String {
    let (y, m, d) = civil_from_days(ms.div_euclid(DAY_MS));
    let secs = ms.rem_euclid(DAY_MS) / 1000;
    format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z", secs / 3600, secs / 60 % 60, secs % 60)
}

// ---- quick create ----

#[derive(Debug, PartialEq)]
struct Quick {
    title: String,
    start_wall: i64,
    minutes: i64,
}

const WEEKDAYS: [&str; 7] = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

/// Day word → offset in days from today (`today_wd`: Monday = 0).
fn day_offset(w: &str, today_wd: i64) -> Option<i64> {
    match w {
        "today" => Some(0),
        "tomorrow" | "tmrw" | "tmr" => Some(1),
        _ if w.len() >= 3 => {
            let wd = WEEKDAYS.iter().position(|d| d.starts_with(w))? as i64;
            Some((wd - today_wd).rem_euclid(7))
        }
        _ => None,
    }
}

/// "3pm", "3:30pm", "15:00", "3.30" + "pm" → (minutes of day, tokens used).
fn clock(tok: &str, next: Option<&str>) -> Option<(i64, usize)> {
    let (body, mut ampm, mut used) = match tok.strip_suffix("am").or(tok.strip_suffix("pm")) {
        Some(b) => (b, Some(tok.ends_with("pm")), 1),
        None => (tok, None, 1),
    };
    if ampm.is_none() && matches!(next, Some("am" | "pm")) {
        ampm = Some(next == Some("pm"));
        used = 2;
    }
    let (h, m, has_min) = match body.split_once([':', '.']) {
        Some((h, m)) if m.len() == 2 => (h.parse::<i64>().ok()?, m.parse::<i64>().ok()?, true),
        Some(_) => return None,
        None => (body.parse::<i64>().ok()?, 0, false),
    };
    // A bare number ("event 3 …") is too ambiguous to book.
    if ampm.is_none() && !has_min || m > 59 {
        return None;
    }
    let h = match ampm {
        Some(pm) if (1..=12).contains(&h) => h % 12 + if pm { 12 } else { 0 },
        Some(_) => return None,
        None if h <= 23 => h,
        None => return None,
    };
    Some((h * 60 + m, used))
}

/// "for 30m", "for 1h", "for 90 min", "for 1.5 hours" → minutes.
fn length(tok: &str, next: Option<&str>) -> Option<(i64, usize)> {
    let split = tok.find(|c: char| !c.is_ascii_digit() && c != '.').unwrap_or(tok.len());
    let (num, unit, used) = if split == tok.len() { (tok, next?, 2) } else { (&tok[..split], &tok[split..], 1) };
    let n: f64 = num.parse().ok()?;
    let mins = match unit {
        "m" | "min" | "mins" | "minute" | "minutes" => n,
        "h" | "hr" | "hrs" | "hour" | "hours" => n * 60.0,
        _ => return None,
    };
    (mins >= 1.0 && mins <= 24.0 * 60.0).then_some((mins.round() as i64, used))
}

fn parse_quick(text: &str, now_wall: i64) -> Option<Quick> {
    let words: Vec<&str> = text.split_whitespace().collect();
    let lower: Vec<String> = words.iter().map(|w| w.to_lowercase().trim_end_matches([',', ':']).to_string()).collect();
    let mut i = 0;
    if matches!(lower.first().map(String::as_str), Some("new" | "add" | "create")) {
        i += 1;
    }
    if !matches!(lower.get(i).map(String::as_str), Some("event" | "meeting")) {
        return None;
    }
    i += 1;
    let today = now_wall.div_euclid(DAY_MS);
    let today_wd = (today + 3).rem_euclid(7);
    let (mut day, mut time, mut minutes) = (None, None, 60);
    // Day, time and length may come in any order before the title.
    while i < lower.len() {
        let w = lower[i].as_str();
        let next = lower.get(i + 1).map(String::as_str);
        if matches!(w, "at" | "on" | "this") {
            i += 1;
        } else if let (None, Some(d)) = (day, day_offset(w, today_wd)) {
            day = Some(d);
            i += 1;
        } else if let (None, Some((t, used))) = (time, clock(w, next)) {
            time = Some(t);
            i += used;
        } else if let (true, Some((m, used))) = (w == "for" && time.is_some(), next.and_then(|n| length(n, lower.get(i + 2).map(String::as_str)))) {
            minutes = m;
            i += 1 + used;
        } else {
            break;
        }
    }
    let time = time?;
    let title = words[i..].join(" ").trim_start_matches(['-', ':', '–']).trim().to_string();
    let mut start = (today + day.unwrap_or(0)) * DAY_MS + time * 60_000;
    if start <= now_wall && !lower.iter().any(|w| w == "today") {
        // "event 9am standup" at 10am means tomorrow; "thursday" said on a Thursday afternoon, next week.
        start += match day {
            None => 1,
            Some(0) => 7,
            _ => 0,
        } * DAY_MS;
    }
    Some(Quick { title: if title.is_empty() { "Event".into() } else { title }, start_wall: start, minutes })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn wall(y: i64, m: i64, d: i64, h: i64, mi: i64) -> i64 {
        days_from_civil(y, m, d) * DAY_MS + (h * 60 + mi) * 60_000
    }

    #[test]
    fn pkce_rfc7636_vector() {
        assert_eq!(
            pkce_challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk").unwrap(),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
        assert_ne!(random::<16>().unwrap(), random::<16>().unwrap());
    }

    #[test]
    fn rfc3339() {
        let t = wall(2026, 10, 1, 9, 30);
        assert_eq!(parse_rfc3339("2026-10-01T09:30:00Z"), Some(t));
        assert_eq!(parse_rfc3339("2026-10-01T15:00:00+05:30"), Some(t));
        assert_eq!(parse_rfc3339("2026-10-01T04:30:00-05:00"), Some(t));
        assert_eq!(parse_rfc3339("2026-10-01T09:30:00.0000000"), Some(t));
        assert_eq!(parse_rfc3339("2026-10-01"), None);
        assert_eq!(fmt_rfc3339(t), "2026-10-01T09:30:00Z");
    }

    #[test]
    fn quick_parse() {
        // Thursday 1 Oct 2026, 10:00 local.
        let now = wall(2026, 10, 1, 10, 0);
        let q = |s: &str| parse_quick(s, now);
        assert_eq!(
            q("event tomorrow 3pm Call with X"),
            Some(Quick { title: "Call with X".into(), start_wall: wall(2026, 10, 2, 15, 0), minutes: 60 })
        );
        assert_eq!(q("new event at 3:30 pm for 30m - Sync").map(|q| (q.start_wall, q.minutes, q.title)), Some((wall(2026, 10, 1, 15, 30), 30, "Sync".into())));
        assert_eq!(q("event 9am standup").unwrap().start_wall, wall(2026, 10, 2, 9, 0)); // passed → tomorrow
        assert_eq!(q("event monday 14:00 for 1.5 hours Review").map(|q| (q.start_wall, q.minutes)), Some((wall(2026, 10, 5, 14, 0), 90)));
        assert_eq!(q("event thu 9am Retro").unwrap().start_wall, wall(2026, 10, 8, 9, 0)); // today's slot passed → next week
        assert_eq!(q("event 3pm tomorrow").unwrap(), Quick { title: "Event".into(), start_wall: wall(2026, 10, 2, 15, 0), minutes: 60 });
        assert_eq!(q("event 12am Late").unwrap().start_wall, wall(2026, 10, 2, 0, 0));
        assert!(q("event tomorrow Call with X").is_none());
        assert!(q("event 3 Call").is_none());
        assert!(q("remind me tomorrow 3pm").is_none());
    }

    #[test]
    fn provider_json_and_merge() {
        let g = json!({ "items": [
            { "id": "a1", "summary": "Standup", "start": { "dateTime": "2026-10-01T15:00:00+05:30" }, "end": { "dateTime": "2026-10-01T15:30:00+05:30" },
              "hangoutLink": "https://meet.google.com/abc-defg-hij",
              "attendees": [{ "email": "x@y", "responseStatus": "accepted" }, { "self": true, "responseStatus": "needsAction" }] },
            { "id": "a2", "summary": "Holiday", "start": { "date": "2026-10-01" }, "end": { "date": "2026-10-02" } },
            { "id": "a3", "status": "cancelled", "start": { "dateTime": "2026-10-01T10:00:00Z" } },
            { "id": "a4", "start": { "dateTime": "2026-10-01T11:00:00Z" }, "end": { "dateTime": "2026-10-01T12:00:00Z" }, "organizer": { "self": true },
              "description": "Zoom https://us02web.zoom.us/j/123" }
        ]});
        let ev = parse_google(&g);
        assert_eq!(ev.len(), 2);
        assert_eq!((ev[0].id.as_str(), ev[0].start, ev[0].rsvp.as_deref()), ("g:a1", wall(2026, 10, 1, 9, 30), Some("pending")));
        assert_eq!(ev[0].join_url.as_deref(), Some("https://meet.google.com/abc-defg-hij"));
        assert_eq!((ev[1].title.as_str(), ev[1].rsvp.clone()), ("Busy", None));
        assert_eq!(ev[1].join_url.as_deref(), Some("https://us02web.zoom.us/j/123"));

        let m = json!({ "value": [
            { "id": "AAMk=/x", "subject": "Client", "isOrganizer": false, "responseStatus": { "response": "tentativelyAccepted" },
              "start": { "dateTime": "2026-10-01T09:30:00.0000000" }, "end": { "dateTime": "2026-10-01T10:00:00.0000000" },
              "onlineMeeting": { "joinUrl": "https://teams.microsoft.com/l/meetup-join/1" }, "location": { "displayName": "" } },
            { "id": "z", "isAllDay": true, "start": { "dateTime": "2026-10-01T00:00:00.0000000" } }
        ]});
        let mut all = parse_graph(&m);
        assert_eq!(all.len(), 1);
        assert_eq!((all[0].rsvp.as_deref(), all[0].location.clone()), (Some("tentative"), None));
        assert_eq!(all[0].join_url.as_deref(), Some("https://teams.microsoft.com/l/meetup-join/1"));

        let mut dup = ev[0].clone();
        dup.id = "ics:x".into();
        dup.title = "Client".into(); // same title + start as the Graph event
        merge(&mut all, vec![ev[0].clone(), ev[0].clone(), dup]);
        assert_eq!(all.len(), 2);
    }
}

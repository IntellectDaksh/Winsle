// Upcoming meetings from a private ICS feed (Google/Outlook "secret address"),
// stored in the Credential Manager as "calendar-ics-url". Hand-rolled parser:
// we only need the next 24 h of timed events, not full RFC 5545.

use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde::Serialize;
use tauri::AppHandle;
use windows::Win32::Foundation::SYSTEMTIME;
use windows::Win32::System::Time::TzSpecificLocalTimeToSystemTime;

const EVERY: Duration = Duration::from_secs(300);
pub(super) const DAY_MS: i64 = 86_400_000;
const WINDOW_MS: i64 = DAY_MS;

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CalendarEvent {
    /// "ics:<uid>@<start>", "g:<id>" (Google) or "m:<id>" (Outlook); RSVP routes on the prefix.
    pub id: String,
    pub title: String,
    pub start: i64,
    pub end: i64,
    pub join_url: Option<String>,
    pub location: Option<String>,
    /// "pending" | "accepted" | "declined" | "tentative" when you're an invitee of an account event.
    pub rsvp: Option<String>,
}

#[derive(Serialize, Clone)]
struct CalendarInfo {
    events: Vec<CalendarEvent>,
    error: Option<String>,
}

static NO_URL_SENT: AtomicBool = AtomicBool::new(false);

pub fn spawn(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            refresh(&app, false).await;
            tokio::time::sleep(EVERY).await;
        }
    });
}

#[tauri::command]
pub fn calendar_refresh(app: AppHandle) {
    tauri::async_runtime::spawn(async move { refresh(&app, true).await });
}

async fn refresh(app: &AppHandle, forced: bool) {
    if crate::live::paused() {
        return;
    }
    let url = crate::secrets::get("calendar-ics-url").filter(|u| !u.trim().is_empty());
    if url.is_none() && !super::calendar_oauth::any_connected() {
        if forced || !NO_URL_SENT.swap(true, Ordering::Relaxed) {
            crate::live::emit(app, "live-calendar", CalendarInfo { events: vec![], error: None });
        }
        return;
    }
    NO_URL_SENT.store(false, Ordering::Relaxed);
    let now = now_ms();
    let (mut events, mut errors) = super::calendar_oauth::fetch_all(now).await;
    if let Some(url) = url {
        match fetch(&url).await {
            Ok(ics) => super::calendar_oauth::merge(&mut events, upcoming(&ics, now, &local_to_utc)),
            Err(e) => {
                crate::log::line(format!("calendar: {e}"));
                errors.push(e);
            }
        }
    }
    events.sort_by_key(|e| (e.start, e.end));
    // One source failing while another works is logged, not shown over the working list.
    let error = (events.is_empty() && !errors.is_empty()).then(|| errors.join(" · "));
    crate::live::emit(app, "live-calendar", CalendarInfo { events, error });
}

async fn fetch(url: &str) -> Result<String, String> {
    let url = match url.trim().strip_prefix("webcal://") {
        Some(rest) => format!("https://{rest}"),
        None => url.trim().to_string(),
    };
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?;
    // Errors are shown in the island; never echo the secret URL into them.
    let resp = client.get(&url).send().await.map_err(|e| {
        if e.is_timeout() { "calendar timed out".to_string() } else { "calendar unreachable".to_string() }
    })?;
    if !resp.status().is_success() {
        return Err(format!("calendar returned HTTP {}", resp.status().as_u16()));
    }
    resp.text().await.map_err(|_| "calendar download failed".to_string())
}

pub(super) fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Naive local wall time (as if UTC) → real UTC ms, using the machine's time zone.
pub(super) fn local_to_utc(naive_ms: i64) -> i64 {
    let (y, m, d) = civil_from_days(naive_ms.div_euclid(DAY_MS));
    let rem = naive_ms.rem_euclid(DAY_MS) / 1000;
    let local = SYSTEMTIME {
        wYear: y as u16,
        wMonth: m as u16,
        wDay: d as u16,
        wHour: (rem / 3600) as u16,
        wMinute: (rem / 60 % 60) as u16,
        wSecond: (rem % 60) as u16,
        ..Default::default()
    };
    let mut utc = SYSTEMTIME::default();
    // Note: TZID is mapped to the machine's zone, not the named zone; fine while
    // the feed and the PC share a zone. Upgrade path: Windows→IANA zone table.
    if unsafe { TzSpecificLocalTimeToSystemTime(None, &local, &mut utc) }.is_err() {
        return naive_ms;
    }
    days_from_civil(utc.wYear as i64, utc.wMonth as i64, utc.wDay as i64) * DAY_MS
        + (utc.wHour as i64 * 3600 + utc.wMinute as i64 * 60 + utc.wSecond as i64) * 1000
}

// ---- civil date math (Howard Hinnant's algorithms) ----

pub(super) fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

pub(super) fn civil_from_days(z: i64) -> (i64, i64, i64) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (if m <= 2 { yoe + era * 400 + 1 } else { yoe + era * 400 }, m, d)
}

/// Monday = 0.
fn weekday(days: i64) -> i64 {
    (days + 3).rem_euclid(7)
}

// ---- ICS parsing ----

#[derive(Clone, Copy, Debug, PartialEq)]
enum Time {
    Utc(i64),
    /// Wall-clock ms as if it were UTC; resolved through the local zone.
    Local(i64),
    AllDay,
}

impl Time {
    fn wall(self) -> Option<i64> {
        match self {
            Time::Utc(t) | Time::Local(t) => Some(t),
            Time::AllDay => None,
        }
    }
    fn with_wall(self, t: i64) -> Time {
        match self {
            Time::Utc(_) => Time::Utc(t),
            _ => Time::Local(t),
        }
    }
    fn resolve(self, tz: &dyn Fn(i64) -> i64) -> Option<i64> {
        match self {
            Time::Utc(t) => Some(t),
            Time::Local(t) => Some(tz(t)),
            Time::AllDay => None,
        }
    }
}

struct Prop<'a> {
    name: String,
    params: Vec<(String, &'a str)>,
    value: &'a str,
}

fn unfold(ics: &str) -> Vec<String> {
    let mut lines: Vec<String> = Vec::new();
    for raw in ics.split('\n') {
        let line = raw.strip_suffix('\r').unwrap_or(raw);
        if let (Some(rest), Some(last)) = (line.strip_prefix([' ', '\t']), lines.last_mut()) {
            last.push_str(rest);
        } else if !line.is_empty() {
            lines.push(line.to_string());
        }
    }
    lines
}

fn parse_prop(line: &str) -> Option<Prop<'_>> {
    // The value starts at the first ':' outside a quoted parameter value.
    let mut quoted = false;
    let colon = line.char_indices().find(|&(_, c)| {
        if c == '"' {
            quoted = !quoted;
        }
        c == ':' && !quoted
    })?.0;
    let (head, value) = (&line[..colon], &line[colon + 1..]);
    let mut parts = head.split(';');
    let name = parts.next()?.to_ascii_uppercase();
    let params = parts
        .filter_map(|p| p.split_once('='))
        .map(|(k, v)| (k.to_ascii_uppercase(), v.trim_matches('"')))
        .collect();
    Some(Prop { name, params, value })
}

fn unescape_text(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        if c == '\\' {
            match chars.next() {
                Some('n') | Some('N') => out.push('\n'),
                Some(other) => out.push(other),
                None => {}
            }
        } else {
            out.push(c);
        }
    }
    out
}

fn num(s: &str) -> Option<i64> {
    s.parse().ok()
}

fn parse_time(value: &str, params: &[(String, &str)]) -> Option<Time> {
    let v = value.trim();
    let date_only = params.iter().any(|(k, v)| k == "VALUE" && v.eq_ignore_ascii_case("DATE")) || v.len() == 8;
    if !v.is_ascii() || v.len() < 8 {
        return None;
    }
    let days = days_from_civil(num(&v[0..4])?, num(&v[4..6])?, num(&v[6..8])?);
    if date_only {
        return Some(Time::AllDay);
    }
    if v.len() < 15 || &v[8..9] != "T" {
        return None;
    }
    let secs = num(&v[9..11])? * 3600 + num(&v[11..13])? * 60 + num(&v[13..15])?;
    let ms = days * DAY_MS + secs * 1000;
    Some(if v.ends_with('Z') { Time::Utc(ms) } else { Time::Local(ms) })
}

/// ISO 8601 duration as used by ICS: P1W, P1DT2H, PT30M, -PT15M…
fn parse_duration(s: &str) -> Option<i64> {
    let (neg, s) = match s.strip_prefix('-') {
        Some(r) => (true, r),
        None => (false, s.strip_prefix('+').unwrap_or(s)),
    };
    let s = s.strip_prefix('P')?;
    let mut total = 0i64;
    let mut n = String::new();
    for c in s.chars() {
        match c {
            '0'..='9' => n.push(c),
            'T' => {}
            'W' | 'D' | 'H' | 'M' | 'S' => {
                let v: i64 = n.parse().ok()?;
                n.clear();
                total += v * match c {
                    'W' => 7 * DAY_MS,
                    'D' => DAY_MS,
                    'H' => 3_600_000,
                    'M' => 60_000,
                    _ => 1000,
                };
            }
            _ => return None,
        }
    }
    Some(if neg { -total } else { total })
}

#[derive(Default)]
struct RawEvent {
    uid: String,
    summary: String,
    location: Option<String>,
    description: String,
    url: String,
    start: Option<Time>,
    end: Option<Time>,
    duration: Option<i64>,
    rrule: Option<String>,
    exdates: Vec<Time>,
    recurrence_id: Option<Time>,
    cancelled: bool,
}

fn parse_events(ics: &str) -> Vec<RawEvent> {
    let mut events = Vec::new();
    let mut cur: Option<RawEvent> = None;
    let mut depth = 0; // nested components inside a VEVENT (VALARM)
    for line in unfold(ics) {
        let Some(p) = parse_prop(&line) else { continue };
        match (p.name.as_str(), p.value.to_ascii_uppercase().as_str()) {
            ("BEGIN", "VEVENT") => {
                cur = Some(RawEvent::default());
                depth = 0;
                continue;
            }
            ("END", "VEVENT") => {
                events.extend(cur.take());
                continue;
            }
            ("BEGIN", _) if cur.is_some() => {
                depth += 1;
                continue;
            }
            ("END", _) if cur.is_some() => {
                depth -= 1;
                continue;
            }
            _ => {}
        }
        let Some(ev) = cur.as_mut().filter(|_| depth == 0) else { continue };
        match p.name.as_str() {
            "UID" => ev.uid = p.value.to_string(),
            "SUMMARY" => ev.summary = unescape_text(p.value),
            "LOCATION" => ev.location = Some(unescape_text(p.value)).filter(|s| !s.trim().is_empty()),
            "DESCRIPTION" => ev.description = unescape_text(p.value),
            "URL" => ev.url = p.value.to_string(),
            "DTSTART" => ev.start = parse_time(p.value, &p.params),
            "DTEND" => ev.end = parse_time(p.value, &p.params),
            "DURATION" => ev.duration = parse_duration(p.value),
            "RRULE" => ev.rrule = Some(p.value.to_string()),
            "EXDATE" => ev.exdates.extend(p.value.split(',').filter_map(|v| parse_time(v, &p.params))),
            "RECURRENCE-ID" => ev.recurrence_id = parse_time(p.value, &p.params),
            "STATUS" => ev.cancelled = p.value.eq_ignore_ascii_case("CANCELLED"),
            _ => {}
        }
    }
    events
}

struct Rule {
    freq_days: i64, // 1 = DAILY, 7 = WEEKLY
    interval: i64,
    until: Option<Time>,
    count: Option<i64>,
    byday: Vec<i64>, // Monday = 0
}

fn parse_rrule(s: &str) -> Option<Rule> {
    let mut rule = Rule { freq_days: 0, interval: 1, until: None, count: None, byday: vec![] };
    for part in s.split(';') {
        let (k, v) = part.split_once('=')?;
        match k.to_ascii_uppercase().as_str() {
            "FREQ" => {
                rule.freq_days = match v.to_ascii_uppercase().as_str() {
                    "DAILY" => 1,
                    "WEEKLY" => 7,
                    _ => return None,
                }
            }
            "INTERVAL" => rule.interval = num(v).filter(|&n| n > 0)?,
            "UNTIL" => rule.until = parse_time(v, &[]),
            "COUNT" => rule.count = num(v),
            "BYDAY" => {
                for d in v.split(',') {
                    // Weekly BYDAY has no ordinal prefix; ignore anything that does.
                    let code = d.trim().to_ascii_uppercase();
                    let idx = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"].iter().position(|x| *x == code)?;
                    rule.byday.push(idx as i64);
                }
            }
            _ => {}
        }
    }
    (rule.freq_days > 0).then_some(rule)
}

/// Occurrence start wall-times (same clock as `start`) up to `limit_wall`.
fn expand(start: i64, rule: &Rule, limit_wall: i64, until_wall: Option<i64>) -> Vec<i64> {
    let mut out = Vec::new();
    let day0 = start.div_euclid(DAY_MS);
    let tod = start.rem_euclid(DAY_MS);
    let mut emitted = 0i64;
    let mut push = |t: i64, out: &mut Vec<i64>| -> bool {
        if t > limit_wall || until_wall.is_some_and(|u| t > u) || rule.count.is_some_and(|c| emitted >= c) {
            return false;
        }
        emitted += 1;
        out.push(t);
        true
    };
    if rule.freq_days == 1 {
        // Note: linear walk from DTSTART; fine for years of daily events.
        for k in 0..200_000 {
            if !push((day0 + k * rule.interval) * DAY_MS + tod, &mut out) {
                break;
            }
        }
    } else {
        let mut days = if rule.byday.is_empty() { vec![weekday(day0)] } else { rule.byday.clone() };
        days.sort_unstable();
        days.dedup();
        let monday = day0 - weekday(day0);
        'weeks: for w in 0..50_000 {
            for &wd in &days {
                let d = monday + w * 7 * rule.interval + wd;
                if d < day0 {
                    continue;
                }
                if !push(d * DAY_MS + tod, &mut out) {
                    break 'weeks;
                }
            }
        }
    }
    out
}

fn upcoming(ics: &str, now: i64, tz: &dyn Fn(i64) -> i64) -> Vec<CalendarEvent> {
    let raw = parse_events(ics);
    let overridden: HashSet<(String, i64)> = raw
        .iter()
        .filter_map(|e| Some((e.uid.clone(), e.recurrence_id?.resolve(tz)?)))
        .collect();
    let horizon = now + WINDOW_MS;
    let mut out = Vec::new();
    for ev in &raw {
        if ev.cancelled {
            continue;
        }
        let Some(start) = ev.start.filter(|s| *s != Time::AllDay) else { continue };
        let base_start = start.resolve(tz).unwrap();
        let length = match ev.end.and_then(|e| e.resolve(tz)) {
            Some(end) => end - base_start,
            None => ev.duration.unwrap_or(3_600_000),
        }
        .max(0);
        let rule = if ev.recurrence_id.is_none() { ev.rrule.as_deref().and_then(parse_rrule) } else { None };
        let starts: Vec<i64> = match rule {
            Some(rule) => {
                let wall = start.wall().unwrap();
                // Wall clock and UTC differ by at most ±14 h; pad the limit and filter after resolving.
                let limit_wall = horizon + DAY_MS;
                let until_wall = rule.until.and_then(|u| match u {
                    Time::AllDay => None,
                    Time::Utc(t) => Some(match start {
                        Time::Utc(_) => t,
                        _ => t + DAY_MS, // compared in wall time; resolved filter below is exact
                    }),
                    Time::Local(t) => Some(t),
                });
                let until_utc = rule.until.and_then(|u| u.resolve(tz));
                let exdates: HashSet<i64> = ev.exdates.iter().filter_map(|t| t.resolve(tz)).collect();
                expand(wall, &rule, limit_wall, until_wall)
                    .into_iter()
                    .map(|w| start.with_wall(w).resolve(tz).unwrap())
                    .filter(|s| until_utc.is_none_or(|u| *s <= u))
                    .filter(|s| !exdates.contains(s) && !overridden.contains(&(ev.uid.clone(), *s)))
                    .collect()
            }
            None => vec![base_start],
        };
        let join_url = join_url(&[ev.location.as_deref().unwrap_or(""), &ev.description, &ev.url]);
        for s in starts {
            let end = s + length;
            if end > now && s < horizon {
                out.push(CalendarEvent {
                    id: format!("ics:{}@{s}", ev.uid),
                    title: if ev.summary.trim().is_empty() { "Busy".into() } else { ev.summary.clone() },
                    start: s,
                    end,
                    join_url: join_url.clone(),
                    location: ev.location.clone(),
                    rsvp: None,
                });
            }
        }
    }
    out.sort_by_key(|e| (e.start, e.end));
    out
}

pub(super) fn join_url(fields: &[&str]) -> Option<String> {
    for field in fields {
        for token in field.split(|c: char| c.is_whitespace() || "<>\"'()[]|,".contains(c)) {
            let token = token.trim_end_matches(['.', ';', ':']);
            let Some((_, rest)) = token.split_once("://") else { continue };
            let (host, path) = rest.split_at(rest.find('/').unwrap_or(rest.len()));
            let is_http = token.starts_with("https://") || token.starts_with("http://");
            let ok = (host == "meet.google.com" && path.len() > 1)
                || ((host == "zoom.us" || host.ends_with(".zoom.us")) && path.starts_with("/j/"))
                || (host == "teams.microsoft.com" && path.starts_with("/l/meetup-join/"))
                || (host == "teams.live.com" && path.starts_with("/meet/"))
                || (host.ends_with(".webex.com") && (path.starts_with("/meet/") || path.starts_with("/join/")));
            if ok && is_http && !token.chars().any(|c| c.is_control() || c == '"' || c == '\'' || c == ';' || c == '\\') {
                return Some(token.to_string());
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    const IST: i64 = 5 * 3_600_000 + 1_800_000;
    fn ist(t: i64) -> i64 {
        t - IST
    }
    fn utc(y: i64, m: i64, d: i64, h: i64, mi: i64) -> i64 {
        days_from_civil(y, m, d) * DAY_MS + (h * 3600 + mi * 60) * 1000
    }

    #[test]
    fn date_math() {
        assert_eq!(days_from_civil(1970, 1, 1), 0);
        assert_eq!(days_from_civil(2000, 3, 1), 11_017);
        assert_eq!(civil_from_days(days_from_civil(2024, 2, 29)), (2024, 2, 29));
        assert_eq!(civil_from_days(-1), (1969, 12, 31));
        assert_eq!(weekday(0), 3); // Thursday
        assert_eq!(weekday(days_from_civil(2026, 10, 1)), 3);
    }

    #[test]
    fn durations() {
        assert_eq!(parse_duration("PT1H30M"), Some(5_400_000));
        assert_eq!(parse_duration("P1DT1S"), Some(DAY_MS + 1000));
        assert_eq!(parse_duration("-PT15M"), Some(-900_000));
    }

    #[test]
    fn join_urls() {
        assert_eq!(
            join_url(&["", "Join: <https://us02web.zoom.us/j/123?pwd=ab>.", ""]),
            Some("https://us02web.zoom.us/j/123?pwd=ab".into())
        );
        assert_eq!(join_url(&["https://meet.google.com/abc-defg-hij", "", ""]), Some("https://meet.google.com/abc-defg-hij".into()));
        assert_eq!(
            join_url(&["", "https://teams.microsoft.com/l/meetup-join/19%3ameeting_x/0?context=y", ""]),
            Some("https://teams.microsoft.com/l/meetup-join/19%3ameeting_x/0?context=y".into())
        );
        assert_eq!(join_url(&["https://zoom.us/pricing", "https://meet.google.com/", ""]), None);
        assert_eq!(
            join_url(&["https://company.webex.com/meet/user123"]),
            Some("https://company.webex.com/meet/user123".into())
        );
        assert_eq!(join_url(&["https://meet.google.com/abc;calc.exe"]), None);
    }

    const ICS: &str = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:a\r\nDTSTART:20261001T093000Z\r\nDTEND:20261001T100000Z\r\nSUMMARY:Standup\\, daily\r\nDESCRIPTION:Join https://meet.google.com/\r\n abc-defg-hij now\r\nBEGIN:VALARM\r\nDESCRIPTION:ignored\r\nEND:VALARM\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:b\r\nDTSTART;TZID=Asia/Kolkata:20261001T150000\r\nDTEND;TZID=Asia/Kolkata:20261001T160000\r\nSUMMARY:Client call\r\nLOCATION:Office\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:c\r\nDTSTART;VALUE=DATE:20261001\r\nSUMMARY:Holiday\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:d\r\nDTSTART:20261001T120000Z\r\nSTATUS:CANCELLED\r\nSUMMARY:Gone\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:w\r\nDTSTART;TZID=Asia/Kolkata:20260907T180000\r\nDURATION:PT30M\r\nRRULE:FREQ=WEEKLY;BYDAY=MO,TH;UNTIL=20261231T000000Z\r\nEXDATE;TZID=Asia/Kolkata:20260910T180000\r\nSUMMARY:Gym\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:old\r\nDTSTART:20200101T000000Z\r\nSUMMARY:Past\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";

    #[test]
    fn parse_and_window() {
        let now = utc(2026, 10, 1, 9, 0);
        let ev = upcoming(ICS, now, &ist);
        let titles: Vec<&str> = ev.iter().map(|e| e.title.as_str()).collect();
        assert_eq!(titles, vec!["Standup, daily", "Client call", "Gym"]);
        assert_eq!(ev[0].start, utc(2026, 10, 1, 9, 30));
        assert_eq!(ev[0].join_url.as_deref(), Some("https://meet.google.com/abc-defg-hij"));
        assert_eq!(ev[1].start, utc(2026, 10, 1, 9, 30)); // 15:00 IST
        assert_eq!(ev[1].location.as_deref(), Some("Office"));
        // Thursday 1 Oct 18:00 IST = 12:30 UTC, 30 min.
        assert_eq!((ev[2].start, ev[2].end), (utc(2026, 10, 1, 12, 30), utc(2026, 10, 1, 13, 0)));
    }

    #[test]
    fn rrule_weekly_exdate_count_interval() {
        // Exdate'd Thursday 10 Sep must be skipped.
        let now = utc(2026, 9, 10, 0, 0);
        assert!(upcoming(ICS, now, &ist).iter().all(|e| e.title != "Gym"));

        let r = parse_rrule("FREQ=WEEKLY;INTERVAL=2;COUNT=3").unwrap();
        let start = utc(2026, 9, 7, 10, 0); // Monday
        assert_eq!(expand(start, &r, i64::MAX, None), vec![start, start + 14 * DAY_MS, start + 28 * DAY_MS]);

        let r = parse_rrule("FREQ=DAILY;INTERVAL=3").unwrap();
        assert_eq!(expand(start, &r, start + 7 * DAY_MS, None).len(), 3);
        assert!(parse_rrule("FREQ=MONTHLY").is_none());
    }

    #[test]
    fn in_progress_and_override() {
        let ics = "BEGIN:VEVENT\nUID:r\nDTSTART:20260930T090000Z\nDTEND:20260930T100000Z\nRRULE:FREQ=DAILY\nSUMMARY:Daily\nEND:VEVENT\nBEGIN:VEVENT\nUID:r\nRECURRENCE-ID:20261001T090000Z\nDTSTART:20261001T110000Z\nDTEND:20261001T113000Z\nSUMMARY:Moved\nEND:VEVENT\n";
        let ev = upcoming(ics, utc(2026, 10, 1, 9, 15), &|t| t);
        let got: Vec<(&str, i64)> = ev.iter().map(|e| (e.title.as_str(), e.start)).collect();
        assert_eq!(got, vec![("Moved", utc(2026, 10, 1, 11, 0)), ("Daily", utc(2026, 10, 2, 9, 0))]);
        // In progress counts.
        let ev = upcoming(ics, utc(2026, 9, 30, 9, 30), &|t| t);
        assert_eq!(ev[0].start, utc(2026, 9, 30, 9, 0));
    }
}

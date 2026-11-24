// Synced lyrics for the compact island, from LRCLIB (lrclib.net): a free,
// keyless lyrics database. Only artist, title, album and length are sent, once
// per track; the front end caches the answer for the session.

use std::sync::OnceLock;
use std::time::Duration;

use serde::Deserialize;

const UA: &str = concat!("Winsle/", env!("CARGO_PKG_VERSION"), " (https://github.com/)");
const MAX_FIELD_LEN: usize = 200;
const MAX_DURATION_SECS: f64 = 86_400.0;
const MAX_LYRICS_LEN: usize = 64 * 1024;

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Track {
    pub(crate) synced_lyrics: Option<String>,
    #[serde(default)]
    pub(crate) instrumental: bool,
}

pub(crate) fn sanitize_query_field(raw: &str) -> String {
    raw.trim()
        .chars()
        .filter(|c| !c.is_control())
        .take(MAX_FIELD_LEN)
        .collect()
}

pub(crate) fn sanitize_duration_secs(duration: f64) -> Option<u64> {
    if !duration.is_finite() || duration <= 0.0 || duration > MAX_DURATION_SECS {
        return None;
    }
    Some(duration.round() as u64)
}

pub(crate) fn extract_lyrics(track: Track) -> Option<String> {
    if track.instrumental {
        return None;
    }
    let lyrics = track.synced_lyrics?;
    let trimmed = lyrics.trim();
    if trimmed.is_empty() || trimmed.len() > MAX_LYRICS_LEN {
        return None;
    }
    Some(trimmed.to_string())
}

pub(crate) fn pick_synced_lyrics(tracks: Vec<Track>) -> Option<String> {
    tracks.into_iter().find_map(extract_lyrics)
}

fn client() -> Result<&'static reqwest::Client, String> {
    static C: OnceLock<reqwest::Client> = OnceLock::new();
    if let Some(c) = C.get() {
        return Ok(c);
    }
    let built = reqwest::Client::builder()
        .user_agent(UA)
        .timeout(Duration::from_secs(8))
        .build()
        .map_err(|e| e.to_string())?;
    Ok(C.get_or_init(|| built))
}

/// Synced LRC text, or None when the track has no synced lyrics.
#[tauri::command]
pub async fn lyrics_get(artist: String, title: String, album: String, duration: f64) -> Result<Option<String>, String> {
    let artist = sanitize_query_field(&artist);
    let title = sanitize_query_field(&title);
    let album = sanitize_query_field(&album);
    if crate::live::paused() || artist.is_empty() || title.is_empty() {
        return Ok(None);
    }
    let http = client()?;
    // Exact match first (needs the length within ~2 s), then a looser search.
    let mut query = vec![("artist_name", artist.clone()), ("track_name", title.clone())];
    if !album.is_empty() {
        query.push(("album_name", album));
    }
    if let Some(secs) = sanitize_duration_secs(duration) {
        query.push(("duration", secs.to_string()));
    }
    if let Ok(resp) = http.get("https://lrclib.net/api/get").query(&query).send().await {
        if resp.status().is_success() {
            if let Ok(t) = resp.json::<Track>().await {
                if t.instrumental {
                    return Ok(None);
                }
                if let Some(l) = extract_lyrics(t) {
                    return Ok(Some(l));
                }
            }
        }
    }
    let found: Vec<Track> = http
        .get("https://lrclib.net/api/search")
        .query(&[("artist_name", artist), ("track_name", title)])
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    Ok(pick_synced_lyrics(found))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_query_field_strips_control_chars_and_bounds_len() {
        assert_eq!(sanitize_query_field("  Daft Punk\r\n "), "Daft Punk");
        assert_eq!(sanitize_query_field("\x00\x07"), "");
        let long = "a".repeat(MAX_FIELD_LEN + 40);
        assert_eq!(sanitize_query_field(&long).len(), MAX_FIELD_LEN);
    }

    #[test]
    fn sanitize_duration_secs_rejects_non_finite_and_out_of_range() {
        assert_eq!(sanitize_duration_secs(214.6), Some(215));
        assert_eq!(sanitize_duration_secs(0.0), None);
        assert_eq!(sanitize_duration_secs(-12.0), None);
        assert_eq!(sanitize_duration_secs(f64::NAN), None);
        assert_eq!(sanitize_duration_secs(f64::INFINITY), None);
        assert_eq!(sanitize_duration_secs(MAX_DURATION_SECS + 1.0), None);
    }

    #[test]
    fn pick_synced_lyrics_skips_instrumental_blank_and_oversized() {
        let tracks = vec![
            Track { synced_lyrics: Some("[00:01.00] inst".into()), instrumental: true },
            Track { synced_lyrics: Some("   \n  ".into()), instrumental: false },
            Track { synced_lyrics: Some("x".repeat(MAX_LYRICS_LEN + 1)), instrumental: false },
            Track { synced_lyrics: Some("  [00:10.00] Hello world  ".into()), instrumental: false },
        ];
        assert_eq!(pick_synced_lyrics(tracks), Some("[00:10.00] Hello world".into()));
    }
}

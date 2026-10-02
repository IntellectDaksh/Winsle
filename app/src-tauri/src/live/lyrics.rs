// Synced lyrics for the compact island, from LRCLIB (lrclib.net): a free,
// keyless lyrics database. Only artist, title, album and length are sent, once
// per track; the front end caches the answer for the session.

use std::time::Duration;

use serde::Deserialize;

const UA: &str = concat!("Winsle/", env!("CARGO_PKG_VERSION"), " (https://github.com/)");

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Track {
    synced_lyrics: Option<String>,
    #[serde(default)]
    instrumental: bool,
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(UA)
        .timeout(Duration::from_secs(8))
        .build()
        .map_err(|e| e.to_string())
}

/// Synced LRC text, or None when the track has no synced lyrics.
#[tauri::command]
pub async fn lyrics_get(artist: String, title: String, album: String, duration: f64) -> Result<Option<String>, String> {
    if crate::live::paused() || artist.trim().is_empty() || title.trim().is_empty() {
        return Ok(None);
    }
    let http = client()?;
    // Exact match first (needs the length within ~2 s), then a looser search.
    let mut query = vec![("artist_name", artist.clone()), ("track_name", title.clone())];
    if !album.trim().is_empty() {
        query.push(("album_name", album));
    }
    if duration > 0.0 {
        query.push(("duration", (duration.round() as u64).to_string()));
    }
    if let Ok(resp) = http.get("https://lrclib.net/api/get").query(&query).send().await {
        if resp.status().is_success() {
            if let Ok(t) = resp.json::<Track>().await {
                if t.instrumental {
                    return Ok(None);
                }
                if let Some(l) = t.synced_lyrics.filter(|l| !l.trim().is_empty()) {
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
    Ok(found.into_iter().find_map(|t| t.synced_lyrics.filter(|l| !l.trim().is_empty())))
}

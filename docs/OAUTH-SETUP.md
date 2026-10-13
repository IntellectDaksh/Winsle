# OAuth setup

## Spotify

Optional. Now playing works without it (Windows media controls).

1. https://developer.spotify.com/dashboard → Create app. APIs used: **Web API**.
2. Redirect URI: `http://127.0.0.1:8898/callback` (exact match; Spotify allows loopback IPs, not `localhost`).
3. Copy the **Client ID** (PKCE: no client secret is used or shipped).
4. Release builds: set CI secret `WINSLE_SPOTIFY_CLIENT_ID` (read at compile time). Local/dev: `WINSLE_SPOTIFY_CLIENT_ID=` in `.env`, or Credential Manager key `spotify-client-id`.
5. User: Settings → Live → Spotify → Connect, sign in in the browser. Disconnect clears the stored refresh token.

Scopes: `user-library-read user-library-modify user-modify-playback-state user-read-playback-state playlist-read-private`.

Limits:
- Development mode allows only 25 users, each added by email under the app's *User Management*, until Spotify grants **Extended Quota Mode** (apply in the dashboard; needs a reviewed app).
- Play, queue and start-playlist need **Spotify Premium**; free accounts get "Spotify Premium is required for playback control." Liking and listing playlists work on free.
- Port 8898 must be free during sign-in.

## Google Calendar

Used by Settings → Live → **Connect Google** (read next 24 h, RSVP, quick-create).

1. [Google Cloud Console](https://console.cloud.google.com/) → create a project → *APIs & Services → Library* → enable **Google Calendar API**.
2. *OAuth consent screen*: External, app name "Winsle", add scope `https://www.googleapis.com/auth/calendar.events`.
3. *Credentials → Create credentials → OAuth client ID → Desktop app*. Desktop clients accept any loopback port, so no redirect URI is registered; Winsle listens on `http://127.0.0.1:<random port>/callback`.
4. Copy the client ID and client secret into the release CI secrets `WINSLE_GOOGLE_CLIENT_ID` and `WINSLE_GOOGLE_CLIENT_SECRET` (build-time `option_env!`). Google documents desktop-app secrets as non-confidential; they still never go in source. Local override: `WINSLE_GOOGLE_CLIENT_ID` / `WINSLE_GOOGLE_CLIENT_SECRET` in `.env`, or secret keys `google-client-id` / `google-client-secret`.

Limits:
- `calendar.events` is a **sensitive scope**. While the consent screen is in *Testing*, only listed test users (max **100**) can sign in, and their refresh tokens expire after **7 days** (Winsle then shows "sign-in expired — reconnect"). Shipping to everyone needs **OAuth app verification** (privacy policy URL, homepage, demo video of the scope in use; takes days to weeks). Unverified apps in production show the "Google hasn't verified this app" warning and are capped at 100 users.
- Calendar API quota: 1,000,000 queries/day per project, per-user rate limits apply; Winsle polls once every 5 min while connected.

## Outlook (Microsoft Graph)

Used by Settings → Live → **Connect Outlook**. Works for personal Microsoft accounts and work/school tenants.

1. [Entra admin center](https://entra.microsoft.com/) → *App registrations → New registration*. Supported account types: **Accounts in any organizational directory and personal Microsoft accounts** (tenant `common`).
2. *Authentication → Add a platform → Mobile and desktop applications* → custom redirect URI `http://127.0.0.1/callback` (Microsoft ignores the port for loopback URIs). Set **Allow public client flows = Yes**. No client secret.
3. *API permissions → Microsoft Graph → Delegated*: `Calendars.ReadWrite`, `offline_access`, `User.Read`.
4. Put the Application (client) ID in the CI secret `WINSLE_MICROSOFT_CLIENT_ID` (local override: `.env` or secret key `microsoft-client-id`).

Limits:
- Some work tenants block user consent; an admin must grant consent for the app first.
- Refresh tokens rotate and are re-saved on each refresh; they lapse after 90 days without use.
- Graph throttling: 10,000 requests / 10 min per app per mailbox, far above Winsle's one call per 5 min.

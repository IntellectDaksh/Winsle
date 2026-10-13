# Phone link

Local Wi-Fi bridge between a phone and Winsle. No app to install, no cloud: the phone talks straight to the PC over your LAN.

## Enable and pair
1. Settings → **Phone link** → switch on. Winsle listens on `0.0.0.0:8899`.
2. **Windows Firewall** asks once whether to allow Winsle. Tick **Private networks** only. If you dismissed it, allow `winsle.exe` under Windows Security → Firewall → Allow an app, or the phone can't connect. On networks Windows marks *Public* the firewall keeps blocking it, which is intended.
3. On the phone (same Wi-Fi), scan the QR code or open the URL shown (`http://<pc-ip>:8899/`).
4. Enter the 6-digit code. The phone gets a bearer token, saved in its browser storage. The code is single-use; press **New code** for another phone.
5. Paired devices are listed in Settings; **Revoke** cuts one off immediately.

Turning Phone link off closes the port. When it's off nothing listens.

## What the page does
- Send text to the PC clipboard, fetch the PC clipboard.
- Media remote: previous, play/pause, next (the current Windows media session).
- Shows the automation URL and header for forwarding notifications.

## API
All endpoints except `GET /` and `POST /pair` need `Authorization: Bearer <token>`. POST bodies must be `Content-Type: application/json`, at most 64 KB.

| Method | Path | Body | Result |
|---|---|---|---|
| POST | `/pair` | `{"code":"123456","name":"Pixel"}` | `{"token":"…"}` |
| POST | `/notify` | `{"app":"WhatsApp","title":"Sam","body":"on my way"}` | 204, shows in Winsle's notification list and flashes the island |
| POST | `/clip` | `{"text":"…"}` | 204, PC clipboard set |
| GET | `/clip` | | `{"text":"…"}` |
| POST | `/media` | `{"action":"play_pause"}` (`next`, `prev`) | 204 |
| GET | `/ping` | | `{"ok":true}` |

Errors return `{"error":"…"}`. 503 while Winsle is paused from the tray.

## Forwarding phone notifications
**Tasker (Android):** Profile → Event → UI → Notification (pick apps). Task → Net → HTTP Request: POST, URL `http://<pc-ip>:8899/notify`, headers `Authorization: Bearer <token>` and `Content-Type: application/json`, body `{"app":"%an","title":"%ntitle","body":"%ntext"}`.

**MacroDroid (Android):** Trigger *Notification received*. Action *HTTP Request*: POST, same URL and headers, body `{"app":"[notification_app_name]","title":"[notification_title]","body":"[notification]"}`.

**iOS Shortcuts:** iOS doesn't expose other apps' notifications. Use a Personal Automation (message received, email, app opened, time of day) with *Get contents of URL*: POST, headers as above, JSON body with `app`, `title`, `body`.

Give the PC a DHCP reservation in your router so the URL doesn't change.

## Security
- Requests from non-private source IPs (anything outside 10/8, 172.16/12, 192.168/16, loopback, link-local, IPv6 ULA/link-local) are dropped without a reply.
- Tokens are 32 random bytes; only their SHA-256 is stored (`%APPDATA%\Winsle\phone.json`), compared in constant time.
- Pairing: 5 attempts per minute total; the code rotates after 10 wrong guesses and after every successful pair. Max 10 devices.
- 8 KB header cap, 64 KB body cap, 10 s read timeout, 16 concurrent connections, no chunked bodies, duplicate `Content-Length` rejected.
- POSTs require `application/json`, so a random web page can't fire them cross-origin without a CORS preflight, which the server never approves.
- Plain HTTP: anyone sniffing the same Wi-Fi could read the token and clipboard text. Only use it on networks you trust (home, not café Wi-Fi). Revoke a device if in doubt.

<div align="center">
  <img src="app/src-tauri/icons/128x128.png" width="96" height="96" alt="Winsle logo" />

  # Winsle

  **A dynamic island for Windows. Mochi lives at the top of your screen.**

  ![CI](https://github.com/IntellectDaksh/Winsle/actions/workflows/ci.yml/badge.svg)
  ![Release](https://img.shields.io/github/v/release/IntellectDaksh/Winsle)
  ![License](https://img.shields.io/badge/license-MIT-blue)
  ![Platform](https://img.shields.io/badge/platform-Windows%2010%20%7C%2011%20x64-informational)
  ![Built with](https://img.shields.io/badge/built%20with-Tauri%202%20%2B%20Rust-orange)
</div>

Winsle brings a fluid, interactive dynamic island to Windows. It sits subtly at the top of your desktop, follows your active **Claude Code** and **Antigravity** coding sessions, and surfaces live system activities: Spotify playback, calendar agendas, phone notifications, download/render progress, clipboard history, focus sessions, screen-time stats, and push-to-talk voice dictation.

**Local-first by design.** No cloud server, no telemetry, and no Winsle account. The network is only touched for services you explicitly link, the optional keyless Spotify lyrics lookup (`lrclib.net`), and signed updater checks. Tokens and keys reside strictly in the **Windows Credential Manager** or your local `.env`, never in code.

---

## Where it fits

| Feature | macOS Dynamic Island | Standard Windows Taskbar | Third-Party Widget Bars | Winsle |
|---|---|---|---|---|
| **Platform** | macOS only (hardware pill) | Windows 10 / 11 | Windows | Windows 10 / 11 (64-bit) |
| **Coding Cockpit** | No | No | No | **Yes** (Claude Code & Antigravity live steps, tool approvals) |
| **Account Auth** | Cloud Apple ID | Microsoft Account | Vendor accounts | **100% Local OAuth PKCE & Credential Manager** |
| **Phone Link** | Apple Ecosystem only | Phone Link (cloud-heavy) | Rare | **Direct LAN Wi-Fi QR pairing (no mobile app)** |
| **Voice Commands** | Siri (cloud) | Cortana / Copilot (cloud) | None | **Offline Push-to-Talk (whisper.cpp)** |
| **Resource Usage** | OS Native | System process | ~300 MB–800 MB RAM | **~25–60 MB RAM (idle), runs on 2 GB RAM PCs** |
| **Telemetry & Ads** | Apple analytics | Windows diagnostic data | Frequently ad-supported | **Zero telemetry, zero trackers, open source** |

---

## System Requirements

### Runtime Requirements
* **Operating System:** Windows 10 or Windows 11 (64-bit, x64).
* **Hardware:** Any modern dual-core CPU and at least 2 GB of RAM. Winsle is designed to stay tiny and silent in the background.
* **WebView2 Runtime:** Included with Windows 10/11. The standalone setup installer automatically embeds the bootstrapper if missing.

### Build & Development Requirements
If compiling from source:
* **Node.js:** v20.0.0 or higher ([nodejs.org](https://nodejs.org))
* **Rust:** Stable toolchain (`x86_64-pc-windows-msvc`) installed via [rustup.rs](https://rustup.rs)
* **Visual Studio C++ Build Tools:** Desktop development with C++ (MSVC compiler and Windows 10/11 SDK)
* **Git:** For cloning and version management

---

## Install & Quick Start

### 1. Pre-built Executable (Recommended)
1. Download `Winsle_x.y.z_x64-setup.exe` from [Releases](https://github.com/IntellectDaksh/Winsle/releases).
2. Run the installer. No administrative privileges required.
3. On first launch, the Settings window opens automatically so you can configure optional modules (Spotify, Calendar, Phone Link, Voice).
> *Note on Windows SmartScreen:* Unsigned builds may trigger a SmartScreen alert. Click **More info → Run anyway**.

### 2. Build from Source
```bash
# 1. Clone the repository
git clone https://github.com/IntellectDaksh/Winsle.git
cd Winsle/app

# 2. Install frontend dependencies
npm install

# 3. Run in live development mode
npm run tauri dev

# 4. Compile a standalone release package
npm run pack
```
Compiled setup installers and standalone binaries land in `app/release/` and `app/src-tauri/target/release/winsle.exe`.

---

## Authentication & Account Setup

Winsle never ships with bundled API keys or shared cloud credentials. Every integration connects through direct OAuth PKCE on your machine or uses local keys stored in the **Windows Credential Manager**.

### Method 1: One-Click In-App Sign-In (Settings UI)
Open Winsle Settings (`Right-click tray icon → Settings` or `Ctrl+Alt+K → Settings`):

| Service | How to Connect | Auth Mechanism |
|---|---|---|
| **Spotify** | Settings → Spotify → **Connect** | OAuth 2.0 PKCE (`http://127.0.0.1:8898/callback`). Like, queue, seek, and playlist controls. |
| **Google Calendar** | Settings → Calendar → **Connect Google** | Google OAuth Desktop Client. Reads agenda for next 24h, 1-click meeting join, RSVP. |
| **Outlook Calendar** | Settings → Calendar → **Connect Outlook** | Microsoft Graph OAuth Public Client (`http://127.0.0.1/callback`). |
| **Any iCal Calendar** | Settings → Calendar → Paste iCal secret URL | Private ICS subscription URL (Google, Apple iCloud, Proton, Outlook). |
| **Integrations** | Settings → Integrations → Paste API Token | Tokens for GitHub, Vercel, Stripe, Notion, Resend, Cal.com, n8n. |

---

### Method 2: Optional `.env` Fallback (Power Users)
If you prefer configuring credentials via files or automated dotfiles, copy [`app/.env.example`](app/.env.example) to `.env` in the working directory (or alongside `winsle.exe`).

> **Safety Notice:** `.env` and all credential patterns are strictly `.gitignore`'d. Never commit private keys.

```env
# ==========================================
# Winsle Environment Configuration (.env)
# ==========================================

# Calendar: Google Calendar > Settings > "Secret address in iCal format"
WINSLE_CALENDAR_ICS_URL=

# AI Chat & Assistants
WINSLE_ANTHROPIC_API_KEY=

# Developer & Cloud Integrations (All Optional)
WINSLE_GITHUB_TOKEN=
WINSLE_VERCEL_TOKEN=
WINSLE_STRIPE_API_KEY=
WINSLE_RESEND_API_KEY=
WINSLE_NOTION_API_KEY=
WINSLE_CALCOM_API_KEY=
WINSLE_N8N_URL=
WINSLE_N8N_API_KEY=

# Custom OAuth Application IDs (Optional overrides for custom builds)
WINSLE_SPOTIFY_CLIENT_ID=
WINSLE_GOOGLE_CLIENT_ID=
WINSLE_GOOGLE_CLIENT_SECRET=
WINSLE_MICROSOFT_CLIENT_ID=
```

---

### Method 3: Registering Your Own OAuth Apps
If you are maintaining your own build or want dedicated API quotas, register apps in the official developer consoles:

#### 1. Spotify Web API
1. Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) and create an app.
2. Select **Web API**.
3. Set the Redirect URI to exactly:
   ```text
   http://127.0.0.1:8898/callback
   ```
4. Copy the **Client ID** into `WINSLE_SPOTIFY_CLIENT_ID` in `.env` (PKCE: no client secret required).
5. Scopes used: `user-library-read user-library-modify user-modify-playback-state user-read-playback-state playlist-read-private`.

#### 2. Google Calendar API
1. Open [Google Cloud Console](https://console.cloud.google.com/) and create a project.
2. Under **APIs & Services → Library**, enable the **Google Calendar API**.
3. Configure the **OAuth consent screen** (External, app name: "Winsle", scope: `https://www.googleapis.com/auth/calendar.events`).
4. Go to **Credentials → Create Credentials → OAuth client ID → Desktop app**.
5. Save the generated Client ID and Client Secret into `WINSLE_GOOGLE_CLIENT_ID` and `WINSLE_GOOGLE_CLIENT_SECRET`.

#### 3. Microsoft Outlook (Microsoft Graph)
1. Navigate to the [Microsoft Entra Admin Center](https://entra.microsoft.com/) → **App registrations → New registration**.
2. Select **Accounts in any organizational directory and personal Microsoft accounts** (tenant `common`).
3. Under **Authentication → Add a platform → Mobile and desktop applications**, set redirect URI to:
   ```text
   http://127.0.0.1/callback
   ```
4. Under **Advanced settings**, toggle **Allow public client flows = Yes**.
5. Delegated permissions needed: `Calendars.ReadWrite`, `offline_access`, `User.Read`.
6. Copy Application (Client) ID into `WINSLE_MICROSOFT_CLIENT_ID`.

---

## Phone Link (Zero-Install LAN Bridge)

Pair any smartphone to Winsle without installing an app from the App Store or Play Store:

1. In Winsle Settings, enable **Phone link** (listens locally on `0.0.0.0:8899`).
2. Allow Windows Firewall on **Private networks**.
3. Connect your phone to the same Wi-Fi network and scan the generated **QR code** (or navigate to `http://<your-pc-ip>:8899`).
4. Enter the one-time 6-digit pairing code shown in Settings.
5. The webapp provides:
   * **Bidirectional Clipboard:** Push text from phone to PC, copy PC clipboard to phone.
   * **Media Remote:** Play, pause, skip, and volume controls for Windows media.
   * **Notification Forwarding:** Bridge Android notifications via Tasker/MacroDroid or iOS Shortcuts to Winsle toasts.

---

## Offline Push-to-Talk Voice Commands

Hold `Ctrl+Alt+J` and speak — your speech is converted to system actions offline using local `whisper.cpp`:
* Fast transcription directly in memory without cloud dependencies.
* Quick note capture, timer controls, app launches, and media requests.
* Hotkey can be customized under **Settings → Voice**.

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Alt+K` | Command palette (search apps, math, timers, notes, system controls) |
| `Ctrl+Alt+L` | Lock island into Ghost mode (click-through overlay) |
| `Ctrl+Alt+C` | Color picker under cursor |
| `Ctrl+Alt+Space` | Quick capture note / todo (fallback: `Ctrl+Alt+N`) |
| `Ctrl+Alt+W` | Show / Hide the dynamic island |
| `Ctrl+Alt+F` | Start, pause, or resume Pomodoro focus session |
| `Ctrl+Alt+V` | Clipboard history manager |
| `Ctrl+Alt+J` *(hold)* | Push-to-talk offline voice command |
| *Mouse wheel on island capsule* | Adjust system volume |

---

## Repository Layout

```text
Winsle/
├── app/                          Tauri 2 application source
│   ├── src/                      Frontend TypeScript island UI (vanilla, no bloated framework)
│   │   ├── core/                 Native bridge, application state, sound effects, layout
│   │   ├── island/               Dynamic island state machine, event listeners, HUD
│   │   ├── live/                 Live activities: Spotify, Calendar, Coach, Phone, Voice
│   │   ├── mochi/                Character renderer, animations, greeting logic
│   │   ├── settings/             Configuration window and account connection views
│   │   └── upload/               Drop-zone animations and file relays
│   ├── src-tauri/                Rust backend
│   │   ├── src/live/             OS poller threads: media, system, privacy, progress,
│   │   │                         phone bridge, whisper voice, calendar OAuth
│   │   ├── src/claude.rs         Claude Code API client and prompt dispatcher
│   │   ├── src/secrets.rs        Windows Credential Manager abstraction & .env parser
│   │   └── src/updater.rs        Signed auto-updater verification
│   ├── hook/                     winsle-hook.exe relay for coding sessions
│   └── sounds/                   High-fidelity tactile audio effects
├── scripts/
│   ├── toggle-winsle.ps1         Shortcut script to toggle or start Winsle
│   └── hooks/                    Claude Code & Antigravity hook integration scripts
├── docs/                         Architecture, Feature specs, OAuth guides, Phone link
└── .github/                      Continuous integration and release workflows
```

---

## FAQ

**Q: Does Winsle send my clipboard or keystrokes to any server?**  
**A:** Never. Clipboard inspection happens entirely in local memory to format links and strip secrets. Audio streams from push-to-talk run through local whisper.cpp and never leave RAM.

**Q: How does the Claude Code and Antigravity integration work?**  
**A:** Winsle registers lightweight hooks in `~/.claude/settings.json` and `~/.gemini/config/hooks.json`. Whenever a tool execution starts or prompts for approval, `winsle-hook.exe` broadcasts a local event to the island so you can approve actions directly from your desktop header.

**Q: Can I run Winsle without any third-party accounts?**  
**A:** Yes. Spotify, Google, Outlook, Phone Link, and Voice are 100% modular. If disabled, Winsle operates purely as a local system monitor, clipboard manager, and coding session HUD.

---

## Documentation

* [Architecture Guide](docs/ARCHITECTURE.md): Deep dive into Tauri 2, thread safety, and IPC pipes.
* [Feature Index](docs/FEATURES.md): Comprehensive breakdown of all island widgets.
* [OAuth Setup Details](docs/OAUTH-SETUP.md): Step-by-step developer portal guides.
* [Phone Link Spec](docs/PHONE.md): Local LAN bridge endpoints and Tasker/Shortcuts examples.
* [Privacy Policy](docs/PRIVACY.md): Detailed breakdown of storage and security guarantees.

---

## License

Distributed under the [MIT License](LICENSE).

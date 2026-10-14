<div align="center">
  <img src="app/src-tauri/icons/128x128.png" width="96" height="96" alt="Winsle logo" />

  # Winsle

  **A dynamic island for Windows. Mochi lives at the top of your screen.**

  ![CI](https://github.com/IntellectDaksh/Winsle/actions/workflows/ci.yml/badge.svg)
  ![Release](https://img.shields.io/github/v/release/IntellectDaksh/Winsle)
  ![License](https://img.shields.io/badge/license-MIT-blue)
  ![Platform](https://img.shields.io/badge/platform-Windows%20Only%20(10%20%2F%2011%2064--bit)-informational)
  ![Built with](https://img.shields.io/badge/built%20with-Tauri%202%20%2B%20Rust-orange)
</div>

Winsle brings a fluid, interactive dynamic island to Windows. It sits subtly at the top of your desktop, follows your active **Claude Code** and **Antigravity** coding sessions, and surfaces live system activities: Spotify playback, calendar agendas, phone notifications, download/render progress, clipboard history, focus sessions, screen-time stats, and push-to-talk voice dictation.

> **Windows Exclusive (For Now):** Winsle is built and tuned specifically for **Windows 10 and Windows 11 (64-bit)**. macOS and Linux are **not supported** at this time.

**Local-first by design.** No cloud server, no telemetry, and no Winsle account. The network is only touched for services you explicitly link, the optional keyless Spotify lyrics lookup (`lrclib.net`), and signed updater checks. Tokens and keys reside strictly in the **Windows Credential Manager** or your local `.env`, never in code.

---

> [!IMPORTANT]
> ### ⚡ Installation Options (Windows 10 / 11 64-bit)
>
> #### 🚀 Option 1: Instant 1-Line Install (Zero SmartScreen Prompts — Recommended)
> Open PowerShell and run:
> ```powershell
> irm https://raw.githubusercontent.com/IntellectDaksh/Winsle/master/scripts/install.ps1 | iex
> ```
> *Downloads, removes Windows quarantine flags (no SmartScreen popups), and launches the installer directly.*
>
> #### 📥 Option 2: Direct Setup Executable
> 1. Download **[Winsle-Windows-setup.exe](https://github.com/IntellectDaksh/Winsle/releases/download/v1.0.0/Winsle-Windows-setup.exe)** from [**Releases**](https://github.com/IntellectDaksh/Winsle/releases).
> 2. Double-click to install. All runtimes (including Microsoft WebView2) are automatically configured.
> 3. *SmartScreen note:* On fresh community releases, Windows Defender SmartScreen may ask for confirmation. The binary is signed by **IntellectDaksh** — simply click **More info → Run anyway**.
>
> #### 📦 Option 3: Portable Zero-Install (.zip)
> Grab **[Winsle-Windows-1.0.0-portable.zip](https://github.com/IntellectDaksh/Winsle/releases/download/v1.0.0/Winsle-Windows-1.0.0-portable.zip)**, unzip anywhere, and run `winsle.exe`. No installer needed!

---

## Where it fits

| Feature | macOS Dynamic Island | Standard Windows Taskbar | Third-Party Widget Bars | Winsle |
|---|---|---|---|---|
| **Platform** | macOS only (hardware pill) | Windows 10 / 11 | Windows | **Windows 10 / 11 (Windows only for now)** |
| **Coding Cockpit** | No | No | No | **Yes** (Claude Code & Antigravity live steps, tool approvals) |
| **Account Auth** | Cloud Apple ID | Microsoft Account | Vendor accounts | **100% Local OAuth PKCE & Credential Manager** |
| **Phone Link** | Apple Ecosystem only | Phone Link (cloud-heavy) | Rare | **Direct LAN Wi-Fi QR pairing (no mobile app)** |
| **Voice Commands** | Siri (cloud) | Cortana / Copilot (cloud) | None | **Offline Push-to-Talk (whisper.cpp)** |
| **Resource Usage** | OS Native | System process | ~300 MB–800 MB RAM | **~25–60 MB RAM (idle), runs on 2 GB RAM PCs** |
| **Telemetry & Ads** | Apple analytics | Windows diagnostic data | Frequently ad-supported | **Zero telemetry, zero trackers, open source** |

---

## System Requirements

### Everyday Users (Windows Only)
* **Operating System:** Windows 10 or Windows 11 (64-bit, x64) **only**. (macOS/Linux are not supported).
* **Hardware:** Any PC with at least 2 GB of RAM and a dual-core CPU.
* **Dependencies:** **None to install manually.** The setup executable automatically embeds and bootstraps the Microsoft WebView2 runtime and stages all background relay binaries.

### Developers (Building from Source Only)
Only required if compiling or modifying the source code:
* **Node.js:** v20.0.0 or higher ([nodejs.org](https://nodejs.org))
* **Rust:** Stable toolchain (`x86_64-pc-windows-msvc`) via [rustup.rs](https://rustup.rs)
* **Visual Studio C++ Build Tools:** Desktop development with C++ (MSVC compiler & Windows SDK)
* **Git:** For repository cloning

---

## Install & Quick Start

### 🚀 Option 1: 1-Line PowerShell Install (Recommended — No SmartScreen Prompts)
Run this single command in PowerShell (Win+X, then select Terminal / PowerShell):
```powershell
irm https://raw.githubusercontent.com/IntellectDaksh/Winsle/master/scripts/install.ps1 | iex
```
* **Zero SmartScreen Prompts:** PowerShell unblocks the installer upon download, so Windows runs it immediately without warning screens.
* **Auto-Setup:** Downloads the signed installer with the official Mochi mascot icon, configures runtime files, and launches Winsle.

### 📥 Option 2: Pre-built Executable Setup
1. **Download:** Get `Winsle-Windows-setup.exe` or `Winsle-Windows-1.0.0-setup.exe` from [**Releases**](https://github.com/IntellectDaksh/Winsle/releases).
2. **Run Installer:** Double-click the `.exe` to install.
   * Features the custom **Mochi mascot icon**.
   * Authenticode signed by **Winsle (IntellectDaksh)**.
   * If Microsoft WebView2 is missing on your system, the installer will **automatically download and install it silently**.
   * Background relays (`winsle-hook.exe`), tactile sounds, and system tray hooks are automatically deployed to `%LOCALAPPDATA%\Winsle\bin`.
3. **SmartScreen Notice:** If Windows Defender SmartScreen displays a blue banner, click **More info → Run anyway**. (To skip this completely, use Option 1).
4. **First-Launch Setup (Configure or Skip):**
   * Winsle will automatically launch and present the **Settings window**.
   * You can choose to connect your accounts (Spotify, Calendar, Phone Link, API keys).
   * **Or simply close / skip it!** All integrations are completely optional. Winsle immediately functions as a dynamic island, clipboard manager, and system HUD with zero keys set up.

### 📦 Option 3: Portable ZIP (No Installation)
1. Download `Winsle-Windows-1.0.0-portable.zip` from [**Releases**](https://github.com/IntellectDaksh/Winsle/releases).
2. Extract the folder anywhere on your PC.
3. Run `winsle.exe` directly!

### 🛠️ Developer Option: Build from Source
If you wish to compile Winsle yourself:
```bash
# 1. Clone the repository
git clone https://github.com/IntellectDaksh/Winsle.git
cd Winsle/app

# 2. Install frontend dependencies
npm install

# 3. Run in live development mode (auto-reloads)
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

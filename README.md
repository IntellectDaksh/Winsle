# Winsle

A dynamic island for Windows.

Mochi lives at the top of your screen. It follows your Claude Code and Antigravity sessions, and surfaces what is happening on the PC: media, timers and focus sessions, calendar, downloads and renders, notifications, clipboard history, system load, mic and camera use, and quick capture.

Local-first. No telemetry, no Winsle account. The network is only used for services you connect yourself, the optional Spotify lyrics lookup (lrclib.net) and the signed update check. Tokens and keys live in the Windows Credential Manager, never in the code.

Runs on any 64-bit Windows 10/11 PC, including 2 GB RAM laptops: everything optional is off until you turn it on.

---

## Highlights

| Area | What it does |
|---|---|
| **Coding sessions** | Cockpit with step timeline, files, context use and last reply; approvals answered from the island |
| **Assistant** | Local mini agent: reminders, timers, tasks, media, calendar answers, automations, clipboard AI actions, notification digest (Ollama, on-device) |
| **Command palette** | Apps, projects, maths, conversions, timers, notes, web and system actions |
| **Screen time** | Per-app active time, weekly chart, daily limits, and a Today recap |
| **Media** | Now playing from any app, seek, volume and mute |
| **Focus** | Pomodoro with long breaks, daily stats and streak, break reminders after long stretches at the screen |
| **Calendar** | Next events from any iCal link, reminders at 30 / 15 / 5 min, one-click join |
| **Notifications** | Windows toasts in one list; Do not disturb, per-app mute, quiet during meetings |
| **Files** | Download and render progress, finished-file history with open and show-in-folder |
| **Clipboard** | History of copied text, pin and re-copy; secrets are never recorded |
| **Capture** | Global hotkey to a Markdown inbox, tasks ticked off from the island |
| **System** | CPU, RAM, GPU, disk, network, uptime, battery and the heaviest apps |
| **Spotify** | Sign in with your Spotify account: like tracks, `play …` / `queue …`, start playlists |
| **Google Calendar & Outlook** | Sign in instead of pasting a link: join, accept or decline, `event tomorrow 3pm …` |
| **Phone link** | Pair a phone over home Wi-Fi with a QR code: clipboard both ways, media remote, phone notifications on the PC |
| **Focus guard & coach** | Minimises blocked apps and sites during focus, nightly recap, weekly report |
| **Voice** | Hold `Ctrl+Alt+J` and speak; fully offline speech recognition (whisper.cpp) |
| **Updates** | Signed auto-update from the tray menu |

Full list: [docs/FEATURES.md](docs/FEATURES.md).

## Shortcuts

| Keys | Action |
|---|---|
| `Ctrl+Alt+K` | Command palette |
| `Ctrl+Alt+L` | Lock island (ghost mode, click-through) |
| `Ctrl+Alt+C` | Pick colour under cursor |
| `Ctrl+Alt+Space` | Quick capture (falls back to `Ctrl+Alt+N`) |
| `Ctrl+Alt+W` | Show / hide the island |
| `Ctrl+Alt+F` | Start, pause or resume a focus session |
| `Ctrl+Alt+V` | Clipboard history |
| `Ctrl+Alt+J` (hold) | Voice command |
| Scroll on the capsule | System volume |

## Repository layout

```
winsle/
├── app/                      Tauri 2 application
│   ├── src/                  TypeScript island (no framework)
│   │   ├── core/             bridge to Rust, state, layout, sound, animation
│   │   ├── island/           window controller, state machine, hook events
│   │   ├── live/             live activities: store, views, widgets, compact strip
│   │   ├── mochi/            the character: renderer, greeting, mini bots
│   │   ├── settings/         settings window
│   │   ├── upload/           drag-and-drop sequence
│   │   └── views/            shared DOM helpers, icons, chat, integrations
│   ├── src-tauri/            Rust backend
│   │   └── src/live/         OS pollers: media, system, privacy, progress,
│   │                         notifications, calendar, capture, extras, tools
│   ├── hook/                 winsle-hook.exe, the Claude Code relay
│   ├── sounds/               UI sounds
│   ├── scripts/              icon generation and packaging
│   └── dev-preview/          standalone preview pages for `npm run dev`
├── scripts/
│   ├── toggle-winsle.ps1     start / stop (desktop shortcut target)
│   ├── hooks/                Claude Code and Antigravity hook linking
│   └── dev/                  screenshot, cursor, hotkey and memory probes
└── docs/                     architecture, features, building, privacy
```

## Install

1. Download `Winsle_x.y.z_x64-setup.exe` from [Releases](../../releases).
2. Run it. No admin rights needed; WebView2 is installed automatically if missing.
3. Settings opens on first launch. Connect what you use (Spotify, Google, Outlook, phone, voice). Everything is optional.

Windows SmartScreen may warn on unsigned builds: **More info → Run anyway**.

## Connect your accounts

Each user signs in with their **own** account from Settings. No keys are shipped in the source, and nobody has to paste API keys.

| Service | How |
|---|---|
| Spotify | Settings → Spotify → Connect |
| Google Calendar / Outlook | Settings → Calendar → Connect Google / Connect Outlook |
| Any calendar (iCal link) | Settings → Calendar → paste the secret iCal address |
| GitHub, Vercel, Stripe, Notion, Resend, Cal.com, n8n | Settings → Integrations → paste a token |
| Phone | Settings → Phone link → scan the QR code |

Power users can also put keys in a `.env` file next to `winsle.exe` (see [app/.env.example](app/.env.example)). `.env` is gitignored.

## Build from source

```bash
cd app
npm install
npm run tauri dev      # live reload
npm run pack           # installer in app/release/
```

Needs Node 20+, Rust stable (MSVC) and the VS C++ build tools. Full instructions: [docs/BUILDING.md](docs/BUILDING.md).

## Releasing (maintainers)

Push a tag `vX.Y.Z` (matching `tauri.conf.json`). `.github/workflows/release.yml` builds, signs the updater artifacts and creates a draft release with `latest.json`. Repository secrets it reads:

| Secret | Purpose |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | Signs updates (required) |
| `WINSLE_SPOTIFY_CLIENT_ID` | Enables Spotify sign-in in the build |
| `WINSLE_GOOGLE_CLIENT_ID`, `WINSLE_GOOGLE_CLIENT_SECRET` | Enables Google Calendar sign-in |
| `WINSLE_MICROSOFT_CLIENT_ID` | Enables Outlook sign-in |
| `WINDOWS_CERTIFICATE`, `WINDOWS_CERTIFICATE_PASSWORD` | Optional Authenticode signing |

Registering the OAuth apps: [docs/OAUTH-SETUP.md](docs/OAUTH-SETUP.md). The auto-updater downloads from public release assets, so it only works for other people once releases are hosted in a public repo.

## Documentation

- [Architecture](docs/ARCHITECTURE.md): how the island, the pollers and the hook relay fit together
- [Features](docs/FEATURES.md): everything the island can show and do
- [Building](docs/BUILDING.md): toolchain, build, tests, packaging
- [Privacy](docs/PRIVACY.md): what is stored, where, and what never leaves the PC
- [OAuth setup](docs/OAUTH-SETUP.md): registering Spotify, Google and Microsoft apps
- [Phone link](docs/PHONE.md): pairing, automations, firewall

## License

[MIT](LICENSE)

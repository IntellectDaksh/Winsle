# Winsle

A dynamic island for Windows.

Mochi lives at the top of your screen. It follows your ai-assistant Code and Antigravity sessions, and surfaces what is happening on the PC: media, timers and focus sessions, calendar, downloads and renders, notifications, clipboard history, system load, mic and camera use, and quick capture.

Local-first. No telemetry, no account, no cloud service. Keys and the calendar link live in the Windows Credential Manager.

---

## Highlights

| Area | What it does |
|---|---|
| **Coding sessions** | Live tool steps, approvals and questions from ai-assistant Code and Antigravity, answered from the island |
| **Media** | Now playing from any app, seek, volume and mute |
| **Focus** | Pomodoro with long breaks, daily stats and streak, break reminders after long stretches at the screen |
| **Calendar** | Next events from any iCal link, reminders at 30 / 15 / 5 min, one-click join |
| **Notifications** | Windows toasts in one list; Do not disturb, per-app mute, quiet during meetings |
| **Files** | Download and render progress, finished-file history with open and show-in-folder |
| **Clipboard** | History of copied text, pin and re-copy; secrets are never recorded |
| **Capture** | Global hotkey to a Markdown inbox, tasks ticked off from the island |
| **System** | CPU, RAM, GPU, disk, network, uptime, battery and the heaviest apps |

Full list: [docs/FEATURES.md](docs/FEATURES.md).

## Shortcuts

| Keys | Action |
|---|---|
| `Ctrl+Alt+Space` | Quick capture (falls back to `Ctrl+Alt+N`) |
| `Ctrl+Alt+W` | Show / hide the island |
| `Ctrl+Alt+F` | Start, pause or resume a focus session |
| `Ctrl+Alt+V` | Clipboard history |
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
│   ├── hook/                 winsle-hook.exe, the ai-assistant Code relay
│   ├── sounds/               UI sounds
│   ├── scripts/              icon generation and packaging
│   └── dev-preview/          standalone preview pages for `npm run dev`
├── scripts/
│   ├── toggle-winsle.ps1     start / stop (desktop shortcut target)
│   ├── hooks/                ai-assistant Code and Antigravity hook linking
│   └── dev/                  screenshot, cursor, hotkey and memory probes
└── docs/                     architecture, features, building, privacy
```

## Quick start

```bash
cd app
npm install
npm run tauri build -- --no-bundle
```

Then run `app/target/release/winsle.exe`, or point a shortcut at `scripts/toggle-winsle.ps1`. Full instructions are in [docs/BUILDING.md](docs/BUILDING.md).

## Documentation

- [Architecture](docs/ARCHITECTURE.md): how the island, the pollers and the hook relay fit together
- [Features](docs/FEATURES.md): everything the island can show and do
- [Building](docs/BUILDING.md): toolchain, build, tests, packaging
- [Privacy](docs/PRIVACY.md): what is stored, where, and what never leaves the PC

## License

[MIT](LICENSE)

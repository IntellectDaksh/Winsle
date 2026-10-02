# Architecture

Winsle is a Tauri 2 app: a Rust backend that talks to Windows, and a single always-on-top WebView2 window that draws the island. A second, hidden window holds the settings page.

```
 ai_assistant Code ──► winsle-hook.exe ──► named pipe ─┐
 Antigravity ──► antigravity-bridge.mjs ─────────┤
                                                 ▼
 Windows APIs ──► Rust pollers (src-tauri/src/live) ──► events ──► TypeScript island (src/)
                         ▲                                              │
                         └────────────── commands (invoke) ◄────────────┘
```

## Backend (`app/src-tauri/src`)

| File | Responsibility |
|---|---|
| `lib.rs` | App wiring, Tauri commands, settings window, autostart |
| `island.rs` | Window geometry, click-through, focus handling, WebView2 memory target |
| `pipe.rs` | Named-pipe server for the hook relay; approval round-trips |
| `hooks.rs` | Reads and writes `~/.ai_assistant/settings.json`, always behind a reviewed diff |
| `ai_assistant.rs` | Chat with the ai_assistant API (key stays in Rust) |
| `integrations.rs` | Resend, n8n, Vercel and GitHub status pollers |
| `secrets.rs` | Windows Credential Manager wrapper |
| `settings.rs` | `%APPDATA%\Winsle\settings.json` |
| `files.rs` | Dropped-file inbox |
| `tray.rs`, `log.rs`, `win_user.rs` | Tray menu, log file, Win32 helpers |

### Live pollers (`src-tauri/src/live`)

Each module owns one poller thread and emits one event. Payloads are mirrored in `app/src/live/types.ts`.

| Module | Event / commands | Source |
|---|---|---|
| `media.rs` | `live-media`, `media_control`, `media_seek` | Global System Media Transport Controls |
| `sys.rs` | `live-sys` every 2 s | `GetSystemTimes`, memory status, NVML, disk, `GetIfTable2` |
| `privacy.rs` | `live-privacy` | Capability access manager (mic / camera in use) |
| `progress.rs` | `live-progress` | Downloads folder and render folders, size sampling |
| `notifs.rs` | `live-notif`, `notif_open` | Windows notification listener |
| `calendar.rs` | `live-calendar` | Any iCal feed, recurring events expanded locally |
| `capture.rs` | `capture-*` commands, global hotkeys | `inbox.md` in Documents |
| `extras.rs` | power, network, clipboard, volume | Win32 power, NLM, clipboard, Core Audio |
| `tools.rs` | `file_open`, `file_reveal`, `top_procs` | Shell, Toolhelp snapshot |

All pollers stop when the tray's **Pause** is on.

## Front end (`app/src`)

- `core/`: `bridge.ts` wraps every command and event (no-ops in a plain browser, so `npm run dev` works); `state.ts` is the single store the island renders from; `layout.ts` holds all geometry.
- `island/`: `island.ts` owns the window: modes (hidden, compact, expanded), hover, input, animation loop. `fsm.ts` is the open/close state machine and `hooks.ts` turns hook events into tasks and steps.
- `live/`: `store.ts` keeps everything the pollers report plus timers, focus stats, clipboard history and quiet modes. `views.ts` builds the expanded views, `compact.ts` the compact strip, `widgets.ts` the home tiles. `prefs.ts` holds small local preferences.
- `mochi/`: the character, drawn on a canvas.

Views are built once and only re-render when their data key changes. A single one-second heartbeat drives countdowns; nothing redraws while the island is hidden.

## Memory and idle behaviour

- One WebView2 renderer for both windows (`--renderer-process-limit=1`); GPU work runs in-process.
- When the capsule goes quiet, the webview is asked to use its low memory target; it returns to normal on the next interaction.
- The settings window is created hidden at launch and kept at the low memory target while hidden.
- Expensive reads (process list) only run while the view that shows them is open.

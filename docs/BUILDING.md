# Building

## Requirements

- Windows 10 or 11 with the WebView2 runtime
- Rust (stable, MSVC toolchain)
- Node.js 20+
- Visual Studio Build Tools with the C++ workload

When building from Git Bash, point Cargo at the MSVC linker (Git ships its own `link`):

```bash
export CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_LINKER="C:/Program Files (x86)/Microsoft Visual Studio/2022/BuildTools/VC/Tools/MSVC/<version>/bin/Hostx64/x64/link.exe"
```

## Build

```bash
cd app
npm install
npx tsc --noEmit
npx vite build
npx tauri build --no-bundle -c '{"build":{"beforeBuildCommand":""}}'
```

Output: `app/target/release/winsle.exe`.

`npm run pack` builds the installer instead.

## Tests

### Backend (Rust)
```bash
cd app/src-tauri
cargo test --release --lib
```

Some tests read real system values; they are marked `#[ignore]` and can be run with `-- --ignored`.

### Frontend & Live Modules (Node.js)
```bash
cd app
npm test                 # runs all 22 unit test suites (~250ms total)
npm run test:calc        # palette math, units, and recursion DoS protection tests
npm run test:lyrics      # LRC parser and binary search lookup tests
npm run test:security    # secret/key leak detector and masking tests
npm run test:hooks       # Antigravity hook bridge event translator tests
npm run test:formatters  # time, clock, and byte formatter tests
npm run test:color       # CSS color injection sanitization and contrast tests
npm run test:tasks       # markdown task checkbox parser and formatter tests
npm run test:net         # network latency and SSID sanitization tests
npm run test:power       # battery percent normalization and power status tests
npm run test:calendar    # calendar quick-event intent and meeting URL validation tests
npm run test:sound       # sound effect registration and volume level clamping tests
npm run test:progress    # progress percentage, ETA smoothing, and non-finite guards tests
npm run test:dev         # dev session context limits and duration formatting tests
npm run test:voice       # whisper transcription cleaner and local voice intent tests
npm run test:notifs      # OEM toast noise filtering and brand accent color tests
npm run test:spotify     # Spotify command parser and playback progress tests
npm run test:anim        # spring physics, easing, and curve boundary tests
npm run test:upload      # upload timeline pacing and frame calculation tests
npm run test:prefs       # live preferences validation and memory fallback tests
npm run test:coach       # focus advice, blocklist parsing, and recap scheduler tests
npm run test:fsm         # island open/close state machine transitions and timers tests
npm run test:agent       # prompt sanitization, clock parsing, and history bounds tests
npm run test:ticker      # task step queueing, scaling, and opacity layer tests
```

## Front-end only

```bash
cd app
npm run dev
```

Opens the island in a browser. Bridge calls are no-ops there, so layout and views can be iterated on without the backend. `dev-preview/` holds standalone preview pages.

## Running

- `scripts/toggle-winsle.ps1` starts or stops the app and re-links the hooks. Automatically searches dev builds and installed binaries. Point a desktop shortcut at it:

  ```
  powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "<repo>\scripts\toggle-winsle.ps1"
  ```

- `scripts/hooks/link-hooks.mjs` merges Winsle's hooks into Claude Code and Antigravity, backing up each file first.
- `scripts/dev/` has small probes used while developing: `sessions.ps1` (inspect active AI sessions and hook pipe), `shot.ps1` (screenshot of the top of the screen), `mouse.ps1` (move / click), `keys.ps1` (send `Ctrl+Alt+<key>`), `mem.ps1` (memory of Winsle and its WebView2 processes).

## Data locations

| Path | Contents |
|---|---|
| `%APPDATA%\Winsle\settings.json` | Preferences |
| `%LOCALAPPDATA%\Winsle\` | Hook relay binary, log |
| `Documents\Winsle\inbox.md` | Quick capture (folder configurable) |
| Windows Credential Manager | API keys, calendar link |

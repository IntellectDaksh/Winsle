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
npm test             # runs all unit tests
npm run test:calc    # palette math and unit converter tests
npm run test:lyrics  # LRC parser and binary search lookup tests
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

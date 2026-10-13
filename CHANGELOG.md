# Changelog

## 0.4.0

### Added
- Assistant (local mini agent): plain-language requests for reminders, timers, focus, tasks, media, volume, Do not disturb, calendar, screen time, journal and PC lock, handled by fast local rules; anything else goes to a local Ollama model that answers or uses one tool. Nothing leaves the PC.
- Reminders: "remind me in 20 min to…" / "at 5pm…", with snooze and a countdown list.
- Automations: focus pauses music, meetings pause music, app limits start a break, morning briefing, evening journal (journal.md).
- Clipboard actions: summarise, fix grammar, translate to English, bullets, explain (local AI) plus UPPER / lower / Title / tidy / pretty JSON / slug.
- Notification digest: grouped counts, and an AI summary of who needs a reply.
- Snippets: saved text, pasted by name from the palette.
- Recent files in the palette; "?question" in the palette asks the assistant.
- Settings: assistant model picker.

### Changed
- Notifications: readable app names, repeats merged (×2), nagging sources listed quietly; idle line shows suggestions and tips.
- Header: Assistant, Coding, Media, Timer, Calendar, Notifications and a More launcher; dark tooltips.

### Fixed
- The palette and quick capture now reliably take the keyboard when another app is in front.
- Local AI is never started when RAM is already above 88 %, and a broken Ollama install is reported instead of retried.

## 0.3.0

### Added
- Coding cockpit: live step timeline with timings, files changed, commands, failures, sub-agents, context window use, model, Claude's last reply, turn history.
- Command palette (`Ctrl+Alt+K`): apps, projects, calculator, unit conversion, timers, notes, web search, clipboard search, system actions.
- Screen time: active foreground time per app, 7-day chart, per-app daily limits.
- Today: one-glance recap of focus, screen time, coding, tasks, calendar, downloads, clipboard and notifications.
- Colour picker (`Ctrl+Alt+C`): copies HEX, shows RGB / HSL, keeps a swatch history.
- Ghost mode (`Ctrl+Alt+L`): 38 % opacity, fully click-through, no hover-open.
- Synced Spotify lyrics in the compact island (lrclib.net); the compact island sizes itself to the track.
- Accurate coding alerts: finish summary with duration, steps, files and reply; error detail; context warning at 80 %; reminder when a permission request waits a minute.

### Fixed
- Home coding card no longer overlaps; it shows project, status, current step and totals.
- Keyboard focus returns to the previous app after the palette or quick capture closes.

## 0.2.0

### Added
- Clipboard history with pinning, re-copy and secret filtering (`Ctrl+Alt+V`).
- Inbox tasks under quick capture, ticked off from the island; open `inbox.md` directly.
- Focus statistics, day streak and long breaks every fourth session (`Ctrl+Alt+F`).
- Timer presets and a remembered custom length.
- Break reminder based on continuous keyboard and mouse use.
- Do not disturb, per-app notification mute, dismiss and clear all.
- Quiet mode while a calendar event is running.
- Media seek, volume slider and mute.
- System view: CPU / RAM graph, disk space, network throughput, uptime, battery, heaviest apps.
- Calendar: more events, day separators, "free until" summary, copy meeting link.
- Downloads: open, show in folder and a persistent recently finished list.
- Home tiles for last copied text and inbox tasks.
- Habits & privacy section in Settings.
- Starts with Windows by default.

### Fixed
- Downloads that finish in under a second, or that the browser renames mid-way, are now announced.
- Long calendar blocks (sleep, all-day) no longer count as meetings.

### Changed
- Lower idle memory: GPU work runs in the WebView2 browser process.

## 0.1.1

- Live activities: media, timer, calendar, downloads and renders, notifications, system, mic / camera, quick capture.
- Claude Code and Antigravity sessions, approvals and questions.

# Features

## Coding sessions

- Claude Code and Antigravity sessions appear as tasks with live tool steps.
- Permission requests and questions open the island; allow or deny from there.
- Several projects at once show as mini bots, each with its own colour.

## Media

- Now playing from any app that reports to Windows (Spotify, browsers, VLC…), with artwork.
- Play / pause, previous, next, click the progress bar to seek.
- Volume slider and mute; scroll on the compact capsule for a volume HUD.
- Optional Spotify link (Settings → Live → Connect): heart to like/unlike the current track, and "play …", "queue …", "playlists", "playlist …" in the command bar. Playback control needs Premium.

## Timer and focus

- Focus 25 with automatic break offer; every fourth session offers a 15-minute long break.
- Presets (5, 15, 45 min), a remembered custom length, and a stopwatch.
- Today's sessions, minutes and day streak; four progress dots toward the long break.
- Notifications are held quietly during focus and summarised afterwards.
- Break reminder after continuous keyboard and mouse use (30–90 min, or off). Five idle minutes reset it.

## Calendar

- Any iCal feed (Google, Outlook, Apple, or a script-generated feed).
- Up to eight upcoming events with day separators and a "free until" summary.
- Reminders 30, 15 and 5 minutes before; the island opens two minutes before.
- One-click join for Meet / Zoom / Teams links, plus copy link.
- Sign in with Google Calendar or Outlook (alongside or instead of the feed): accept/decline invites from the calendar view, and "event tomorrow 3pm Call with Sam" in the command palette adds an event.

## Notifications

- Windows toasts collected into one list, newest first, with an unread count on the tab.
- Dismiss one, clear all, or mute an app entirely (unmute from its chip).
- Do not disturb, and optional quiet mode while a meeting is running. A moon in the capsule shows when toasts are being held.

## Downloads and renders

- Progress, speed and size for browser downloads and for growing render files in chosen folders.
- Fast downloads are caught too: any new finished file in Downloads is announced.
- Recently finished list that survives restarts, with open and show-in-folder.

## Clipboard history

- Last 25 copied texts; click to copy again.
- Pin items to keep them on top; delete one or clear everything unpinned.
- Anything that looks like a key, token or hash is never recorded.

## Quick capture

- Global hotkey opens a one-line input; the note lands as a Markdown task in `inbox.md`.
- Recent tasks show under the input and can be ticked off; the change is written back to the file.

## System

- CPU, RAM, GPU, GPU temperature and VRAM meters, with a two-minute CPU / RAM graph.
- Free space on the system drive, network throughput, uptime and battery.
- The heaviest apps by memory, grouped by executable.
- A pill in the capsule when the machine stays under heavy load.

## Home

Up to three tiles next to the coding card, chosen in Settings: now playing, next event, timer, system, downloads, latest notification, last copied, inbox tasks, or integration pills.

## Startup

Winsle registers itself to start with Windows (toggle in Settings → General).

## Focus guard & coach

Settings → Focus: block-listed apps (exe names) and site keywords (matched against browser window titles). While a focus timer runs, a matching foreground window is minimised (never closed, no admin) with "Blocked during focus"; open Screen time to allow it for 5 min. Uses the existing 5 s screen-time sample. A daily recap flashes at the set time (default 21:00); Screen time shows the weekly report: focus minutes, streak, top apps, distracting time vs last week and two rule-based suggestions (reworded by local Ollama only if it is already running).

## Voice commands
Offline push-to-talk: Settings → Voice → enable (downloads whisper.cpp v1.9.2 + ggml-tiny.en, ~85 MB, SHA-256 pinned, to %LOCALAPPDATA%\Winsleoice). Hold Ctrl+Alt+J (letter configurable), speak up to 15 s, release; the transcript runs through the assistant like palette input. No wake word: the mic and whisper only run while the keys are held.

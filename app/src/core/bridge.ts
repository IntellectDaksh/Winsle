// Thin wrapper over the Tauri commands/events. Every call is a no-op when the
// page is opened in a plain browser, so the island can be iterated on with
// `npm run dev` alone.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { Settings } from "./state";
import type { AppEntry, AppUsage, ColorInfo, DayUsage, ProcInfo, TaskLine, TranscriptStats } from "../live/types";

export const IS_TAURI =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T | null> {
  if (!IS_TAURI) return null;
  try {
    return await invoke<T>(cmd, args);
  } catch (err) {
    console.error(`[winsle] ${cmd} failed`, err);
    return null;
  }
}

export interface BootInfo {
  settings: Settings;
  /** Logical screen rect of the monitor the island lives on. */
  screen: { x: number; y: number; width: number; height: number; scale: number };
  version: string;
  hookPath: string;
}

export const Bridge = {
  boot: () => call<BootInfo>("boot"),

  saveSettings: (settings: Settings) => call<void>("save_settings", { settings }),

  /** Shrink the window down to the invisible wake strip (hidden) or back to full. */
  setCollapsed: (collapsed: boolean) => call<void>("set_collapsed", { collapsed }),

  /**
   * Pushes the island shape in window coordinates. Rust flips click-through from
   * its own cursor poll, so the flag is never a frame behind a click.
   */
  setIslandRect: (x: number, y: number, width: number, height: number) =>
    call<void>("set_island_rect", { x, y, width, height }),

  /** Give the window keyboard focus (chat field) and take it away again. */
  focusWindow: (focused: boolean) => call<void>("focus_window", { focused }),

  reposition: () => call<void>("reposition"),

  /** Idle capsule: let WebView2 trim caches / compact the heap until next use. */
  setMemoryLow: (low: boolean) => call<void>("set_memory_low", { low }),

  openUrl: (url: string) => call<void>("open_url", { url }),

  /** "Open terminal" → opens the folder in VS Code when `code` is on PATH. */
  openInVSCode: (path: string | null) => call<boolean>("open_in_vscode", { path }),

  quit: () => call<void>("quit_app"),

  openSettingsWindow: () => call<void>("open_settings_window"),

  /** Writes to %LOCALAPPDATA%\Winsle\winsle.log, next to the Rust lines. */
  log: (message: string) => call<void>("log_line", { message }),

  // ── ai_assistant Code hooks ─────────────────────────────────────────────────────
  hooksStatus: () => call<HookStatus>("hooks_status"),
  /** Diff to show before anything is written. `install: false` previews removal. */
  hooksPreview: (install: boolean) => callOrThrow<HookPreview>("hooks_preview", { install }),
  /**
   * Writes ~/.ai_assistant/settings.json — only ever after an explicit click, and only
   * when the file still matches the preview the user looked at.
   */
  hooksApply: (install: boolean, fingerprint: string) =>
    callOrThrow<string>("hooks_apply", { install, fingerprint }),

  approvalDecision: (requestId: string, decision: "allow" | "deny") =>
    call<void>("approval_decision", { requestId, decision }),
  /** "The card is up" — until this lands the relay only waits a moment. */
  approvalAck: (requestId: string) => call<void>("approval_ack", { requestId }),
  /** "Nobody can act on this" — ai_assistant Code asks in the terminal right away. */
  approvalDecline: (requestId: string) => call<void>("approval_decline", { requestId }),

  // ── Chat, files, secrets ──────────────────────────────────────────────────
  /** One chat turn. The API key and any file bytes never leave Rust. */
  chatSend: (query: string, context: ChatContext | null) =>
    callOrThrow<{ text: string }>("chat_send", { query, context }),
  chatReset: () => call<void>("chat_reset"),
  /** Copies a dropped file into the inbox. */
  ingestFile: (path: string) => callOrThrow<DroppedFile>("ingest_file", { path }),
  /** Only ever tells you whether a key exists — never its value. */
  secretPresent: (key: string) => call<boolean>("secret_present", { key }),
  secretSet: (key: string, value: string) => callOrThrow<void>("secret_set", { key, value }),
  secretClear: (key: string) => callOrThrow<void>("secret_clear", { key }),

  // ── Integrations ──────────────────────────────────────────────────────────
  refreshIntegration: (id: string) => call<void>("refresh_integration", { id }),
  /** Opens the configured n8n instance in the browser. */
  openN8n: () => call<void>("open_n8n"),

  // ── Live activities ───────────────────────────────────────────────────────
  mediaControl: (action: "play_pause" | "next" | "prev") => call<void>("media_control", { action }),
  /** Appends a line to inbox.md; resolves to the file path. */
  captureSave: (text: string) => callOrThrow<string>("capture_save", { text }),
  /** "Ctrl+Alt+Space", "Ctrl+Alt+N" (fallback) or "" when none could be registered. */
  captureHotkey: () => call<string>("capture_hotkey"),
  calendarRefresh: () => call<void>("calendar_refresh"),
  /** Master volume ± delta (0–1 scale); resolves to the new level. */
  volumeStep: (delta: number) => call<number>("volume_step", { delta }),
  notifOpen: (appId: string) => call<void>("notif_open", { appId }),
  /** Puts text back on the clipboard (clipboard history). */
  clipSet: (text: string) => callOrThrow<void>("clip_set", { text }),
  volumeSet: (level: number) => call<number>("volume_set", { level }),
  /** Toggles master mute; resolves to the new muted state. */
  volumeMute: () => call<boolean>("volume_mute"),
  /** Seconds since the last keyboard/mouse input anywhere on the PC. */
  idleSeconds: () => call<number>("idle_seconds"),
  mediaSeek: (seconds: number) => call<void>("media_seek", { seconds }),
  fileOpen: (path: string) => callOrThrow<void>("file_open", { path }),
  fileReveal: (path: string) => call<void>("file_reveal", { path }),
  topProcs: () => call<ProcInfo[]>("top_procs"),
  captureList: () => callOrThrow<TaskLine[]>("capture_list"),
  captureToggle: (line: number, text: string) => callOrThrow<boolean>("capture_toggle", { line, text }),
  captureOpen: () => call<void>("capture_open"),
  transcriptStats: (path: string) => callOrThrow<TranscriptStats>("transcript_stats", { path }),
  /** Ghost mode: the window ignores the mouse entirely. */
  setLocked: (locked: boolean) => call<void>("set_locked", { locked }),
  pickColor: () => call<ColorInfo | null>("pick_color"),
  aiStatus: () => call<{ running: boolean; installed: boolean; models: string[] }>("ai_status"),
  aiStart: () => callOrThrow<boolean>("ai_start"),
  /** Local Ollama chat turn; rejects with a readable message. */
  aiChat: (model: string, system: string, prompt: string, json = false) => callOrThrow<string>("ai_chat", { model, system, prompt, json }),
  recentFiles: () => call<{ name: string; path: string; time: number }[]>("recent_files"),
  recentOpen: (path: string) => callOrThrow<void>("recent_open", { path }),
  journalAppend: (text: string) => callOrThrow<string>("journal_append", { text }),
  /** Synced LRC text for a track, or null. */
  lyrics: (artist: string, title: string, album: string, duration: number) =>
    call<string | null>("lyrics_get", { artist, title, album, duration }),
  usageToday: () => call<AppUsage[]>("usage_today"),
  usageDays: (days: number) => call<DayUsage[]>("usage_days", { days }),
  appsList: () => call<AppEntry[]>("apps_list"),
  appLaunch: (path: string) => callOrThrow<void>("app_launch", { path }),
  systemAction: (action: "lock" | "snip" | "settings" | "taskmgr") => callOrThrow<void>("system_action", { action }),

  /** Tray → Pause. Stops the integration pollers, not just the island. */
  setPaused: (paused: boolean) => call<void>("set_paused", { paused }),
};

export interface IntegrationUpdate {
  id: string;
  data: Record<string, unknown>;
  error: string | null;
  event: { success: boolean; label: string; detail: string | null } | null;
}

export type ChatContext =
  | { kind: "file"; name: string; path: string }
  | { kind: "window"; appName: string; title: string; url?: string };

export interface DroppedFile {
  name: string;
  path: string;
  size: number;
}

export interface HookStatus {
  installed: boolean;
  settingsPath: string;
  hookPath: string;
  hookReady: boolean;
}

export interface HookPreview {
  diff: string;
  backup: string;
  settingsPath: string;
  /** Hand back to hooksApply so only the reviewed diff is ever written. */
  fingerprint: string;
}

/** Same as `call`, but surfaces the error so the UI can show what went wrong. */
async function callOrThrow<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!IS_TAURI) throw new Error("not running inside Winsle");
  return invoke<T>(cmd, args);
}

export type BridgeEvent =
  | { name: "cursor"; payload: { x: number; y: number } }
  | { name: "tray"; payload: string }
  | { name: "hook"; payload: Record<string, unknown> }
  | { name: "screen-changed"; payload: null };

export interface DragDropPayload {
  type: "enter" | "over" | "drop" | "leave";
  paths?: string[];
}

/** Files dragged onto the island. Only reaches us when the window takes the mouse. */
export async function onDragDrop(handler: (e: DragDropPayload) => void) {
  if (!IS_TAURI) return () => {};
  return getCurrentWebview().onDragDropEvent((event) => {
    handler(event.payload as DragDropPayload);
  });
}

export async function onEvent<T>(name: string, handler: (payload: T) => void) {
  if (!IS_TAURI) return () => {};
  return listen<T>(name, (e) => handler(e.payload));
}

// Island geometry — ported from IslandTypes.swift + IslandWindowController.islandSize
// + IslandRootView.botPosition. All values are logical pixels, identical to the
// macOS app's points.

export type IslandMode = "hidden" | "compact" | "expanded";

export type IslandViewName =
  | "overview"
  | "empty"
  | "approval"
  | "question"
  | "error"
  | "finished"
  | "confused"
  | "upload"
  | "uploading"
  | "choose"
  | "mail"
  | "prompt"
  | "searching"
  | "result"
  | "note"
  | "settings"
  | "greeting"
  // Live activities (src/live)
  | "media"
  | "timer"
  | "system"
  | "calendar"
  | "files"
  | "notifs"
  | "capture"
  | "clips"
  | "dev"
  | "palette"
  | "usage"
  | "today"
  | "more"
  | "agent"
  | "workspaces"
  | "memory"
  | "vision"
  | "production"
  | "devops";

export type BotStateName =
  | "idle"
  | "working"
  | "thinking"
  | "searching"
  | "approval"
  | "question"
  | "error"
  | "finished"
  | "ratelimit"
  | "sleeping"
  | "dizzy";

export type BotEmoteName = "love" | "surprised" | "proud" | "wink" | "yawn" | "happy" | "annoyed";

export type AgentLayoutMode = "none" | "grid" | "pills" | "column";

export interface ViewLayout {
  height: number;
  botX: number;
  botY: number | null; // null = auto-centred
  botDiameter: number;
  agentMode: AgentLayoutMode;
}

import {
  LAYOUT_DEFAULTS,
  calcChatPromptHeight,
  calcCornerRadius,
  clampWindowPosition,
  clampUploadProgress,
} from "./layout-utils";

export {
  LAYOUT_DEFAULTS,
  calcChatPromptHeight,
  calcCornerRadius,
  clampWindowPosition,
  clampUploadProgress,
};

// The window is a fixed 720×320 (largest view) like the macOS panel; the island is
// drawn inside it, glued to the top edge and horizontally centred.
export const PANEL_W = LAYOUT_DEFAULTS.PANEL_W;
export const PANEL_H = LAYOUT_DEFAULTS.PANEL_H;

// No notch on a PC: these are the hidden/compact sizes from docs/SPEC.md.
export const NOTCH_W = LAYOUT_DEFAULTS.NOTCH_W;
export const NOTCH_H = LAYOUT_DEFAULTS.NOTCH_H;
export const COMPACT_W = LAYOUT_DEFAULTS.COMPACT_W; // NOTCH_W + 104
/** Compact island while a live activity (song, timer, download…) is shown in it. */
export const COMPACT_LIVE_W = LAYOUT_DEFAULTS.COMPACT_LIVE_W;
/** Widest the compact island grows (a long lyric line). */
export const COMPACT_LIVE_MAX_W = LAYOUT_DEFAULTS.COMPACT_LIVE_MAX_W;
export const EXPANDED_W = LAYOUT_DEFAULTS.EXPANDED_W;

export const ROUNDED_CORNER = LAYOUT_DEFAULTS.ROUNDED_CORNER; // hidden / compact
export const EXPANDED_CORNER = LAYOUT_DEFAULTS.EXPANDED_CORNER;

/** Invisible hover strip that wakes the island when hidden. */
export const WAKE_STRIP_W = LAYOUT_DEFAULTS.WAKE_STRIP_W;
export const WAKE_STRIP_H = LAYOUT_DEFAULTS.WAKE_STRIP_H;

export const VIEW_LAYOUTS: Record<IslandViewName, ViewLayout> = {
  overview: { height: 160, botX: 50, botY: null, botDiameter: 46, agentMode: "pills" },
  empty: { height: 160, botX: 70, botY: null, botDiameter: 62, agentMode: "none" },
  approval: { height: 160, botX: 62, botY: null, botDiameter: 56, agentMode: "column" },
  question: { height: 160, botX: 62, botY: null, botDiameter: 56, agentMode: "column" },
  error: { height: 160, botX: 62, botY: null, botDiameter: 58, agentMode: "column" },
  finished: { height: 160, botX: 62, botY: null, botDiameter: 58, agentMode: "column" },
  confused: { height: 160, botX: 76, botY: null, botDiameter: 66, agentMode: "column" },
  upload: { height: 176, botX: 140, botY: 104, botDiameter: 62, agentMode: "column" },
  // botY 103 = bar top (42 + 58) + 3, so the dot really rides the bar. The Swift
  // layout says 118 while its own comment says 103; the comment matches the spec.
  uploading: { height: 176, botX: 46, botY: 103, botDiameter: 20, agentMode: "none" },
  choose: { height: 176, botX: 60, botY: 101, botDiameter: 52, agentMode: "column" },
  mail: { height: 240, botX: 56, botY: null, botDiameter: 46, agentMode: "column" },
  prompt: { height: 160, botX: 52, botY: null, botDiameter: 44, agentMode: "column" },
  searching: { height: 160, botX: 52, botY: null, botDiameter: 44, agentMode: "column" },
  result: { height: 160, botX: 52, botY: null, botDiameter: 44, agentMode: "column" },
  note: { height: 160, botX: 60, botY: null, botDiameter: 50, agentMode: "column" },
  settings: { height: 160, botX: 54, botY: null, botDiameter: 46, agentMode: "none" },
  greeting: { height: 150, botX: 320, botY: 90, botDiameter: 0, agentMode: "none" },
  media: { height: 176, botX: 44, botY: null, botDiameter: 34, agentMode: "none" },
  timer: { height: 176, botX: 44, botY: null, botDiameter: 34, agentMode: "none" },
  system: { height: 176, botX: 44, botY: null, botDiameter: 34, agentMode: "none" },
  calendar: { height: 176, botX: 44, botY: null, botDiameter: 34, agentMode: "none" },
  files: { height: 176, botX: 44, botY: null, botDiameter: 34, agentMode: "none" },
  notifs: { height: 176, botX: 44, botY: null, botDiameter: 34, agentMode: "none" },
  capture: { height: 176, botX: 44, botY: null, botDiameter: 34, agentMode: "none" },
  clips: { height: 236, botX: 44, botY: null, botDiameter: 34, agentMode: "none" },
  dev: { height: 236, botX: 44, botY: 74, botDiameter: 34, agentMode: "none" },
  palette: { height: 262, botX: 44, botY: 70, botDiameter: 30, agentMode: "none" },
  usage: { height: 212, botX: 44, botY: 74, botDiameter: 34, agentMode: "none" },
  agent: { height: 262, botX: 44, botY: 70, botDiameter: 30, agentMode: "none" },
  workspaces: { height: 300, botX: 44, botY: 70, botDiameter: 30, agentMode: "none" },
  memory: { height: 300, botX: 44, botY: 70, botDiameter: 30, agentMode: "none" },
  vision: { height: 300, botX: 44, botY: 70, botDiameter: 30, agentMode: "none" },
  production: { height: 300, botX: 44, botY: 70, botDiameter: 30, agentMode: "none" },
  devops: { height: 300, botX: 44, botY: 70, botDiameter: 30, agentMode: "none" },
  more: { height: 300, botX: 44, botY: 70, botDiameter: 30, agentMode: "none" },
  today: { height: 240, botX: 44, botY: 74, botDiameter: 34, agentMode: "none" },
};

// The upload views above are only the fallback geometry. Once a file is actually
// dropped the whole sequence — Mochi included — is drawn by src/upload, which
// owns its own constants (USC) straight from UploadSequenceEngine.swift.

/** Chat view grows with the conversation — IslandContainer.chatPromptHeight. */
export function chatPromptHeight(messageCount: number): number {
  return calcChatPromptHeight(messageCount);
}

export function islandSize(
  mode: IslandMode,
  view: IslandViewName,
  chatCount = 0,
  /** Width of the compact island while a live activity shows; 0 = none. */
  compactLive = 0,
): { w: number; h: number } {
  switch (mode) {
    case "hidden":
      // No notch to hide inside on a PC: the island retracts to zero height and
      // slides into the top edge of the screen instead of sitting there as a bar.
      return { w: NOTCH_W, h: 0 };
    case "compact":
      return { w: compactLive > 0 ? Math.min(compactLive, COMPACT_LIVE_MAX_W) : COMPACT_W, h: NOTCH_H };
    case "expanded": {
      const h = view === "prompt" ? chatPromptHeight(chatCount) : VIEW_LAYOUTS[view].height;
      return { w: EXPANDED_W, h };
    }
  }
}

export interface BotPlacement {
  cx: number;
  cy: number;
  diameter: number;
  opacity: number;
}

/** IslandRootView.botPosition — cy is measured from the island's top edge. */
export function botPosition(
  mode: IslandMode,
  view: IslandViewName,
  islandH: number,
  uploadProgress = 0,
): BotPlacement {
  const safeProgress = clampUploadProgress(uploadProgress);
  switch (mode) {
    case "hidden":
      return { cx: 46, cy: 16, diameter: 6, opacity: 0 };
    case "compact":
      return { cx: 30, cy: 19, diameter: 22, opacity: 1 };
    case "expanded": {
      const layout = VIEW_LAYOUTS[view];
      if (view === "uploading") {
        return {
          cx: 36 + safeProgress * 526,
          cy: layout.botY ?? 103,
          diameter: layout.botDiameter,
          opacity: 1,
        };
      }
      if (layout.botY != null) {
        return { cx: layout.botX, cy: layout.botY, diameter: layout.botDiameter, opacity: 1 };
      }
      // Centre of the fixed 84 pt card (8 pt top inset + 34 pt header → content at y = 42)
      const headerBottom = 42;
      const cardH = 84;
      const cy = headerBottom + (islandH - headerBottom - cardH) / 2 + cardH / 2;
      return { cx: layout.botX, cy, diameter: layout.botDiameter, opacity: 1 };
    }
  }
}

export function botGlowColor(s: BotStateName): string {
  switch (s) {
    case "working":
      return "#3B9EFF";
    case "thinking":
      return "#A78BFA";
    case "searching":
      return "#6366F1";
    case "approval":
      return "#F5A524";
    case "error":
      return "#F4505E";
    case "finished":
      return "#34D399";
    case "ratelimit":
      return "#F59E0B";
    default:
      return "#FFFFFF";
  }
}

export function botGlowOpacity(s: BotStateName): number {
  switch (s) {
    case "idle":
    case "sleeping":
      return 0.15;
    case "dizzy":
      return 0;
    default:
      return 0.65;
  }
}

// Project colours: add `"project name": "#hex"` entries to pin a colour; anything
// else gets a stable colour from its name.
const PROJECT_COLORS: Record<string, string> = {};

const FALLBACK_COLORS = ["#22C55E", "#EAB308", "#60A5FA", "#E879F9"];

export function colorForProject(name: string): string {
  const key = name.toLowerCase().trim();
  const exact = PROJECT_COLORS[key];
  if (exact) return exact;
  for (const [k, c] of Object.entries(PROJECT_COLORS)) {
    if (key.startsWith(k) || key.includes(k)) return c;
  }
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return FALLBACK_COLORS[Math.abs(hash) % FALLBACK_COLORS.length];
}

// Card wash colours (CardBackground.washColor)
export type Wash = "red" | "green" | "pink" | "amber" | "cyan" | "indigo" | "soft" | null;

export function washRGBA(wash: Wash): string {
  switch (wash) {
    case "red":
      return "rgba(244,80,94,0.55)";
    case "green":
      return "rgba(52,211,153,0.5)";
    case "pink":
      return "rgba(244,114,182,0.55)";
    case "amber":
      return "rgba(245,165,36,0.42)";
    case "cyan":
      return "rgba(34,211,238,0.38)";
    case "indigo":
      return "rgba(99,102,241,0.5)";
    case "soft":
      return "rgba(255,255,255,0.08)";
    default:
      return "rgba(0,0,0,0)";
  }
}

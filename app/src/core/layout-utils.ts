/**
 * Island geometry constants, bounds clamping, and window position math.
 */

export const LAYOUT_DEFAULTS = {
  PANEL_W: 720,
  PANEL_H: 320,
  NOTCH_W: 184,
  NOTCH_H: 38,
  COMPACT_W: 288,
  COMPACT_LIVE_W: 420,
  COMPACT_LIVE_MAX_W: 480,
  EXPANDED_W: 640,
  ROUNDED_CORNER: 14,
  EXPANDED_CORNER: 22,
  WAKE_STRIP_W: 240,
  WAKE_STRIP_H: 6,
};

/** Chat view grows with the conversation bounded between 240 and 300px. */
export function calcChatPromptHeight(messageCount: number): number {
  const count = Number.isFinite(messageCount) ? Math.max(0, Math.floor(messageCount)) : 0;
  return Math.min(300, 240 + count * 40);
}

/** Computes corner radius for island mode. */
export function calcCornerRadius(mode: "hidden" | "compact" | "expanded"): number {
  return mode === "expanded" ? LAYOUT_DEFAULTS.EXPANDED_CORNER : LAYOUT_DEFAULTS.ROUNDED_CORNER;
}

/** Computes horizontally centered window coordinate clamped against monitor width. */
export function clampWindowPosition(
  monitorW: number,
  panelW = LAYOUT_DEFAULTS.PANEL_W,
  topMargin = 0,
): { x: number; y: number } {
  const safeW = Math.max(panelW, Number.isFinite(monitorW) ? monitorW : panelW);
  const x = Math.round((safeW - panelW) / 2);
  const y = Math.max(0, Number.isFinite(topMargin) ? topMargin : 0);
  return { x, y };
}

/** Clamps upload progress cleanly in [0, 1]. */
export function clampUploadProgress(progress: number): number {
  if (typeof progress !== "number" || !Number.isFinite(progress) || Number.isNaN(progress)) {
    return 0;
  }
  return Math.max(0, Math.min(1, progress));
}

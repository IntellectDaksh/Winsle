// Notification sanitization, noise filtering, and avatar accent color generation.
// Guards against OEM bloat, telemetry popups, null/undefined payloads, and text overflow.

import type { NotifInfo } from "./types";

/**
 * OEM bloatware, updaters, and background telemetry apps that generate unwanted toast interruptions.
 */
export const NOISE_APPS = /^(?:ASUS|MyASUS|Armoury Crate|GlideX|Windows|NVIDIA|Creative Cloud|Acrobat|Dell SupportAssist|Dell Optimizer|Dell Command|HP Support Assistant|HP Smart|Lenovo Vantage|Lenovo Commercial Vantage|Acer Care Center|McAfee|Norton|PowerToys)$/i;

export const NOISE_TEXT = /administrator privileges|update (?:is )?available|survey|tips? (?:for|and)|get the most out of|recommended settings|battery saver is on|restart your computer to finish|scan complete|no threats found/i;

/**
 * Determines whether a notification is low-value noise (OEM alerts, battery nags, generic telemetry)
 * that should be listed quietly without flashing or interrupting the user.
 */
export function isNoise(n: Partial<NotifInfo> | null | undefined): boolean {
  if (!n) return true;
  const app = typeof n.app === "string" ? n.app.trim() : "";
  const title = typeof n.title === "string" ? n.title.trim() : "";
  const body = typeof n.body === "string" ? n.body.trim() : "";

  if (!app && !title && !body) return true;
  return NOISE_APPS.test(app) || NOISE_TEXT.test(`${title} ${body}`);
}

/**
 * Sanitizes notification title or body text, removing invisible control characters
 * and truncating oversized payloads safely.
 */
export function sanitizeNotificationText(text: unknown, maxLen = 200): string {
  if (typeof text !== "string") return "";
  // Strip control characters except whitespace/newlines
  const cleaned = text.replace(/[\x00-\x09\x0B-\x1F\x7F]/g, "").trim();
  if (cleaned.length <= maxLen) return cleaned;
  return cleaned.slice(0, maxLen - 1) + "…";
}

const BRAND_COLORS: Record<string, string> = {
  whatsapp: "#25D366",
  discord: "#5865F2",
  slack: "#E01E5A",
  teams: "#6264A7",
  outlook: "#0F6CBD",
  chrome: "#4285F4",
  edge: "#0EA5E9",
  spotify: "#1DB954",
  telegram: "#2AABEE",
  gmail: "#EA4335",
  "vs code": "#3B9EFF",
  vscode: "#3B9EFF",
  antigravity: "#A78BFA",
};

const DEFAULT_PALETTE = ["#60A5FA", "#F472B6", "#FBBF24", "#34D399", "#A78BFA", "#F87171", "#22D3EE"];

/**
 * Computes a stable brand or hash-based accent color for an application name.
 * Performs case-insensitive matching for known messaging and productivity apps.
 */
export function appColor(app: unknown): string {
  if (typeof app !== "string" || !app.trim()) {
    return DEFAULT_PALETTE[0];
  }
  const normalized = app.trim().toLowerCase();
  if (BRAND_COLORS[normalized]) {
    return BRAND_COLORS[normalized];
  }
  let h = 0;
  for (let i = 0; i < normalized.length; i++) {
    h = (h * 31 + normalized.charCodeAt(i)) | 0;
  }
  return DEFAULT_PALETTE[Math.abs(h) % DEFAULT_PALETTE.length];
}

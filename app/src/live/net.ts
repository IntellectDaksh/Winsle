// Network utilities: connection quality, latency evaluation, and SSID sanitization.

export type LatencyQuality = "excellent" | "good" | "fair" | "poor" | "unreachable";

/**
 * Validates and normalizes round-trip network latency in milliseconds.
 * Returns null if negative, infinite, or NaN.
 */
export function normalizeLatency(ms: number | null | undefined): number | null {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return null;
  return Math.min(Math.round(ms), 10_000);
}

/**
 * Classifies latency into standard network response tiers.
 */
export function latencyQuality(ms: number | null | undefined): LatencyQuality {
  const norm = normalizeLatency(ms);
  if (norm == null) return "unreachable";
  if (norm < 30) return "excellent";
  if (norm < 80) return "good";
  if (norm < 150) return "fair";
  return "poor";
}

/**
 * Formats network latency as a human-friendly string (e.g. "24 ms" or "—").
 */
export function formatLatency(ms: number | null | undefined): string {
  const norm = normalizeLatency(ms);
  return norm == null ? "—" : `${norm} ms`;
}

/**
 * Sanitizes Wi-Fi SSIDs per IEEE 802.11 (max 32 octets, strip control characters).
 */
export function sanitizeSsid(raw: string): string {
  let clean = "";
  for (const char of raw) {
    const code = char.charCodeAt(0);
    // Ignore control characters (0-31, 127)
    if (code >= 32 && code !== 127) {
      clean += char;
    }
  }
  const trimmed = clean.trim();
  if (!trimmed) return "Wi-Fi";
  // Cap at 32 characters
  return trimmed.slice(0, 32);
}

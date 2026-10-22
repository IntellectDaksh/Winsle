// Progress percentage and ETA calculation utilities.
// Pure functions with full guards against division by zero, NaN, negative values, and non-finite inputs.

export interface ProgressSummary {
  pct: number | null;
  etaSeconds: number | null;
  etaFormatted: string | null;
}

/**
 * Calculates completion percentage clamped between 0 and 100.
 * Returns null for indeterminate progress (when totalBytes is unknown or invalid).
 */
export function calcProgressPct(
  bytes: number,
  totalBytes: number | null | undefined,
  done = false,
): number | null {
  if (done) return 100;
  if (
    totalBytes == null ||
    typeof totalBytes !== "number" ||
    !Number.isFinite(totalBytes) ||
    totalBytes <= 0
  ) {
    return null;
  }
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes <= 0) {
    return 0;
  }
  const pct = (bytes / totalBytes) * 100;
  return Math.max(0, Math.min(100, Math.round(pct * 10) / 10));
}

/**
 * Calculates estimated seconds remaining based on transfer speed.
 * Returns null if indeterminate or transfer speed is zero/negative.
 */
export function calcEtaSeconds(
  bytes: number,
  totalBytes: number | null | undefined,
  speed: number,
): number | null {
  if (
    totalBytes == null ||
    typeof totalBytes !== "number" ||
    !Number.isFinite(totalBytes) ||
    totalBytes <= 0
  ) {
    return null;
  }
  if (typeof speed !== "number" || !Number.isFinite(speed) || speed <= 0) {
    return null;
  }
  const safeBytes = typeof bytes === "number" && Number.isFinite(bytes) ? bytes : 0;
  if (safeBytes >= totalBytes) return 0;

  const remaining = totalBytes - safeBytes;
  const seconds = remaining / speed;
  if (!Number.isFinite(seconds) || seconds < 0) return null;

  // Cap at 7 days to avoid ridiculous estimations for near-stalled transfers
  const MAX_ETA = 7 * 24 * 3600;
  if (seconds > MAX_ETA) return null;

  return Math.round(seconds);
}

/**
 * Formats remaining seconds into human-readable compact ETA string.
 */
export function formatEta(seconds: number | null | undefined): string | null {
  if (
    seconds == null ||
    typeof seconds !== "number" ||
    !Number.isFinite(seconds) ||
    seconds < 0
  ) {
    return null;
  }
  if (seconds === 0) return "Done";
  if (seconds < 5) return "< 5s left";
  if (seconds < 60) return `${seconds}s left`;

  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) {
    return s > 0 && m < 10 ? `${m}m ${s}s left` : `${m}m left`;
  }

  const h = Math.floor(m / 60);
  const remM = m % 60;
  if (h < 24) {
    return remM > 0 ? `${h}h ${remM}m left` : `${h}h left`;
  }

  const d = Math.floor(h / 24);
  return `${d}d left`;
}

/**
 * Summarizes progress item metrics.
 */
export function summarizeProgress(
  bytes: number,
  totalBytes: number | null | undefined,
  speed: number,
  done = false,
): ProgressSummary {
  const pct = calcProgressPct(bytes, totalBytes, done);
  const etaSeconds = done ? 0 : calcEtaSeconds(bytes, totalBytes, speed);
  const etaFormatted = formatEta(etaSeconds);

  return { pct, etaSeconds, etaFormatted };
}

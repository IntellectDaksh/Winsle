// Battery and power management normalization helpers for island HUD.

export interface BatteryStatus {
  label: string;
  text: string;
  color: string;
  isLow: boolean;
}

/**
 * Validates and clamps battery percentage to 0–100 integer range.
 * Returns null if not finite, negative, or unmeasured.
 */
export function normalizeBatteryPercent(raw: number | null | undefined): number | null {
  if (raw == null || !Number.isFinite(raw) || raw < 0 || raw > 100) return null;
  return Math.round(raw);
}

/**
 * Normalizes remaining seconds, returning null if negative, infinite, or unavailable.
 */
export function normalizeBatterySeconds(seconds: number | null | undefined): number | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0 || seconds > 86400 * 7) return null;
  return Math.round(seconds);
}

/**
 * Produces structured status for battery display in idle capsules or widgets.
 */
export function formatBatteryStatus(
  rawPercent: number | null | undefined,
  charging: boolean,
  rawSecondsLeft: number | null | undefined
): BatteryStatus {
  const percent = normalizeBatteryPercent(rawPercent);
  const seconds = normalizeBatterySeconds(rawSecondsLeft);

  if (percent == null) {
    return {
      label: charging ? "AC Power" : "Battery",
      text: charging ? "plugged in" : "on battery",
      color: "#94A3B8",
      isLow: false,
    };
  }

  const isLow = !charging && percent <= 20;
  const isModerate = !charging && percent <= 35;
  const color = charging ? "#34D399" : isLow ? "#F4505E" : isModerate ? "#F5A524" : "#10B981";

  let text = charging ? "charging" : "not charging";
  if (!charging && seconds != null) {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    text = hours > 0 ? `${hours}h ${mins}m left` : `${mins}m left`;
  }

  return {
    label: `Battery ${percent}%`,
    text,
    color,
    isLow,
  };
}

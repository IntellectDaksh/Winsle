/**
 * Utilities for task step bounding, integration toggling, and settings sanitization.
 */

import type { Settings } from "./state";
import { DEFAULT_SETTINGS } from "./state";

/**
 * Sanitizes and bounds task step list to maxSteps entries.
 */
export function appendTaskStep(
  steps: string[],
  step: string,
  maxSteps = 20,
): { steps: string[]; stepIndex: number } {
  const safeSteps = Array.isArray(steps) ? [...steps] : [];
  const text = (step ?? "").trim();
  if (text) {
    safeSteps.push(text.slice(0, 500));
  }
  while (safeSteps.length > maxSteps) {
    safeSteps.shift();
  }
  return {
    steps: safeSteps,
    stepIndex: Math.max(0, safeSteps.length - 1),
  };
}

/**
 * Toggles an integration ID in active list with safety bounds.
 */
export function toggleIntegrationId(
  active: string[],
  id: string,
  maxActive = 4,
): { active: string[]; changed: boolean } {
  if (id === "integration_claude" || !id.trim()) {
    return { active: [...active], changed: false };
  }
  const current = Array.isArray(active) ? [...active] : [];
  if (current.includes(id)) {
    return { active: current.filter((x) => x !== id), changed: true };
  }
  if (current.length >= maxActive) {
    return { active: current, changed: false };
  }
  return { active: [...current, id], changed: true };
}

/**
 * Validates and clamps user settings against out-of-range or NaN numbers.
 */
export function sanitizeSettings(s?: Partial<Settings>): Settings {
  if (!s || typeof s !== "object") return { ...DEFAULT_SETTINGS };
  const vol = typeof s.soundVolume === "number" && Number.isFinite(s.soundVolume)
    ? Math.max(0, Math.min(1, s.soundVolume))
    : DEFAULT_SETTINGS.soundVolume;
  const autoClose = typeof s.autoCloseInterval === "number" && Number.isFinite(s.autoCloseInterval)
    ? Math.max(1, Math.min(300, s.autoCloseInterval))
    : DEFAULT_SETTINGS.autoCloseInterval;
  const absence = typeof s.absenceInterval === "number" && Number.isFinite(s.absenceInterval)
    ? Math.max(10, Math.min(3600, s.absenceInterval))
    : DEFAULT_SETTINGS.absenceInterval;

  return {
    ...DEFAULT_SETTINGS,
    ...s,
    soundVolume: vol,
    autoCloseInterval: autoClose,
    absenceInterval: absence,
    activeIntegrations: Array.isArray(s.activeIntegrations) ? s.activeIntegrations.slice(0, 4) : DEFAULT_SETTINGS.activeIntegrations,
    homeWidgets: Array.isArray(s.homeWidgets) ? s.homeWidgets.slice(0, 3) : DEFAULT_SETTINGS.homeWidgets,
  };
}

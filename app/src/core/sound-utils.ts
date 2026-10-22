// Pure sound utility functions and constants.
// Separated from sound.ts to allow deterministic unit testing in environments without Web Audio API.

export const SOUND_NAMES = [
  "peek", "open", "close", "hover", "blip", "slap", "annoyed", "dizzy", "greet",
  "work", "finish", "error", "approval", "question", "approve", "gulp", "tick",
  "send", "love", "pop", "proud", "wink", "yawn", "attach", "think", "search",
  "rate", "sleep",
] as const;

export type SoundName = (typeof SOUND_NAMES)[number];

export const DEFAULT_SOUND_VOLUME = 0.12;
export const MIN_SOUND_VOLUME = 0.0;
export const MAX_SOUND_VOLUME = 0.2;

/**
 * Validates whether a given string is a recognized sound effect identifier.
 */
export function isValidSoundName(name: unknown): name is SoundName {
  if (typeof name !== "string") return false;
  return (SOUND_NAMES as readonly string[]).includes(name);
}

/**
 * Clamps audio volume to safe sound engine range [0.0, 0.2].
 * Guards against NaN, +/-Infinity, negative values, and non-numeric inputs.
 */
export function clampSoundVolume(v: unknown, fallback: number = DEFAULT_SOUND_VOLUME): number {
  if (typeof v !== "number" || !Number.isFinite(v)) {
    return fallback;
  }
  return Math.max(MIN_SOUND_VOLUME, Math.min(MAX_SOUND_VOLUME, v));
}

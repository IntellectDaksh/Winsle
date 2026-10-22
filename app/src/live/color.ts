// Color validation, sanitization, and luminance helpers for island UI.

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const RGB_RE = /^rgba?\(\s*(\d{1,3}%?)\s*,\s*(\d{1,3}%?)\s*,\s*(\d{1,3}%?)(?:\s*,\s*([\d.]+%?))?\s*\)$/i;
const HSL_RE = /^hsla?\(\s*(\d{1,3}(?:deg)?)\s*,\s*(\d{1,3}%)\s*,\s*(\d{1,3}%)(?:\s*,\s*([\d.]+%?))?\s*\)$/i;

/** Returns true if str is a valid, safe CSS color string without injection characters. */
export function isValidColor(str: string): boolean {
  const s = str.trim();
  if (!s || s.length > 64) return false;
  if (/['"\\;{}]|url\(/i.test(s)) return false;
  return HEX_RE.test(s) || RGB_RE.test(s) || HSL_RE.test(s);
}

/** Sanitizes a CSS color string, falling back to a safe default if invalid or dangerous. */
export function sanitizeColor(color: string, fallback = "#3B82F6"): string {
  const s = color.trim();
  return isValidColor(s) ? s : fallback;
}

/** Parses a hex color to [r, g, b] (0-255). Returns null if invalid. */
export function parseHex(hex: string): [number, number, number] | null {
  const clean = hex.trim().replace(/^#/, "");
  if (clean.length === 3) {
    const r = parseInt(clean[0] + clean[0], 16);
    const g = parseInt(clean[1] + clean[1], 16);
    const b = parseInt(clean[2] + clean[2], 16);
    return [r, g, b];
  }
  if (clean.length === 6 || clean.length === 8) {
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    return [r, g, b];
  }
  return null;
}

/** Returns relative luminance between 0.0 (pure black) and 1.0 (pure white). */
export function getLuminance(r: number, g: number, b: number): number {
  const [R, G, B] = [r / 255, g / 255, b / 255].map((v) =>
    v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  );
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

/** Returns true if the background color is bright enough to warrant dark text. */
export function isLightBackground(color: string): boolean {
  const rgb = parseHex(color);
  if (!rgb) return false;
  return getLuminance(rgb[0], rgb[1], rgb[2]) > 0.45;
}

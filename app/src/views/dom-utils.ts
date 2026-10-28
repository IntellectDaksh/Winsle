/**
 * Safe DOM attribute utilities and URI sanitizers for Winsle dynamic DOM views.
 */

const DANGEROUS_PROTOCOLS = ["javascript:", "vbscript:", "data:text/html"];

/**
 * Checks if a URI uses dangerous or executable protocol schemes.
 */
export function isDangerousUri(uri: string): boolean {
  const trimmed = uri.trim().toLowerCase().replace(/[\x00-\x1f\s]/g, "");
  return DANGEROUS_PROTOCOLS.some((proto) => trimmed.startsWith(proto));
}

/**
 * Validates and sanitizes attribute values, guarding against script execution via URLs.
 */
export function sanitizeAttributeValue(attrName: string, value: string): string | null {
  const lower = attrName.toLowerCase();
  if (lower === "href" || lower === "src" || lower === "action" || lower === "formaction") {
    if (isDangerousUri(value)) {
      return null;
    }
  }
  return value;
}

/**
 * Safely sanitizes numeric element dimensions, falling back to a default on NaN or negative values.
 */
export function sanitizeDimension(size: number | string, fallback = 14): number {
  const num = typeof size === "number" ? size : parseFloat(size);
  if (!Number.isFinite(num) || num < 0) {
    return fallback;
  }
  return num;
}

/**
 * Parses and validates an SVG viewBox coordinate string (x, y, width, height).
 */
export function parseViewBox(viewBoxStr: string): { x: number; y: number; width: number; height: number } | null {
  const parts = viewBoxStr.trim().split(/[\s,]+/).map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isFinite(p))) {
    return null;
  }
  const [x, y, width, height] = parts;
  if (width < 0 || height < 0) {
    return null;
  }
  return { x, y, width, height };
}

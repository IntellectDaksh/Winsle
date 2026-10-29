/**
 * Pure math, particle kinematics, and geometry utilities for upload animations.
 */

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const eOut = (t: number) => 1 - Math.pow(1 - t, 3);
export const eIn = (t: number) => t * t * t;
export const eInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/**
 * Calculates radii and power exponent for Mochi's superellipse body based on morph factor `m`.
 */
export function calcSuperellipseRadii(
  m: number,
  R: number
): { rx: number; ry: number; n: number } {
  const mc = Math.max(0, Math.min(Number.isFinite(m) ? m : 0, 1));
  const safeR = Number.isFinite(R) && R > 0 ? R : 1;
  const n = 2.15 + (5.5 - 2.15) * mc;
  const rx = safeR * (1.04 - 0.04 * mc);
  const ry = safeR * (0.97 - 0.03 * mc);
  return { rx, ry, n };
}

/**
 * Calculates coordinate point along superellipse curve at given angle.
 */
export function calcSuperellipsePoint(
  rx: number,
  ry: number,
  n: number,
  angle: number
): { x: number; y: number } {
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  const safeN = n > 0 ? n : 2;
  const px = rx * Math.sign(ca) * Math.pow(Math.abs(ca), 2 / safeN);
  const py = ry * Math.sign(sa) * Math.pow(Math.abs(sa), 2 / safeN);
  return { x: px, y: py };
}

export interface CrumbParticle {
  x: number;
  y: number;
  radius: number;
  alpha: number;
}

/**
 * Computes particle crumb position, scale, and alpha pulled toward the intake mouth.
 */
export function calcCrumbParticle(
  index: number,
  total: number,
  suck: number,
  cx: number,
  cy: number,
  mouthX: number,
  mouthY: number,
  mouthW: number,
  mouthH: number
): CrumbParticle | null {
  if (total <= 0 || !Number.isFinite(suck)) return null;
  const a = (index / total) * Math.PI * 2 + 0.6;
  const k = Math.max(0, Math.min(1, (suck - index * 0.08) / 0.7));
  if (k <= 0 || k >= 1) return null;

  const sx0 = cx + Math.cos(a) * 24;
  const sy0 = cy + Math.sin(a) * 24;
  const ex = mouthX + mouthW / 2;
  const ey = mouthY + mouthH * 0.3;
  const kk = Math.pow(k, 0.7);
  const px = lerp(sx0, ex, kk);
  const py = lerp(sy0, ey, kk) - Math.sin(Math.PI * k) * 6;
  const rad = 2.2 * (1 - k * 0.5);

  return {
    x: px,
    y: py,
    radius: rad,
    alpha: 1 - k,
  };
}

/**
 * Computes horizontal scale and vertical position ratio for document suction slices.
 */
export function calcSuckStripParams(
  stripIndex: number,
  totalStrips: number,
  suck: number,
  mouthW: number,
  baseW0 = 34
): { wsc: number; v0: number } {
  const safeTotal = totalStrips > 0 ? totalStrips : 28;
  const safeBaseW0 = baseW0 > 0 ? baseW0 : 34;
  const clampedSuck = Math.max(0, Math.min(1, Number.isFinite(suck) ? suck : 0));

  const p = eIn(clampedSuck);
  const q = eOut(clampedSuck);
  const sc = lerp(1, 0.55, p);
  const v0 = stripIndex / safeTotal;
  const wsc = lerp(1, lerp(0.92, (0.22 * mouthW) / safeBaseW0, Math.pow(v0, 1.2)), q) * sc;

  return { wsc, v0 };
}

/**
 * Computes gentle rotational wobble during suction intake.
 */
export function calcSuckWobble(suck: number): number {
  const clampedSuck = Math.max(0, Math.min(1, Number.isFinite(suck) ? suck : 0));
  const p = eIn(clampedSuck);
  return Math.sin(clampedSuck * Math.PI * 2) * 0.1 * (1 - p);
}

/**
 * Clamps glow trail length behind the upload progress indicator based on velocity.
 */
export function calcGlowTrailLength(velocity: number): number {
  const v = Number.isFinite(velocity) ? velocity : 0;
  return Math.max(8, Math.min(34, 8 + v * 40));
}

/**
 * Sanitizes and bounds drop zone dimensions.
 */
export function clampDropZoneBounds(
  x: number,
  y: number,
  w: number,
  h: number,
  minW = 20,
  minH = 20
): { x: number; y: number; w: number; h: number } {
  return {
    x: Number.isFinite(x) ? x : 0,
    y: Number.isFinite(y) ? y : 0,
    w: Math.max(minW, Number.isFinite(w) ? w : minW),
    h: Math.max(minH, Number.isFinite(h) ? h : minH),
  };
}

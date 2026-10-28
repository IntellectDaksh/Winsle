/**
 * Minibot canvas sizing, device pixel ratio scaling, and animation frame clamping.
 */

export const MINIBOT_BODY_SCALE = 0.6;

/**
 * Computes slot, CSS canvas, and device pixel canvas dimensions.
 */
export function calcMiniBotDimensions(
  bodySize: number,
  dpr = 1,
  bodyScale = MINIBOT_BODY_SCALE,
): { slotSize: number; cssSize: number; pixelSize: number } {
  const safeBody = Math.max(8, Math.min(256, Number.isFinite(bodySize) ? bodySize : 22));
  const safeScale = bodyScale > 0 && bodyScale <= 1 ? bodyScale : MINIBOT_BODY_SCALE;
  const cssSize = Math.round((safeBody / safeScale) * 10) / 10;
  const safeDpr = Math.max(1, Math.min(3, Number.isFinite(dpr) ? dpr : 1));
  const pixelSize = Math.round(cssSize * safeDpr);

  return {
    slotSize: safeBody,
    cssSize,
    pixelSize,
  };
}

/**
 * Clamps dt physics time step for minibot updates against lag spikes or background suspension.
 */
export function clampMinibotDt(dt: number, maxDt = 0.1): number {
  if (typeof dt !== "number" || !Number.isFinite(dt) || Number.isNaN(dt)) {
    return 1 / 60;
  }
  return Math.max(0, Math.min(maxDt, dt));
}

/**
 * Ticker animation constants, opacity calculations, and step queue management.
 */

export const TICKER_CONSTANTS = {
  ROW_H: 22,
  DURATION: 380,
  MAX_QUEUE: 4,
  COMPLETED_SCALE: 11.5 / 13,
};

/**
 * Computes the scale factor for a given transition phase in [0, 1].
 */
export function calcRowScale(phase: number, completedScale = TICKER_CONSTANTS.COMPLETED_SCALE): number {
  const p = Number.isNaN(phase) ? 0 : Math.max(0, Math.min(1, phase));
  return 1 - p * (1 - completedScale);
}

/**
 * Computes chevron, checkmark, shimmer, and dim layer opacities across transition phase [0, 1].
 */
export function calcRowOpacities(phase: number): {
  chevron: number;
  check: number;
  shimmer: number;
  dim: number;
} {
  const p = Number.isNaN(phase) ? 0 : Math.max(0, Math.min(1, phase));
  return {
    chevron: Math.max(0, Math.min(1, 1 - p * 2)),
    check: Math.max(0, Math.min(1, p * 2 - 1)),
    shimmer: Math.max(0, Math.min(1, 1 - p * 1.6)),
    dim: Math.max(0, Math.min(1, p * 2 - 0.4)),
  };
}

/**
 * Sanitizes and enqueues newly arrived steps, bounding the queue size to maxQueue.
 */
export function enqueueSteps(
  existingQueue: string[],
  steps: string[],
  displayIndex: number,
  newIndex: number,
  maxQueue = TICKER_CONSTANTS.MAX_QUEUE,
): { queue: string[]; displayIndex: number; reset: boolean } {
  const safeSteps = Array.isArray(steps) && steps.length > 0 ? steps : ["…"];
  const targetIdx = Math.min(newIndex, safeSteps.length - 1);

  if (displayIndex < 0 || targetIdx < displayIndex) {
    return {
      queue: [],
      displayIndex: targetIdx,
      reset: true,
    };
  }

  const nextQueue = [...existingQueue];
  for (let i = displayIndex + 1; i <= targetIdx; i++) {
    const s = safeSteps[i] ?? "…";
    nextQueue.push(s);
  }

  return {
    queue: nextQueue.length > maxQueue ? nextQueue.slice(-maxQueue) : nextQueue,
    displayIndex: targetIdx,
    reset: false,
  };
}

/**
 * Computes interpolation progress [0, 1] clamped, guarding against non-finite or backwards timestamps.
 */
export function calcTickerProgress(startMs: number, nowMs: number, duration = TICKER_CONSTANTS.DURATION): number {
  if (!Number.isFinite(startMs) || !Number.isFinite(nowMs) || duration <= 0) return 1;
  const elapsed = nowMs - startMs;
  if (elapsed <= 0) return 0;
  return Math.max(0, Math.min(1, elapsed / duration));
}

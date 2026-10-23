// Easing + spring helpers.
// Ease.* mirrors BotEngine.swift `enum Ease` (itself the prototype's `E`).
// Spring mirrors SwiftUI `.spring(response:dampingFraction:)` so open/close motion
// matches the macOS app exactly.

export const Ease = {
  out: (t: number) => 1 - Math.pow(1 - t, 3),
  inOut: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  back: (t: number) => {
    const c1 = 1.7;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  lin: (t: number) => t,
  easeIn: (t: number) => t * t * t,
};

export type EaseFn = (t: number) => number;

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const clamp = (v: number, lo: number, hi: number) => {
  if (!Number.isFinite(v)) return lo;
  return Math.max(lo, Math.min(hi, v));
};
export const seg = (t: number, a: number, b: number) => {
  if (b === a || !Number.isFinite(t)) return 0;
  return clamp((t - a) / (b - a), 0, 1);
};

/** cubic-bezier(x1,y1,x2,y2) — used for the 340 ms close curve (.45,0,.2,1). */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): EaseFn {
  const cx = (t: number) => ((1 - t) ** 2 * 3 * t * x1) + (3 * (1 - t) * t * t * x2) + t ** 3;
  const cy = (t: number) => ((1 - t) ** 2 * 3 * t * y1) + (3 * (1 - t) * t * t * y2) + t ** 3;
  return (x) => {
    if (!Number.isFinite(x) || x <= 0) return 0;
    if (x >= 1) return 1;
    // Newton-ish bisection on x — 12 iterations is plenty at 60 fps.
    let lo = 0;
    let hi = 1;
    let t = x;
    for (let i = 0; i < 12; i++) {
      const v = cx(t);
      if (v < x) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return cy(t);
  };
}

export const closeCurve = cubicBezier(0.45, 0, 0.2, 1);

/**
 * SwiftUI-equivalent spring: ω₀ = 2π / response, ζ = dampingFraction.
 * Integrated per frame (sub-stepped) so a dropped frame never destabilises it.
 */
export class Spring {
  value: number;
  target: number;
  velocity = 0;
  omega: number;
  zeta: number;

  constructor(value: number, response = 0.5, damping = 0.72) {
    const safeVal = Number.isFinite(value) ? value : 0;
    this.value = safeVal;
    this.target = safeVal;
    const r = Number.isFinite(response) && response > 0.01 ? response : 0.5;
    const d = Number.isFinite(damping) && damping >= 0 ? damping : 0.72;
    this.omega = (2 * Math.PI) / r;
    this.zeta = d;
  }

  configure(response: number, damping: number) {
    const r = Number.isFinite(response) && response > 0.01 ? response : 0.5;
    const d = Number.isFinite(damping) && damping >= 0 ? damping : 0.72;
    this.omega = (2 * Math.PI) / r;
    this.zeta = d;
  }

  set(value: number) {
    const safeVal = Number.isFinite(value) ? value : 0;
    this.value = safeVal;
    this.target = safeVal;
    this.velocity = 0;
  }

  get settled(): boolean {
    return Math.abs(this.target - this.value) < 0.01 && Math.abs(this.velocity) < 0.05;
  }

  step(dt: number) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    // Cap dt to 0.1s to prevent lag spike destabilisation or runaway iterations
    const clampedDt = Math.min(0.1, dt);
    const steps = Math.min(24, Math.max(1, Math.ceil(clampedDt / (1 / 240))));
    const h = clampedDt / steps;
    for (let i = 0; i < steps; i++) {
      const acc =
        this.omega * this.omega * (this.target - this.value) -
        2 * this.zeta * this.omega * this.velocity;
      this.velocity += acc * h;
      this.value += this.velocity * h;
    }
  }
}

/**
 * Value driven either by a spring (growing) or a timed curve (shrinking) —
 * matches IslandContainer: openSpring for grow, closeEase 340 ms for shrink.
 */
export class Tracked {
  private spring: Spring;
  private curveFrom = 0;
  private curveTo = 0;
  private curveStart = 0;
  private curveDur = 0;
  private mode: "spring" | "curve" | "idle" = "idle";

  constructor(value: number) {
    this.spring = new Spring(value);
  }

  get value(): number {
    return this.spring.value;
  }

  get animating(): boolean {
    return this.mode !== "idle";
  }

  jump(v: number) {
    this.spring.set(v);
    this.mode = "idle";
  }

  /** Spring to `v` (open / grow). */
  springTo(v: number, response = 0.5, damping = 0.72) {
    this.spring.configure(response, damping);
    this.spring.target = Number.isFinite(v) ? v : 0;
    this.mode = "spring";
  }

  /** Timed curve to `v` (close / shrink), no overshoot. */
  curveTowards(v: number, durationMs = 340, now = performance.now()) {
    const safeV = Number.isFinite(v) ? v : 0;
    const safeDur = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 340;
    const safeNow = Number.isFinite(now) ? now : performance.now();
    this.curveFrom = this.spring.value;
    this.curveTo = safeV;
    this.curveStart = safeNow;
    this.curveDur = safeDur;
    this.spring.target = safeV;
    this.spring.velocity = 0;
    this.mode = "curve";
  }

  step(dt: number, now = performance.now()) {
    if (this.mode === "spring") {
      this.spring.step(dt);
      if (this.spring.settled) {
        this.spring.value = this.spring.target;
        this.spring.velocity = 0;
        this.mode = "idle";
      }
    } else if (this.mode === "curve") {
      const safeNow = Number.isFinite(now) ? now : performance.now();
      const p = clamp((safeNow - this.curveStart) / this.curveDur, 0, 1);
      this.spring.value = lerp(this.curveFrom, this.curveTo, closeCurve(p));
      if (p >= 1) {
        this.spring.value = this.curveTo;
        this.spring.velocity = 0;
        this.mode = "idle";
      }
    }
  }
}

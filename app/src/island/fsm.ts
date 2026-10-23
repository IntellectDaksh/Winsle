// Island open/close FSM — port of IslandStateMachine.swift.
// No DOM, no Tauri: it only reports transitions.

export type FsmState = "hidden" | "petit" | "home" | "winsle";

/**
 * Sanitizes timer delays ensuring they are finite, non-NaN, and respect a minimum bound.
 */
export function sanitizeDelay(delay: unknown, fallback: number, min = 0): number {
  if (typeof delay !== "number" || !Number.isFinite(delay) || Number.isNaN(delay)) {
    return fallback;
  }
  return Math.max(min, delay);
}

type TimerHandle = ReturnType<typeof setTimeout>;

export class IslandStateMachine {
  state: FsmState = "hidden";

  onTransition: ((from: FsmState, to: FsmState) => void) | null = null;

  /** home → petit delay, seconds. */
  homeToPetitDelay = 15;
  /**
   * petit → hidden delay, seconds. Infinity = the compact island stays on screen
   * (it only shrinks from expanded, never disappears on its own); Pause hides it.
   */
  petitToHiddenDelay = Infinity;
  /** winsle → petit once the greeting animation ends (no hover). */
  greetAutoCollapseDelay = 0.6;
  /** winsle → petit while the mouse hovers the greeting. */
  greetHoverCollapseDelay = 10;
  /** An alert waiting for an answer stays open, even when the mouse leaves. */
  pinned = false;

  private petitHide: TimerHandle | null = null;
  private homeCollapse: TimerHandle | null = null;
  private greetCollapse: TimerHandle | null = null;

  // ── Inputs ──────────────────────────────────────────────────────────────────

  launch() {
    this.cancelTimers();
    this.transition("winsle");
  }

  mouseEntered() {
    switch (this.state) {
      case "hidden":
        this.cancelTimers();
        this.transition("petit");
        break;
      case "petit":
        this.clear("petitHide");
        break;
      case "home":
        this.clear("homeCollapse");
        break;
      case "winsle":
        this.scheduleGreetCollapse(this.greetHoverCollapseDelay);
        break;
    }
  }

  /** `homeDelay` overrides the expanded → compact delay for this exit (seconds). */
  mouseLeft(homeDelay?: number) {
    switch (this.state) {
      case "hidden":
        break;
      case "petit":
        this.schedulePetitHide();
        break;
      case "home":
        this.scheduleHomeCollapse(homeDelay);
        break;
      case "winsle":
        this.clear("greetCollapse");
        this.transition("petit");
        break;
    }
  }

  click() {
    if (this.state !== "petit") return;
    this.cancelTimers();
    this.transition("home");
  }

  /** Greeting animation finished (T.end). Doesn't override a running hover timer. */
  greetComplete() {
    if (this.state !== "winsle") return;
    if (this.greetCollapse == null) this.scheduleGreetCollapse(this.greetAutoCollapseDelay);
  }

  /** Non-alert work event: show compact from hidden. */
  reveal() {
    if (this.state !== "hidden") return;
    this.cancelTimers();
    this.transition("petit");
    this.schedulePetitHide();
  }

  /** Alert or explicit request: open straight to expanded. */
  forceHome() {
    this.cancelTimers();
    this.transition("home");
  }

  /// Explicit close (OK button, Escape, an alert being answered).
  forcePetit() {
    this.cancelTimers();
    this.transition("petit");
  }

  forceHidden() {
    this.cancelTimers();
    this.transition("hidden");
  }

  // ── Timers ──────────────────────────────────────────────────────────────────

  private schedulePetitHide() {
    this.clear("petitHide");
    if (!Number.isFinite(this.petitToHiddenDelay) || this.petitToHiddenDelay <= 0) return;
    const delay = sanitizeDelay(this.petitToHiddenDelay, Infinity, 0);
    if (!Number.isFinite(delay)) return;
    this.petitHide = globalThis.setTimeout(() => {
      this.petitHide = null;
      if (this.state === "petit") this.transition("hidden");
    }, delay * 1000);
  }

  private scheduleHomeCollapse(delay = this.homeToPetitDelay) {
    this.clear("homeCollapse");
    if (this.pinned) return;
    const safeDelay = sanitizeDelay(delay, this.homeToPetitDelay, 0);
    this.homeCollapse = globalThis.setTimeout(() => {
      this.homeCollapse = null;
      if (this.state === "home") this.transition("petit");
    }, safeDelay * 1000);
  }

  private scheduleGreetCollapse(delay: number) {
    this.clear("greetCollapse");
    const safeDelay = sanitizeDelay(delay, this.greetAutoCollapseDelay, 0);
    this.greetCollapse = globalThis.setTimeout(() => {
      this.greetCollapse = null;
      if (this.state === "winsle") this.transition("petit");
    }, safeDelay * 1000);
  }

  private clear(which: "petitHide" | "homeCollapse" | "greetCollapse") {
    const id = this[which];
    if (id != null) globalThis.clearTimeout(id);
    this[which] = null;
  }

  cancelTimers() {
    this.clear("petitHide");
    this.clear("homeCollapse");
    this.clear("greetCollapse");
  }

  private transition(next: FsmState) {
    if (next === this.state) return;
    const from = this.state;
    this.state = next;
    try {
      this.onTransition?.(from, next);
    } catch (err) {
      console.error(`[FSM] Transition error from ${from} to ${next}:`, err);
    }
  }
}


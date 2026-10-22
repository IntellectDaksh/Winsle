// SoundEngine — port of SoundEngine.swift.
// The 28 WAVs are the macOS app's own files (see SOUNDS_DIR in vite.config.ts);
// they are served at /sounds/<name>.wav. Default volume 0.12, slider range 0–0.2,
// exactly like the Mac player, and several sounds may overlap.

import {
  SOUND_NAMES,
  type SoundName,
  DEFAULT_SOUND_VOLUME,
  clampSoundVolume,
  isValidSoundName,
} from "./sound-utils";

export { SOUND_NAMES, type SoundName, clampSoundVolume, isValidSoundName };

class SoundEngine {
  enabled = true;
  volume = DEFAULT_SOUND_VOLUME;

  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private loading: Promise<void> | null = null;
  private idleTimer: number | null = null;

  /** Creates the context and decodes every WAV. Safe to call more than once. */
  preload(): Promise<void> {
    if (this.loading) return this.loading;
    this.loading = (async () => {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      const ctx = new Ctor();
      this.ctx = ctx;
      const master = ctx.createGain();
      master.gain.value = this.volume;
      master.connect(ctx.destination);
      this.master = master;
      await Promise.all(
        SOUND_NAMES.map(async (name) => {
          try {
            const res = await fetch(`/sounds/${name}.wav`);
            if (!res.ok) return;
            const buf = await ctx.decodeAudioData(await res.arrayBuffer());
            this.buffers.set(name, buf);
          } catch {
            /* a missing sound must never break the island */
          }
        }),
      );
    })();
    return this.loading;
  }

  /** WebView2 can hand us a suspended context; call after any user input. */
  resume() {
    if (this.idleTimer != null) {
      window.clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    void this.ctx?.resume();
  }

  /**
   * Called when the island goes quiet. A running AudioContext keeps an audio
   * thread and its render quantum alive even with nothing playing, which shows
   * up as a steady trickle of CPU on a machine that is supposed to be idle.
   *
   * The delay covers the tail of whatever just played — suspending mid-sound
   * would clip it — and `play()` resumes the context on its own.
   */
  idle() {
    if (!this.ctx || this.ctx.state !== "running" || this.idleTimer != null) return;
    this.idleTimer = window.setTimeout(() => {
      this.idleTimer = null;
      void this.ctx?.suspend();
    }, 1500);
  }

  setVolume(v: number) {
    this.volume = clampSoundVolume(v);
    if (this.master) this.master.gain.value = this.volume;
  }

  setEnabled(on: boolean) {
    this.enabled = on;
  }

  hasSound(name: string): boolean {
    return this.buffers.has(name);
  }

  isReady(): boolean {
    return this.buffers.size > 0 && this.ctx != null;
  }

  loadedCount(): number {
    return this.buffers.size;
  }

  play(name: SoundName | string) {
    if (!this.enabled) return;
    const ctx = this.ctx;
    const master = this.master;
    const buf = this.buffers.get(name);
    if (!ctx || !master || !buf) return;
    try {
      if (this.idleTimer != null) {
        window.clearTimeout(this.idleTimer);
        this.idleTimer = null;
      }
      if (ctx.state === "suspended") void ctx.resume();
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(master);
      src.start();
    } catch {
      /* AudioContext state transition or buffer decode issues must never crash */
    }
  }
}

export const Sound = new SoundEngine();

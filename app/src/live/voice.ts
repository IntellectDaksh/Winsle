// Voice commands: the island side (listening meter → transcript → agent answer)
// and the Settings row (enable, download engine, pick the hotkey letter).
// Recording and whisper.cpp run in Rust (src-tauri/src/live/voice.rs).

import { invoke } from "@tauri-apps/api/core";
import { IS_TAURI, onEvent } from "../core/bridge";
import { h } from "../views/dom";

interface VoiceStatus {
  enabled: boolean;
  key: string;
  installed: boolean;
  installing: boolean;
  error: string | null;
}

interface VoiceState {
  phase: "listening" | "transcribing" | "done" | "error";
  level: number;
  text: string;
  error: string | null;
}

interface Progress {
  stage: "engine" | "model";
  done: number;
  total: number;
}

const COLOR = "#F472B6";

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!IS_TAURI) throw new Error("Voice needs the desktop app");
  return invoke<T>(cmd, args);
}

/** Island: show each phase as a flash; a transcript runs like typed palette input. */
// Agent/store are imported lazily so the Settings window, which only uses
// voiceSection, never boots the agent's timers a second time.
export async function registerVoice() {
  const [{ Agent }, { Live }] = await Promise.all([import("./agent"), import("./store")]);
  const run = async (text: string) => {
    Live.setFlash({ icon: "bolt", color: COLOR, title: `“${text}”`, sub: "Thinking…", view: "agent" }, 30_000);
    const reply = await Agent.ask(text);
    Live.setFlash({ icon: "check", color: COLOR, title: `“${text}”`, sub: reply.text, view: "agent" }, 6000);
  };
  void onEvent<VoiceState>("voice-state", (s) => {
    switch (s.phase) {
      case "listening":
        Live.setFlash({ icon: "bolt", color: COLOR, title: "Listening…", sub: "Release to send", level: s.level, view: "agent" }, 16_000);
        break;
      case "transcribing":
        Live.setFlash({ icon: "bolt", color: COLOR, title: "Transcribing…", sub: "", view: "agent" }, 20_000);
        break;
      case "error":
        Live.setFlash({ icon: "bang", color: "#F87171", title: "Voice", sub: s.error ?? "Something went wrong", view: "agent" }, 4000);
        break;
      case "done":
        void run(s.text);
        break;
    }
  });
}

function mb(n: number): string {
  return (n / 1_048_576).toFixed(0);
}

/** Settings → Voice commands row. */
export function voiceSection(): HTMLElement {
  const toggle = h("input", { type: "checkbox" }) as HTMLInputElement;
  const key = h("input", { type: "text", maxlength: "1", style: "width:3em;text-transform:uppercase", spellcheck: "false" }) as HTMLInputElement;
  const note = h("div", { class: "hint", "aria-live": "polite" });
  let st: VoiceStatus | null = null;

  const render = () => {
    toggle.checked = !!st?.enabled;
    key.value = st?.key ?? "J";
    toggle.disabled = !!st?.installing;
    if (!st) note.textContent = "Voice commands need the desktop app.";
    else if (st.error) note.textContent = st.error;
    else if (st.installing) note.textContent = "Downloading…";
    else if (st.enabled && st.installed) note.textContent = `Hold Ctrl+Alt+${st.key}, speak, release. Runs offline with whisper.cpp; the mic is only open while you hold the keys.`;
    else note.textContent = "Offline speech via whisper.cpp. Enabling downloads ~85 MB once to %LOCALAPPDATA%\\Winsle\\voice.";
  };

  const apply = async (enabled: boolean) => {
    try {
      st = await call<VoiceStatus>("voice_configure", { enabled, key: key.value || "J" });
      render();
      if (enabled && !st.installed) {
        st = { ...st, installing: true };
        render();
        st = await call<VoiceStatus>("voice_install");
      }
    } catch (e) {
      st = st ? { ...st, installing: false, error: String(e) } : null;
    }
    render();
  };

  toggle.addEventListener("change", () => void apply(toggle.checked));
  key.addEventListener("change", () => void apply(toggle.checked));
  void onEvent<Progress>("voice-progress", (p) => {
    note.textContent = `Downloading ${p.stage === "engine" ? "whisper.cpp" : "speech model"}… ${mb(p.done)}${p.total ? ` / ${mb(p.total)}` : ""} MB`;
  });
  if (IS_TAURI) void call<VoiceStatus>("voice_status").then((s) => { st = s; render(); }).catch(() => render());
  else render();

  return h("div", {},
    h("div", { class: "row" }, h("label", { text: "Voice commands" }), toggle, h("span", { text: "Ctrl+Alt+" }), key),
    note);
}

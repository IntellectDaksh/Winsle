// Settings window — the place where anything that writes to disk is confirmed.
// Stage 2 covers the ai-assistant Code hooks and the general preferences; API keys and
// integrations land here too in a later stage.

import "./settings.css";
import { Bridge, onEvent, type HookStatus } from "../core/bridge";
import { DEFAULT_SETTINGS, type Settings } from "../core/state";
import { h, clear } from "../views/dom";
import { DEFAULT_HOME_WIDGETS, WIDGET_LABELS } from "../live/widgets";
import { prefs, save as savePref, setPrefs } from "../live/prefs";

let settings: Settings = { ...DEFAULT_SETTINGS };
let version = "";

const root = document.getElementById("settings-root")!;

async function save() {
  await Bridge.saveSettings(settings);
}

// ── Reusable bits ─────────────────────────────────────────────────────────────

function toggle(on: boolean, onChange: (v: boolean) => void): HTMLElement {
  const el = h("button", { class: on ? "switch on" : "switch", "aria-pressed": on });
  el.addEventListener("click", () => {
    const next = !el.classList.contains("on");
    el.classList.toggle("on", next);
    onChange(next);
  });
  return el;
}

function statusDot(ok: boolean): HTMLElement {
  return h("i", { class: "dot", style: `background:${ok ? "#22c55e" : "#f4505e"}` });
}

function renderDiff(text: string): HTMLElement {
  const box = h("div", { class: "diff" });
  for (const line of text.split("\n")) {
    const cls = line.startsWith("+") ? "add" : line.startsWith("-") ? "del" : "ctx";
    box.append(h("div", { class: cls, text: line }));
  }
  return box;
}

// ── ai-assistant Code section ───────────────────────────────────────────────────────

function ai-assistantSection(status: HookStatus): HTMLElement {
  const body = h("div", { style: "display:flex;flex-direction:column;gap:12px" });
  const section = h(
    "section",
    {},
    h("h2", {}, statusDot(status.installed), h("span", { text: "ai-assistant Code" })),
    body,
  );

  const rebuild = async () => {
    const fresh = await Bridge.hooksStatus();
    if (fresh) Object.assign(status, fresh);
    clear(body);
    draw();
    const head = section.querySelector("h2")!;
    clear(head);
    head.append(statusDot(status.installed), h("span", { text: "ai-assistant Code" }));
  };

  function draw() {
    body.append(
      h("div", {
        class: "hint",
        text: status.installed
          ? "Winsle is hooked into your ai-assistant Code sessions. Tool calls, questions and permission requests show up in the island, and you can answer them there."
          : "Install the hooks to see your ai-assistant Code sessions in the island and approve permissions without leaving what you are doing.",
      }),
      h("div", { class: "row" },
        h("label", { text: "settings.json" }),
        h("span", { class: "path", text: status.settingsPath }),
      ),
      h("div", { class: "row" },
        h("label", { text: "Relay" }),
        h("span", { class: "path", text: status.hookPath }),
        statusDot(status.hookReady),
      ),
    );

    if (!status.hookReady) {
      body.append(h("div", {
        class: "notice warn",
        text: "winsle-hook.exe is not in place yet. Restart Winsle; if it still fails, build it with `cargo build -p winsle-hook`.",
      }));
    }

    const actions = h("div", { class: "row" });
    const install = h("button", {
      class: "primary",
      text: status.installed ? "Reinstall hooks…" : "Install hooks…",
      onclick: () => showPreview(true),
    });
    // Writing hook commands that point at a relay which isn't there would give
    // every ai-assistant Code session a broken hook and nothing to show for it.
    if (!status.hookReady) {
      install.disabled = true;
      install.title = "The relay isn't installed yet.";
    }
    actions.append(install);
    if (status.installed) {
      actions.append(h("button", {
        class: "danger",
        text: "Uninstall hooks…",
        onclick: () => showPreview(false),
      }));
    }
    body.append(actions);
  }

  async function showPreview(install: boolean) {
    let preview;
    try {
      preview = await Bridge.hooksPreview(install);
    } catch (err) {
      // An unreadable or invalid settings.json stops here rather than being
      // treated as empty and written over.
      clear(body);
      body.append(
        h("div", { class: "notice err", text: String(err).replace(/^Error:\s*/, "") }),
        h("div", { class: "row" }, h("button", {
          text: "Back",
          onclick: () => { clear(body); draw(); },
        })),
      );
      return;
    }
    if (!preview) return;
    clear(body);
    body.append(
      h("div", {
        class: "hint",
        text: install
          ? "This is exactly what will change in your settings.json. Your own hooks are left untouched."
          : "This removes Winsle's entries only. Your own hooks are left untouched.",
      }),
      renderDiff(preview.diff),
      h("div", { class: "row" },
        h("span", { class: "path", text: `Backup → ${preview.backup}` }),
      ),
    );
    const confirm = h("button", {
      class: install ? "primary" : "danger",
      text: install ? "Back up and write" : "Back up and remove",
    });
    confirm.addEventListener("click", async () => {
      confirm.disabled = true;
      try {
        const backup = await Bridge.hooksApply(install, preview.fingerprint);
        clear(body);
        body.append(h("div", {
          class: "notice ok",
          text: `Done. Previous settings saved as ${backup}. Open a new ai-assistant Code session to pick the hooks up.`,
        }));
        window.setTimeout(() => void rebuild(), 2600);
      } catch (err) {
        confirm.disabled = false;
        body.append(h("div", { class: "notice err", text: `Could not write: ${String(err)}` }));
      }
    });
    body.append(h("div", { class: "row" }, confirm, h("button", {
      text: "Cancel",
      onclick: () => { clear(body); draw(); },
    })));
  }

  draw();
  return section;
}

// ── ai-assistant API section ────────────────────────────────────────────────────────

const MODELS: [string, string][] = [
  ["ai-assistant-opus-5", "ai-assistant Opus 5"],
  ["ai-assistant-sonnet-5", "ai-assistant Sonnet 5"],
  ["ai-assistant-haiku-4-5", "ai-assistant Haiku 4.5"],
];

function apiSection(hasKey: boolean): HTMLElement {
  const dot = statusDot(hasKey);
  const state = h("span", { class: "hint", text: hasKey ? "Key saved in the Windows Credential Manager." : "No key yet — the chat needs one." });

  const field = h("input", {
    type: "password",
    placeholder: hasKey ? "••••••••••••  (stored)" : "sk-ant-...",
    style: "flex:1 1 auto;min-width:0",
    autocomplete: "off",
    spellcheck: "false",
  }) as HTMLInputElement;

  const saveBtn = h("button", { class: "primary", text: "Save key" });
  const clearBtn = h("button", { class: "danger", text: "Remove" });
  const feedback = h("div", {});

  async function refresh() {
    const present = (await Bridge.secretPresent("anthropic-api-key")) ?? false;
    dot.style.background = present ? "#22c55e" : "#f4505e";
    state.textContent = present
      ? "Key saved in the Windows Credential Manager."
      : "No key yet — the chat needs one.";
    field.placeholder = present ? "••••••••••••  (stored)" : "sk-ant-...";
    clearBtn.style.display = present ? "" : "none";
  }

  saveBtn.addEventListener("click", async () => {
    const value = field.value.trim();
    if (!value) return;
    clear(feedback);
    try {
      await Bridge.secretSet("anthropic-api-key", value);
      field.value = "";
      feedback.append(h("div", { class: "notice ok", text: "Saved. It never touches disk." }));
      await refresh();
    } catch (err) {
      feedback.append(h("div", { class: "notice err", text: `Could not save: ${String(err)}` }));
    }
  });

  clearBtn.addEventListener("click", async () => {
    clear(feedback);
    try {
      await Bridge.secretClear("anthropic-api-key");
      feedback.append(h("div", { class: "notice ok", text: "Key removed." }));
      await refresh();
    } catch (err) {
      feedback.append(h("div", { class: "notice err", text: `Could not remove: ${String(err)}` }));
    }
  });

  const model = h("select", {}) as HTMLSelectElement;
  for (const [id, label] of MODELS) model.append(h("option", { value: id, text: label }));
  if (!MODELS.some(([id]) => id === settings.model)) {
    model.append(h("option", { value: settings.model, text: settings.model }));
  }
  model.value = settings.model;
  model.addEventListener("change", () => {
    settings.model = model.value;
    void save();
  });

  clearBtn.style.display = hasKey ? "" : "none";

  return h(
    "section",
    {},
    h("h2", {}, dot, h("span", { text: "ai-assistant" })),
    state,
    h("div", { class: "row" }, h("label", { text: "API key" }), field, saveBtn, clearBtn),
    h("div", { class: "row" }, h("label", { text: "Model" }), model),
    feedback,
  );
}

// ── Integrations section ──────────────────────────────────────────────────────

interface IntegrationDef {
  id: string;
  name: string;
  color: string;
  /** Credential Manager keys, in the order they are shown. */
  fields: { key: string; label: string; placeholder: string; secret: boolean }[];
}

const INTEGRATIONS: IntegrationDef[] = [
  { id: "integration_stripe", name: "Stripe", color: "#0570DE",
    fields: [{ key: "stripe-api-key", label: "Secret key", placeholder: "sk_live_…", secret: true }] },
  { id: "integration_github", name: "GitHub", color: "#F4505E",
    fields: [{ key: "github-token", label: "Token", placeholder: "ghp_…", secret: true }] },
  { id: "integration_vercel", name: "Vercel", color: "#7C5CFF",
    fields: [{ key: "vercel-token", label: "Token", placeholder: "…", secret: true }] },
  { id: "integration_n8n", name: "n8n", color: "#F29B38",
    fields: [
      { key: "n8n-url", label: "Instance URL", placeholder: "https://n8n.example.com", secret: false },
      { key: "n8n-api-key", label: "API key", placeholder: "…", secret: true },
    ] },
  { id: "integration_resend", name: "Resend", color: "#22C55E",
    fields: [{ key: "resend-api-key", label: "API key", placeholder: "re_…", secret: true }] },
  { id: "integration_notion", name: "Notion", color: "#8C8C8C",
    fields: [{ key: "notion-api-key", label: "Integration token", placeholder: "ntn_…", secret: true }] },
  { id: "integration_calcom", name: "Cal.com", color: "#C9956A",
    fields: [{ key: "calcom-api-key", label: "API key", placeholder: "cal_…", secret: true }] },
];

const MAX_ACTIVE = 4;

function integrationsSection(present: Record<string, boolean>): HTMLElement {
  const note = h("div", { class: "hint" });
  const list = h("div", { style: "display:flex;flex-direction:column;gap:14px" });

  function updateNote() {
    const used = settings.activeIntegrations.length;
    note.textContent = `Pick up to ${MAX_ACTIVE} pills to show next to Mochi — ${used}/${MAX_ACTIVE} in use. Keys are stored in the Windows Credential Manager, never on disk.`;
  }

  for (const def of INTEGRATIONS) {
    const active = settings.activeIntegrations.includes(def.id);
    const sw = h("button", { class: active ? "switch on" : "switch" });
    sw.addEventListener("click", () => {
      const on = settings.activeIntegrations.includes(def.id);
      if (on) {
        settings.activeIntegrations = settings.activeIntegrations.filter((x) => x !== def.id);
      } else {
        if (settings.activeIntegrations.length >= MAX_ACTIVE) return;
        settings.activeIntegrations = [...settings.activeIntegrations, def.id];
      }
      sw.classList.toggle("on", !on);
      updateNote();
      void save();
    });

    const rows = h("div", { style: "display:flex;flex-direction:column;gap:6px;flex:1 1 auto;min-width:0" });
    for (const field of def.fields) {
      const input = h("input", {
        type: field.secret ? "password" : "text",
        placeholder: present[field.key] ? "••••••••  (stored)" : field.placeholder,
        autocomplete: "off",
        spellcheck: "false",
        style: "flex:1 1 auto;min-width:0",
      }) as HTMLInputElement;
      const saveBtn = h("button", { text: "Save" });
      const dotEl = statusDot(present[field.key] ?? false);
      saveBtn.addEventListener("click", async () => {
        const value = input.value.trim();
        try {
          await Bridge.secretSet(field.key, value);
          present[field.key] = value.length > 0;
          input.value = "";
          input.placeholder = value ? "••••••••  (stored)" : field.placeholder;
          dotEl.style.background = value ? "#22c55e" : "#f4505e";
        } catch {
          dotEl.style.background = "#f5a524";
        }
      });
      rows.append(
        h("div", { class: "row" },
          h("label", { style: "min-width:104px", text: field.label }),
          input, saveBtn, dotEl,
        ),
      );
    }

    list.append(
      h("div", { style: "display:flex;gap:12px;align-items:flex-start" },
        h("div", { style: "display:flex;align-items:center;gap:8px;min-width:132px;padding-top:4px" },
          sw,
          h("i", { class: "dot", style: `background:${def.color}` }),
          h("span", { style: "font-size:12.5px", text: def.name }),
        ),
        rows,
      ),
    );
  }

  updateNote();
  return h("section", {}, h("h2", {}, h("span", { text: "Integrations" })), note, list);
}

// ── General section ───────────────────────────────────────────────────────────

function generalSection(): HTMLElement {
  const volume = h("input", {
    type: "range", min: "0", max: "0.2", step: "0.005",
    value: String(settings.soundVolume),
  }) as HTMLInputElement;
  volume.addEventListener("input", () => {
    settings.soundVolume = Number(volume.value);
    void save();
  });

  const autoClose = h("input", {
    type: "number", min: "5", max: "120", step: "1",
    value: String(Math.round(settings.autoCloseInterval)),
    style: "width:72px",
  }) as HTMLInputElement;
  autoClose.addEventListener("change", () => {
    settings.autoCloseInterval = Math.max(5, Math.min(120, Number(autoClose.value) || 15));
    autoClose.value = String(settings.autoCloseInterval);
    void save();
  });

  const screen = h("select", {}) as HTMLSelectElement;
  screen.append(
    h("option", { value: "primary", text: "Main display" }),
    h("option", { value: "cursor", text: "Display under the cursor" }),
  );
  screen.value = settings.screen;
  screen.addEventListener("change", () => {
    settings.screen = screen.value as Settings["screen"];
    void save();
  });

  return h(
    "section",
    {},
    h("h2", {}, h("span", { text: "General" })),
    h("div", { class: "row" },
      h("label", { text: "Sound" }),
      toggle(settings.soundEnabled, (v) => { settings.soundEnabled = v; void save(); }),
      volume,
    ),
    h("div", { class: "row" },
      h("label", { text: "Auto-close" }),
      autoClose,
      h("span", { class: "hint", text: "seconds after you leave the island" }),
    ),
    h("div", { class: "row" },
      h("label", { text: "Island lives on" }),
      screen,
    ),
    h("div", { class: "row" },
      h("label", { text: "Launch at startup" }),
      toggle(settings.autostart, (v) => { settings.autostart = v; void save(); }),
    ),
  );
}

// ── Home tiles ────────────────────────────────────────────────────────────────

function homeSection(): HTMLElement {
  const current = [...(settings.homeWidgets ?? DEFAULT_HOME_WIDGETS)];
  const selects = [0, 1, 2].map((i) => {
    const sel = h("select", {}) as HTMLSelectElement;
    sel.append(h("option", { value: "", text: "— empty —" }));
    for (const [k, label] of Object.entries(WIDGET_LABELS)) sel.append(h("option", { value: k, text: label }));
    sel.value = current[i] ?? "";
    sel.addEventListener("change", () => {
      const picked = selects.map((x) => x.value).filter(Boolean);
      settings.homeWidgets = [...new Set(picked)];
      void save();
    });
    return sel;
  });
  return h(
    "section",
    {},
    h("h2", {}, h("span", { text: "Home" })),
    h("div", { class: "hint", text: "Up to three tiles next to the VS Code card when the island opens. Click a tile to open its full view." }),
    ...selects.map((sel, i) => h("div", { class: "row" }, h("label", { text: `Tile ${i + 1}` }), sel)),
  );
}

// ── Live activities ───────────────────────────────────────────────────────────

function liveSection(hasCalendar: boolean): HTMLElement {
  const calDot = statusDot(hasCalendar);
  const calField = h("input", {
    type: "password",
    placeholder: hasCalendar ? "••••••••••••  (stored)" : "https://calendar.example.com/sample-link",
    style: "flex:1 1 auto;min-width:0",
    autocomplete: "off",
    spellcheck: "false",
  }) as HTMLInputElement;
  const calSave = h("button", { class: "primary", text: "Save link" });
  const calClear = h("button", { class: "danger", text: "Remove" });
  calClear.style.display = hasCalendar ? "" : "none";
  const calFeedback = h("div", {});

  const say = (ok: boolean, text: string) => {
    clear(calFeedback);
    calFeedback.append(h("div", { class: `notice ${ok ? "ok" : "err"}`, text }));
  };
  const setCalendar = async (value: string) => {
    try {
      if (value) await Bridge.secretSet("calendar-ics-url", value);
      else await Bridge.secretClear("calendar-ics-url");
      const present = (await Bridge.secretPresent("calendar-ics-url")) ?? false;
      calDot.style.background = present ? "#22c55e" : "#f4505e";
      calClear.style.display = present ? "" : "none";
      calField.value = "";
      calField.placeholder = present ? "••••••••••••  (stored)" : "https://…/basic.ics";
      void Bridge.calendarRefresh();
      say(true, value ? "Saved. Upcoming events show up within a few seconds." : "Calendar removed.");
    } catch (err) {
      say(false, `Could not save: ${String(err)}`);
    }
  };
  calSave.addEventListener("click", () => {
    const v = calField.value.trim();
    if (!/^(https?|webcal):\/\//i.test(v)) {
      say(false, "That doesn't look like a calendar link (it should start with https:// or webcal://).");
      return;
    }
    void setCalendar(v.replace(/^webcal:/i, "https:"));
  });
  calClear.addEventListener("click", () => void setCalendar(""));

  const dirs = h("textarea", {
    rows: "3",
    placeholder: "One folder per line, e.g. D:\\Renders",
    style: "flex:1 1 auto;min-width:0;resize:vertical;font:12px var(--mono, monospace)",
    spellcheck: "false",
  }) as HTMLTextAreaElement;
  dirs.value = (settings.renderDirs ?? []).join("\n");
  dirs.addEventListener("change", () => {
    settings.renderDirs = dirs.value.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
    void save();
  });

  const captureDir = h("input", {
    type: "text",
    placeholder: "Documents\\Winsle (default)",
    style: "flex:1 1 auto;min-width:0",
    spellcheck: "false",
    value: settings.captureDir ?? "",
  }) as HTMLInputElement;
  captureDir.addEventListener("change", () => {
    settings.captureDir = captureDir.value.trim();
    void save();
  });

  return h(
    "section",
    {},
    h("h2", {}, h("span", { text: "Live" })),
    h("div", { class: "hint", text: "Media, timers, system load, mic/camera use, downloads and notifications work on their own. These three need a little setup." }),
    h("div", { class: "row" }, h("label", {}, calDot, h("span", { text: " Calendar" })), calField, calSave, calClear),
    h("div", { class: "hint", text: "Google Calendar → Settings → your calendar → \"Secret address in iCal format\". Outlook: Publish calendar → ICS. Stored in the Credential Manager. Reminders fire 30, 15 and 5 minutes before every event." }),
    calFeedback,
    h("div", { class: "row" }, h("label", { text: "Render folders" }), dirs),
    h("div", { class: "hint", text: "Premiere, After Effects, Resolve… output folders. Winsle shows a growing file as a render and tells you when it stops." }),
    h("div", { class: "row" }, h("label", { text: "Capture inbox" }), captureDir),
    h("div", { class: "hint", text: "Ctrl+Alt+Space (or Ctrl+Alt+N if another app holds it) opens quick capture; notes are appended to inbox.md here." }),
  );
}

// ── Habits & privacy ──────────────────────────────────────────────────────────

function habitsSection(): HTMLElement {
  const p = prefs();
  const breakSel = h("select", {}) as HTMLSelectElement;
  for (const [v, label] of [[0, "Off"], [30, "Every 30 min"], [50, "Every 50 min"], [60, "Every hour"], [90, "Every 90 min"]] as const) {
    breakSel.append(h("option", { value: String(v), text: label, selected: p.breakMinutes === v }));
  }
  breakSel.addEventListener("change", () => setPrefs({ breakMinutes: Number(breakSel.value) }));

  const check = (on: boolean, change: (v: boolean) => void) => {
    const el = h("input", { type: "checkbox", checked: on }) as HTMLInputElement;
    el.addEventListener("change", () => change(el.checked));
    return el;
  };
  const cleared = h("span", { class: "hint" });
  const clearClips = h("button", { class: "danger", text: "Clear history" });
  clearClips.addEventListener("click", () => {
    savePref("clips", []);
    cleared.textContent = "Clipboard history cleared.";
  });

  return h(
    "section",
    {},
    h("h2", {}, h("span", { text: "Habits & privacy" })),
    h("div", { class: "row" }, h("label", { text: "Break reminder" }), breakSel),
    h("div", { class: "hint", text: "Counts continuous keyboard/mouse use; five idle minutes reset it. Skipped while a timer runs or you're in a meeting." }),
    h("div", { class: "row" }, h("label", { text: "Quiet in meetings" }), check(p.quietInMeetings, (v) => setPrefs({ quietInMeetings: v }))),
    h("div", { class: "hint", text: "Hold notifications while a calendar event is running, like focus mode. A moon shows in the island while toasts are held." }),
    h("div", { class: "row" }, h("label", { text: "Clipboard history" }), check(p.clipHistory, (v) => setPrefs({ clipHistory: v })), clearClips),
    h("div", { class: "hint", text: "Last 25 copied texts, stored only on this PC. Things that look like keys or tokens are never recorded." }),
    cleared,
    h("div", { class: "hint", text: "Shortcuts: Ctrl+Alt+Space capture · Ctrl+Alt+W show/hide · Ctrl+Alt+F focus timer · Ctrl+Alt+V clipboard." }),
  );
}

// ── Boot ──────────────────────────────────────────────────────────────────────

async function main() {
  const boot = await Bridge.boot();
  if (boot) {
    settings = { ...settings, ...boot.settings };
    version = boot.version;
  }
  const status = (await Bridge.hooksStatus()) ?? {
    installed: false, settingsPath: "", hookPath: "", hookReady: false,
  };

  const hasKey = (await Bridge.secretPresent("anthropic-api-key")) ?? false;
  const hasCalendar = (await Bridge.secretPresent("calendar-ics-url")) ?? false;

  const keys = [
    "stripe-api-key", "github-token", "vercel-token",
    "n8n-url", "n8n-api-key", "resend-api-key", "notion-api-key", "calcom-api-key",
  ];
  const present: Record<string, boolean> = {};
  for (const k of keys) present[k] = (await Bridge.secretPresent(k)) ?? false;

  clear(root);
  root.append(
    h("h1", {}, h("span", { text: "Winsle" }), h("span", { class: "version", text: version })),
    ai-assistantSection(status),
    apiSection(hasKey),
    integrationsSection(present),
    homeSection(),
    liveSection(hasCalendar),
    habitsSection(),
    generalSection(),
    h("div", {
      class: "hint",
      text: "No telemetry. Network requests only go to the services you configure yourself.",
    }),
  );

  void onEvent<Settings>("settings-changed", (s) => {
    settings = { ...settings, ...s };
  });
}

void main();

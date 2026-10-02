// Assistant view: ask Winsle in plain words, plus the reminders, automations
// and snippets the agent manages. Four tabs inside one card.

import type { IslandViewName } from "../core/layout";
import { State } from "../core/state";
import { h, svg } from "../views/dom";
import { ICONS } from "../views/icons";
import type { ViewActions, ViewHost } from "../views/views";
import { Agent, RULES, type AgentReply } from "./agent";
import { Live, fmtTime, fmtUntil } from "./store";
import { roundBtn, shell } from "./views";

type Tab = "ask" | "reminders" | "rules" | "snippets";

const EXAMPLES = ["remind me in 20 min to stretch", "what's next", "pause music", "timer 10", "add task send invoice", "volume 40"];

/** Answer bubble shared by the Assistant view and the palette. */
export function answerBubble(): { el: HTMLElement; show(a: AgentReply | null, thinking?: boolean): void } {
  const text = h("div", { class: "ag-text" });
  const chips = h("div", { class: "ag-did" });
  const el = h("div", { class: "ag-bubble" }, text, chips);
  return {
    el,
    show(a, thinking = false) {
      el.style.display = a || thinking ? "" : "none";
      el.classList.toggle("thinking", thinking);
      text.textContent = thinking ? "Thinking…" : a?.text ?? "";
      chips.replaceChildren(
        ...(a?.ai && !thinking ? [h("span", { class: "ag-chip ai" }, svg(ICONS.sparkle, 9), h("span", { text: "local AI" }))] : []),
        ...(thinking ? [] : (a?.did ?? []).map((d) => h("span", { class: "ag-chip" }, svg(ICONS.check, 9, { stroke: 3 }), h("span", { text: d })))),
      );
    },
  };
}

function toggle(on: boolean, onChange: (v: boolean) => void): HTMLElement {
  const el = h("button", { class: on ? "ag-switch on" : "ag-switch", role: "switch", "aria-checked": String(on) }, h("i"));
  el.addEventListener("click", (e) => {
    e.stopPropagation();
    onChange(!el.classList.contains("on"));
  });
  return el;
}

function buildAgent(actions: ViewActions): ViewHost {
  let tab: Tab = "ask";
  const tabs = h("div", { class: "ag-tabs" });
  const status = h("span", { class: "ag-status" });
  const body = h("div", { class: "ag-body" });

  // Ask
  const input = h("input", { class: "lv-input ag-input", type: "text", spellcheck: "false", autocomplete: "off", placeholder: "Ask or tell Winsle…  e.g. remind me at 5pm to call mum" }) as HTMLInputElement;
  const send = roundBtn(ICONS.arrowUp, "Send", () => void submit(), true);
  const bubble = answerBubble();
  const examples = h("div", { class: "ag-examples" }, ...EXAMPLES.map((ex) => h("button", { class: "ag-ex", text: ex, onclick: () => { input.value = ex; void submit(); } })));
  const past = h("div", { class: "ag-past" });
  const ask = h("div", { class: "ag-pane" }, h("div", { class: "ag-field" }, input, send), bubble.el, examples, past);

  async function submit() {
    const q = input.value.trim();
    if (!q || Agent.busy) return;
    bubble.show(null, true);
    const a = await Agent.ask(q);
    input.value = "";
    bubble.show(a);
  }
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") void submit();
    if (e.key === "Escape") actions.collapse();
  });

  // Reminders
  const remInput = h("input", { class: "lv-input", type: "text", placeholder: "in 20 min call mum · at 5pm stand-up", spellcheck: "false" }) as HTMLInputElement;
  const remList = h("div", { class: "lv-list scroll" });
  const remPane = h("div", { class: "ag-pane" }, h("div", { class: "ag-field" }, remInput,
    roundBtn(ICONS.plus, "Add reminder", () => addReminder(), true)), remList);
  function addReminder() {
    const v = remInput.value.trim();
    if (!v) return;
    const reply = Agent.local(/^remind me/i.test(v) ? v : `remind me ${v}`);
    remInput.value = "";
    remInput.placeholder = reply ? reply.text : "Try “in 20 min …” or “at 5pm …”";
  }
  remInput.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") addReminder();
  });

  // Rules
  const rulesPane = h("div", { class: "ag-pane ag-rules" });

  // Snippets
  const snName = h("input", { class: "lv-input small ag-snname", type: "text", placeholder: "name", spellcheck: "false" }) as HTMLInputElement;
  const snText = h("input", { class: "lv-input", type: "text", placeholder: "Text to paste — email, address, reply…", spellcheck: "false" }) as HTMLInputElement;
  const snList = h("div", { class: "ag-snips" });
  const saveSnip = () => {
    Agent.saveSnippet(snName.value, snText.value);
    snName.value = snText.value = "";
  };
  for (const el of [snName, snText]) el.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") saveSnip();
  });
  const snipPane = h("div", { class: "ag-pane" }, h("div", { class: "ag-field" }, snName, snText, roundBtn(ICONS.plus, "Save snippet", saveSnip, true)), snList,
    h("div", { class: "pl-hint", text: "Type a snippet's name in the palette (Ctrl+Alt+K) to copy it." }));

  const panes: Record<Tab, HTMLElement> = { ask, reminders: remPane, rules: rulesPane, snippets: snipPane };
  const labels: [Tab, string][] = [["ask", "Ask"], ["reminders", "Reminders"], ["rules", "Automations"], ["snippets", "Snippets"]];
  const tabBtns = labels.map(([t, l]) => {
    const b = h("button", { class: "ag-tab", onclick: () => { tab = t; key = ""; State.notify(); focusTab(); } }, h("span", { text: l }), h("i", { class: "ag-count" }));
    return { t, b };
  });
  tabs.append(...tabBtns.map((x) => x.b), status);
  body.append(...Object.values(panes));
  const { el } = shell(tabs, body);
  el.classList.add("ag");

  function focusTab() {
    window.setTimeout(() => (tab === "ask" ? input : tab === "reminders" ? remInput : tab === "snippets" ? snName : null)?.focus(), 60);
  }

  let key = "";
  return {
    el,
    focus() {
      focusTab();
    },
    sync() {
      for (const { t, b } of tabBtns) {
        b.classList.toggle("on", t === tab);
        const n = t === "reminders" ? Agent.reminders.length : t === "snippets" ? Agent.snippets.length : 0;
        (b.querySelector(".ag-count") as HTMLElement).textContent = n ? String(n) : "";
      }
      for (const [t, p] of Object.entries(panes)) p.style.display = t === tab ? "" : "none";
      status.textContent = Agent.aiState === "ready" ? `● ${Agent.model ?? "local AI"}` : Agent.aiState === "starting" ? "Starting local AI…" : Agent.aiState === "off" ? "Rules only — no local AI" : "";
      status.className = `ag-status ${Agent.aiState}`;
      send.classList.toggle("busy", Agent.busy);

      const k = `${tab}|${Agent.reminders.map((r) => r.id).join()}|${JSON.stringify(Agent.rules)}|${Agent.snippets.map((s) => s.name).join()}|${Agent.history.length}`;
      // Reminder countdowns move every sync; the rest only rebuilds on change.
      if (tab === "reminders") {
        remList.replaceChildren(...(Agent.reminders.length ? Agent.reminders.map((r) => h("div", { class: "lv-item ag-rem" },
          h("div", { class: "glyph cal" }, svg(ICONS.bell, 11)),
          h("div", { class: "lv-col" }, h("div", { class: "lv-name", text: r.text }),
            h("div", { class: "lv-meta" }, h("span", { class: "lv-until", text: fmtUntil(r.at) }), h("span", { text: ` · ${fmtTime(r.at)}` }))),
          h("div", { class: "lv-row-acts hover" },
            h("button", { class: "lv-link", text: "+10m", onclick: () => Agent.snooze(r, 10) }),
            roundBtn(ICONS.xmark, "Delete", () => Agent.removeReminder(r.id))))) : [h("div", { class: "lv-meta", text: "No reminders. Add one above, or ask: “remind me in 1 h to drink water”." })]));
      }
      if (k === key) return;
      key = k;
      if (tab === "ask") {
        past.replaceChildren(...Agent.history.slice(1, 4).map((x) => h("button", { class: "ag-hist", title: x.a.text, onclick: () => { input.value = x.q; input.focus(); } },
          h("span", { class: "q", text: x.q }), h("span", { class: "a", text: x.a.text }))));
        if (Agent.history[0] && !Agent.busy) bubble.show(Agent.history[0].a);
        examples.style.display = Agent.history.length ? "none" : "";
      }
      if (tab === "rules") {
        rulesPane.replaceChildren(...RULES.map((r) => h("div", { class: "ag-rule" },
          h("div", { class: "lv-col" }, h("div", { class: "lv-name", text: r.title }), h("div", { class: "lv-meta", text: r.sub })),
          toggle(Agent.rules[r.id], (v) => Agent.setRule(r.id, v)))),
          h("div", { class: "ag-rule-foot" },
            h("button", { class: "lv-link", text: "Write today's journal now", onclick: () => void Agent.writeJournal(true) }),
            h("button", { class: "lv-link", text: "Show briefing", onclick: () => Agent.briefing() })));
      }
      if (tab === "snippets") {
        snList.replaceChildren(...(Agent.snippets.length ? Agent.snippets.map((s) => h("span", { class: "ag-snip", title: s.text },
          h("button", { class: "ag-snip-name", text: `;${s.name}`, onclick: () => void Live.copyClip(s.text) }),
          h("button", { class: "ag-snip-x", "aria-label": "Delete", onclick: () => Agent.removeSnippet(s.name) }, svg(ICONS.xmark, 8)))) : [h("span", { class: "lv-meta", text: "Save text you paste often." })]));
      }
    },
  };
}

export function buildAgentViews(actions: ViewActions, map: Map<IslandViewName, ViewHost>) {
  map.set("agent", buildAgent(actions));
}

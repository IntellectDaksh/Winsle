// Google Calendar / Outlook sign-in, RSVP and quick-create. Kept free of the
// live store so the settings window can import the account rows too.

import { invoke } from "@tauri-apps/api/core";
import { IS_TAURI } from "../core/bridge";
import { h, clear } from "../views/dom";
import type { AgentReply } from "./agent";

export type CalendarProvider = "google" | "microsoft";

interface Account {
  provider: CalendarProvider;
  configured: boolean;
  connected: boolean;
}

interface Created {
  title: string;
  start: number;
  provider: CalendarProvider;
}

const NAMES: Record<CalendarProvider, string> = { google: "Google Calendar", microsoft: "Outlook" };
const DOCS = "https://github.com/IntellectDaksh/Winsle/blob/HEAD/docs/OAUTH-SETUP.md";

const msg = (err: unknown) => String(err).replace(/^Error:\s*/, "");

export function calendarRsvp(id: string, accept: boolean): Promise<void> {
  return invoke<void>("calendar_rsvp", { id, accept });
}

/** "event tomorrow 3pm Call with X" → creates it on the connected account; null when the text isn't an event request. */
export async function quickEvent(text: string): Promise<AgentReply | null> {
  if (!/^(?:(?:new|add|create)\s+)?(?:event|meeting)\s+\S/i.test(text) || !IS_TAURI) return null;
  try {
    const c = await invoke<Created>("calendar_quick_create", { text, tzOffsetMin: -new Date().getTimezoneOffset() });
    const when = new Date(c.start).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });
    return { text: `Added “${c.title}” ${when} to ${NAMES[c.provider]}.`, did: ["Event"], ai: false };
  } catch (err) {
    return { text: msg(err), did: [], ai: false };
  }
}

/** Settings → Live: one Connect/Disconnect row per provider. */
export function calendarAccountRows(onChange: () => void): HTMLElement {
  const box = h("div", {});
  const feedback = h("div", {});
  const say = (ok: boolean, text: string) => {
    clear(feedback);
    feedback.append(h("div", { class: `notice ${ok ? "ok" : "err"}`, text }));
  };
  const render = async () => {
    const accounts = IS_TAURI ? await invoke<Account[]>("calendar_accounts").catch(() => []) : [];
    clear(box);
    for (const a of accounts) {
      const dot = h("span", { class: "dot", style: `display:inline-block;width:8px;height:8px;border-radius:50%;background:${a.connected ? "#22c55e" : "#f4505e"}` });
      const action = !a.configured
        ? h("a", { href: "#", text: "Not configured in this build", onclick: ((e: Event) => { e.preventDefault(); void invoke("open_url", { url: DOCS }); }) as EventListener })
        : a.connected
          ? h("button", { class: "danger", text: "Disconnect" })
          : h("button", { class: "primary", text: `Connect ${a.provider === "google" ? "Google" : "Outlook"}` });
      if (action instanceof HTMLButtonElement) {
        action.addEventListener("click", async () => {
          action.disabled = true;
          const was = action.textContent;
          if (!a.connected) action.textContent = "Waiting for browser…";
          try {
            await invoke(a.connected ? "calendar_disconnect" : "calendar_connect", { provider: a.provider });
            say(true, a.connected ? `${NAMES[a.provider]} disconnected.` : `${NAMES[a.provider]} connected. Events show up in a few seconds.`);
            onChange();
          } catch (err) {
            say(false, msg(err));
            action.textContent = was;
          }
          action.disabled = false;
          void render();
        });
      }
      box.append(h("div", { class: "row" }, h("label", {}, dot, h("span", { text: ` ${NAMES[a.provider]}` })), action));
    }
  };
  void render();
  return h("div", {}, box, feedback);
}

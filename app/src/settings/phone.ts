// Settings → Phone link: enable the LAN server, show the pairing code/QR, revoke devices.

import { invoke } from "@tauri-apps/api/core";
import { IS_TAURI } from "../core/bridge";
import { h, clear } from "../views/dom";

interface PhoneStatus {
  enabled: boolean;
  running: boolean;
  url: string | null;
  code: string;
  qrSvg: string | null;
  devices: { id: string; name: string; paired: number }[];
  error: string | null;
}

export function phoneSection(): HTMLElement {
  const body = h("div", {});
  const msg = h("div", { class: "hint", role: "status" });

  const run = async (cmd: string, args?: Record<string, unknown>) => {
    if (!IS_TAURI) return;
    try {
      render(await invoke<PhoneStatus>(cmd, args));
      msg.textContent = "";
    } catch (e) {
      msg.textContent = String(e);
    }
  };

  function render(s: PhoneStatus) {
    clear(body);
    const sw = h("button", { class: s.enabled ? "switch on" : "switch", "aria-pressed": s.enabled, "aria-label": "Phone link" });
    sw.addEventListener("click", () => void run("phone_set_enabled", { on: !s.enabled }));
    body.append(
      h("div", { class: "row" }, h("label", { text: "Phone link" }), sw),
      h("div", { class: "hint", text: "Lets a phone on the same Wi-Fi send notifications and clipboard text to this PC and control media. Nothing leaves your network. The first time, Windows asks to allow Winsle through the firewall: allow Private networks only." }),
    );
    if (s.error) body.append(h("div", { class: "hint", style: "color:#f4505e", text: s.error }));
    if (s.running && s.url) {
      const newCode = h("button", { text: "New code" });
      newCode.addEventListener("click", () => void run("phone_new_code"));
      body.append(
        h("div", { class: "row" }, h("label", { text: "Open on phone" }), h("code", { text: s.url })),
        h("div", { class: "row" }, h("label", { text: "Pairing code" }), h("code", { style: "font-size:18px;letter-spacing:3px", text: s.code }), newCode),
      );
      if (s.qrSvg) {
        body.append(h("img", {
          src: "data:image/svg+xml;charset=utf-8," + encodeURIComponent(s.qrSvg),
          alt: `QR code for ${s.url}`, width: 160, height: 160,
          style: "display:block;margin:8px 0;border-radius:6px",
        }));
      }
    }
    for (const d of s.devices) {
      const revoke = h("button", { class: "danger", text: "Revoke" });
      revoke.addEventListener("click", () => void run("phone_revoke", { id: d.id }));
      body.append(h("div", { class: "row" },
        h("label", { text: d.name }),
        h("span", { class: "hint", text: `paired ${new Date(d.paired).toLocaleDateString()}` }),
        revoke));
    }
  }

  void run("phone_status");
  return h("section", {}, h("h2", {}, h("span", { text: "Phone link" })), body, msg);
}

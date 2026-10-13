// Optional Spotify account link (see src-tauri/src/live/spotify.rs). Calls throw
// with the backend's message so the island can show it as is.

import { invoke } from "@tauri-apps/api/core";
import { IS_TAURI } from "../core/bridge";
import type { MediaInfo } from "./types";
import { h } from "../views/dom";

export interface SpotifyStatus { configured: boolean; connected: boolean; account: string | null; error: string | null }
export interface SpotifyTrack { id: string; liked: boolean }
export interface SpotifyPlaylist { name: string; uri: string }

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!IS_TAURI) throw new Error("Spotify needs the desktop app.");
  try {
    return await invoke<T>(cmd, args);
  } catch (err) {
    throw new Error(String(err).replace(/^Error:\s*/, ""));
  }
}

export const HEART = "M12 20.5 10.6 19.2C5.4 14.5 2 11.4 2 7.6 2 4.5 4.4 2 7.5 2c1.7 0 3.4.8 4.5 2.1C13.1 2.8 14.8 2 16.5 2 19.6 2 22 4.5 22 7.6c0 3.8-3.4 6.9-8.6 11.6L12 20.5z";
export const HEART_OUTLINE = "M16.5 2c-1.7 0-3.4.8-4.5 2.1C10.9 2.8 9.2 2 7.5 2 4.4 2 2 4.5 2 7.6c0 3.8 3.4 6.9 8.6 11.6L12 20.5l1.4-1.3C18.6 14.5 22 11.4 22 7.6 22 4.5 19.6 2 16.5 2zm-4.4 15.7-.1.1-.1-.1C7.1 13.4 4 10.6 4 7.6 4 5.6 5.5 4 7.5 4c1.5 0 3 1 3.6 2.4h1.9C13.5 5 15 4 16.5 4c2 0 3.5 1.6 3.5 3.6 0 3-3.1 5.8-7.9 10.1z";

let connected: boolean | null = null;
let current: { key: string; track: SpotifyTrack | null } | null = null;

export const Spotify = {
  status: () => call<SpotifyStatus>("spotify_status").then((s) => ((connected = s.connected), s)),
  connect: () => call<string>("spotify_connect").then((n) => ((connected = true), n)),
  disconnect: () => call<void>("spotify_disconnect").then(() => { connected = false; current = null; }),
  play: (query: string) => call<string>("spotify_search_play", { query, queue: false }),
  queue: (query: string) => call<string>("spotify_search_play", { query, queue: true }),
  playlists: () => call<SpotifyPlaylist[]>("spotify_playlists"),
  playPlaylist: (uri: string) => call<void>("spotify_play_playlist", { uri }),

  async isConnected(): Promise<boolean> {
    if (connected == null) await this.status().catch(() => (connected = false));
    return !!connected;
  },

  /** Liked state for what's playing, looked up once per track; null when not Spotify/not linked. */
  async track(m: MediaInfo | null): Promise<SpotifyTrack | null> {
    if (!m || !/spotify/i.test(m.app) || !(await this.isConnected())) return null;
    const key = `${m.title}\u001f${m.artist}`;
    if (current?.key !== key) {
      current = { key, track: await call<SpotifyTrack | null>("spotify_current", { title: m.title, artist: m.artist }).catch(() => null) };
    }
    return current.track;
  },

  async setLiked(t: SpotifyTrack, like: boolean) {
    await call<void>("spotify_like", { id: t.id, like });
    t.liked = like;
  },

  /** "play <q>", "queue <q>", "playlists", "playlist <name>"; null if not a Spotify command or not linked. */
  async command(text: string): Promise<string | null> {
    const m = /^(play|queue|playlist)\s+(.+)$/i.exec(text.trim()) ?? /^(playlists)$/i.exec(text.trim());
    if (!m || /^(play)\s+(music|the music|song)$/i.test(text.trim()) || !(await this.isConnected())) return null;
    const verb = m[1].toLowerCase();
    if (verb === "play") return `Playing ${await this.play(m[2])}.`;
    if (verb === "queue") return `Queued ${await this.queue(m[2])}.`;
    const lists = await this.playlists();
    if (verb === "playlists") return lists.length ? lists.slice(0, 12).map((p) => p.name).join(" · ") : "No playlists on this account.";
    const want = m[2].toLowerCase();
    const hit = lists.find((p) => p.name.toLowerCase() === want) ?? lists.find((p) => p.name.toLowerCase().includes(want));
    if (!hit) return `No playlist called "${m[2]}".`;
    await this.playPlaylist(hit.uri);
    return `Playing ${hit.name}.`;
  },
};

/** Settings → Live row: Connect / Disconnect with the linked account name. */
export function spotifySettingsRow(): HTMLElement {
  const dot = h("i", { class: "dot" });
  const label = h("span", { text: " Spotify" });
  const btn = h("button", { class: "primary" }) as HTMLButtonElement;
  const note = h("div", {});
  const say = (ok: boolean, text: string) => note.replaceChildren(h("div", { class: `notice ${ok ? "ok" : "err"}`, text }));
  let isOn = false;
  const draw = (s: SpotifyStatus) => {
    isOn = s.connected;
    dot.setAttribute("style", `background:${s.connected ? "#22c55e" : "#f4505e"}`);
    label.textContent = s.connected && s.account ? ` Spotify · ${s.account}` : " Spotify";
    btn.className = s.connected ? "danger" : "primary";
    btn.textContent = s.connected ? "Disconnect" : "Connect";
    btn.disabled = !s.configured;
    if (!s.configured) say(false, "Not configured in this build. See docs/OAUTH-SETUP.md (Spotify) to add a client ID.");
    else if (s.error) say(false, s.error);
  };
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    try {
      if (isOn) {
        await Spotify.disconnect();
        say(true, "Spotify disconnected.");
      } else {
        say(true, "Finish signing in in your browser…");
        say(true, `Connected as ${await Spotify.connect()}.`);
      }
    } catch (err) {
      say(false, (err as Error).message);
    }
    draw(await Spotify.status().catch((e) => ({ configured: true, connected: false, account: null, error: (e as Error).message })));
  });
  void Spotify.status().then(draw, (e) => say(false, (e as Error).message));
  return h("div", {},
    h("div", { class: "row" }, h("label", {}, dot, label), btn),
    h("div", { class: "hint", text: "Optional. Adds like/unlike, \"play …\", \"queue …\", \"playlist …\" in the command bar. Now playing works without it. Playback control needs Spotify Premium." }),
    note,
  );
}

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

import {
  HEART,
  HEART_OUTLINE,
  parseSpotifyCommand,
  sanitizeTrackMetadata,
  formatTrackProgress,
} from "./spotify-utils";

export {
  HEART,
  HEART_OUTLINE,
  parseSpotifyCommand,
  sanitizeTrackMetadata,
  formatTrackProgress,
};

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
    const cmd = parseSpotifyCommand(text);
    if (!cmd || !(await this.isConnected())) return null;
    if (cmd.action === "play" && cmd.target) return `Playing ${await this.play(cmd.target)}.`;
    if (cmd.action === "queue" && cmd.target) return `Queued ${await this.queue(cmd.target)}.`;
    const lists = await this.playlists();
    if (cmd.action === "playlists") return lists.length ? lists.slice(0, 12).map((p) => p.name).join(" · ") : "No playlists on this account.";
    if (cmd.action === "playlist" && cmd.target) {
      const want = cmd.target.toLowerCase();
      const hit = lists.find((p) => p.name.toLowerCase() === want) ?? lists.find((p) => p.name.toLowerCase().includes(want));
      if (!hit) return `No playlist called "${cmd.target}".`;
      await this.playPlaylist(hit.uri);
      return `Playing ${hit.name}.`;
    }
    return null;
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

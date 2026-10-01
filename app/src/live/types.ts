// Payloads of the live-activity events emitted by src-tauri/src/live/*.rs.
// Rust structs serialise with `#[serde(rename_all = "camelCase")]` to exactly these.

/** `live-media` — the current Windows media session, or null when nothing is playing/paused. */
export interface MediaInfo {
  app: string; // friendly app name, e.g. "Spotify", "Chrome"
  title: string;
  artist: string;
  album: string;
  playing: boolean;
  /** Seconds. null when the app does not report a timeline. */
  position: number | null;
  duration: number | null;
  /** data:image/...;base64 thumbnail, or null. Re-sent only when the track changes. */
  art: string | null;
  canPrev: boolean;
  canNext: boolean;
}

/** `live-sys` — every 2 s. */
export interface SysInfo {
  cpu: number; // 0–100
  ramUsedGb: number;
  ramTotalGb: number;
  ramPct: number; // 0–100
  /** NVIDIA only (NVML); null when unavailable. */
  gpu: number | null;
  gpuTemp: number | null; // °C
  vramPct: number | null;
  diskFreeGb: number;
  diskTotalGb: number;
  uptimeS: number;
  /** Bytes/s over hardware adapters; null on the first sample. */
  netDown: number | null;
  netUp: number | null;
}

/** `live-privacy` — on change. Friendly app names currently using each device. */
export interface PrivacyInfo {
  mic: string[];
  cam: string[];
}

/** One growing file. */
export interface ProgressItem {
  id: string; // full path
  name: string; // final file name (without .crdownload etc.)
  kind: "download" | "render";
  bytes: number;
  totalBytes: number | null;
  speed: number; // bytes/s, smoothed
  done: boolean; // sent once when it completes, then dropped
}

/** `live-progress` — on change. */
export interface ProgressInfo {
  items: ProgressItem[];
}

/** `live-notif` — one per new Windows toast. */
export interface NotifInfo {
  id: string;
  appId: string;
  app: string; // friendly name
  title: string;
  body: string;
  time: number; // epoch ms
}

export interface CalendarEvent {
  title: string;
  start: number; // epoch ms
  end: number;
  joinUrl: string | null; // Meet / Zoom / Teams link found in the event
  location: string | null;
}

/** `live-calendar` — next 24 h, sorted, every 5 min and on calendar_refresh. */
export interface CalendarInfo {
  events: CalendarEvent[];
  error: string | null;
}

/** `live-power` — on change (and once at start). null fields = no battery (desktop). */
export interface PowerInfo {
  percent: number | null; // 0–100
  charging: boolean;
  /** Seconds of battery left, when Windows knows. */
  secondsLeft: number | null;
}

/** `live-net` — on change. */
export interface NetInfo {
  online: boolean;
}

/** `live-clip` — once per new clipboard text (not images/files). Truncated to 200 chars. */
export interface ClipInfo {
  text: string;
}

/** `volume_step(delta)` returns the new master volume 0–1; also emitted as `live-volume` {level, muted} on change. */
export interface VolumeInfo {
  level: number;
  muted: boolean;
}

/** `top_procs` — heaviest apps by working set, grouped by exe name. */
export interface ProcInfo {
  name: string;
  mb: number;
  count: number;
}

/** `capture_list` — one task line of inbox.md. */
export interface TaskLine {
  line: number;
  text: string;
  done: boolean;
}

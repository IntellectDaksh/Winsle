// Pure voice command transcription cleaner and intent parser.
// Filters whisper.cpp artifacts, subtitle tokens, and matches fast local island actions.

export type VoiceIntentType =
  | "media_play"
  | "media_pause"
  | "media_next"
  | "volume_mute"
  | "volume_unmute"
  | "volume_up"
  | "volume_down"
  | "task"
  | "query";

export interface VoiceIntent {
  type: VoiceIntentType;
  param?: string;
}

const WHISPER_HALLUCINATIONS = [
  /^\[.*?\]$/i,
  /^\(.*?\)$/i,
  /^thank you for watching\.?$/i,
  /^subtitles by .*$/i,
  /^bye\.?$/i,
];

/**
 * Cleans whisper.cpp speech transcription:
 * - Strips hallucination tags like [BLANK_AUDIO], [music], (silence)
 * - Normalizes quotes and spacing
 * - Capitalizes first letter
 */
export function cleanVoiceTranscription(raw: string | null | undefined): string {
  if (!raw || typeof raw !== "string") return "";
  let s = raw.trim();

  // Strip brackets and parentheses tags e.g. [BLANK_AUDIO], (music)
  s = s.replace(/\[(?:blank_audio|music|applause|laughter|silence|snort|cough)\]/gi, "");
  s = s.replace(/\((?:music|applause|laughter|silence)\)/gi, "");

  // Remove surrounding quotes
  s = s.replace(/^["'“‘]+|["'”’]+$/g, "").trim();

  // Check for hallucinated silence lines
  for (const re of WHISPER_HALLUCINATIONS) {
    if (re.test(s)) return "";
  }

  // Collapse multiple spaces
  s = s.replace(/\s+/g, " ").trim();
  if (!s) return "";

  // Capitalize first character
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Matches common quick voice commands into local actions before falling back to full LLM.
 */
export function matchVoiceIntent(text: string): VoiceIntent {
  const norm = text.trim().toLowerCase().replace(/[.!?,]+$/, "");

  if (/^(?:play|resume|unpause)(?:\s+music)?$/i.test(norm)) {
    return { type: "media_play" };
  }
  if (/^(?:pause|stop)(?:\s+music)?$/i.test(norm)) {
    return { type: "media_pause" };
  }
  if (/^(?:next|skip|next\s+track|next\s+song)$/i.test(norm)) {
    return { type: "media_next" };
  }
  if (/^(?:mute|silence|be\s+quiet)$/i.test(norm)) {
    return { type: "volume_mute" };
  }
  if (/^(?:unmute)$/i.test(norm)) {
    return { type: "volume_unmute" };
  }
  if (/^(?:volume\s+up|louder|turn\s+it\s+up)$/i.test(norm)) {
    return { type: "volume_up" };
  }
  if (/^(?:volume\s+down|quieter|lower\s+volume|turn\s+it\s+down)$/i.test(norm)) {
    return { type: "volume_down" };
  }

  const taskMatch = /^(?:remember to|todo|add task|task)\s+(.+)$/i.exec(text);
  if (taskMatch) {
    return { type: "task", param: taskMatch[1].trim() };
  }

  return { type: "query", param: text };
}

/**
 * Returns true if the transcription has substantive words to act upon.
 */
export function isActionableVoiceCommand(text: string | null | undefined): boolean {
  const cleaned = cleanVoiceTranscription(text);
  return cleaned.length > 1 && /[a-z0-9]/i.test(cleaned);
}

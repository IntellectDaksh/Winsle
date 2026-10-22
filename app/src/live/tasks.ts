// Helper utilities for parsing and formatting markdown task checkboxes and timestamps.

export interface ParsedTask {
  done: boolean;
  text: string;
  stamp?: string;
}

const TASK_RE = /^[\s\t]*[-*]\s*\[([ xX])\]\s*(.*?)(?:\s{2,}_\((.*?)\)_)?$/;

/**
 * Parses a markdown task item like:
 * "- [ ] Finish report  _(2026-10-22 12:00)_"
 * "* [x] Call doctor"
 */
export function parseTaskLine(raw: string): ParsedTask | null {
  const line = raw.replace(/[\r\n]+$/, "");
  const match = TASK_RE.exec(line);
  if (!match) return null;

  const done = match[1].toLowerCase() === "x";
  const text = match[2].trim();
  const stamp = match[3]?.trim();

  if (!text) return null;

  return {
    done,
    text,
    stamp: stamp || undefined,
  };
}

/**
 * Formats a task into standard Markdown checkbox format.
 */
export function formatTaskLine(text: string, stamp?: string, done = false): string {
  const cleanText = text.replace(/[\r\n]+/g, " ").trim();
  const mark = done ? "x" : " ";
  if (stamp?.trim()) {
    return `- [${mark}] ${cleanText}  _(${stamp.trim()})_\n`;
  }
  return `- [${mark}] ${cleanText}\n`;
}

export interface MemoryHit {
  path: string;
  title: string;
  excerpt: string;
  score: number;
}

export interface ClipItem {
  text: string;
  time: number;
}

/**
 * Normalizes OCR raw text:
 * - Converts CRLF to LF
 * - Trims trailing whitespace per line
 * - Collapses consecutive blank lines into single blank line
 * - Trims leading and trailing outer whitespace
 */
export function cleanVisionText(raw: string): string {
  if (!raw) return "";
  return raw
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Formats OCR extraction summary with character and line count.
 */
export function formatVisionSummary(text: string, windowTitle = "App window"): string {
  const cleaned = cleanVisionText(text);
  if (!cleaned) {
    return `No readable text found in ${windowTitle}.`;
  }
  const lines = cleaned.split("\n").length;
  const chars = cleaned.length;
  return `${chars.toLocaleString()} character${chars === 1 ? "" : "s"} across ${lines} line${lines === 1 ? "" : "s"} found in ${windowTitle}.`;
}

/**
 * Filters clipboard items matching a case-insensitive query and limits result count.
 */
export function filterClipboardHistory(
  clips: ClipItem[],
  query: string,
  limit = 10
): ClipItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return clips
    .filter((c) => c.text.toLowerCase().includes(q))
    .slice(0, Math.max(0, limit));
}

/**
 * Formats an excerpt safely on word boundaries up to maxLen characters.
 */
export function formatMemoryExcerpt(excerpt: string, maxLen = 120): string {
  const singleLine = excerpt.replace(/\s+/g, " ").trim();
  if (singleLine.length <= maxLen) return singleLine;
  const truncated = singleLine.slice(0, maxLen);
  const lastSpace = truncated.lastIndexOf(" ");
  if (lastSpace > maxLen * 0.6) {
    return `${truncated.slice(0, lastSpace)}…`;
  }
  return `${truncated}…`;
}

/**
 * Ranks search results by relevance score ascending (SQLite FTS5 bm25 produces lower/negative scores for closer matches).
 */
export function rankMemoryHits(hits: MemoryHit[]): MemoryHit[] {
  return [...hits].sort((a, b) => a.score - b.score);
}

/**
 * Chat prompt sanitization and history boundary utilities.
 */

export const MAX_CHAT_PROMPT_LENGTH = 2000;
export const MAX_CHAT_HISTORY_ENTRIES = 50;

/**
 * Sanitizes user chat query input, stripping nulls/control codes and enforcing maximum length.
 */
export function sanitizeChatPrompt(input: string, maxChars = MAX_CHAT_PROMPT_LENGTH): string {
  if (!input) return "";
  const cleaned = input
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .trim();
  return cleaned.slice(0, maxChars);
}

/**
 * Bounds chat history to a maximum number of recent messages to prevent unbounded memory growth.
 */
export function boundChatHistory<T>(history: T[], maxEntries = MAX_CHAT_HISTORY_ENTRIES): T[] {
  if (history.length <= maxEntries) {
    return history;
  }
  return history.slice(history.length - maxEntries);
}

/**
 * Returns input placeholder string depending on conversation state.
 */
export function getPlaceholderText(historyLength: number): string {
  return historyLength === 0 ? "Ask me anything…" : "Continue…";
}

/**
 * Resolves context chip label for dropped files, avoiding malicious or oversized labels.
 */
export function calcChatChipLabel(file: { name?: string } | null | undefined, maxChars = 60): string {
  if (!file || !file.name) return "";
  const trimmed = file.name.trim();
  return trimmed.slice(0, maxChars);
}

/**
 * Checks whether the initial message should attach the dropped file context.
 */
export function shouldAttachFileContext(historyLength: number, hasDroppedFile: boolean): boolean {
  return historyLength === 1 && hasDroppedFile;
}

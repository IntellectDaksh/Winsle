// Helper functions for calendar event intent matching and title cleaning.

const QUICK_EVENT_RE = /^(?:(?:new|add|create)\s+)?(?:event|meeting)\s+(\S.*)$/i;

/**
 * Returns true if text matches a natural language calendar quick-event creation request.
 */
export function isQuickEventRequest(text: string): boolean {
  return QUICK_EVENT_RE.test(text.trim());
}

/**
 * Extracts and cleans the event description/title from a quick-event command string.
 * e.g. "add event tomorrow 3pm Call with Daksh" -> "tomorrow 3pm Call with Daksh"
 */
export function extractEventPrompt(text: string): string | null {
  const match = QUICK_EVENT_RE.exec(text.trim());
  if (!match) return null;
  return match[1].trim();
}

/**
 * Validates whether an HTTP/HTTPS URL is a known video conference meeting link.
 */
export function isConferenceUrl(url: string): boolean {
  const s = url.trim();
  if (!s.startsWith("https://") && !s.startsWith("http://")) return false;
  try {
    const parsed = new URL(s);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname;

    return (
      (host === "meet.google.com" && path.length > 1) ||
      ((host === "zoom.us" || host.endsWith(".zoom.us")) && path.startsWith("/j/")) ||
      (host === "teams.microsoft.com" && path.startsWith("/l/meetup-join/")) ||
      (host === "teams.live.com" && path.startsWith("/meet/")) ||
      (host.endsWith(".webex.com") && (path.startsWith("/meet/") || path.startsWith("/join/")))
    );
  } catch {
    return false;
  }
}

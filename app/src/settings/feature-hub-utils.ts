export interface Notice {
  info: {
    id: string;
    appId: string;
    app: string;
    title: string;
    body: string;
    time: number;
  };
  repeats: number;
  status: "unread" | "read" | "snoozed" | "dismissed" | string;
  snoozeUntil: number;
}

export interface ExtensionAction {
  id: string;
  label: string;
  kind: string;
  prefix: string;
}

export interface ExtensionManifest {
  id: string;
  name: string;
  description: string;
  permissions: string[];
  subscriptions: string[];
  actions: ExtensionAction[];
}

export function filterNotices(
  notices: Notice[],
  statusFilter: string,
  searchQuery: string
): Notice[] {
  const q = searchQuery.trim().toLowerCase();
  return notices.filter((n) => {
    const matchesStatus = statusFilter === "all" || n.status === statusFilter;
    if (!matchesStatus) return false;
    if (!q) return true;
    const haystack = `${n.info.app} ${n.info.title} ${n.info.body}`.toLowerCase();
    return haystack.includes(q);
  });
}

export function validateExtensionManifest(raw: unknown): { valid: boolean; error?: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { valid: false, error: "Manifest must be a JSON object" };
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.id !== "string" || !/^[a-z0-9-_]{1,64}$/i.test(obj.id)) {
    return { valid: false, error: "Manifest requires a valid alphanumeric id (1-64 chars)" };
  }
  if (typeof obj.name !== "string" || obj.name.trim().length === 0) {
    return { valid: false, error: "Manifest requires a non-empty name" };
  }
  if (!Array.isArray(obj.permissions)) {
    return { valid: false, error: "Manifest permissions must be an array" };
  }
  if (!Array.isArray(obj.actions)) {
    return { valid: false, error: "Manifest actions must be an array" };
  }
  return { valid: true };
}

export function calculateSnoozeUntil(nowMs: number, minutes: number): number {
  const safeMinutes = Math.max(1, Math.min(1440, minutes));
  return nowMs + safeMinutes * 60 * 1000;
}

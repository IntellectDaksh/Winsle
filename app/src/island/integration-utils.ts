/**
 * Pure utilities for integration credentials, state updates, and task badges.
 */

export const INTEGRATION_SECRET_KEYS: Record<string, string> = {
  integration_stripe: "stripe-api-key",
  integration_github: "github-token",
  integration_vercel: "vercel-token",
  integration_n8n: "n8n-api-key",
  integration_resend: "resend-api-key",
  integration_notion: "notion-api-key",
  integration_calcom: "calcom-api-key",
};

export const CLEAR_TASK_TIMEOUT_MS = 60_000;

export interface IntegrationStateRecord {
  data: Record<string, any>;
  error: string | null;
  loaded: boolean;
  configured: boolean;
}

export interface IntegrationEventPayload {
  success: boolean;
  label: string;
  detail?: string | null;
}

/**
 * Returns the Windows Credential Manager key associated with an integration ID.
 */
export function getSecretKeyForIntegration(id: string): string | undefined {
  return INTEGRATION_SECRET_KEYS[id];
}

/**
 * Computes updated integration state, preserving cached data during transient errors.
 */
export function computeIntegrationState(
  previous: IntegrationStateRecord | undefined,
  data: Record<string, any>,
  error: string | null | undefined
): IntegrationStateRecord {
  const isErr = Boolean(error);
  return {
    data: isErr ? (previous?.data ?? {}) : data,
    error: error ?? null,
    loaded: isErr ? (previous?.loaded ?? false) : true,
    configured: previous?.configured ?? true,
  };
}

/**
 * Converts an integration event payload into task state, steps, and badge values.
 */
export function computeTaskEventUpdate(event: IntegrationEventPayload, isFocused = false): {
  state: "finished" | "error";
  steps: string[];
  stepIndex: number;
  pillBadge: "finished" | "error" | null;
} {
  const state = event.success ? "finished" : "error";
  const steps = event.detail ? [event.label, event.detail] : [event.label];
  return {
    state,
    steps,
    stepIndex: steps.length - 1,
    pillBadge: isFocused ? null : state,
  };
}

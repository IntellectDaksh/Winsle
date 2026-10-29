// Integration events → island state. Port of the `handle…` methods in the Swift
// pollers: a genuinely new item flips the pill to finished/error, badges it when
// the pill isn't focused, plays a sound, and clears itself after 60 s.

import { onEvent, Bridge, type IntegrationUpdate } from "../core/bridge";
import { Sound } from "../core/sound";
import { State } from "../core/state";
import type { Island } from "./island";
import {
  INTEGRATION_SECRET_KEYS,
  CLEAR_TASK_TIMEOUT_MS,
  getSecretKeyForIntegration,
  computeIntegrationState,
  computeTaskEventUpdate,
} from "./integration-utils.js";

export {
  INTEGRATION_SECRET_KEYS,
  CLEAR_TASK_TIMEOUT_MS,
  getSecretKeyForIntegration,
  computeIntegrationState,
  computeTaskEventUpdate,
};

const clearTimers = new Map<string, number>();

export function registerIntegrationHandlers(island: Island) {
  void onEvent<IntegrationUpdate>("integration", (update) => handle(island, update));
  void refreshConfigured();
}

/** Asks Rust which keys exist so the idle cards can say so. */
export async function refreshConfigured() {
  for (const [id, key] of Object.entries(INTEGRATION_SECRET_KEYS)) {
    const present = (await Bridge.secretPresent(key)) ?? false;
    const info = State.integrations[id] ?? { data: {}, error: null, loaded: false, configured: false };
    State.integrations[id] = { ...info, configured: present };
  }
  const hooks = State.settings.hooksInstalled;
  const claude = State.integrations.integration_claude ?? {
    data: {}, error: null, loaded: false, configured: false,
  };
  State.integrations.integration_claude = { ...claude, configured: hooks };
  State.notify();
}

function handle(island: Island, update: IntegrationUpdate) {
  if (State.paused) return;

  const previous = State.integrations[update.id];
  State.integrations[update.id] = computeIntegrationState(previous, update.data, update.error);

  const event = update.event;
  if (event) {
    const task = State.tasks.find((t) => t.id === update.id);
    if (task) {
      const taskUpdate = computeTaskEventUpdate(event, State.focusId === update.id);
      task.state = taskUpdate.state;
      task.steps = taskUpdate.steps;
      task.stepIndex = taskUpdate.stepIndex;
      if (taskUpdate.pillBadge) {
        task.pillBadge = taskUpdate.pillBadge;
      }
      Sound.play(event.success ? "finish" : "error");
      // Same as the Swift pollers: show the compact island so the badge is seen,
      // but never steal the screen for a successful deploy.
      island.reveal();

      const existing = clearTimers.get(update.id);
      if (existing != null) window.clearTimeout(existing);
      clearTimers.set(
        update.id,
        window.setTimeout(() => {
          clearTimers.delete(update.id);
          const t = State.tasks.find((x) => x.id === update.id);
          if (!t || (t.state !== "finished" && t.state !== "error")) return;
          t.state = "idle";
          t.steps = [];
          t.stepIndex = 0;
          t.pillBadge = null;
          State.notify();
        }, CLEAR_TASK_TIMEOUT_MS),
      );
    }
  }

  State.notify();
}

import test from "node:test";
import assert from "node:assert/strict";

import {
  INTEGRATION_SECRET_KEYS,
  CLEAR_TASK_TIMEOUT_MS,
  getSecretKeyForIntegration,
  computeIntegrationState,
  computeTaskEventUpdate,
} from "../src/island/integration-utils.ts";

test("constants: verifies integration secret key registry and timeout", () => {
  assert.equal(CLEAR_TASK_TIMEOUT_MS, 60000);
  assert.ok(Object.keys(INTEGRATION_SECRET_KEYS).length >= 7);
});

test("getSecretKeyForIntegration: maps integration identifiers to Credential Manager keys", () => {
  assert.equal(getSecretKeyForIntegration("integration_github"), "github-token");
  assert.equal(getSecretKeyForIntegration("integration_vercel"), "vercel-token");
  assert.equal(getSecretKeyForIntegration("integration_stripe"), "stripe-api-key");
  assert.equal(getSecretKeyForIntegration("integration_resend"), "resend-api-key");
  assert.equal(getSecretKeyForIntegration("unknown_integration"), undefined);
});

test("computeIntegrationState: updates state and preserves cache on transient errors", () => {
  const initial = computeIntegrationState(undefined, { repos: 10 }, null);
  assert.deepEqual(initial.data, { repos: 10 });
  assert.equal(initial.error, null);
  assert.equal(initial.loaded, true);
  assert.equal(initial.configured, true);

  // Transient network error should preserve previous cached data
  const withError = computeIntegrationState(initial, {}, "network timeout");
  assert.deepEqual(withError.data, { repos: 10 });
  assert.equal(withError.error, "network timeout");
  assert.equal(withError.loaded, true);

  // Error without prior cache
  const freshError = computeIntegrationState(undefined, {}, "unauthorized");
  assert.deepEqual(freshError.data, {});
  assert.equal(freshError.error, "unauthorized");
  assert.equal(freshError.loaded, false);
});

test("computeTaskEventUpdate: computes task steps, completion states, and pill badges", () => {
  // Successful deploy with detail
  const deploy = computeTaskEventUpdate({
    success: true,
    label: "Deploy",
    detail: "Production ready",
  }, false);

  assert.equal(deploy.state, "finished");
  assert.deepEqual(deploy.steps, ["Deploy", "Production ready"]);
  assert.equal(deploy.stepIndex, 1);
  assert.equal(deploy.pillBadge, "finished");

  // Error without detail
  const failed = computeTaskEventUpdate({
    success: false,
    label: "Build failed",
    detail: null,
  }, false);

  assert.equal(failed.state, "error");
  assert.deepEqual(failed.steps, ["Build failed"]);
  assert.equal(failed.stepIndex, 0);
  assert.equal(failed.pillBadge, "error");

  // When pill is already focused, no badge is set
  const focused = computeTaskEventUpdate({
    success: true,
    label: "Success",
  }, true);
  assert.equal(focused.pillBadge, null);
});

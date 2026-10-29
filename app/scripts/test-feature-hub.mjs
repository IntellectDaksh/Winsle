import test from "node:test";
import assert from "node:assert/strict";

import {
  filterNotices,
  validateExtensionManifest,
  calculateSnoozeUntil,
} from "../src/settings/feature-hub-utils.ts";

test("filterNotices: filters by status and case-insensitive query", () => {
  const notices = [
    {
      info: {
        id: "1",
        appId: "slack",
        app: "Slack",
        title: "New mention",
        body: "Hey, check PR #40",
        time: 1000,
      },
      repeats: 1,
      status: "unread",
      snoozeUntil: 0,
    },
    {
      info: {
        id: "2",
        appId: "teams",
        app: "Teams",
        title: "Daily Standup",
        body: "Meeting starting in 5 minutes",
        time: 2000,
      },
      repeats: 3,
      status: "read",
      snoozeUntil: 0,
    },
    {
      info: {
        id: "3",
        appId: "slack",
        app: "Slack",
        title: "Deploy Alert",
        body: "Production release completed",
        time: 3000,
      },
      repeats: 1,
      status: "snoozed",
      snoozeUntil: 5000,
    },
  ];

  // All notices
  assert.equal(filterNotices(notices, "all", "").length, 3);

  // Status filtering
  const unread = filterNotices(notices, "unread", "");
  assert.equal(unread.length, 1);
  assert.equal(unread[0].info.id, "1");

  // Query filtering
  const prSearch = filterNotices(notices, "all", "pr #40");
  assert.equal(prSearch.length, 1);
  assert.equal(prSearch[0].info.app, "Slack");

  // Combined status and query
  const slackUnread = filterNotices(notices, "unread", "slack");
  assert.equal(slackUnread.length, 1);

  const teamsUnread = filterNotices(notices, "unread", "teams");
  assert.equal(teamsUnread.length, 0);
});

test("validateExtensionManifest: verifies required fields and structure", () => {
  const valid = {
    id: "quick-note",
    name: "Quick Note",
    description: "Save note to task inbox",
    permissions: ["capture.write"],
    subscriptions: ["notification"],
    actions: [{ id: "save", label: "Save note", kind: "capture", prefix: "Note: " }],
  };
  assert.deepEqual(validateExtensionManifest(valid), { valid: true });

  // Invalid IDs
  assert.equal(
    validateExtensionManifest({ ...valid, id: "" }).valid,
    false
  );
  assert.equal(
    validateExtensionManifest({ ...valid, id: "invalid space id" }).valid,
    false
  );

  // Empty name
  assert.equal(
    validateExtensionManifest({ ...valid, name: "   " }).valid,
    false
  );

  // Non-array permissions
  assert.equal(
    validateExtensionManifest({ ...valid, permissions: "capture.write" }).valid,
    false
  );

  // Non-object
  assert.equal(validateExtensionManifest(null).valid, false);
  assert.equal(validateExtensionManifest("string").valid, false);
});

test("calculateSnoozeUntil: bounds duration and calculates correct target timestamp", () => {
  const now = 1_000_000;
  // 30 minutes = 1,800,000 ms
  assert.equal(calculateSnoozeUntil(now, 30), now + 30 * 60 * 1000);

  // Clamp sub-minute to 1 minute
  assert.equal(calculateSnoozeUntil(now, 0), now + 1 * 60 * 1000);
  assert.equal(calculateSnoozeUntil(now, -10), now + 1 * 60 * 1000);

  // Clamp above 1440 minutes (24h)
  assert.equal(calculateSnoozeUntil(now, 2000), now + 1440 * 60 * 1000);
});

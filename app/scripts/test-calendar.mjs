import test from "node:test";
import assert from "node:assert/strict";

import { isQuickEventRequest, extractEventPrompt, isConferenceUrl } from "../src/live/calendar-utils.ts";

test("isQuickEventRequest: identifies natural language event requests", () => {
  assert.equal(isQuickEventRequest("event tomorrow 3pm Call with Daksh"), true);
  assert.equal(isQuickEventRequest("add event Friday 10am Team sync"), true);
  assert.equal(isQuickEventRequest("create meeting Monday 2pm Planning"), true);
  assert.equal(isQuickEventRequest("meeting with Alex at 5pm"), true);

  // Non-event prompts
  assert.equal(isQuickEventRequest("what is an event loop in Node.js?"), false);
  assert.equal(isQuickEventRequest("meeting notes from yesterday"), false);
  assert.equal(isQuickEventRequest("hello world"), false);
});

test("extractEventPrompt: extracts event details cleanly", () => {
  assert.equal(extractEventPrompt("event tomorrow 3pm Call with Daksh"), "tomorrow 3pm Call with Daksh");
  assert.equal(extractEventPrompt("create meeting Monday 2pm Planning"), "Monday 2pm Planning");
  assert.equal(extractEventPrompt("not an event"), null);
});

test("isConferenceUrl: recognizes standard video meeting URLs", () => {
  // Google Meet
  assert.equal(isConferenceUrl("https://meet.google.com/abc-defg-hij"), true);
  assert.equal(isConferenceUrl("https://meet.google.com/"), false);

  // Zoom
  assert.equal(isConferenceUrl("https://zoom.us/j/123456789?pwd=abc"), true);
  assert.equal(isConferenceUrl("https://us02web.zoom.us/j/987654321"), true);
  assert.equal(isConferenceUrl("https://zoom.us/pricing"), false);

  // Microsoft Teams
  assert.equal(isConferenceUrl("https://teams.microsoft.com/l/meetup-join/19%3ameeting_xyz"), true);
  assert.equal(isConferenceUrl("https://teams.live.com/meet/987654321"), true);

  // Cisco Webex
  assert.equal(isConferenceUrl("https://uideas.webex.com/meet/daksh"), true);
  assert.equal(isConferenceUrl("https://company.webex.com/join/room"), true);

  // Invalid / non-conferencing
  assert.equal(isConferenceUrl("https://github.com/IntellectDaksh/Winsle"), false);
  assert.equal(isConferenceUrl("javascript:alert(1)"), false);
  assert.equal(isConferenceUrl(""), false);
});

import test from "node:test";
import assert from "node:assert/strict";

import { parseTaskLine, formatTaskLine } from "../src/live/tasks.ts";

test("parseTaskLine: parses standard markdown task checkboxes", () => {
  const t1 = parseTaskLine("- [ ] Write report");
  assert.equal(t1?.done, false);
  assert.equal(t1?.text, "Write report");
  assert.equal(t1?.stamp, undefined);

  const t2 = parseTaskLine("- [x] Submit expenses");
  assert.equal(t2?.done, true);
  assert.equal(t2?.text, "Submit expenses");
});

test("parseTaskLine: parses asterisk bullets and case variants", () => {
  const t1 = parseTaskLine("* [ ] Grocery shopping");
  assert.equal(t1?.done, false);
  assert.equal(t1?.text, "Grocery shopping");

  const t2 = parseTaskLine("* [X] Done with laundry");
  assert.equal(t2?.done, true);
  assert.equal(t2?.text, "Done with laundry");
});

test("parseTaskLine: parses trailing timestamps and indented lines", () => {
  const t1 = parseTaskLine("- [ ] Meeting with team  _(2026-10-22 14:00)_");
  assert.equal(t1?.done, false);
  assert.equal(t1?.text, "Meeting with team");
  assert.equal(t1?.stamp, "2026-10-22 14:00");

  const t2 = parseTaskLine("    - [ ] Indented subtask");
  assert.equal(t2?.done, false);
  assert.equal(t2?.text, "Indented subtask");
});

test("parseTaskLine: ignores non-task lines", () => {
  assert.equal(parseTaskLine("# Notes"), null);
  assert.equal(parseTaskLine("Just regular text paragraph"), null);
  assert.equal(parseTaskLine("- Bullet without checkbox"), null);
  assert.equal(parseTaskLine(""), null);
});

test("formatTaskLine: formats task strings cleanly", () => {
  assert.equal(formatTaskLine("Buy milk"), "- [ ] Buy milk\n");
  assert.equal(formatTaskLine("Buy milk", undefined, true), "- [x] Buy milk\n");
  assert.equal(formatTaskLine("Call mom", "2026-10-22 10:00"), "- [ ] Call mom  _(2026-10-22 10:00)_\n");
  assert.equal(formatTaskLine("Multi\nline\ntext"), "- [ ] Multi line text\n");
});

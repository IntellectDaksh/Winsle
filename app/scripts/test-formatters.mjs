import test from "node:test";
import assert from "node:assert/strict";

import { fmtClock, fmtBytes, fmtUntil, fmtUptime, fmtHM, hsl } from "../src/live/formatters.ts";

test("fmtClock: formats MM:SS and H:MM:SS accurately", () => {
  assert.equal(fmtClock(0), "0:00");
  assert.equal(fmtClock(5000), "0:05");
  assert.equal(fmtClock(65000), "1:05");
  assert.equal(fmtClock(3665000), "1:01:05");

  // Safeguards against negative or invalid values
  assert.equal(fmtClock(-1000), "0:00");
  assert.equal(fmtClock(NaN), "0:00");
  assert.equal(fmtClock(Infinity), "0:00");
});

test("fmtBytes: formats binary sizes with appropriate unit scaling", () => {
  assert.equal(fmtBytes(0), "0 B");
  assert.equal(fmtBytes(512), "512 B");
  assert.equal(fmtBytes(1024), "1.0 KB");
  assert.equal(fmtBytes(1048576), "1.0 MB");
  assert.equal(fmtBytes(1073741824), "1.0 GB");
  assert.equal(fmtBytes(1099511627776), "1.0 TB");

  // Invalid sizes
  assert.equal(fmtBytes(-100), "0 B");
  assert.equal(fmtBytes(NaN), "0 B");
});

test("fmtUntil: formats relative future and past calendar spans", () => {
  assert.equal(fmtUntil(0), "—");
  assert.equal(fmtUntil(NaN), "—");

  const now = Date.now();
  assert.equal(fmtUntil(now), "now");
  assert.equal(fmtUntil(now + 10 * 60_000), "in 10 min");
  assert.equal(fmtUntil(now + 65 * 60_000), "in 1 h 5 min");
  assert.equal(fmtUntil(now - 5 * 60_000), "started 5 min ago");
});

test("fmtUptime: formats system uptime in human readable intervals", () => {
  assert.equal(fmtUptime(0), "0 min");
  assert.equal(fmtUptime(-50), "0 min");
  assert.equal(fmtUptime(120), "2 min");
  assert.equal(fmtUptime(3660), "1 h 1 min");
  assert.equal(fmtUptime(90000), "1 d 1 h");
});

test("fmtHM: formats focus duration", () => {
  assert.equal(fmtHM(0), "0m");
  assert.equal(fmtHM(-60), "0m");
  assert.equal(fmtHM(300), "5m");
  assert.equal(fmtHM(3660), "1h 01m");
});

test("hsl: computes valid css hsl strings", () => {
  assert.equal(hsl(255, 0, 0), "hsl(0, 100%, 50%)");
  assert.equal(hsl(0, 255, 0), "hsl(120, 100%, 50%)");
  assert.equal(hsl(0, 0, 255), "hsl(240, 100%, 50%)");
});

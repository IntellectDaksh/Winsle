import test from "node:test";
import assert from "node:assert/strict";

import {
  parseWorkspacePaths,
  formatResumeSummary,
  filterOutputs,
  sortOutputs,
  formatGitStatusSummary,
} from "../src/live/workspaces-utils.ts";

test("parseWorkspacePaths: trims, filters empty lines, and ignores comments", () => {
  const raw = `
    C:\\Users\\Uideas\\Projects\\Winsle
    
    # ignored comment
    D:\\Creative\\Render
    C:\\Windows\\System32\\notepad.exe
  `;
  const paths = parseWorkspacePaths(raw);
  assert.deepEqual(paths, [
    "C:\\Users\\Uideas\\Projects\\Winsle",
    "D:\\Creative\\Render",
    "C:\\Windows\\System32\\notepad.exe",
  ]);
});

test("formatResumeSummary: correctly summarizes opened, missing, and failed items", () => {
  assert.equal(
    formatResumeSummary({ opened: 3, missing: [], failed: [] }),
    "Opened 3 items"
  );
  assert.equal(
    formatResumeSummary({ opened: 1, missing: ["path/to/missing"], failed: [] }),
    "Opened 1 item, Missing: 1"
  );
  assert.equal(
    formatResumeSummary({ opened: 0, missing: ["a"], failed: ["b", "c"] }),
    "Missing: 1, Failed: 2"
  );
  assert.equal(
    formatResumeSummary({ opened: 0, missing: [], failed: [] }),
    "Nothing opened"
  );
});

test("filterOutputs: correctly filters review and versioned outputs", () => {
  const sampleOutputs = [
    {
      path: "render1.mp4",
      folder: "renders",
      name: "render1.mp4",
      format: "mp4",
      bytes: 1024,
      modifiedAt: 100,
      group: "render",
      version: 1,
      state: "ready",
    },
    {
      path: "render2.mp4",
      folder: "renders",
      name: "render2.mp4",
      format: "mp4",
      bytes: 0,
      modifiedAt: 200,
      group: "render",
      version: null,
      state: "empty",
    },
    {
      path: "render3.mov",
      folder: "renders",
      name: "render3.mov",
      format: "mov",
      bytes: 500,
      modifiedAt: 300,
      group: "render",
      version: 2,
      state: "stalled",
    },
  ];

  const all = filterOutputs(sampleOutputs, "all");
  assert.equal(all.length, 3);

  const review = filterOutputs(sampleOutputs, "review");
  assert.equal(review.length, 2);
  assert.deepEqual(
    review.map((o) => o.name),
    ["render2.mp4", "render3.mov"]
  );

  const versions = filterOutputs(sampleOutputs, "versions");
  assert.equal(versions.length, 2);
  assert.deepEqual(
    versions.map((o) => o.name),
    ["render1.mp4", "render3.mov"]
  );
});

test("sortOutputs: sorts by recent modifiedAt or alphabetical name", () => {
  const items = [
    { name: "Beta", modifiedAt: 100 },
    { name: "Alpha", modifiedAt: 300 },
    { name: "Gamma", modifiedAt: 200 },
  ];

  const byRecent = sortOutputs(items, "recent");
  assert.deepEqual(
    byRecent.map((i) => i.name),
    ["Alpha", "Gamma", "Beta"]
  );

  const byName = sortOutputs(items, "name");
  assert.deepEqual(
    byName.map((i) => i.name),
    ["Alpha", "Beta", "Gamma"]
  );
});

test("formatGitStatusSummary: handles clean, ahead, behind, and dirty states", () => {
  assert.equal(
    formatGitStatusSummary({
      branch: "master",
      ahead: 0,
      behind: 0,
      changedFiles: 0,
      stagedFiles: 0,
      untrackedFiles: 0,
    }),
    "master (clean)"
  );

  assert.equal(
    formatGitStatusSummary({
      branch: "feature/live",
      ahead: 2,
      behind: 0,
      changedFiles: 1,
      stagedFiles: 2,
      untrackedFiles: 1,
    }),
    "feature/live [ahead 2] (4 modified)"
  );

  assert.equal(
    formatGitStatusSummary({
      branch: null,
      ahead: 0,
      behind: 1,
      changedFiles: 0,
      stagedFiles: 0,
      untrackedFiles: 0,
    }),
    "HEAD (detached) [behind 1] (clean)"
  );
});

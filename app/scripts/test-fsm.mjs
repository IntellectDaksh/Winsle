import test from "node:test";
import assert from "node:assert/strict";

import { IslandStateMachine, sanitizeDelay } from "../src/island/fsm.ts";

test("sanitizeDelay: validates numbers, handles NaN and non-finite inputs", () => {
  assert.equal(sanitizeDelay(15, 5), 15);
  assert.equal(sanitizeDelay(0, 5), 0);
  assert.equal(sanitizeDelay(-3, 5, 0), 0);
  assert.equal(sanitizeDelay(-3, 5, -10), -3);
  assert.equal(sanitizeDelay(NaN, 10), 10);
  assert.equal(sanitizeDelay(Infinity, 10), 10);
  assert.equal(sanitizeDelay(undefined, 10), 10);
  assert.equal(sanitizeDelay("not a number", 10), 10);
  assert.equal(sanitizeDelay(null, 10), 10);
});

test("IslandStateMachine: basic lifecycle transitions and onTransition callback", () => {
  const fsm = new IslandStateMachine();
  assert.equal(fsm.state, "hidden");

  const transitions = [];
  fsm.onTransition = (from, to) => {
    transitions.push({ from, to });
  };

  fsm.launch();
  assert.equal(fsm.state, "winsle");
  assert.deepEqual(transitions, [{ from: "hidden", to: "winsle" }]);

  fsm.mouseLeft();
  assert.equal(fsm.state, "petit");
  assert.equal(transitions.length, 2);
  assert.deepEqual(transitions[1], { from: "winsle", to: "petit" });

  fsm.click();
  assert.equal(fsm.state, "home");
  assert.equal(transitions.length, 3);
  assert.deepEqual(transitions[2], { from: "petit", to: "home" });

  // Clicking while already in home should not re-trigger transition
  fsm.click();
  assert.equal(fsm.state, "home");
  assert.equal(transitions.length, 3);
});

test("IslandStateMachine: force states and timer cancellations", () => {
  const fsm = new IslandStateMachine();
  fsm.launch();
  assert.equal(fsm.state, "winsle");

  fsm.forcePetit();
  assert.equal(fsm.state, "petit");

  fsm.forceHome();
  assert.equal(fsm.state, "home");

  fsm.forceHidden();
  assert.equal(fsm.state, "hidden");
});

test("IslandStateMachine: pinned alert state prevents auto-collapse timer", async () => {
  const fsm = new IslandStateMachine();
  fsm.homeToPetitDelay = 0.05; // 50ms for testing
  fsm.forceHome();
  assert.equal(fsm.state, "home");

  // When pinned is true, mouseLeft should not schedule home collapse
  fsm.pinned = true;
  fsm.mouseLeft();
  await new Promise((r) => setTimeout(r, 70));
  assert.equal(fsm.state, "home");

  // When unpinned, mouseLeft will trigger transition to petit
  fsm.pinned = false;
  fsm.mouseLeft(0.02); // 20ms
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(fsm.state, "petit");
});

test("IslandStateMachine: transition error boundary handles throwing callbacks gracefully", () => {
  const fsm = new IslandStateMachine();
  fsm.onTransition = () => {
    throw new Error("Simulated UI listener crash");
  };

  // Must not throw uncaught error and state must update
  assert.doesNotThrow(() => {
    fsm.launch();
  });
  assert.equal(fsm.state, "winsle");
});

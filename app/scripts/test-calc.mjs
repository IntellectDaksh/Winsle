import test from "node:test";
import assert from "node:assert/strict";

// Dynamic import or relative evaluation of calc logic
import { evaluate, convert } from "../src/live/calc.ts";

test("evaluate: basic arithmetic & precedence", () => {
  assert.equal(evaluate("2 + 2"), "4");
  assert.equal(evaluate("2 + 3 * 4"), "14");
  assert.equal(evaluate("(2 + 3) * 4"), "20");
  assert.equal(evaluate("10 / 2 - 3"), "2");
  assert.equal(evaluate("2 ^ 3"), "8");
  assert.equal(evaluate("10 % 3"), "1");
});

test("evaluate: scientific functions & constants", () => {
  assert.equal(evaluate("sqrt(16)"), "4");
  assert.equal(evaluate("abs(-42)"), "42");
  assert.equal(evaluate("round(3.7)"), "4");
  assert.equal(evaluate("floor(3.9)"), "3");
  assert.equal(evaluate("ceil(3.1)"), "4");
  assert.equal(evaluate("pi * 2"), String(Math.round(Math.PI * 2 * 1e10) / 1e10));
});

test("evaluate: non-calculation inputs return null", () => {
  assert.equal(evaluate("hello world"), null);
  assert.equal(evaluate("15 min"), null);
  assert.equal(evaluate(""), null);
  assert.equal(evaluate("10 / 0"), null);
});

test("convert: distance, mass, and data", () => {
  assert.equal(convert("1 km to m"), "1000 m");
  assert.equal(convert("1 m to cm"), "100 cm");
  assert.equal(convert("1 kg to g"), "1000 g");
  assert.equal(convert("1024 kib to mib"), "1 mib");
  assert.equal(convert("1 gb to mb"), "1000 mb");
});

test("convert: temperature Celsius, Fahrenheit, and Kelvin", () => {
  assert.equal(convert("0 c to f"), "32 °F");
  assert.equal(convert("100 c to f"), "212 °F");
  assert.equal(convert("32 f to c"), "0 °C");
  assert.equal(convert("0 c to k"), "273.1 K");
  assert.equal(convert("273.15 k to c"), "0 °C");
});

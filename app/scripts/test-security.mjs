import test from "node:test";
import assert from "node:assert/strict";

import { isSecretText, maskSecret } from "../src/live/security.ts";

test("isSecretText: detects standard API key prefixes", () => {
  // OpenAI & Anthropic
  assert.equal(isSecretText("sk-proj-abc123def456ghi7890"), true);
  assert.equal(isSecretText("sk-ant-api03-abcdef123456789"), true);

  // GitHub tokens
  assert.equal(isSecretText("ghp_1234567890abcdefghijklmnopqrstuvwxyz"), true);
  assert.equal(isSecretText("github_pat_11AAAAAAA0123456789abcdefghijklmnopqrstuvwxyz"), true);
  assert.equal(isSecretText("gho_1234567890abcdefghijklmnopqrstuvwxyz"), true);
  assert.equal(isSecretText("glpat-abcdef1234567890"), true);

  // Slack tokens
  assert.equal(isSecretText("xoxb-1234567890-abcdef"), true);
  assert.equal(isSecretText("xoxp-1234567890-abcdef"), true);
  assert.equal(isSecretText("xapp-1234567890-abcdef"), true);

  // AWS & Google
  assert.equal(isSecretText("AKIAIOSFODNN7EXAMPLE"), true);
  assert.equal(isSecretText("AIzaSyD-1234567890abcdefghijklmnopqr"), true);

  // JWTs
  assert.equal(isSecretText("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0"), true);
});

test("isSecretText: detects private key blocks", () => {
  assert.equal(isSecretText("-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0..."), true);
  assert.equal(isSecretText("-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC..."), true);
  assert.equal(isSecretText("-----BEGIN EC PRIVATE KEY-----\nMHcCAQEE..."), true);
});

test("isSecretText: detects high-entropy random hashes and tokens", () => {
  // 32-char hex token
  assert.equal(isSecretText("4f8a92b3c1d4e5f6a7b8c9d0e1f2a3b4"), true);
  // Base64 hash with length >= 20
  assert.equal(isSecretText("K8jF9mQ2pL7vX4wZ1sN6bV8"), true);
});

test("isSecretText: allows regular non-secret strings", () => {
  assert.equal(isSecretText(""), false);
  assert.equal(isSecretText("   "), false);
  assert.equal(isSecretText("Hello world! How are you today?"), false);
  assert.equal(isSecretText("https://github.com/IntellectDaksh/Winsle"), false);
  assert.equal(isSecretText("npm run build"), false);
  assert.equal(isSecretText("Meeting at 3pm with design team"), false);
  assert.equal(isSecretText("123456"), false);
});

test("maskSecret: masks tokens securely", () => {
  assert.equal(maskSecret("sk-proj-1234567890abcdef"), "sk-pro...cdef");
  assert.equal(maskSecret("AKIAIOSFODNN7EXAMPLE"), "AKIAIO...MPLE");
  assert.equal(maskSecret("short"), "•••••");
});

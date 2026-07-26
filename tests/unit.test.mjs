import assert from "node:assert/strict";
import test from "node:test";

import { isStrongPassword, safeInteger, safeText } from "../app/lib/security.ts";
import { sanitizeContext } from "../app/lib/observability.ts";

test("safeText trims and caps max string length", () => {
  assert.equal(safeText("  hello world  ", 5), "hello");
  assert.equal(safeText(null), "");
  assert.equal(safeText(123), "");
});

test("safeInteger clamps numbers between min and max", () => {
  assert.equal(safeInteger(15, 1, 0, 10), 10);
  assert.equal(safeInteger(-5, 1, 0, 10), 0);
  assert.equal(safeInteger("invalid", 5, 0, 10), 5);
});

test("isStrongPassword enforces 12+ chars, upper, lower, digit, symbol", () => {
  assert.equal(isStrongPassword("Weak1!"), false);
  assert.equal(isStrongPassword("alllowercase1!"), false);
  assert.equal(isStrongPassword("ALLUPPERCASE1!"), false);
  assert.equal(isStrongPassword("NoSpecialSymbol123"), false);
  assert.equal(isStrongPassword("ValidP@ssw0rd2026"), true);
});

test("sanitizeContext redacts sensitive fields like passwords and tokens", () => {
  const context = {
    userEmail: "student@example.test",
    password: "SuperSecretPassword123!",
    token: "abcdef123456",
    action: "login",
  };
  const sanitized = sanitizeContext(context);
  assert.equal(sanitized.userEmail, "student@example.test");
  assert.equal(sanitized.password, "[REDACTED]");
  assert.equal(sanitized.token, "[REDACTED]");
  assert.equal(sanitized.action, "login");
});

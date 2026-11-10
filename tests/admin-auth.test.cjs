const test = require("node:test");
const assert = require("node:assert/strict");
const { verifyTotp, verifyTotpStep, verifyAdminPassword } = require("../dist/application/admin-auth.js");

test("validates RFC 6238 six-digit TOTP with a bounded clock window", async () => {
  const secret = new TextEncoder().encode("12345678901234567890");
  assert.equal(await verifyTotp(secret, "287082", 59000), true);
  assert.equal(await verifyTotpStep(secret, "287082", 59000), 1);
  assert.equal(await verifyTotp(secret, "000000", 59000), false);
  assert.equal(await verifyTotpStep(secret, "000000", 59000), null);
  assert.equal(await verifyTotp(secret, "287082", 59000 + 10 * 60 * 1000), false);
});

test("rejects unsupported or malformed administrator password hashes", async () => {
  assert.equal(await verifyAdminPassword("plain-text", "plain-text"), false);
  assert.equal(await verifyAdminPassword("pbkdf2-sha256$9999999$bad$bad", "x"), false);
});

test("creates and verifies Worker-compatible chained PBKDF2 hashes", async () => {
  const { hashAdminPassword } = require("../dist/application/admin-auth.js");
  const original = globalThis.crypto.subtle.deriveBits.bind(globalThis.crypto.subtle);
  globalThis.crypto.subtle.deriveBits = async (algorithm, key, length) => {
    if (algorithm.name === "PBKDF2" && algorithm.iterations > 100000) {
      throw new Error("Worker PBKDF2 iteration limit exceeded");
    }
    return original(algorithm, key, length);
  };
  try {
    const encoded = await hashAdminPassword("a-strong-test-password-123");
    assert.match(encoded, /^pbkdf2-sha256-chain\$310000\$/);
    assert.equal(await verifyAdminPassword(encoded, "a-strong-test-password-123"), true);
    assert.equal(await verifyAdminPassword(encoded, "wrong-password"), false);
  } finally {
    globalThis.crypto.subtle.deriveBits = original;
  }
});

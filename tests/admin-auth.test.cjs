const test = require("node:test");
const assert = require("node:assert/strict");
const { verifyTotp, verifyAdminPassword } = require("../dist/application/admin-auth.js");

test("validates RFC 6238 six-digit TOTP with a bounded clock window", async () => {
  const secret = new TextEncoder().encode("12345678901234567890");
  assert.equal(await verifyTotp(secret, "287082", 59000), true);
  assert.equal(await verifyTotp(secret, "000000", 59000), false);
  assert.equal(await verifyTotp(secret, "287082", 59000 + 10 * 60 * 1000), false);
});

test("rejects unsupported or malformed administrator password hashes", async () => {
  assert.equal(await verifyAdminPassword("plain-text", "plain-text"), false);
  assert.equal(await verifyAdminPassword("pbkdf2-sha256$9999999$bad$bad", "x"), false);
});

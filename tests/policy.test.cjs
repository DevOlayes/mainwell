const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveDestination, validateOwnerAuthorization, assertAdmin } = require("../dist/policy/recovery-policy.js");

test("uses an asset override before the locked network destination", () => {
  const policy = { network: "ethereum", address: "0xNetwork", locked: true, updatedBy: "admin", updatedAt: "2026-11-09T10:00:00.000Z", assetOverrides: { "asset-1": "0xAsset" } };
  assert.equal(resolveDestination(policy, "asset-1"), "0xAsset");
  assert.equal(resolveDestination(policy, "asset-2"), "0xNetwork");
});

test("rejects an unlocked destination policy", () => {
  assert.throws(() => resolveDestination({ network: "ethereum", address: "0xNetwork", locked: false, updatedBy: "admin", updatedAt: "2026-11-09T10:00:00.000Z" }, "asset"), /must be locked/);
});

test("requires an MFA-protected admin for admin actions", () => {
  assert.throws(() => assertAdmin({ id: "operator", role: "operator", mfaVerified: true }), /administrator with MFA/);
  assert.doesNotThrow(() => assertAdmin({ id: "admin", role: "admin", mfaVerified: true }));
});

test("rejects expired owner authorization", () => {
  const auth = { authorizationId: "a", walletAddress: "0xowner", network: "ethereum", authorizedAssetIds: ["asset"], destinationAddress: "0xdest", approvedAt: "2026-11-09T10:00:00.000Z", expiresAt: "2026-11-09T11:00:00.000Z", confirmationReference: "confirmed" };
  assert.throws(() => validateOwnerAuthorization(auth, "0xowner", "ethereum", Date.parse("2026-11-09T12:00:00.000Z")), /expired/);
});

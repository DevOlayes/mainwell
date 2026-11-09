const test = require("node:test");
const assert = require("node:assert/strict");
const { validateRecoveryGrant } = require("../dist/policy/recovery-grant.js");

const now = Date.parse("2026-11-09T12:00:00.000Z");
const base = {
  grantId: "grant-1",
  ownerWallet: "0x1111111111111111111111111111111111111111",
  network: "ethereum",
  chainId: 1,
  executorAddress: "0x2222222222222222222222222222222222222222",
  executorCodeHash: "0x" + "a".repeat(64),
  destinationAddress: "0x3333333333333333333333333333333333333333",
  assets: [{ assetId: "usdc", destinationAddress: "0x3333333333333333333333333333333333333333", tokenAddress: "0x4444444444444444444444444444444444444444", amount: { kind: "capped", maxAmountRaw: "1000000" } }],
  executionModes: ["automatic-priority", "admin-initiated"],
  approvedAt: "2026-11-09T11:00:00.000Z",
  expiresAt: "2026-11-09T13:00:00.000Z",
  evidence: { kind: "onchain-approval", reference: "0x" + "b".repeat(64) }
};

test("accepts a scoped grant that permits both execution paths", () => {
  assert.doesNotThrow(() => validateRecoveryGrant(base, base.ownerWallet, "ethereum", now));
});

test("rejects a grant for a different wallet or network", () => {
  assert.throws(() => validateRecoveryGrant(base, "0x5555555555555555555555555555555555555555", "ethereum", now), /does not match/);
  assert.throws(() => validateRecoveryGrant(base, base.ownerWallet, "polygon", now), /network mismatch/);
});

test("rejects missing executor bytecode hash and malformed EVM addresses", () => {
  assert.throws(() => validateRecoveryGrant({ ...base, executorCodeHash: "missing" }, base.ownerWallet, "ethereum", now), /bytecode hash/);
  assert.throws(() => validateRecoveryGrant({ ...base, destinationAddress: "bad" }, base.ownerWallet, "ethereum", now), /valid EVM address/);
});

test("rejects expired, revoked, or evidence-free grants", () => {
  assert.throws(() => validateRecoveryGrant({ ...base, expiresAt: "2026-11-09T11:30:00.000Z" }, base.ownerWallet, "ethereum", now), /timestamps/);
  assert.throws(() => validateRecoveryGrant({ ...base, revokedAt: "2026-11-09T11:30:00.000Z" }, base.ownerWallet, "ethereum", now), /revoked/);
  assert.throws(() => validateRecoveryGrant({ ...base, evidence: { kind: "permit", reference: "" } }, base.ownerWallet, "ethereum", now), /evidence/);
});

test("requires explicit owner acknowledgement for unlimited token allowance", () => {
  const unlimited = { ...base, assets: [{ assetId: "usdc", tokenAddress: base.assets[0].tokenAddress, destinationAddress: base.destinationAddress, amount: { kind: "unlimited-allowance", ownerAcknowledged: true } }] };
  assert.doesNotThrow(() => validateRecoveryGrant(unlimited, base.ownerWallet, "ethereum", now));
  const unacknowledged = { ...unlimited, assets: [{ ...unlimited.assets[0], amount: { kind: "unlimited-allowance", ownerAcknowledged: false } }] };
  assert.throws(() => validateRecoveryGrant(unacknowledged, base.ownerWallet, "ethereum", now), /acknowledgement/);
});

test("requires at least one explicitly authorized execution mode and unique assets", () => {
  assert.throws(() => validateRecoveryGrant({ ...base, executionModes: [] }, base.ownerWallet, "ethereum", now), /execution mode/);
  assert.throws(() => validateRecoveryGrant({ ...base, assets: [base.assets[0], base.assets[0]] }, base.ownerWallet, "ethereum", now), /unique/);
});

const { assertGrantAllowsExecutionMode } = require("../dist/policy/recovery-grant.js");

test("allows only the execution paths explicitly included in the grant", () => {
  const automaticOnly = { ...base, executionModes: ["automatic-priority"] };
  assert.doesNotThrow(() => assertGrantAllowsExecutionMode(automaticOnly, "automatic-priority", base.ownerWallet, "ethereum", now));
  assert.throws(() => assertGrantAllowsExecutionMode(automaticOnly, "admin-initiated", base.ownerWallet, "ethereum", now), /does not permit admin-initiated/);
});

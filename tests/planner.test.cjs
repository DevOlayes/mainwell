const test = require("node:test");
const assert = require("node:assert/strict");
const { createRecoveryPlan } = require("../dist/planner/recovery-planner.js");

const now = new Date("2026-11-09T12:00:00.000Z");
const base = {
  wallet: { network: "ethereum", address: "0xOwner" },
  assets: [
    { id: "token-a", network: "ethereum", symbol: "A", name: "Asset A", amount: "10", decimals: 18, estimatedValueUsd: 100, isNative: false, urgencyScore: 40, confidence: 0.95 },
    { id: "token-b", network: "ethereum", symbol: "B", name: "Asset B", amount: "2", decimals: 18, estimatedValueUsd: 40, isNative: false, urgencyScore: 90, confidence: 0.9 },
    { id: "token-c", network: "ethereum", symbol: "C", name: "Asset C", amount: "1", decimals: 18, estimatedValueUsd: 5, isNative: false, urgencyScore: 10, confidence: 0.9 }
  ],
  destination: { network: "ethereum", address: "0xLockedDestination", locked: true, updatedBy: "admin-1", updatedAt: "2026-11-09T10:00:00.000Z" },
  authorization: { authorizationId: "auth-1", walletAddress: "0xOwner", network: "ethereum", authorizedAssetIds: ["token-a", "token-b", "token-c"], destinationAddress: "0xLockedDestination", approvedAt: "2026-11-09T11:00:00.000Z", expiresAt: "2026-11-09T12:15:00.000Z", confirmationReference: "owner-confirmation-1" },
  feeQuotes: [{ network: "ethereum", estimatedNativeFee: 0.001, estimatedFeeUsd: 3, safeMaximumFeeUsd: 5, quotedAt: "2026-11-09T11:59:00.000Z", source: "fixture", confidence: 0.99 }],
  gas: { compromisedWalletNativeBalance: 0.01, requiredNativeReserve: 0.002, sponsorAvailable: false, sponsorSupportedOnNetwork: false },
  now,
  planId: "test-plan"
};

test("ranks eligible assets by net recoverable value", () => {
  const plan = createRecoveryPlan(base);
  assert.equal(plan.executionEnabled, false);
  assert.equal(plan.items[0].asset.id, "token-a");
  assert.equal(plan.items[0].status, "eligible-for-review");
  assert.equal(plan.totalEstimatedNetValueUsd, 136);
});

test("blocks assets absent from explicit owner authorization", () => {
  const plan = createRecoveryPlan({ ...base, authorization: { ...base.authorization, authorizedAssetIds: ["token-a"] } });
  const blocked = plan.items.find((item) => item.asset.id === "token-b");
  assert.equal(blocked.status, "blocked");
  assert.match(blocked.reasons.join(" "), /not included in owner authorization/);
});

test("uses sponsor only when wallet reserve is insufficient and sponsor is supported", () => {
  const plan = createRecoveryPlan({ ...base, gas: { compromisedWalletNativeBalance: 0, requiredNativeReserve: 0.002, sponsorAvailable: true, sponsorSupportedOnNetwork: true } });
  assert.equal(plan.items[0].gasFundingSource, "recovery-sponsor");
});

test("blocks assets when neither gas source is available", () => {
  const plan = createRecoveryPlan({ ...base, gas: { compromisedWalletNativeBalance: 0, requiredNativeReserve: 0.002, sponsorAvailable: false, sponsorSupportedOnNetwork: false } });
  assert.equal(plan.items[0].status, "blocked");
});

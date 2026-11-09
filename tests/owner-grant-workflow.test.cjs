const test = require("node:test");
const assert = require("node:assert/strict");
const { handleOwnerApi } = require("../dist/application/owner-api.js");

const wallet = "0x1111111111111111111111111111111111111111";
const session = { wallet, chainId: 1 };
function request(path, body) {
  return new Request("https://mainwell.example" + path, {
    method: "POST",
    headers: { origin: "https://mainwell.example", "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}
const grant = {
  grantId: "grant-01", ownerWallet: wallet, network: "ethereum", chainId: 1,
  executorAddress: "0x2222222222222222222222222222222222222222",
  executorCodeHash: "0x" + "a".repeat(64),
  destinationAddress: "0x3333333333333333333333333333333333333333",
  assets: [{ assetId: "token-1", destinationAddress: "0x3333333333333333333333333333333333333333", tokenAddress: "0x4444444444444444444444444444444444444444",
    amount: { kind: "capped", maxAmountRaw: "1000" } }],
  executionModes: ["automatic-priority"],
  executionOperators: { automation: "0x6666666666666666666666666666666666666666", administrator: "0x7777777777777777777777777777777777777777" },
  approvedAt: "2026-11-09T06:00:00.000Z", expiresAt: "2026-12-09T06:00:00.000Z",
  evidence: { kind: "onchain-approval", reference: "0x" + "b".repeat(64) }
};

test("grant verification refuses a network different from the authenticated wallet session", async () => {
  const env = { DB: { prepare() { throw new Error("must not touch database"); } } };
  const response = await handleOwnerApi(request("/api/owner/grants/verify", {
    grant: { ...grant, network: "polygon", chainId: 137 }
  }), env, session);
  assert.equal(response.status, 400);
});

test("grant verification requires an admin-locked source wallet before checking chain configuration", async () => {
  const env = { DB: { prepare(sql) {
    return { bind() { return this; }, async first() { return null; } };
  } } };
  const response = await handleOwnerApi(request("/api/owner/grants/verify", { grant }), env, session);
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "source_wallet_not_locked");
});

test("grant verification fails closed when trusted RPC or service operators are not configured", async () => {
  const env = { DB: { prepare(sql) {
    return {
      bind() { return this; },
      async first() { return { id: "locked-wallet" }; },
      async all() { return { success: true, results: [{
        assetId: "token-1", maxAmountRaw: "1000", automaticPriorityEnabled: 1,
        adminInitiatedEnabled: 0, expiresInSeconds: 2592000,
        destinationAddress: "0x3333333333333333333333333333333333333333",
        tokenAddress: "0x4444444444444444444444444444444444444444"
      }] }; }
    };
  } } };
  const response = await handleOwnerApi(request("/api/owner/grants/verify", { grant }), env, session);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "grant_verifier_not_configured");
});

test("revocation confirmation cannot locate another owner's grant", async () => {
  const env = { DB: { prepare() {
    return { bind() { return this; }, async first() { return null; } };
  } } };
  const response = await handleOwnerApi(request("/api/owner/grants/grant-foreign/revoke/confirm", {
    transactionHash: "0x" + "c".repeat(64)
  }), env, session);
  assert.equal(response.status, 404);
});

test("per-asset revocation cannot access a grant owned by another wallet", async () => {
  const env = { DB: { prepare() {
    return { bind() { return this; }, async first() { return null; } };
  } } };
  const response = await handleOwnerApi(request("/api/owner/grants/grant-foreign/assets/token-1/revoke/confirm", {
    transactionHash: "0x" + "d".repeat(64)
  }), env, session);
  assert.equal(response.status, 404);
});


function policyBoundEnv(policyOverrides = {}) {
  const policy = {
    assetId: "token-1", maxAmountRaw: "1000", automaticPriorityEnabled: 1,
    adminInitiatedEnabled: 0, expiresInSeconds: 2592000,
    destinationAddress: "0x3333333333333333333333333333333333333333",
    tokenAddress: "0x4444444444444444444444444444444444444444",
    ...policyOverrides
  };
  return { DB: { prepare() {
    return {
      bind() { return this; },
      async first() { return { id: "locked-wallet" }; },
      async all() { return { success: true, results: [policy] }; }
    };
  } } };
}

test("grant verification rejects a token cap that differs from the current admin policy", async () => {
  const response = await handleOwnerApi(request("/api/owner/grants/verify", { grant }), policyBoundEnv({ maxAmountRaw: "1001" }), session);
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /does not exactly match/);
});

test("grant verification rejects an execution mode not enabled for every selected asset", async () => {
  const response = await handleOwnerApi(request("/api/owner/grants/verify", { grant }), policyBoundEnv({ automaticPriorityEnabled: 0 }), session);
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /Automatic-priority execution is not enabled/);
});

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
  assets: [{ assetId: "token-1", tokenAddress: "0x4444444444444444444444444444444444444444",
    amount: { kind: "capped", maxAmountRaw: "1000" } }],
  executionModes: ["automatic-priority"],
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

test("grant verification fails closed when trusted RPC and executor hash are not configured", async () => {
  const env = { DB: { prepare() { throw new Error("must not persist unverified grant"); } } };
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

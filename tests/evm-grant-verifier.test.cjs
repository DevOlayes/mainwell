const test = require("node:test");
const assert = require("node:assert/strict");
const { keccak256, keccak256Hex } = require("../dist/adapters/keccak.js");
const { EvmGrantVerifier } = require("../dist/adapters/evm-grant-verifier.js");

const owner = "0x1111111111111111111111111111111111111111";
const executor = "0x2222222222222222222222222222222222222222";
const destination = "0x3333333333333333333333333333333333333333";
const token = "0x4444444444444444444444444444444444444444";
const code = "0x60006000";
const codeHash = keccak256Hex(code);
const grant = {
  grantId: "evm-check-001", ownerWallet: owner, network: "ethereum", chainId: 1,
  executorAddress: executor, executorCodeHash: codeHash, destinationAddress: destination,
  assets: [{ assetId: "usdc-ethereum", tokenAddress: token, amount: { kind: "capped", maxAmountRaw: "2500000" } }],
  executionModes: ["automatic-priority", "admin-initiated"],
  approvedAt: "2026-11-09T06:00:00.000Z", expiresAt: "2026-12-09T06:00:00.000Z",
  evidence: { kind: "onchain-approval", reference: "0x" + "a".repeat(64) }
};
const now = Date.parse("2026-11-09T06:05:00.000Z");
const word = value => BigInt(value).toString(16).padStart(64, "0");
const addressWord = value => value.slice(2).toLowerCase().padStart(64, "0");
const selector = signature => keccak256Hex("0x" + Buffer.from(signature).toString("hex")).slice(2, 10);

function makeVerifier(overrides = {}) {
  const selectors = {
    owner: selector("owner()"), destination: selector("destination()"),
    expires: selector("expiresAt()"), revoked: selector("revoked()"),
    limit: selector("assetLimit(address)"), recovered: selector("amountRecovered(address)"),
    allowance: selector("allowance(address,address)")
  };
  const fetcher = async (_url, init) => {
    const req = JSON.parse(init.body);
    let result;
    if (req.method === "eth_chainId") result = overrides.chainId || "0x1";
    else if (req.method === "eth_getCode") result = overrides.code || code;
    else if (req.method === "eth_getTransactionReceipt") result = overrides.receipt === undefined ? {
      status: "0x1", from: owner, contractAddress: executor
    } : overrides.receipt;
    else if (req.method === "eth_call") {
      const data = req.params[0].data;
      const sig = data.slice(2, 10);
      const values = {
        [selectors.owner]: "0x" + addressWord(owner),
        [selectors.destination]: "0x" + addressWord(destination),
        [selectors.expires]: "0x" + word(Math.floor(Date.parse(grant.expiresAt) / 1000)),
        [selectors.revoked]: "0x" + word(0),
        [selectors.limit]: "0x" + word(overrides.limit ?? 2500000),
        [selectors.recovered]: "0x" + word(overrides.recovered ?? 500000),
        [selectors.allowance]: "0x" + word(overrides.allowance ?? 2000000)
      };
      result = values[sig];
      if (overrides.callResult && sig === overrides.callResult.selector) result = overrides.callResult.value;
    } else throw new Error("Unexpected RPC method: " + req.method);
    return { ok: true, status: 200, json: async () => ({ jsonrpc: "2.0", id: req.id, result }) };
  };
  return new EvmGrantVerifier({
    rpcUrl: "https://trusted-rpc.example", trustedExecutorCodeHash: codeHash, fetcher
  });
}

test("Keccak-256 uses Ethereum Keccak padding, not NIST SHA3 padding", () => {
  assert.equal(keccak256(new Uint8Array()), "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470");
});

test("verifies deployed executor, owner, destination, expiry, cap and live allowance", async () => {
  const result = await makeVerifier().verify(grant, owner, now);
  assert.equal(result.chainId, 1);
  assert.equal(result.observedExecutorCodeHash, codeHash);
  assert.equal(result.destination, destination);
  assert.equal(result.assets[0].remaining, "2000000");
});

test("fails closed when deployed runtime bytecode hash is not trusted", async () => {
  await assert.rejects(makeVerifier({ code: "0x60016000" }).verify(grant, owner, now), /bytecode hash is not trusted/);
});

test("fails closed when RPC chain ID differs from grant", async () => {
  await assert.rejects(makeVerifier({ chainId: "0x89" }).verify(grant, owner, now), /chain ID does not match/);
});

test("fails closed when deployment receipt does not prove owner deployment", async () => {
  await assert.rejects(makeVerifier({ receipt: { status: "0x1", from: destination, contractAddress: executor } }).verify(grant, owner, now), /does not prove/);
});

test("fails closed when on-chain allowance is below remaining authorized cap", async () => {
  await assert.rejects(makeVerifier({ allowance: 1999999 }).verify(grant, owner, now), /allowance is below/);
});

test("fails closed when on-chain token cap differs from owner grant", async () => {
  await assert.rejects(makeVerifier({ limit: 2500001 }).verify(grant, owner, now), /does not exactly match/);
});

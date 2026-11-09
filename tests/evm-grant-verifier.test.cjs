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
  assets: [{ assetId: "usdc-ethereum", tokenAddress: token, destinationAddress: destination, amount: { kind: "capped", maxAmountRaw: "2500000" } }],
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
    allowance: selector("allowance(address,address)"),
    automatic: selector("automaticPriorityEnabled()"), admin: selector("adminInitiatedEnabled()"),
    assetCount: selector("authorizedAssetCount()"), assetAt: selector("authorizedAssetAt(uint256)"),
    assetDestination: selector("assetDestination(address)"), destinationAt: selector("authorizedAssetDestinationAt(uint256)")
  };
  const fetcher = async (_url, init) => {
    const req = JSON.parse(init.body);
    let result;
    if (req.method === "eth_chainId") result = overrides.chainId || "0x1";
    else if (req.method === "eth_getCode") result = overrides.code || code;
    else if (req.method === "eth_getBlockByNumber") result = { timestamp: "0x" + Math.floor(Date.parse(overrides.blockTimestamp || grant.approvedAt) / 1000).toString(16) };
    else if (req.method === "eth_getTransactionByHash") result = overrides.tx === undefined ? {
      from: owner, to: executor, input: "0x" + selector("revoke()")
    } : overrides.tx;
    else if (req.method === "eth_getTransactionReceipt") result = overrides.receipt === undefined ? {
      status: "0x1", from: owner, contractAddress: executor, blockNumber: "0x10"
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
        [selectors.allowance]: "0x" + word(overrides.allowance ?? 2000000),
        [selectors.automatic]: "0x" + word(overrides.automatic === undefined ? 1 : overrides.automatic),
        [selectors.admin]: "0x" + word(overrides.admin === undefined ? 1 : overrides.admin),
        [selectors.assetCount]: "0x" + word(overrides.assetCount === undefined ? 1 : overrides.assetCount),
        [selectors.assetAt]: "0x" + addressWord(overrides.assetAt || token),
        [selectors.assetDestination]: "0x" + addressWord(overrides.assetDestination || destination),
        [selectors.destinationAt]: "0x" + addressWord(overrides.destinationAt || destination)
      };
      result = values[sig];
      if (overrides.callResult && sig === overrides.callResult.selector) result = overrides.callResult.value;
    } else throw new Error("Unexpected RPC method: " + req.method);
    return { ok: true, status: 200, json: async () => ({ jsonrpc: "2.0", id: req.id, result }) };
  };
  return new EvmGrantVerifier({
    rpcUrl: "https://trusted-rpc.example", trustedExecutorCodeHash: codeHash, expectedChainId: 1, fetcher
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

test("fails closed when RPC chain ID differs from configured chain", async () => {
  await assert.rejects(makeVerifier({ chainId: "0x89" }).verify(grant, owner, now), /chain ID does not match/);
});

test("fails closed when grant network label and chain ID are inconsistent", async () => {
  await assert.rejects(makeVerifier().verify({ ...grant, chainId: 137 }, owner, now), /chain ID does not match/);
});

test("fails closed when authenticated wallet differs from grant owner", async () => {
  await assert.rejects(makeVerifier().verify(grant, destination, now), /Grant owner does not match/);
});

test("fails closed when executor owner differs from authenticated wallet", async () => {
  const selectors = { owner: selector("owner()") };
  await assert.rejects(makeVerifier({ callResult: { selector: selectors.owner, value: "0x" + addressWord(destination) } }).verify(grant, owner, now), /Executor owner does not match/);
});

test("fails closed when executor destination differs from approved destination", async () => {
  const sig = selector("destination()");
  await assert.rejects(makeVerifier({ callResult: { selector: sig, value: "0x" + addressWord(owner) } }).verify(grant, owner, now), /destination does not match/);
});

test("fails closed when executor is revoked on-chain", async () => {
  const sig = selector("revoked()");
  await assert.rejects(makeVerifier({ callResult: { selector: sig, value: "0x" + word(1) } }).verify(grant, owner, now), /revoked on-chain/);
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

test("fails closed when on-chain execution modes differ from declared owner modes", async () => {
  await assert.rejects(makeVerifier({ automatic: 0 }).verify(grant, owner, now), /execution modes do not match/);
});

test("fails closed when on-chain asset list contains a different scope", async () => {
  await assert.rejects(makeVerifier({ assetAt: destination }).verify(grant, owner, now), /asset order or token address/);
});

test("fails closed when per-asset on-chain destination differs from owner approval", async () => {\n  await assert.rejects(makeVerifier({ assetDestination: owner }).verify(grant, owner, now), /destination for asset.*does not match/);\n});\n\ntest("fails closed when on-chain asset count includes undeclared assets", async () => {
  await assert.rejects(makeVerifier({ assetCount: 2 }).verify(grant, owner, now), /asset count does not match/);
});

test("fails closed when grant approval timestamp is not the deployment block timestamp", async () => {
  const changed = { ...grant, approvedAt: "2026-11-09T06:01:00.000Z" };
  await assert.rejects(makeVerifier().verify(changed, owner, now), /timestamp does not match/);
});

test("verifies owner-signed executor revocation only after the chain reports revoked", async () => {
  const revokedSelector = selector("revoked()");
  const result = await makeVerifier({ blockTimestamp: new Date(now + 60_000).toISOString(), callResult: { selector: revokedSelector, value: "0x" + word(1) } })
    .verifyRevocation(grant, owner, "0x" + "d".repeat(64), now);
  assert.equal(result.transactionHash, "0x" + "d".repeat(64));
  assert.equal(result.revokedAt, new Date(now + 60_000).toISOString());
});

test("rejects revocation transactions sent by a different wallet", async () => {
  await assert.rejects(makeVerifier({
    tx: { from: destination, to: executor, input: "0x" + selector("revoke()") }
  }).verifyRevocation(grant, owner, "0x" + "d".repeat(64), now), /authenticated owner successfully called revoke/);
});

test("rejects successful-looking revocation transactions when executor is not revoked", async () => {
  await assert.rejects(makeVerifier().verifyRevocation(grant, owner, "0x" + "d".repeat(64), now), /does not report an on-chain revoked state/);
});

test("verifies an owner-signed per-asset revocation and confirms its on-chain cap is closed", async () => {
  const selectorValue = selector("revokeAsset(address)");
  const input = "0x" + selectorValue + token.slice(2).toLowerCase().padStart(64, "0");
  const result = await makeVerifier({
    tx: { from: owner, to: executor, input },
    limit: 500000,
    recovered: 500000,
    blockTimestamp: new Date(now + 60_000).toISOString()
  }).verifyAssetRevocation(grant, owner, token, "0x" + "e".repeat(64), now);
  assert.equal(result.tokenAddress, token);
  assert.equal(result.revokedAt, new Date(now + 60_000).toISOString());
});

test("rejects per-asset revocation when the token is outside the owner grant", async () => {
  await assert.rejects(
    makeVerifier().verifyAssetRevocation(grant, owner, destination, "0x" + "e".repeat(64), now),
    /not part of this owner grant/
  );
});

test("rejects per-asset revocation if the on-chain cap remains spendable", async () => {
  const input = "0x" + selector("revokeAsset(address)") + token.slice(2).toLowerCase().padStart(64, "0");
  await assert.rejects(makeVerifier({
    tx: { from: owner, to: executor, input },
    limit: 2500000,
    recovered: 500000,
    blockTimestamp: new Date(now + 60_000).toISOString()
  }).verifyAssetRevocation(grant, owner, token, "0x" + "e".repeat(64), now), /not disabled/);
});

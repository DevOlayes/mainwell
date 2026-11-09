const test = require("node:test");
const assert = require("node:assert/strict");
const { EvmReadOnlyAdapter } = require("../dist/adapters/evm-read-only.js");

const owner = "0x1111111111111111111111111111111111111111";
const token = "0x2222222222222222222222222222222222222222";
const spender = "0x3333333333333333333333333333333333333333";
const fresh = new Date().toISOString();

function mockFetch(handler) {
  return async (_url, init) => {
    const request = JSON.parse(init.body);
    return { ok: true, status: 200, json: async () => ({ jsonrpc: "2.0", id: request.id, result: handler(request) }) };
  };
}

function adapter(fetcher = mockFetch((request) => {
  if (request.method === "eth_chainId") return "0x1";
  if (request.method === "eth_getBalance") return "0xde0b6b3a7640000";
  if (request.method === "eth_call" && request.params[0].data.startsWith("0x70a08231")) return "0x14d1120d7b160000";
  if (request.method === "eth_call" && request.params[0].data.startsWith("0xdd62ed3e")) return "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
  throw new Error("Unexpected RPC method");
})) {
  return new EvmReadOnlyAdapter({
    network: "ethereum", chainId: 1, rpcUrl: "https://rpc.example.test",
    nativeSymbol: "ETH", nativeName: "Ether", nativePriceUsd: 3000,
    nativePriceObservedAt: fresh, nativePriceConfidence: 0.99,
    tokens: [{ address: token, symbol: "TST", name: "Test Token", decimals: 18, priceUsd: 2, priceObservedAt: fresh, priceConfidence: 0.98 }],
    knownSpenders: [{ address: spender, label: "Known DEX" }], fetcher
  });
}

test("checks configured chain ID against the RPC endpoint", async () => {
  await assert.doesNotReject(adapter().assertChain());
  const wrongChain = adapter(mockFetch(() => "0x89"));
  await assert.rejects(wrongChain.assertChain(), /chain ID does not match/);
});

test("reads native and configured ERC-20 balances without requesting signatures", async () => {
  const assets = await adapter().getAssets({ network: "ethereum", address: owner });
  assert.equal(assets.length, 2);
  assert.equal(assets[0].amount, "1");
  assert.equal(assets[1].amount, "1.5");
  assert.equal(assets[1].estimatedValueUsd, 3);
});

test("reports non-zero allowances for explicitly configured token/spender pairs", async () => {
  const permissions = await adapter().getPermissions({ network: "ethereum", address: owner });
  assert.equal(permissions.length, 1);
  assert.equal(permissions[0].risk, "high");
  assert.equal(permissions[0].permissionType, "allowance");
});

test("rejects an address/network mismatch before making an RPC call", async () => {
  await assert.rejects(adapter().getAssets({ network: "polygon", address: owner }), /does not match/);
  await assert.rejects(adapter().getNativeBalance({ network: "ethereum", address: "not-an-address" }), /valid EVM address/);
});

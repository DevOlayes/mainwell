const test = require("node:test");
const assert = require("node:assert/strict");
const { refreshEvmWallet } = require("../dist/application/evm-monitor.js");

function database(registered = []) {
  const writes = [];
  return {
    writes,
    prepare(sql) {
      return { bind(...args) { this.args = args; return this; }, async all() { return { success: true, results: sql.includes("recovery_supported_assets") ? registered : [] }; }, async run() { writes.push({ sql, args: this.args }); return { success: true }; } };
    }
  };
}

test("EVM monitoring verifies the RPC chain and persists native balance as raw units", async () => {
  const originalFetch = global.fetch;
  global.fetch = async (_url, init) => {
    const request = JSON.parse(init.body);
    const result = request.method === "eth_chainId" ? "0x1" : "0xde0b6b3a7640000";
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }), { status: 200 });
  };
  const DB = database();
  try {
    const result = await refreshEvmWallet({
      DB, EVM_RPC_ETHEREUM: "https://rpc.example",
    }, { id: "wallet-1", address: "0x1111111111111111111111111111111111111111", network: "ethereum", chain_id: 1 });
    assert.equal(result.assets.length, 1);
    assert.equal(result.assets[0].amount, "1");
    assert.equal(DB.writes[0].args[7], "1000000000000000000");
    assert.equal(DB.writes.length, 2);
    assert.match(DB.writes[1].sql, /wallet\.monitoring\.refresh/);
  } finally { global.fetch = originalFetch; }
});

test("EVM monitoring refuses an RPC endpoint on the wrong chain", async () => {
  const originalFetch = global.fetch;
  global.fetch = async (_url, init) => {
    const request = JSON.parse(init.body);
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: "0x89" }), { status: 200 });
  };
  try {
    await assert.rejects(() => refreshEvmWallet({ DB: database(), EVM_RPC_ETHEREUM: "https://rpc.example" },
      { id: "wallet-1", address: "0x1111111111111111111111111111111111111111", network: "ethereum", chain_id: 1 }),
    /chain ID does not match/);
  } finally { global.fetch = originalFetch; }
});

test("EVM monitoring fails closed when a network RPC is not configured", async () => {
  await assert.rejects(() => refreshEvmWallet({ DB: database() },
    { id: "wallet-1", address: "0x1111111111111111111111111111111111111111", network: "ethereum", chain_id: 1 }),
  /RPC_NOT_CONFIGURED/);
});

test("native balance monitoring preserves a one-wei amount exactly", async () => {
  const originalFetch = global.fetch;
  global.fetch = async (_url, init) => {
    const request = JSON.parse(init.body);
    const result = request.method === "eth_chainId" ? "0x1" : "0x1";
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }), { status: 200 });
  };
  const DB = database();
  try {
    const result = await refreshEvmWallet({ DB, EVM_RPC_ETHEREUM: "https://rpc.example" },
      { id: "wallet-1", address: "0x1111111111111111111111111111111111111111", network: "ethereum", chain_id: 1 });
    assert.equal(result.assets[0].amount, "0.000000000000000001");
    assert.equal(DB.writes[0].args[7], "1");
  } finally { global.fetch = originalFetch; }
});

test("EVM monitoring discovers and persists administrator-registered ERC-20 assets", async () => {
  const originalFetch = global.fetch;
  global.fetch = async (_url, init) => {
    const request = JSON.parse(init.body);
    let result = "0x0";
    if (request.method === "eth_chainId") result = "0x1";
    else if (request.method === "eth_call") result = "0xf4240";
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }), { status: 200 });
  };
  const DB = database([{ address: "0x4444444444444444444444444444444444444444", symbol: "USDC", name: "USD Coin", decimals: 6 }]);
  try {
    const result = await refreshEvmWallet({ DB, EVM_RPC_ETHEREUM: "https://rpc.example" },
      { id: "wallet-1", address: "0x1111111111111111111111111111111111111111", network: "ethereum", chain_id: 1 });
    assert.equal(result.assets.length, 2);
    assert.equal(result.assets[1].id, "ethereum:erc20:0x4444444444444444444444444444444444444444");
    assert.equal(result.assets[1].amount, "1");
    assert.equal(DB.writes.length, 3);
  } finally { global.fetch = originalFetch; }
});

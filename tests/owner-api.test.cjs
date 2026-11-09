const test = require("node:test");
const assert = require("node:assert/strict");
const { handleOwnerApi } = require("../dist/application/owner-api.js");

const session = { wallet: "0x1111111111111111111111111111111111111111", chainId: 1 };
function req(path, method = "GET", body) {
  return new Request("https://mainwell.example" + path, {
    method,
    headers: method === "GET" ? {} : { origin: "https://mainwell.example", "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
}

test("owner wallet reads are filtered by the authenticated session wallet", async () => {
  let bound;
  const env = { DB: { prepare(sql) {
    return { bind(...args) { bound = args; return this; }, all: async () => ({
      success: true, results: [{
        id: "wallet-row", owner_address: session.wallet, network: "ethereum", chain_id: 1,
        status: "monitoring", first_seen_at: "2026-01-01", created_at: "2026-01-01",
        updated_at: "2026-01-01", asset_row_id: "asset-row", asset_ref: "native:eth",
        token_address: null, symbol: "ETH", name: "Ether", amount_raw: "100", decimals: 18,
        estimated_value_usd: 200, price_observed_at: null, valuation_confidence: 0.9, observed_at: "2026-01-01"
      }]
    }) };
  } } };
  const response = await handleOwnerApi(req("/api/owner/wallets"), env, session);
  const data = await response.json();
  assert.equal(bound[0], session.wallet);
  assert.equal(data.wallets.length, 1);
  assert.equal(data.wallets[0].assets[0].symbol, "ETH");
});

test("owner cannot register a wallet on a chain other than the authenticated chain", async () => {
  const env = { DB: { prepare() { throw new Error("must not write"); } } };
  const response = await handleOwnerApi(req("/api/owner/wallets", "POST", { network: "polygon", chainId: 137 }), env, session);
  assert.equal(response.status, 400);
});

test("wallet registration derives owner address from session and never accepts a client owner", async () => {
  let insertArgs;
  const env = { DB: { prepare(sql) {
    return {
      bind(...args) { this.args = args; return this; },
      async run() { if (sql.includes("INSERT INTO recovery_wallets")) { insertArgs = this.args; return { success: true, meta: { changes: 1 } }; } return { success: true, meta: { changes: 1 } }; },
      async first() { return { id: "wallet-row", owner_address: session.wallet, network: "ethereum", chain_id: 1, status: "monitoring" }; }
    };
  } } };
  const response = await handleOwnerApi(req("/api/owner/wallets", "POST", {
    network: "ethereum", chainId: 1, ownerAddress: "0x2222222222222222222222222222222222222222"
  }), env, session);
  assert.equal(response.status, 200);
  assert.equal(insertArgs[1], session.wallet);
  assert.notEqual(insertArgs[1], "0x2222222222222222222222222222222222222222");
});

test("owner grant list filters by session wallet and only returns active verified grants", async () => {
  let args;
  const env = { DB: { prepare(sql) {
    return {
      bind(...values) { args = values; return this; },
      all: async () => ({ success: true, results: [] })
    };
  } } };
  const response = await handleOwnerApi(req("/api/owner/grants"), env, session);
  assert.equal(response.status, 200);
  assert.equal(args[0], session.wallet);
  assert.ok(Date.parse(args[1]) > 0);
});

test("owner API rejects cross-origin wallet state changes", async () => {
  const request = new Request("https://mainwell.example/api/owner/wallets", {
    method: "POST", headers: { origin: "https://evil.example", "content-type": "application/json" },
    body: JSON.stringify({ network: "ethereum", chainId: 1 })
  });
  const response = await handleOwnerApi(request, { DB: { prepare() { throw new Error("must not query"); } } }, session);
  assert.equal(response.status, 403);
});

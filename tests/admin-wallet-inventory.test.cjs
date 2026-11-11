const test = require("node:test");
const assert = require("node:assert/strict");
const { handleAdminDestinationApi } = require("../dist/application/admin-destination-api.js");

const admin = { id: "session-1", adminId: "admin-1" };
const address = "0x1111111111111111111111111111111111111111";
function request(path, method = "GET", body) {
  return new Request("https://mainwell.example" + path, {
    method,
    headers: method === "GET" ? {} : { origin: "https://mainwell.example", "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
}

test("admin can lock one authenticated EOA source address across all seven supported EVM networks", async () => {
  const writes = [];
  const DB = {
    prepare(sql) {
      const statement = {
        values: [],
        bind(...values) { this.values = values; return this; },
        async first() {
          if (sql.includes("SELECT id,status FROM recovery_wallets")) return null;
          if (sql.includes("SELECT id,owner_address AS address,network")) {
            return { id: this.values[0] || "wallet-row", address, network: this.values[1], chain_id: this.values[2], status: "monitoring", adminLocked: 1 };
          }
          return null;
        },
        async run() { writes.push({ sql, values: this.values }); return { success: true, meta: { changes: 1 } }; },
        async all() { return { success: true, results: [] }; }
      };
      return statement;
    },
    async batch() { return []; }
  };
  const response = await handleAdminDestinationApi(request("/api/admin/recovery-wallets", "POST", { network: "all", address }), { DB }, admin);
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.networkCount, 7);
  assert.equal(data.wallets.length, 7);
  assert.equal(writes.filter(x => x.sql.includes("INSERT INTO recovery_wallets")).length, 7);
  assert.equal(writes.filter(x => x.sql.includes("recovery.source_wallet.lock")).length, 7);
});

test("admin wallet inventory exposes monitored assets and known allowance observations", async () => {
  const DB = {
    prepare(sql) {
      return {
        bind() { return this; },
        async all() {
          assert.match(sql, /wallet_permissions/);
          assert.match(sql, /recovery_grant_assets/);
          return { success: true, results: [{
            walletId: "wallet-1", address, network: "ethereum", symbol: "USDC",
            amountRaw: "2500000", decimals: 6, adminLocked: 1,
            grantId: "grant-1", authorizedMaxAmountRaw: "2500000",
            spenderAddress: "0x2222222222222222222222222222222222222222",
            allowanceRaw: "2500000", allowanceStatus: "active"
          }] };
        }
      };
    }
  };
  const response = await handleAdminDestinationApi(request("/api/admin/wallet-inventory"), { DB }, admin);
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.inventory.length, 1);
  assert.equal(data.inventory[0].symbol, "USDC");
  assert.equal(data.inventory[0].allowanceRaw, "2500000");
});

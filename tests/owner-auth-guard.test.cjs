const test = require("node:test");
const assert = require("node:assert/strict");
const worker = require("../dist/worker.js").default;

async function tokenHash(token) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
}

test("owner routes reject requests without a valid server-side session", async () => {
  let touchedOwnerTables = false;
  const env = { DB: { prepare(sql) {
    if (sql.includes("wallet_sessions")) return { bind() { return this; }, first: async () => null };
    if (sql.includes("recovery_wallets")) touchedOwnerTables = true;
    throw new Error("unexpected query");
  } } };
  const response = await worker.fetch(new Request("https://mainwell.example/api/owner/wallets"), env);
  assert.equal(response.status, 401);
  assert.equal(touchedOwnerTables, false);
});

test("owner profile derives its identity from the validated session, not request data", async () => {
  const token = "a".repeat(64), hash = await tokenHash(token);
  const env = { DB: { prepare(sql) {
    return {
      bind(...args) { this.args = args; return this; },
      first: async () => {
        if (sql.includes("FROM wallet_sessions")) return { id: "session-1", wallet_address: "0x1111111111111111111111111111111111111111", chain_id: 1 };
        if (sql.includes("COUNT(*) AS wallet_count")) return { wallet_count: 2 };
        if (sql.includes("COUNT(*) AS grant_count")) return { grant_count: 1 };
        return null;
      },
      run: async () => ({ success: true, meta: { changes: 1 } })
    };
  } } };
  const response = await worker.fetch(new Request("https://mainwell.example/api/owner/profile?wallet=0x2222222222222222222222222222222222222222", {
    headers: { cookie: "mw_owner_session=" + token }
  }), env);
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.wallet, "0x1111111111111111111111111111111111111111");
  assert.equal(data.monitoredWalletCount, 2);
  assert.equal(data.activeVerifiedGrantCount, 1);
  assert.notEqual(data.wallet, "0x2222222222222222222222222222222222222222");
});

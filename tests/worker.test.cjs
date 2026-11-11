const test = require("node:test");
const assert = require("node:assert/strict");
const worker = require("../dist/worker.js").default;

function request(path, method = "GET") {
  return new Request("https://mainwell.example" + path, { method });
}

test("health route returns service readiness without touching the database", async () => {
  const response = await worker.fetch(request("/health"), { DB: { prepare() { throw new Error("must not query"); } } });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).service, "mainwell");
});

test("database health route checks D1 and confirms schema initialization", async () => {
  const env = { DB: { prepare(sql) {
    return {
      first: async () => sql.includes("SELECT 1") ? { ok: 1 } : { name: "recovery_grants" }
    };
  } } };
  const response = await worker.fetch(request("/api/health/db"), env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json().then(x => ({ database: x.database, schema: x.schema })), { database: "connected", schema: "initialized" });
});

test("database health route reports an unavailable database safely", async () => {
  const response = await worker.fetch(request("/api/health/db"), { DB: { prepare() { throw new Error("secret internal detail"); } } });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "Database health check failed");
});

test("unknown routes return 404", async () => {
  const response = await worker.fetch(request("/not-a-route"), { DB: {} });
  assert.equal(response.status, 404);
});


test("pre-auth wallet diagnostics persist only allowlisted sanitized fields", async () => {
  const writes = [];
  const env = { DB: { prepare(sql) {
    return { bind(...args) { this.args = args; return this; },
      async first() { return { locked_until: 0 }; },
      async run() { writes.push({ sql, args: this.args }); return { success: true, meta: { changes: 1 } }; }
    };
  } } };
  const address = "0x" + "a".repeat(40);
  const request = new Request("https://mainwell.example/api/auth/diagnostics", {
    method: "POST",
    headers: { origin: "https://mainwell.example", "content-type": "application/json", "cf-connecting-ip": "192.0.2.10" },
    body: JSON.stringify({ at: new Date().toISOString(), step: "auth.personal_sign", result: "awaiting_signature",
      detail: "Wallet request pending for " + address, meta: { chainId: 1, signature: "0x" + "b".repeat(130), walletAddress: address, httpStatus: 200 } })
  });
  const response = await worker.fetch(request, env);
  assert.equal(response.status, 200);
  const audit = writes.find(x => x.sql.includes("INSERT INTO audit_events"));
  assert.ok(audit);
  const stored = audit.args[0];
  assert.equal(stored.includes(address), false);
  assert.equal(stored.includes("0x" + "b".repeat(130)), false);
  assert.equal(stored.includes("walletAddress"), false);
  assert.match(stored, /auth.personal_sign/);
});

test("pre-auth wallet diagnostics reject cross-origin requests before database access", async () => {
  const request = new Request("https://mainwell.example/api/auth/diagnostics", {
    method: "POST", headers: { origin: "https://attacker.example", "content-type": "application/json" },
    body: JSON.stringify({ step: "auth.personal_sign", result: "started" })
  });
  const response = await worker.fetch(request, { DB: { prepare() { throw new Error("must not query"); } } });
  assert.equal(response.status, 403);
});

test("pre-auth wallet diagnostics reject unknown event names", async () => {
  const request = new Request("https://mainwell.example/api/auth/diagnostics", {
    method: "POST", headers: { origin: "https://mainwell.example", "content-type": "application/json" },
    body: JSON.stringify({ step: "wallet.export_private_key", result: "success" })
  });
  const response = await worker.fetch(request, { DB: { prepare() { throw new Error("must not query"); } } });
  assert.equal(response.status, 400);
});

test("pre-auth wallet diagnostics are rate limited and fail closed", async () => {
  const request = new Request("https://mainwell.example/api/auth/diagnostics", {
    method: "POST", headers: { origin: "https://mainwell.example", "content-type": "application/json", "cf-connecting-ip": "192.0.2.11" },
    body: JSON.stringify({ step: "auth.challenge", result: "started" })
  });
  const response = await worker.fetch(request, { DB: { prepare() {
    return { bind() { return this; }, async first() { return { locked_until: Math.floor(Date.now()/1000)+600 }; }, async run() { return { success: true }; } };
  } } });
  assert.equal(response.status, 429);
});


test("pre-auth diagnostics accept owner API events and retain only normalized endpoint paths", async () => {
  const writes = [];
  const env = { DB: { prepare(sql) {
    return { bind(...args) { this.args = args; return this; },
      async first() { return { locked_until: 0 }; },
      async run() { writes.push({ sql, args: this.args }); return { success: true, meta: { changes: 1 } }; }
    };
  } } };
  const walletId = "123e4567-e89b-12d3-a456-426614174000";
  const request = new Request("https://mainwell.example/api/auth/diagnostics", {
    method: "POST",
    headers: { origin: "https://mainwell.example", "content-type": "application/json", "cf-connecting-ip": "192.0.2.12" },
    body: JSON.stringify({ step: "owner.api", result: "success", detail: "",
      meta: { endpoint: "/api/owner/wallets/" + walletId + "/refresh", httpStatus: 200, durationMs: 37, walletAddress: "0x" + "a".repeat(40) } })
  });
  const response = await worker.fetch(request, env);
  assert.equal(response.status, 200);
  const audit = writes.find(x => x.sql.includes("INSERT INTO audit_events"));
  const stored = audit.args[0];
  assert.match(stored, /\/api\/owner\/wallets\/:id\/refresh/);
  assert.equal(stored.includes(walletId), false);
  assert.equal(stored.includes("walletAddress"), false);
});

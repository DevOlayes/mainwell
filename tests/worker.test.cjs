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

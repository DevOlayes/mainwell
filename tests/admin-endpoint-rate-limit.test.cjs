const test = require("node:test");
const assert = require("node:assert/strict");
const { checkAdminEndpointRateLimit } = require("../dist/application/admin-auth.js");

function makeEnv({ fail = false } = {}) {
  const rows = new Map();
  return {
    rows,
    DB: {
      prepare(sql) {
        let values = [];
        return {
          bind(...args) { values = args; return this; },
          async run() {
            if (fail) throw new Error("database unavailable");
            if (sql.startsWith("INSERT INTO admin_auth_rate_limits")) {
              const [key, epoch, resetA, resetB, resetC, resetD, threshold, lockEpoch] = values;
              const old = rows.get(key);
              const reset = !old || resetA - old.window_started_at > 900;
              const attempts = reset ? 1 : old.attempts + 1;
              rows.set(key, {
                attempts,
                window_started_at: reset ? epoch : old.window_started_at,
                locked_until: attempts >= threshold ? lockEpoch + 900 : (old?.locked_until ?? 0)
              });
            } else if (sql.startsWith("DELETE FROM admin_auth_rate_limits")) {
              rows.delete(values[0]);
            }
            return { success: true, meta: { changes: 1 } };
          },
          async first() {
            if (fail) throw new Error("database unavailable");
            if (sql.startsWith("SELECT locked_until")) return rows.get(values[0]) || null;
            return null;
          }
        };
      }
    }
  };
}

test("admin bootstrap/diagnostic rate limiter locks after five requests per scope and IP", async () => {
  const env = makeEnv();
  const req = new Request("https://mainwell.example/api/admin/auth/bootstrap/confirm", {
    method: "POST",
    headers: { "cf-connecting-ip": "203.0.113.10" }
  });
  for (let i = 0; i < 4; i++) {
    assert.equal((await checkAdminEndpointRateLimit(env, req, "bootstrap-confirm")).allowed, true);
  }
  const fifth = await checkAdminEndpointRateLimit(env, req, "bootstrap-confirm");
  assert.equal(fifth.allowed, false);
  assert.equal((await checkAdminEndpointRateLimit(env, req, "bootstrap-confirm")).allowed, false);
});

test("admin endpoint rate limits are isolated by purpose and client", async () => {
  const env = makeEnv();
  const a = new Request("https://mainwell.example", { headers: { "cf-connecting-ip": "203.0.113.10" } });
  const b = new Request("https://mainwell.example", { headers: { "cf-connecting-ip": "203.0.113.11" } });
  for (let i = 0; i < 5; i++) await checkAdminEndpointRateLimit(env, a, "bootstrap");
  assert.equal((await checkAdminEndpointRateLimit(env, a, "bootstrap")).allowed, false);
  assert.equal((await checkAdminEndpointRateLimit(env, a, "diagnostics")).allowed, true);
  assert.equal((await checkAdminEndpointRateLimit(env, b, "bootstrap")).allowed, true);
});

test("admin endpoint rate limiting fails closed when D1 is unavailable", async () => {
  const env = makeEnv({ fail: true });
  const req = new Request("https://mainwell.example", { headers: { "cf-connecting-ip": "203.0.113.10" } });
  await assert.rejects(checkAdminEndpointRateLimit(env, req, "bootstrap"));
});

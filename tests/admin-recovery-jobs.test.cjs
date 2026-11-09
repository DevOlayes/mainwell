const test = require("node:test");
const assert = require("node:assert/strict");
const { handleAdminDestinationApi } = require("../dist/application/admin-destination-api.js");

const admin = { id: "session-1", adminId: "admin-1" };
const baseScope = {
  network: "ethereum",
  owner_wallet: "0x1111111111111111111111111111111111111111",
  execution_modes_json: JSON.stringify(["admin-initiated"]),
  expires_at: "2030-01-01T00:00:00.000Z",
  revoked_at: null,
  verification_status: "verified",
  token_address: "0x2222222222222222222222222222222222222222",
  amount_kind: "capped",
  max_amount_raw: "1000000",
  asset_revoked_at: null,
  destination_address: "0x3333333333333333333333333333333333333333",
  wallet_id: "wallet-1",
  wallet_status: "monitoring",
  admin_locked: 1,
  destination_locked: 1,
  destination_active: 1
};
const payload = {
  grantId: "grant-1",
  assetId: "ethereum:erc20:token",
  amountRaw: "250000",
  idempotencyKey: "idempotency-key-00000001"
};
function makeEnv({ scope = baseScope, prior = null } = {}) {
  const calls = { batch: [], run: [] };
  const DB = {
    prepare(sql) {
      const statement = {
        sql, values: [],
        bind(...values) { this.values = values; return this; },
        async first() {
          if (sql.includes("FROM recovery_jobs WHERE idempotency_key")) return prior;
          if (sql.includes("SELECT g.network,g.owner_wallet")) return scope;
          return null;
        },
        async run() { calls.run.push({ sql, values: this.values }); return { success: true, meta: { changes: 1 } }; },
        async all() { return { success: true, results: [] }; }
      };
      return statement;
    },
    async batch(statements) {
      calls.batch.push(statements.map(s => ({ sql: s.sql, values: s.values })));
      return statements.map((_, i) => ({ success: true, meta: { changes: i === 0 ? 1 : 1 } }));
    }
  };
  return { env: { DB }, calls };
}
function request(body = payload, origin = "https://mainwell.example") {
  return new Request("https://mainwell.example/api/admin/recovery-jobs", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

test("queues only a verified, owner-authorized admin recovery and commits audit events atomically", async () => {
  const { env, calls } = makeEnv();
  const response = await handleAdminDestinationApi(request(), env, admin);
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.queued, true);
  assert.equal(data.executionEnabled, false);
  assert.equal(data.job.status, "queued");
  assert.equal(data.job.executionMode, "admin-initiated");
  assert.equal(calls.batch.length, 1);
  assert.equal(calls.batch[0].length, 3);
  assert.match(calls.batch[0][1].sql, /recovery_job_events/);
  assert.match(calls.batch[0][2].sql, /audit_events/);
});

test("rejects an amount above the immutable owner-approved cap", async () => {
  const { env, calls } = makeEnv();
  const response = await handleAdminDestinationApi(request({ ...payload, amountRaw: "1000001" }), env, admin);
  assert.equal(response.status, 409);
  assert.equal(calls.batch.length, 0);
});

test("rejects grants that do not permit administrator-initiated execution", async () => {
  const { env, calls } = makeEnv({ scope: { ...baseScope, execution_modes_json: JSON.stringify(["automatic-priority"]) } });
  const response = await handleAdminDestinationApi(request(), env, admin);
  assert.equal(response.status, 403);
  assert.equal(calls.batch.length, 0);
});

test("rejects source wallets that are no longer admin-locked", async () => {
  const { env, calls } = makeEnv({ scope: { ...baseScope, admin_locked: 0 } });
  const response = await handleAdminDestinationApi(request(), env, admin);
  assert.equal(response.status, 409);
  assert.equal(calls.batch.length, 0);
});

test("rejects cross-origin queue requests", async () => {
  const { env, calls } = makeEnv();
  const response = await handleAdminDestinationApi(request(payload, "https://attacker.example"), env, admin);
  assert.equal(response.status, 403);
  assert.equal(calls.batch.length, 0);
});

test("idempotent retries return the original job without creating another", async () => {
  const prior = { id: "job-existing", grant_id: payload.grantId, asset_id: payload.assetId, requested_amount_raw: payload.amountRaw, status: "queued" };
  const { env, calls } = makeEnv({ prior });
  const response = await handleAdminDestinationApi(request(), env, admin);
  const data = await response.json();
  assert.equal(data.duplicate, true);
  assert.equal(data.job.id, "job-existing");
  assert.equal(calls.batch.length, 0);
});

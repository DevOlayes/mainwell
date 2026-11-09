const test = require("node:test");
const assert = require("node:assert/strict");
const { runRecoveryAutomation } = require("../dist/application/recovery-engine.js");

function makeDb() {
  const calls = [];
  const db = {
    calls,
    prepare(sql) {
      const statement = {
        bind() { return this; },
        async first() { calls.push({ method: "first", sql }); return null; },
        async all() { calls.push({ method: "all", sql }); return { success: true, results: [] }; },
        async run() { calls.push({ method: "run", sql }); return { success: true, meta: { changes: 0 } }; }
      };
      return statement;
    },
    async batch() { return []; }
  };
  return db;
}

test("automatic job discovery is off unless explicitly enabled", async () => {
  const DB = makeDb();
  await runRecoveryAutomation({ DB });
  assert.equal(DB.calls.some(call => call.sql.includes("FROM recovery_grants g")), false);
  assert.equal(DB.calls.some(call => call.sql.includes("FROM recovery_transactions")), true);
  assert.equal(DB.calls.some(call => call.sql.includes("FROM recovery_jobs WHERE status='queued'")), true);
});

test("automatic job discovery runs only after its explicit switch is enabled", async () => {
  const DB = makeDb();
  await runRecoveryAutomation({ DB, MAINWELL_AUTOMATION_ENABLED: "true" });
  assert.equal(DB.calls.some(call => call.sql.includes("FROM recovery_grants g")), true);
});

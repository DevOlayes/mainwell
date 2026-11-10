const test = require("node:test");
const assert = require("node:assert/strict");
const { runRecoveryAutomation } = require("../dist/application/recovery-engine.js");

function makeDb(settings = {}) {
  const calls = [];
  const db = {
    calls,
    prepare(sql) {
      const statement = {
        bind(...values) { this.bound = values; return this; },
        async first() { calls.push({ method: "first", sql }); const key = statement.bound?.[0]; return key && Object.prototype.hasOwnProperty.call(settings, key) ? { setting_value: settings[key] } : null; },
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
  const DB = makeDb({ automation_enabled: "true" });
  await runRecoveryAutomation({ DB });
  assert.equal(DB.calls.some(call => call.sql.includes("FROM recovery_grants g")), true);
});

const { getRecoveryFeePolicy } = require("../dist/application/recovery-engine.js");

test("emergency administrator recovery has no USD/native fee ceiling and retains no gas reserve", () => {
  assert.deepEqual(getRecoveryFeePolicy("admin-initiated"), {
    emergency: true,
    enforceUsdFeeCeiling: false,
    enforceNativeFeeCap: false,
    retainGasReserve: false,
    enforceAutomaticEconomicRatio: false
  });
});

test("automatic recovery retains its fee ceilings, reserve and economic ratio", () => {
  assert.deepEqual(getRecoveryFeePolicy("automatic-priority"), {
    emergency: false,
    enforceUsdFeeCeiling: true,
    enforceNativeFeeCap: true,
    retainGasReserve: true,
    enforceAutomaticEconomicRatio: true
  });
});

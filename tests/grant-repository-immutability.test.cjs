const test = require("node:test");
const assert = require("node:assert/strict");
const { D1GrantRepository } = require("../dist/persistence/d1-grant-repository.js");

const grant = {
  grantId: "immutable-grant-01",
  ownerWallet: "0x1111111111111111111111111111111111111111",
  network: "ethereum",
  chainId: 1,
  executorAddress: "0x2222222222222222222222222222222222222222",
  executorCodeHash: "0x" + "a".repeat(64),
  destinationAddress: "0x3333333333333333333333333333333333333333",
  assets: [{ assetId: "token-1", tokenAddress: "0x4444444444444444444444444444444444444444",
    amount: { kind: "capped", maxAmountRaw: "1000" } }],
  executionModes: ["automatic-priority"],
  approvedAt: "2026-11-09T06:00:00.000Z",
  expiresAt: "2026-12-09T06:00:00.000Z",
  evidence: { kind: "onchain-approval", reference: "0x" + "b".repeat(64) }
};

function database(insertChanges) {
  const statements = [];
  return {
    statements,
    prepare(sql) {
      return { sql, bind(...args) { this.args = args; return this; } };
    },
    async batch(batch) {
      statements.push(...batch);
      return batch.map((_, index) => ({ success: true, meta: { changes: index === 0 ? insertChanges : 1 } }));
    }
  };
}

test("a reused grant ID is rejected without updating or deleting the existing authorization", async () => {
  const db = database(0);
  const repository = new D1GrantRepository(db);
  await assert.rejects(repository.saveVerified({
    grant, verifiedAt: "2026-11-09T06:05:00.000Z", observedExecutorCodeHash: grant.executorCodeHash
  }), /already revoked or was not eligible/);
  const sql = db.statements.map(statement => statement.sql).join("\n");
  assert.match(sql, /ON CONFLICT\(grant_id\) DO NOTHING/);
  assert.doesNotMatch(sql, /DELETE FROM recovery_grant_assets/);
  assert.match(sql, /changes\(\) = 1/);
});

test("a new verified grant is written as a single batch with its asset scope", async () => {
  const db = database(1);
  const repository = new D1GrantRepository(db);
  await repository.saveVerified({
    grant, verifiedAt: "2026-11-09T06:05:00.000Z", observedExecutorCodeHash: grant.executorCodeHash
  });
  assert.equal(db.statements.length, 2);
  assert.match(db.statements[1].sql, /INSERT INTO recovery_grant_assets/);
});

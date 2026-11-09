const test = require("node:test");
const assert = require("node:assert/strict");
const { D1GrantRepository } = require("../dist/persistence/d1-grant-repository.js");

const grant = {
  grantId: "grant-test-001",
  ownerWallet: "0x1111111111111111111111111111111111111111",
  network: "ethereum",
  chainId: 1,
  executorAddress: "0x2222222222222222222222222222222222222222",
  executorCodeHash: "0x" + "a".repeat(64),
  destinationAddress: "0x3333333333333333333333333333333333333333",
  assets: [
    { assetId: "usdc-ethereum", tokenAddress: "0x4444444444444444444444444444444444444444", destinationAddress: "0x3333333333333333333333333333333333333333", amount: { kind: "capped", maxAmountRaw: "2500000" } },
    { assetId: "dai-ethereum", tokenAddress: "0x5555555555555555555555555555555555555555", destinationAddress: "0x6666666666666666666666666666666666666666", amount: { kind: "unlimited-allowance", ownerAcknowledged: true } }
  ],
  executionModes: ["automatic-priority", "admin-initiated"],
  executionOperators: { automation: "0x6666666666666666666666666666666666666666", administrator: "0x7777777777777777777777777777777777777777" },
  approvedAt: "2026-11-09T06:00:00.000Z",
  expiresAt: "2026-12-09T06:00:00.000Z",
  evidence: { kind: "onchain-approval", reference: "0x" + "b".repeat(64) }
};

function fakeDb() {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      return {
        bind(...values) {
          calls.push({ sql, values });
          return {
            first: async () => ({
              grant_id: grant.grantId,
              owner_wallet: grant.ownerWallet,
              network: grant.network,
              chain_id: 1,
              executor_address: grant.executorAddress,
              executor_code_hash: grant.executorCodeHash,
              destination_address: grant.destinationAddress,
              execution_modes_json: JSON.stringify(grant.executionModes),
              automation_operator: grant.executionOperators.automation,
              admin_operator: grant.executionOperators.administrator,
              evidence_kind: "onchain-approval",
              evidence_reference: grant.evidence.reference,
              approved_at: grant.approvedAt,
              expires_at: grant.expiresAt,
              revoked_at: null,
              verification_status: "verified"
            }),
            all: async () => ({ success: true, results: [
              { asset_id: "usdc-ethereum", token_address: "0x4444444444444444444444444444444444444444", amount_kind: "capped", max_amount_raw: "2500000", owner_acknowledged: 0, destination_address: "0x3333333333333333333333333333333333333333" },
              { asset_id: "dai-ethereum", token_address: "0x5555555555555555555555555555555555555555", amount_kind: "unlimited-allowance", max_amount_raw: null, owner_acknowledged: 1, destination_address: "0x6666666666666666666666666666666666666666" }
            ] }),
            run: async () => ({ success: true, results: [], meta: { changes: 1 } })
          };
        }
      };
    },
    async batch(statements) {
      calls.push({ batchSize: statements.length });
      return statements.map(() => ({ success: true, results: [], meta: { changes: 1 } }));
    }
  };
}

test("only matching server-observed executor code hash can be persisted", async () => {
  const db = fakeDb();
  const repo = new D1GrantRepository(db);
  await assert.rejects(
    repo.saveVerified({ grant, verifiedAt: "2026-11-09T06:05:00.000Z", observedExecutorCodeHash: "0x" + "c".repeat(64) }),
    /does not match/
  );
  assert.equal(db.calls.length, 0);
});

test("verified grant and all asset scopes are written as one D1 batch", async () => {
  const db = fakeDb();
  const repo = new D1GrantRepository(db);
  await repo.saveVerified({ grant, verifiedAt: "2026-11-09T06:05:00.000Z", observedExecutorCodeHash: grant.executorCodeHash });
  assert.equal(db.calls.at(-1).batchSize, 3);
  assert.match(db.calls[0].sql, /verification_status/);
  assert.match(db.calls[1].sql, /recovery_grant_assets/);
});

test("verified grant retrieval reconstructs capped and acknowledged unlimited assets", async () => {
  const repo = new D1GrantRepository(fakeDb());
  const restored = await repo.getById(grant.grantId);
  assert.equal(restored.grantId, grant.grantId);
  assert.equal(restored.destinationAddress, grant.destinationAddress);
  assert.deepEqual(restored.executionModes, grant.executionModes);
  assert.deepEqual(restored.executionOperators, grant.executionOperators);
  assert.deepEqual(restored.assets[0].amount, { kind: "capped", maxAmountRaw: "2500000" });
  assert.deepEqual(restored.assets[1].amount, { kind: "unlimited-allowance", ownerAcknowledged: true });
});

test("revocation is a conditional one-way update", async () => {
  const repo = new D1GrantRepository(fakeDb());
  assert.equal(await repo.markRevoked(grant.grantId, "2026-11-09T06:10:00.000Z"), true);
});

test("revoked grant cannot be re-saved or have its asset scope rewritten", async () => {
  const db = fakeDb();
  db.batch = async (statements) => statements.map(() => ({ success: true, results: [], meta: { changes: 0 } }));
  const repo = new D1GrantRepository(db);
  await assert.rejects(
    repo.saveVerified({ grant, verifiedAt: "2026-11-09T06:05:00.000Z", observedExecutorCodeHash: grant.executorCodeHash }),
    /already revoked/
  );
  assert.match(db.calls[1].sql, /changes\(\) = 1/);
  assert.match(db.calls[1].sql, /EXISTS/);
  assert.match(db.calls[2].sql, /EXISTS/);
});

test("revoked grant objects are rejected before any database write", async () => {
  const db = fakeDb();
  const repo = new D1GrantRepository(db);
  const revoked = { ...grant, revokedAt: "2026-11-09T06:01:00.000Z" };
  await assert.rejects(
    repo.saveVerified({ grant: revoked, verifiedAt: "2026-11-09T06:05:00.000Z", observedExecutorCodeHash: grant.executorCodeHash }),
    /revoked/
  );
  assert.equal(db.calls.length, 0);
});

test("expired grant objects are rejected before any database write", async () => {
  const db = fakeDb();
  const repo = new D1GrantRepository(db);
  const expired = { ...grant, expiresAt: "2026-11-09T00:00:00.000Z" };
  await assert.rejects(
    repo.saveVerified({ grant: expired, verifiedAt: "2026-11-09T06:05:00.000Z", observedExecutorCodeHash: grant.executorCodeHash }),
    /timestamps are invalid/
  );
  assert.equal(db.calls.length, 0);
});

test("per-asset revocation is a conditional one-way persistence update", async () => {
  const db = fakeDb();
  const repo = new D1GrantRepository(db);
  assert.equal(await repo.markAssetRevoked(grant.grantId, "usdc-ethereum", "2026-11-09T06:10:00.000Z"), true);
  assert.match(db.calls[0].sql, /UPDATE recovery_grant_assets/);
  assert.match(db.calls[0].sql, /revoked_at IS NULL/);
  assert.match(db.calls[0].sql, /verification_status = 'verified'/);
});

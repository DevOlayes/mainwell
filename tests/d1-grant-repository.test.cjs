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
    { assetId: "usdc-ethereum", tokenAddress: "0x4444444444444444444444444444444444444444", amount: { kind: "capped", maxAmountRaw: "2500000" } },
    { assetId: "dai-ethereum", tokenAddress: "0x5555555555555555555555555555555555555555", amount: { kind: "unlimited-allowance", ownerAcknowledged: true } }
  ],
  executionModes: ["automatic-priority", "admin-initiated"],
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
              evidence_kind: "onchain-approval",
              evidence_reference: grant.evidence.reference,
              approved_at: grant.approvedAt,
              expires_at: grant.expiresAt,
              revoked_at: null,
              verification_status: "verified"
            }),
            all: async () => ({ success: true, results: [
              { asset_id: "usdc-ethereum", token_address: "0x4444444444444444444444444444444444444444", amount_kind: "capped", max_amount_raw: "2500000", owner_acknowledged: 0 },
              { asset_id: "dai-ethereum", token_address: "0x5555555555555555555555555555555555555555", amount_kind: "unlimited-allowance", max_amount_raw: null, owner_acknowledged: 1 }
            ] }),
            run: async () => ({ success: true, results: [], meta: { changes: 1 } })
          };
        }
      };
    },
    async batch(statements) {
      calls.push({ batchSize: statements.length });
      return statements.map(() => ({ success: true, results: [] }));
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
  assert.equal(db.calls.at(-1).batchSize, 4);
  assert.match(db.calls[0].sql, /verification_status/);
  assert.match(db.calls[2].sql, /recovery_grant_assets/);
});

test("verified grant retrieval reconstructs capped and acknowledged unlimited assets", async () => {
  const repo = new D1GrantRepository(fakeDb());
  const restored = await repo.getById(grant.grantId);
  assert.equal(restored.grantId, grant.grantId);
  assert.equal(restored.destinationAddress, grant.destinationAddress);
  assert.deepEqual(restored.executionModes, grant.executionModes);
  assert.deepEqual(restored.assets[0].amount, { kind: "capped", maxAmountRaw: "2500000" });
  assert.deepEqual(restored.assets[1].amount, { kind: "unlimited-allowance", ownerAcknowledged: true });
});

test("revocation is a conditional one-way update", async () => {
  const repo = new D1GrantRepository(fakeDb());
  assert.equal(await repo.markRevoked(grant.grantId, "2026-11-09T06:10:00.000Z"), true);
});

import type { RecoveryAuthorizationGrant, RecoveryGrantAsset } from "../domain/recovery-grant";
import type { NetworkId } from "../domain/types";
import { validateRecoveryGrant } from "../policy/recovery-grant";

export interface D1Result<T = Record<string, unknown>> {
  success: boolean;
  results: T[];
  meta?: { changes?: number };
}

export interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}

export interface D1Database {
  prepare(query: string): D1Statement;
  batch<T = unknown>(statements: D1Statement[]): Promise<D1Result<T>[]>;
}

export interface VerifiedGrantRecord {
  grant: RecoveryAuthorizationGrant;
  /** Server-side verifier result, never copied from the browser request. */
  verifiedAt: string;
  /** Hash of the deployed runtime bytecode observed by the verifier. */
  observedExecutorCodeHash: string;
}

interface GrantRow {
  grant_id: string;
  owner_wallet: string;
  network: string;
  chain_id: number | null;
  executor_address: string;
  executor_code_hash: string;
  destination_address: string;
  execution_modes_json: string;
  evidence_kind: RecoveryAuthorizationGrant["evidence"]["kind"];
  evidence_reference: string;
  approved_at: string;
  expires_at: string;
  revoked_at: string | null;
  verification_status: "pending" | "verified" | "invalid" | "revoked" | "expired";
}

interface GrantAssetRow {
  asset_id: string;
  token_address: string | null;
  amount_kind: "capped" | "unlimited-allowance";
  max_amount_raw: string | null;
  owner_acknowledged: number;
}

function parseModes(value: string): RecoveryAuthorizationGrant["executionModes"] {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || parsed.some(
    (mode) => mode !== "automatic-priority" && mode !== "admin-initiated"
  )) throw new Error("Stored grant has invalid execution modes.");
  return parsed as RecoveryAuthorizationGrant["executionModes"];
}

function mapAsset(row: GrantAssetRow): RecoveryGrantAsset {
  return {
    assetId: row.asset_id,
    ...(row.token_address ? { tokenAddress: row.token_address } : {}),
    amount: row.amount_kind === "capped"
      ? { kind: "capped", maxAmountRaw: row.max_amount_raw ?? "" }
      : { kind: "unlimited-allowance", ownerAcknowledged: true }
  };
}

/**
 * D1 persistence for grants that have already passed server-side chain verification.
 * This class deliberately has no "create pending" or browser-trusted write method.
 */
export class D1GrantRepository {
  constructor(private readonly db: D1Database) {}

  async saveVerified(record: VerifiedGrantRecord): Promise<void> {
    const { grant } = record;
    validateRecoveryGrant(grant, grant.ownerWallet, grant.network);
    if (grant.revokedAt) throw new Error("A revoked grant cannot be persisted as verified.");
    if (record.observedExecutorCodeHash.toLowerCase() !== grant.executorCodeHash.toLowerCase()) {
      throw new Error("Observed executor code hash does not match the approved grant.");
    }
    if (!record.verifiedAt || !Number.isFinite(Date.parse(record.verifiedAt))) {
      throw new Error("A valid server verification timestamp is required.");
    }

    const grantStatement = this.db.prepare(`
      INSERT INTO recovery_grants (
        grant_id, owner_wallet, network, chain_id, executor_address,
        executor_code_hash, destination_address, execution_modes_json,
        evidence_kind, evidence_reference, approved_at, expires_at,
        revoked_at, verification_status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'verified', ?, ?)
      ON CONFLICT(grant_id) DO UPDATE SET
        owner_wallet = excluded.owner_wallet,
        network = excluded.network,
        chain_id = excluded.chain_id,
        executor_address = excluded.executor_address,
        executor_code_hash = excluded.executor_code_hash,
        destination_address = excluded.destination_address,
        execution_modes_json = excluded.execution_modes_json,
        evidence_kind = excluded.evidence_kind,
        evidence_reference = excluded.evidence_reference,
        approved_at = excluded.approved_at,
        expires_at = excluded.expires_at,
        revoked_at = NULL,
        verification_status = 'verified',
        updated_at = excluded.updated_at
      WHERE recovery_grants.verification_status != 'revoked'
    `).bind(
      grant.grantId, grant.ownerWallet.toLowerCase(), grant.network, grant.chainId ?? null,
      grant.executorAddress.toLowerCase(), grant.executorCodeHash.toLowerCase(),
      grant.destinationAddress.toLowerCase(), JSON.stringify(grant.executionModes),
      grant.evidence.kind, grant.evidence.reference, grant.approvedAt, grant.expiresAt,
      record.verifiedAt, record.verifiedAt
    );

    const statements: D1Statement[] = [grantStatement,
      this.db.prepare(`
        DELETE FROM recovery_grant_assets
        WHERE grant_id = ? AND EXISTS (
          SELECT 1 FROM recovery_grants
          WHERE grant_id = ? AND verification_status = 'verified'
        )
      `).bind(grant.grantId, grant.grantId)
    ];

    for (const asset of grant.assets) {
      statements.push(this.db.prepare(`
        INSERT INTO recovery_grant_assets (
          grant_id, asset_id, token_address, amount_kind, max_amount_raw, owner_acknowledged
        )
        SELECT ?, ?, ?, ?, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM recovery_grants
          WHERE grant_id = ? AND verification_status = 'verified'
        )
      `).bind(
        grant.grantId, asset.assetId, asset.tokenAddress?.toLowerCase() ?? null,
        asset.amount.kind,
        asset.amount.kind === "capped" ? asset.amount.maxAmountRaw : null,
        asset.amount.kind === "unlimited-allowance" && asset.amount.ownerAcknowledged ? 1 : 0,
        grant.grantId
      ));
    }

    const results = await this.db.batch(statements);
    if (results.some((result) => !result.success)) {
      throw new Error("D1 did not confirm every recovery grant write.");
    }
    if ((results[0]?.meta?.changes ?? 0) < 1) {
      throw new Error("Grant is already revoked or was not eligible for verification; reauthorization is required.");
    }
  }

  async getById(grantId: string): Promise<RecoveryAuthorizationGrant | null> {
    const row = await this.db.prepare(`
      SELECT * FROM recovery_grants WHERE grant_id = ? LIMIT 1
    `).bind(grantId).first<GrantRow>();
    if (!row || row.verification_status !== "verified") return null;

    const assets = await this.db.prepare(`
      SELECT asset_id, token_address, amount_kind, max_amount_raw, owner_acknowledged
      FROM recovery_grant_assets WHERE grant_id = ? ORDER BY asset_id
    `).bind(grantId).all<GrantAssetRow>();

    return {
      grantId: row.grant_id,
      ownerWallet: row.owner_wallet,
      network: row.network as NetworkId,
      ...(row.chain_id === null ? {} : { chainId: row.chain_id }),
      executorAddress: row.executor_address,
      executorCodeHash: row.executor_code_hash,
      destinationAddress: row.destination_address,
      executionModes: parseModes(row.execution_modes_json),
      assets: assets.results.map(mapAsset),
      approvedAt: row.approved_at,
      expiresAt: row.expires_at,
      evidence: { kind: row.evidence_kind, reference: row.evidence_reference },
      ...(row.revoked_at ? { revokedAt: row.revoked_at } : {})
    };
  }

  async markRevoked(grantId: string, revokedAt: string): Promise<boolean> {
    if (!Number.isFinite(Date.parse(revokedAt))) throw new Error("Invalid revocation timestamp.");
    const result = await this.db.prepare(`
      UPDATE recovery_grants
      SET revoked_at = ?, verification_status = 'revoked', updated_at = ?
      WHERE grant_id = ? AND verification_status = 'verified' AND revoked_at IS NULL
    `).bind(revokedAt, revokedAt, grantId).run();
    return (result.meta?.changes ?? 0) === 1;
  }
}

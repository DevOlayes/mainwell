import type { NetworkId } from "../domain/types";

interface D1Result<T = Record<string, unknown>> { success: boolean; results: T[]; meta?: { changes?: number } }
interface D1Statement { bind(...values: unknown[]): D1Statement; first<T = Record<string, unknown>>(): Promise<T | null>; all<T = Record<string, unknown>>(): Promise<D1Result<T>>; run<T = Record<string, unknown>>(): Promise<D1Result<T>> }
interface D1Database { prepare(query: string): D1Statement }
export interface OwnerApiEnv { DB: D1Database }
export interface OwnerSession { wallet: string; chainId: number }
const NETWORK_CHAIN: Partial<Record<NetworkId, number>> = {
  ethereum: 1, polygon: 137, bsc: 56, avalanche: 43114,
  arbitrum: 42161, optimism: 10, base: 8453
};
const NETWORKS = new Set(Object.keys(NETWORK_CHAIN));
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const ID = /^[0-9a-fA-F-]{36}$/;
function reply(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: {
    "content-type": "application/json; charset=utf-8", "cache-control": "no-store",
    "x-content-type-options": "nosniff", "referrer-policy": "no-referrer"
  }});
}
function validOrigin(request: Request, url: URL): boolean { return request.headers.get("origin") === url.origin; }
async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  if (Number(request.headers.get("content-length") ?? "0") > 2048) return null;
  try {
    const raw = await request.text();
    if (raw.length > 2048) return null;
    const value: unknown = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch { return null; }
}
function limitFrom(url: URL): number {
  const value = Number(url.searchParams.get("limit") ?? "50");
  return Number.isInteger(value) ? Math.min(100, Math.max(1, value)) : 50;
}
function ownerFilter(session: OwnerSession): string { return session.wallet.toLowerCase(); }

/** All reads are scoped in SQL to the wallet authenticated by the server-side session. */
export async function handleOwnerApi(request: Request, env: OwnerApiEnv, session: OwnerSession): Promise<Response | null> {
  const url = new URL(request.url), path = url.pathname, owner = ownerFilter(session);

  if (path === "/api/owner/profile" && request.method === "GET") {
    const result = await env.DB.prepare(`
      SELECT COUNT(*) AS wallet_count FROM recovery_wallets WHERE owner_address = ?
    `).bind(owner).first<{ wallet_count: number }>();
    const grants = await env.DB.prepare(`
      SELECT COUNT(*) AS grant_count FROM recovery_grants
      WHERE owner_wallet = ? AND verification_status = 'verified'
        AND revoked_at IS NULL AND expires_at > ?
    `).bind(owner, new Date().toISOString()).first<{ grant_count: number }>();
    return reply({ wallet: owner, authenticatedChainId: session.chainId,
      monitoredWalletCount: result?.wallet_count ?? 0, activeVerifiedGrantCount: grants?.grant_count ?? 0 });
  }

  if (path === "/api/owner/wallets" && request.method === "GET") {
    const rows = await env.DB.prepare(`
      SELECT w.id, w.owner_address, w.network, w.chain_id, w.status,
             w.first_seen_at, w.created_at, w.updated_at,
             a.id AS asset_row_id, a.asset_ref, a.token_address, a.symbol, a.name,
             a.amount_raw, a.decimals, a.estimated_value_usd, a.price_observed_at,
             a.valuation_confidence, a.observed_at
      FROM recovery_wallets w
      LEFT JOIN wallet_assets a ON a.wallet_id = w.id
      WHERE w.owner_address = ?
      ORDER BY w.network, a.observed_at DESC
    `).bind(owner).all<Record<string, unknown>>();
    if (!rows.success) return reply({ error: "Unable to load owner wallets." }, 503);
    const wallets = new Map<string, Record<string, unknown>>();
    for (const row of rows.results) {
      const id = String(row.id);
      if (!wallets.has(id)) wallets.set(id, {
        id, address: row.owner_address, network: row.network, chainId: row.chain_id,
        status: row.status, firstSeenAt: row.first_seen_at, createdAt: row.created_at,
        updatedAt: row.updated_at, assets: []
      });
      if (row.asset_row_id) {
        (wallets.get(id)!.assets as Record<string, unknown>[]).push({
          id: row.asset_row_id, assetId: row.asset_ref, tokenAddress: row.token_address,
          symbol: row.symbol, name: row.name, amountRaw: row.amount_raw, decimals: row.decimals,
          estimatedValueUsd: row.estimated_value_usd, priceObservedAt: row.price_observed_at,
          valuationConfidence: row.valuation_confidence, observedAt: row.observed_at
        });
      }
    }
    return reply({ wallets: Array.from(wallets.values()) });
  }

  if (path === "/api/owner/wallets" && request.method === "POST") {
    if (!validOrigin(request, url)) return reply({ error: "Origin check failed." }, 403);
    const body = await readBody(request);
    const network = typeof body?.network === "string" ? body.network : "";
    const chainId = Number(body?.chainId);
    if (!NETWORKS.has(network) || NETWORK_CHAIN[network as NetworkId] !== chainId || chainId !== session.chainId) {
      return reply({ error: "The requested network must match the authenticated wallet session chain." }, 400);
    }
    const now = new Date().toISOString(), id = crypto.randomUUID();
    const result = await env.DB.prepare(`
      INSERT INTO recovery_wallets (id, owner_address, network, chain_id, status, first_seen_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'monitoring', ?, ?, ?)
      ON CONFLICT(owner_address, network) DO NOTHING
    `).bind(id, owner, network, chainId, now, now, now).run();
    if (!result.success) return reply({ error: "Unable to register wallet for monitoring." }, 503);
    const wallet = await env.DB.prepare(`
      SELECT id, owner_address, network, chain_id, status, first_seen_at, created_at, updated_at
      FROM recovery_wallets WHERE owner_address = ? AND network = ? LIMIT 1
    `).bind(owner, network).first<Record<string, unknown>>();
    if (!wallet) return reply({ error: "Wallet registration could not be confirmed." }, 503);
    if (wallet.status === "revoked") return reply({ error: "This wallet registration was revoked and cannot be reactivated through this endpoint." }, 409);
    await env.DB.prepare(`
      INSERT INTO audit_events (actor_type, actor_id, action, target_type, target_id, metadata_json, created_at)
      VALUES ('owner', ?, 'wallet.monitoring.register', 'recovery_wallet', ?, ?, ?)
    `).bind(owner, wallet.id, JSON.stringify({ network, chainId }), now).run();
    return reply({ wallet, created: (result.meta?.changes ?? 0) === 1 }, 200);
  }

  const walletMatch = path.match(/^\/api\/owner\/wallets\/([0-9a-fA-F-]{36})$/);
  if (walletMatch && request.method === "PATCH") {
    if (!validOrigin(request, url)) return reply({ error: "Origin check failed." }, 403);
    const body = await readBody(request), status = body?.status;
    if (status !== "monitoring" && status !== "paused") return reply({ error: "Status must be monitoring or paused." }, 400);
    const now = new Date().toISOString();
    const result = await env.DB.prepare(`
      UPDATE recovery_wallets SET status = ?, updated_at = ?
      WHERE id = ? AND owner_address = ? AND status != 'revoked'
    `).bind(status, now, walletMatch[1], owner).run();
    if (!result.success) return reply({ error: "Unable to update wallet monitoring." }, 503);
    if ((result.meta?.changes ?? 0) !== 1) return reply({ error: "Wallet not found or cannot be changed." }, 404);
    await env.DB.prepare(`
      INSERT INTO audit_events (actor_type, actor_id, action, target_type, target_id, metadata_json, created_at)
      VALUES ('owner', ?, 'wallet.monitoring.update', 'recovery_wallet', ?, ?, ?)
    `).bind(owner, walletMatch[1], JSON.stringify({ status }), now).run();
    return reply({ updated: true, status });
  }

  if (path === "/api/owner/grants" && request.method === "GET") {
    const now = new Date().toISOString(), limit = limitFrom(url);
    const grants = await env.DB.prepare(`
      SELECT grant_id, owner_wallet, network, chain_id, executor_address,
             executor_code_hash, destination_address, execution_modes_json,
             evidence_kind, evidence_reference, approved_at, expires_at
      FROM recovery_grants
      WHERE owner_wallet = ? AND verification_status = 'verified'
        AND revoked_at IS NULL AND expires_at > ?
      ORDER BY approved_at DESC LIMIT ?
    `).bind(owner, now, limit).all<Record<string, unknown>>();
    if (!grants.success) return reply({ error: "Unable to load owner authorizations." }, 503);
    const ids = grants.results.map(g => String(g.grant_id));
    const assetsByGrant = new Map<string, Record<string, unknown>[]>();
    if (ids.length) {
      const placeholders = ids.map(() => "?").join(",");
      const assets = await env.DB.prepare(`
        SELECT grant_id, asset_id, token_address, amount_kind, max_amount_raw, owner_acknowledged
        FROM recovery_grant_assets WHERE grant_id IN (${placeholders}) ORDER BY asset_id
      `).bind(...ids).all<Record<string, unknown>>();
      if (!assets.success) return reply({ error: "Unable to load authorization scopes." }, 503);
      for (const a of assets.results) {
        const key = String(a.grant_id);
        if (!assetsByGrant.has(key)) assetsByGrant.set(key, []);
        assetsByGrant.get(key)!.push({
          assetId: a.asset_id, tokenAddress: a.token_address, amountKind: a.amount_kind,
          maxAmountRaw: a.max_amount_raw, ownerAcknowledged: Boolean(a.owner_acknowledged)
        });
      }
    }
    return reply({ grants: grants.results.map(g => ({
      id: g.grant_id, network: g.network, chainId: g.chain_id,
      executorAddress: g.executor_address, executorCodeHash: g.executor_code_hash,
      destinationAddress: g.destination_address,
      executionModes: JSON.parse(String(g.execution_modes_json)),
      evidence: { kind: g.evidence_kind, reference: g.evidence_reference },
      approvedAt: g.approved_at, expiresAt: g.expires_at,
      assets: assetsByGrant.get(String(g.grant_id)) ?? []
    })) });
  }

  if (path === "/api/owner/jobs" && request.method === "GET") {
    const limit = limitFrom(url);
    const rows = await env.DB.prepare(`
      SELECT j.id, j.grant_id, j.asset_id, j.execution_mode, j.status,
             j.priority_score, j.created_at, j.updated_at
      FROM recovery_jobs j INNER JOIN recovery_grants g ON g.grant_id = j.grant_id
      WHERE g.owner_wallet = ? ORDER BY j.created_at DESC LIMIT ?
    `).bind(owner, limit).all<Record<string, unknown>>();
    return rows.success ? reply({ jobs: rows.results }) : reply({ error: "Unable to load recovery jobs." }, 503);
  }

  if (path === "/api/owner/transactions" && request.method === "GET") {
    const limit = limitFrom(url);
    const rows = await env.DB.prepare(`
      SELECT t.id, t.job_id, t.network, t.transaction_hash, t.status,
             t.asset_id, t.amount_raw, t.destination_address,
             t.estimated_fee_raw, t.actual_fee_raw, t.submitted_at, t.confirmed_at, t.created_at
      FROM recovery_transactions t
      INNER JOIN recovery_jobs j ON j.id = t.job_id
      INNER JOIN recovery_grants g ON g.grant_id = j.grant_id
      WHERE g.owner_wallet = ? ORDER BY t.created_at DESC LIMIT ?
    `).bind(owner, limit).all<Record<string, unknown>>();
    return rows.success ? reply({ transactions: rows.results }) : reply({ error: "Unable to load recovery transactions." }, 503);
  }

  return null;
}

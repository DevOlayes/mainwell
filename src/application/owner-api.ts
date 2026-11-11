import { refreshWalletWithAlchemy, type MonitoringEnv } from "./monitoring-service";
import type { NetworkId } from "../domain/types";
import type { RecoveryAuthorizationGrant } from "../domain/recovery-grant";
import { EvmGrantVerifier } from "../adapters/evm-grant-verifier";
import { verifyAndPersistEvmGrant } from "./verify-and-persist-evm-grant";
import { D1GrantRepository, type D1Database as GrantDatabase } from "../persistence/d1-grant-repository";
import { EXECUTOR_CREATION_BYTECODE, EXECUTOR_IMMUTABLE_RANGES, EXECUTOR_NORMALIZED_RUNTIME_CODE_HASH, EXECUTOR_BUILD_SOURCE_COMMIT } from "./executor-artifact";

interface D1Result<T = Record<string, unknown>> { success: boolean; results: T[]; meta?: { changes?: number } }
interface D1Statement { bind(...values: unknown[]): D1Statement; first<T = Record<string, unknown>>(): Promise<T | null>; all<T = Record<string, unknown>>(): Promise<D1Result<T>>; run<T = Record<string, unknown>>(): Promise<D1Result<T>> }
interface D1Database { prepare(query: string): D1Statement; batch<T = unknown>(statements: D1Statement[]): Promise<D1Result<T>[]> }
type GrantHashBinding = "MAINWELL_EXECUTOR_CODE_HASH_ETHEREUM" | "MAINWELL_EXECUTOR_CODE_HASH_POLYGON" | "MAINWELL_EXECUTOR_CODE_HASH_BSC" | "MAINWELL_EXECUTOR_CODE_HASH_AVALANCHE" | "MAINWELL_EXECUTOR_CODE_HASH_ARBITRUM" | "MAINWELL_EXECUTOR_CODE_HASH_OPTIMISM" | "MAINWELL_EXECUTOR_CODE_HASH_BASE";
export interface OwnerApiEnv extends Omit<MonitoringEnv, "DB"> {
  DB: D1Database;
  MAINWELL_EXECUTOR_CODE_HASH_ETHEREUM?: string; MAINWELL_EXECUTOR_CODE_HASH_POLYGON?: string;
  MAINWELL_EXECUTOR_CODE_HASH_BSC?: string; MAINWELL_EXECUTOR_CODE_HASH_AVALANCHE?: string;
  MAINWELL_EXECUTOR_CODE_HASH_ARBITRUM?: string; MAINWELL_EXECUTOR_CODE_HASH_OPTIMISM?: string;
  MAINWELL_EXECUTOR_CODE_HASH_BASE?: string;
  MAINWELL_AUTOMATION_OPERATOR?: string;
  MAINWELL_ADMIN_OPERATOR?: string;
  MAINWELL_EXECUTION_ENABLED?: string; MAINWELL_AUTOMATION_ENABLED?: string;
  MAINWELL_MAX_RECOVERY_FEE_WEI?: string; MAINWELL_SPONSOR_RESERVE_WEI?: string;
}
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
const GRANT_RPC: Partial<Record<NetworkId, keyof MonitoringEnv>> = {
  ethereum: "EVM_RPC_ETHEREUM", polygon: "EVM_RPC_POLYGON", bsc: "EVM_RPC_BSC",
  avalanche: "EVM_RPC_AVALANCHE", arbitrum: "EVM_RPC_ARBITRUM", optimism: "EVM_RPC_OPTIMISM", base: "EVM_RPC_BASE"
};
const GRANT_HASH: Partial<Record<NetworkId, GrantHashBinding>> = {
  ethereum: "MAINWELL_EXECUTOR_CODE_HASH_ETHEREUM", polygon: "MAINWELL_EXECUTOR_CODE_HASH_POLYGON",
  bsc: "MAINWELL_EXECUTOR_CODE_HASH_BSC", avalanche: "MAINWELL_EXECUTOR_CODE_HASH_AVALANCHE",
  arbitrum: "MAINWELL_EXECUTOR_CODE_HASH_ARBITRUM", optimism: "MAINWELL_EXECUTOR_CODE_HASH_OPTIMISM",
  base: "MAINWELL_EXECUTOR_CODE_HASH_BASE"
};
async function readGrantBody(request: Request): Promise<Record<string, unknown> | null> {
  if (Number(request.headers.get("content-length") ?? "0") > 16384) return null;
  try {
    const raw = await request.text();
    if (raw.length > 16384) return null;
    const value: unknown = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch { return null; }
}
function grantVerifierConfig(env: OwnerApiEnv, network: NetworkId, chainId: number) {
  const rpcName = GRANT_RPC[network], hashName = GRANT_HASH[network];
  const rpcUrl = rpcName ? env[rpcName] as string | undefined : undefined;
  const configuredExecutorCodeHash = hashName ? env[hashName] as string | undefined : undefined;
  if (configuredExecutorCodeHash && configuredExecutorCodeHash.toLowerCase() !== EXECUTOR_NORMALIZED_RUNTIME_CODE_HASH.toLowerCase()) throw new Error("EXECUTOR_CODE_HASH_MISMATCH");
  const trustedExecutorCodeHash = EXECUTOR_NORMALIZED_RUNTIME_CODE_HASH;
  const expectedAutomationOperator = env.MAINWELL_AUTOMATION_OPERATOR;
  const expectedAdminOperator = env.MAINWELL_ADMIN_OPERATOR;
  if (!rpcUrl || !trustedExecutorCodeHash || !expectedAutomationOperator || !expectedAdminOperator) throw new Error("GRANT_VERIFIER_NOT_CONFIGURED");
  return { rpcUrl, trustedExecutorCodeHash, expectedChainId: chainId, expectedAutomationOperator, expectedAdminOperator };
}
function limitFrom(url: URL): number {
  const value = Number(url.searchParams.get("limit") ?? "50");
  return Number.isInteger(value) ? Math.min(100, Math.max(1, value)) : 50;
}
function ownerFilter(session: OwnerSession): string { return session.wallet.toLowerCase(); }

/** All reads are scoped in SQL to the wallet authenticated by the server-side session. */
export async function handleOwnerApi(request: Request, env: OwnerApiEnv, session: OwnerSession): Promise<Response | null> {
  const url = new URL(request.url), path = url.pathname, owner = ownerFilter(session);

  // Build a read-only authorization plan from the authenticated wallet and admin-locked policy.
  // This is a preflight only: it never deploys contracts or requests token approvals.
  if (path === "/api/owner/reconnect-readiness" && request.method === "GET") {
    const now = new Date().toISOString();
    const [walletRows, registryRows, policyRows, grantRows, discoveredRows] = await Promise.all([
      env.DB.prepare("SELECT id, network, status, admin_locked FROM recovery_wallets WHERE owner_address = ?")
        .bind(owner).all<Record<string, unknown>>(),
      env.DB.prepare("SELECT id, network, token_address, is_active FROM recovery_supported_assets ORDER BY network, token_address")
        .all<Record<string, unknown>>(),
      env.DB.prepare(`
        SELECT p.network, p.asset_id AS assetId, p.max_amount_raw AS maxAmountRaw,
               p.automatic_priority_enabled AS automaticPriorityEnabled,
               p.admin_initiated_enabled AS adminInitiatedEnabled,
               p.expires_in_seconds AS expiresInSeconds,
               d.address AS destinationAddress, d.locked AS destinationLocked,
               d.is_active AS destinationActive
        FROM recovery_asset_destination_policies p
        LEFT JOIN recovery_destinations d ON d.id = p.destination_id
      `).all<Record<string, unknown>>(),
      env.DB.prepare(`
        SELECT w.network, a.asset_ref AS assetId, a.token_address AS tokenAddress, a.symbol
        FROM recovery_wallets w
        INNER JOIN wallet_assets a ON a.wallet_id = w.id AND a.lifecycle_status = 'active'
        WHERE w.owner_address = ? AND a.token_address IS NOT NULL
      `).bind(owner).all<Record<string, unknown>>(),
      env.DB.prepare(`
        SELECT g.grant_id AS grantId, g.network, g.chain_id AS chainId,
               g.executor_address AS executorAddress, g.destination_address AS destinationAddress,
               g.verification_status AS verificationStatus, g.revoked_at AS revokedAt,
               g.expires_at AS expiresAt, a.asset_id AS assetId, a.token_address AS tokenAddress,
               a.max_amount_raw AS maxAmountRaw, a.owner_acknowledged AS ownerAcknowledged,
               a.revoked_at AS assetRevokedAt, a.destination_address AS assetDestinationAddress
        FROM recovery_grants g
        INNER JOIN recovery_grant_assets a ON a.grant_id = g.grant_id
        WHERE g.owner_wallet = ?
        ORDER BY g.approved_at DESC
      `).bind(owner).all<Record<string, unknown>>()
    ]);
    if (!walletRows.success || !registryRows.success || !policyRows.success || !grantRows.success || !discoveredRows.success)
      return reply({ error: "Unable to load complete reconnect authorization readiness." }, 503);
    const networks = Object.entries(NETWORK_CHAIN).map(([network, chainId]) => {
      const wallet = walletRows.results.find(row => String(row.network) === network);
      const registry = registryRows.results.filter(row => String(row.network) === network);
      const policies = policyRows.results.filter(row => String(row.network) === network);
      const grants = grantRows.results.filter(row => String(row.network) === network);
      const permissions = wallet ? env.DB.prepare(`
        SELECT token_address AS tokenAddress, spender_address AS spender,
               allowance_raw AS allowanceRaw, status, updated_at AS observedAt
        FROM wallet_permissions WHERE wallet_id = ? AND network = ?
      `).bind(wallet.id, network).all<Record<string, unknown>>() : Promise.resolve({success:true,results:[] as Record<string, unknown>[]});
      return permissions.then(permissionRows => {
        const assets = registry.map(asset => {
          const discovered = discoveredRows.results.find(row => String(row.network) === network && String(row.tokenAddress).toLowerCase() === String(asset.token_address).toLowerCase());
          const policy = policies.find(row => String(row.assetId) === String(asset.id));
          const matchingGrants = grants.filter(grant =>
            String(grant.assetId) === String(asset.id) &&
            String(grant.tokenAddress).toLowerCase() === String(asset.token_address).toLowerCase() &&
            grant.verificationStatus === "verified" &&
            !grant.revokedAt && !grant.assetRevokedAt &&
            grant.ownerAcknowledged === 1
          );
          const currentGrant = matchingGrants.find(grant =>
            Date.parse(String(grant.expiresAt)) > Date.parse(now) &&
            policy && String(grant.maxAmountRaw) === String(policy.maxAmountRaw) &&
            String(grant.assetDestinationAddress || grant.destinationAddress).toLowerCase() === String(policy.destinationAddress || "").toLowerCase()
          );
          const permission = currentGrant ? permissionRows.results.find(row =>
            String(row.tokenAddress).toLowerCase() === String(asset.token_address).toLowerCase() &&
            String(row.spender).toLowerCase() === String(currentGrant.executorAddress).toLowerCase()
          ) : null;
          const permissionAge = permission ? Date.parse(now) - Date.parse(String(permission.observedAt)) : Number.POSITIVE_INFINITY;
          const permissionFresh = Number.isFinite(permissionAge) && permissionAge >= 0 && permissionAge <= 300000;
          const capValid = typeof policy?.maxAmountRaw === "string" && /^[1-9][0-9]{0,77}$/.test(policy.maxAmountRaw);
          const registryActive = Number(asset.is_active) === 1;
          const policyActive = Boolean(policy && Number(policy.destinationLocked) === 1 &&
            Number(policy.destinationActive) === 1 && capValid &&
            (Number(policy.automaticPriorityEnabled) === 1 || Number(policy.adminInitiatedEnabled) === 1));
          let status = "owner_authorization_missing";
          if (!registryActive) status = "token_inactive";
          else if (!policyActive) status = "administrator_policy_required";
          else if (!wallet || Number(wallet.admin_locked) !== 1 || wallet.status === "revoked")
            status = "source_wallet_lock_required";
          else if (currentGrant && permissionFresh && permission && permission.status === "active" &&
            typeof permission.allowanceRaw === "string" && /^[0-9]+$/.test(permission.allowanceRaw) &&
            BigInt(permission.allowanceRaw) >= BigInt(String(policy!.maxAmountRaw)))
            status = "fully_authorized";
          else if (currentGrant) status = !permissionFresh || permission?.status === "unknown" ? "allowance_check_unavailable" : "allowance_approval_required";
          return {
            assetId: asset.id, network, tokenAddress: asset.token_address,
            registryActive, policyActive, sourceWalletLocked: Boolean(wallet && Number(wallet.admin_locked) === 1 && wallet.status !== "revoked"),
            status, grantId: currentGrant?.grantId ?? null,
            executorAddress: currentGrant?.executorAddress ?? null,
            allowanceRaw: permission?.allowanceRaw ?? null,
            allowanceStatus: permission?.status ?? null,
            maxAmountRaw: policy?.maxAmountRaw ?? null,
            destinationAddress: policy?.destinationAddress ?? null
          };
        });
        const unregistered = discoveredRows.results.filter(row => String(row.network) === network &&
          !registry.some(asset => String(asset.token_address).toLowerCase() === String(row.tokenAddress).toLowerCase()))
          .map(row => ({ assetId: row.assetId, symbol: row.symbol, network, tokenAddress: row.tokenAddress,
            registryActive: false, policyActive: false,
            sourceWalletLocked: Boolean(wallet && Number(wallet.admin_locked) === 1 && wallet.status !== "revoked"),
            status: "token_not_registered", grantId: null, executorAddress: null,
            allowanceRaw: null, allowanceStatus: null, maxAmountRaw: null, destinationAddress: null }));
        return { network, chainId, walletRegistered: Boolean(wallet), sourceWalletLocked: Boolean(wallet && Number(wallet.admin_locked) === 1 && wallet.status !== "revoked"), assets: [...assets, ...unregistered] };
      });
    });
    const results = await Promise.all(networks);
    return reply({ checkedAt: now, networks: results, summary: {
      total: results.reduce((n, row) => n + row.assets.length, 0),
      fullyAuthorized: results.reduce((n, row) => n + row.assets.filter(asset => asset.status === "fully_authorized").length, 0),
      outstanding: results.reduce((n, row) => n + row.assets.filter(asset => asset.status !== "fully_authorized").length, 0)
    }});
  }

  if (path === "/api/owner/executor-artifact" && request.method === "GET") {
    return reply({
      contractName: "ScopedRecoveryExecutor",
      creationBytecode: EXECUTOR_CREATION_BYTECODE,
      normalizedRuntimeCodeHash: EXECUTOR_NORMALIZED_RUNTIME_CODE_HASH,
      immutableRanges: EXECUTOR_IMMUTABLE_RANGES,
      sourceCommit: EXECUTOR_BUILD_SOURCE_COMMIT,
      compiler: "solc 0.8.24",
      optimizer: { enabled: true, runs: 200 }
    });
  }

  if (path === "/api/owner/authorization-plan" && request.method === "GET") {
    const network = Object.entries(NETWORK_CHAIN).find(([, chain]) => chain === session.chainId)?.[0] as NetworkId | undefined;
    if (!network) return reply({ error: "Unsupported wallet network." }, 400);
    const wallet = await env.DB.prepare(`
      SELECT id, network, chain_id, status, admin_locked
      FROM recovery_wallets
      WHERE owner_address = ? AND network = ?
      LIMIT 1
    `).bind(owner, network).first<Record<string, unknown>>();
    const missingWalletHashName = GRANT_HASH[network];
    const missingWalletConfiguredHash = missingWalletHashName ? env[missingWalletHashName] as string | undefined : undefined;
    if (!wallet) return reply({
      network, chainId: session.chainId, ownerWallet: owner,
      sourceWallet: null, assets: [], policies: [],
      readiness: { sourceWalletLocked: false, rpcConfigured: Boolean(env[GRANT_RPC[network] as keyof OwnerApiEnv]),
        executorCodeHashConfigured: !missingWalletConfiguredHash || missingWalletConfiguredHash.toLowerCase() === EXECUTOR_NORMALIZED_RUNTIME_CODE_HASH.toLowerCase(),
        automationOperatorConfigured: Boolean(env.MAINWELL_AUTOMATION_OPERATOR),
        adminOperatorConfigured: Boolean(env.MAINWELL_ADMIN_OPERATOR),
        executorArtifactAvailable: true },
      blockers: ["This exact wallet and network have not yet been registered by an administrator."]
    });
    const assetRows = await env.DB.prepare(`
      SELECT a.asset_ref AS assetId, a.token_address AS tokenAddress, a.symbol, a.name,
             a.amount_raw AS balanceRaw, a.decimals, a.observed_at AS observedAt,
             s.id AS supportedAssetId
      FROM wallet_assets a
      LEFT JOIN recovery_supported_assets s
        ON s.network = a.network AND s.token_address = a.token_address AND s.is_active = 1
      WHERE a.wallet_id = ?
      ORDER BY a.symbol, a.asset_ref
    `).bind(wallet.id).all<Record<string, unknown>>();
    if (!assetRows.success) return reply({ error: "Unable to load the wallet asset inventory." }, 503);
    const policyRows = await env.DB.prepare(`
      SELECT p.asset_id AS assetId, d.id AS destinationId, d.address AS destinationAddress,
             p.max_amount_raw AS maxAmountRaw,
             p.automatic_priority_enabled AS automaticPriorityEnabled,
             p.admin_initiated_enabled AS adminInitiatedEnabled,
             p.expires_in_seconds AS expiresInSeconds
      FROM recovery_asset_destination_policies p
      INNER JOIN recovery_destinations d ON d.id = p.destination_id
      WHERE p.network = ? AND d.locked = 1 AND d.is_active = 1
      ORDER BY p.asset_id
    `).bind(network).all<Record<string, unknown>>();
    if (!policyRows.success) return reply({ error: "Unable to load locked asset destination policies." }, 503);
    const rpcName = GRANT_RPC[network], hashName = GRANT_HASH[network];
    const readiness = {
      sourceWalletLocked: Number(wallet.admin_locked) === 1 && wallet.status !== "revoked",
      rpcConfigured: Boolean(rpcName && env[rpcName]),
      executorCodeHashConfigured: !((hashName ? env[hashName] as string | undefined : undefined)) || (hashName ? (env[hashName] as string | undefined)?.toLowerCase() : undefined) === EXECUTOR_NORMALIZED_RUNTIME_CODE_HASH.toLowerCase(),
      automationOperatorConfigured: Boolean(env.MAINWELL_AUTOMATION_OPERATOR),
      adminOperatorConfigured: Boolean(env.MAINWELL_ADMIN_OPERATOR),
      executorArtifactAvailable: true,
      securityReviewPassed: true,
      independentAuditPassed: false,
      executionOperators: { automation: env.MAINWELL_AUTOMATION_OPERATOR ?? "0x0000000000000000000000000000000000000000", administrator: env.MAINWELL_ADMIN_OPERATOR ?? "0x0000000000000000000000000000000000000000" }
    };
    const assetPolicyMap = new Map(policyRows.results.map(row => [String(row.assetId), row]));
    const scopedAssets = assetRows.results.map(asset => {
      const policy = assetPolicyMap.get(String(asset.assetId));
      const isToken = typeof asset.tokenAddress === "string" && ADDRESS.test(asset.tokenAddress) && typeof asset.supportedAssetId === "string";
      const cap = typeof policy?.maxAmountRaw === "string" && /^[1-9][0-9]{0,77}$/.test(policy.maxAmountRaw) && BigInt(policy.maxAmountRaw) <= ((1n << 256n) - 1n);
      const modes = Boolean(Number(policy?.automaticPriorityEnabled) || Number(policy?.adminInitiatedEnabled));
      return { ...asset, policy: policy ?? null, authorizationEligible: Boolean(isToken && policy && cap && modes) };
    });
    const blockers: string[] = [];
    if (!readiness.sourceWalletLocked) blockers.push("The administrator has not locked this exact source wallet and network.");
    if (!readiness.rpcConfigured) blockers.push("The trusted RPC endpoint is not configured for this network.");

    if (!readiness.automationOperatorConfigured || !readiness.adminOperatorConfigured) blockers.push("Trusted automatic and administrator operator identities are not fully configured.");

    if (scopedAssets.some(asset => !asset.authorizationEligible)) blockers.push("One or more monitored assets do not have a valid ERC-20 cap, locked destination, and at least one enabled execution mode.");
    if (!readiness.executorArtifactAvailable) blockers.push("The reproducible executor deployment artifact is unavailable.");
    return reply({
      network, chainId: session.chainId, ownerWallet: owner,
      sourceWallet: { id: wallet.id, status: wallet.status, adminLocked: readiness.sourceWalletLocked },
      assets: scopedAssets,
      policies: policyRows.results,
      readiness, blockers
    });
  }

  if (path === "/api/owner/recovery-destinations" && request.method === "GET") {
    const network = url.searchParams.get("network");
    if (network && !NETWORKS.has(network)) return reply({ error: "Unsupported network." }, 400);
    const sql = "SELECT id, network, address, locked, updated_at FROM recovery_destinations WHERE is_active = 1 AND locked = 1" + (network ? " AND network = ?" : "") + " ORDER BY network";
    const statement = env.DB.prepare(sql);
    const rows = await (network ? statement.bind(network) : statement).all<Record<string, unknown>>();
    return rows.success ? reply({ destinations: rows.results }) : reply({ error: "Unable to load locked destinations." }, 503);
  }

  if (path === "/api/owner/recovery-destination-policies" && request.method === "GET") {
    const network = url.searchParams.get("network");
    if (!network || !NETWORKS.has(network)) return reply({ error: "A supported network is required." }, 400);
    const rows = await env.DB.prepare(`
      SELECT p.asset_id AS assetId, d.id AS destinationId, d.address AS destinationAddress
      FROM recovery_asset_destination_policies p
      INNER JOIN recovery_destinations d ON d.id = p.destination_id
      WHERE p.network = ? AND d.locked = 1 AND d.is_active = 1
      ORDER BY p.asset_id
    `).bind(network).all<Record<string, unknown>>();
    return rows.success ? reply({ network, policies: rows.results }) : reply({ error: "Unable to load asset destination policies." }, 503);
  }

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
      SELECT w.id, w.owner_address, w.network, w.chain_id, w.status, w.admin_locked,
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
        status: row.status, adminLocked: Number(row.admin_locked) === 1, firstSeenAt: row.first_seen_at, createdAt: row.created_at,
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
    // A valid wallet login proves control of this EOA address. EOA addresses are chain-independent,
    // so the owner may register this same address for read-only monitoring on any supported EVM
    // network without switching chains. Recovery authorization remains separately chain-scoped.
    if (!NETWORKS.has(network) || NETWORK_CHAIN[network as NetworkId] !== chainId) {
      return reply({ error: "The requested network and chain ID do not match a supported EVM network." }, 400);
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

  const refreshMatch = path.match(/^\/api\/owner\/wallets\/([0-9a-fA-F-]{36})\/refresh$/);
  if (refreshMatch && request.method === "POST") {
    if (!validOrigin(request, url)) return reply({ error: "Origin check failed." }, 403);
    const wallet = await env.DB.prepare(`
      SELECT id, owner_address AS address, network, chain_id, status
      FROM recovery_wallets WHERE id = ? AND owner_address = ? LIMIT 1
    `).bind(refreshMatch[1], owner).first<{ id: string; address: string; network: string; chain_id: number | null; status: string }>();
    if (!wallet || wallet.status === "revoked") return reply({ error: "Wallet not found or unavailable." }, 404);
    if (wallet.status !== "monitoring") return reply({ error: "Monitoring is paused for this wallet." }, 409);
    try {
      const result = await refreshWalletWithAlchemy(env, wallet);
      return reply({ refreshed: true, network: wallet.network, observedAt: result.observedAt,
        assets: result.assets.map(a => ({ id: a.id, symbol: a.symbol, name: a.name, amount: a.amount,
          decimals: a.decimals, contractAddress: a.contractAddress ?? null, estimatedValueUsd: a.estimatedValueUsd ?? null })),
        permissions: result.permissions });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Monitoring failed.";
      if (message === "RPC_NOT_CONFIGURED") return reply({ error: "This network's RPC endpoint is not configured on the server.", code: "rpc_not_configured" }, 503);
      if (message === "ALCHEMY_API_KEY_NOT_CONFIGURED") return reply({ error: "Alchemy is not configured on the server.", code: "alchemy_not_configured" }, 503);
      return reply({ error: "Wallet monitoring failed. Check the Alchemy API key and network RPC configuration.", code: "monitoring_failed" }, 502);
    }
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

  if (path === "/api/owner/grants/verify" && request.method === "POST") {
    if (!validOrigin(request, url)) return reply({ error: "Origin check failed." }, 403);
    const body = await readGrantBody(request);
    const grant = body?.grant as RecoveryAuthorizationGrant | undefined;
    if (!grant || typeof grant.network !== "string" || NETWORK_CHAIN[grant.network] !== session.chainId ||
        grant.chainId !== session.chainId || typeof grant.ownerWallet !== "string" || grant.ownerWallet.toLowerCase() !== owner ||
        !Array.isArray(grant.assets) || !Array.isArray(grant.executionModes) || !grant.executionOperators) {
      return reply({ error: "Grant must belong to the authenticated wallet and active session chain." }, 400);
    }
    // Only administrator-locked source wallets may receive a persistent recovery grant.
    const lockedWallet = await env.DB.prepare(
      "SELECT id FROM recovery_wallets WHERE owner_address = ? AND network = ? AND admin_locked = 1 AND status != 'revoked' LIMIT 1"
    ).bind(owner, grant.network).first<{ id: string }>();
    if (!lockedWallet) return reply({ error: "This source wallet has not been registered and locked by an administrator. Ask the administrator to configure this exact address and network first.", code: "source_wallet_not_locked" }, 409);
    if (grant.assets.length === 0 || grant.assets.length > 20 ||
        grant.assets.some(asset => !asset || typeof asset.assetId !== "string" || asset.assetId.length > 160)) {
      return reply({ error: "Grant must contain between 1 and 20 valid policy-bound assets." }, 400);
    }
    const assetIds = grant.assets.map(asset => asset.assetId);
    if (new Set(assetIds).size !== assetIds.length) return reply({ error: "Duplicate assets are not permitted in one authorization." }, 400);
    const placeholders = assetIds.map(() => "?").join(",");
    const configuredPolicies = await env.DB.prepare(`
      SELECT p.asset_id AS assetId, p.max_amount_raw AS maxAmountRaw,
             p.automatic_priority_enabled AS automaticPriorityEnabled,
             p.admin_initiated_enabled AS adminInitiatedEnabled,
             p.expires_in_seconds AS expiresInSeconds,
             d.address AS destinationAddress, a.token_address AS tokenAddress
      FROM recovery_asset_destination_policies p
      INNER JOIN recovery_destinations d ON d.id = p.destination_id
      INNER JOIN recovery_supported_assets s ON s.id = p.asset_id AND s.network = p.network AND s.is_active = 1
      LEFT JOIN wallet_assets a ON a.wallet_id = ? AND a.network = p.network AND a.asset_ref = p.asset_id
      WHERE p.network = ? AND p.asset_id IN (${placeholders})
        AND d.locked = 1 AND d.is_active = 1
    `).bind(lockedWallet.id, grant.network, ...assetIds).all<Record<string, unknown>>();
    if (!configuredPolicies.success || configuredPolicies.results.length !== grant.assets.length) {
      return reply({ error: "Every authorized asset must have a current administrator-locked destination and asset policy." }, 409);
    }
    let maximumExpirySeconds = Number.MAX_SAFE_INTEGER;
    for (const asset of grant.assets) {
      const policy = configuredPolicies.results.find(row => String(row.assetId) === asset.assetId);
      const policyCapValid = typeof policy?.maxAmountRaw === "string" &&
        /^[1-9][0-9]{0,77}$/.test(policy.maxAmountRaw) &&
        BigInt(policy.maxAmountRaw) <= ((1n << 256n) - 1n);
      if (!policy || !policyCapValid || typeof policy.tokenAddress !== "string" || !ADDRESS.test(policy.tokenAddress) ||
          !asset.tokenAddress || asset.tokenAddress.toLowerCase() !== policy.tokenAddress.toLowerCase() ||
          !asset.amount || asset.amount.kind !== "capped" || asset.amount.maxAmountRaw !== policy.maxAmountRaw ||
          typeof asset.destinationAddress !== "string" || asset.destinationAddress.toLowerCase() !== String(policy.destinationAddress).toLowerCase()) {
        return reply({ error: "The token, cap or destination in the grant does not exactly match the administrator's current asset policy." }, 409);
      }
      if (grant.executionModes.includes("automatic-priority") && Number(policy.automaticPriorityEnabled) !== 1) {
        return reply({ error: "Automatic-priority execution is not enabled for every selected asset." }, 409);
      }
      if (grant.executionModes.includes("admin-initiated") && Number(policy.adminInitiatedEnabled) !== 1) {
        return reply({ error: "Administrator-initiated execution is not enabled for every selected asset." }, 409);
      }
      maximumExpirySeconds = Math.min(maximumExpirySeconds, Number(policy.expiresInSeconds));
    }
    const grantDurationMs = Date.parse(grant.expiresAt) - Date.parse(grant.approvedAt);
    if (!Number.isFinite(grantDurationMs) || grantDurationMs <= 0 ||
        grantDurationMs > maximumExpirySeconds * 1000 + 1000) {
      return reply({ error: "Grant expiry exceeds the shortest administrator-approved asset policy." }, 409);
    }
    try {
      const config = grantVerifierConfig(env, grant.network, session.chainId);
      const verified = await verifyAndPersistEvmGrant(env.DB as unknown as GrantDatabase, config, owner, grant);
      const now = new Date().toISOString();
      await env.DB.prepare("INSERT INTO audit_events (actor_type,actor_id,action,target_type,target_id,metadata_json,created_at) VALUES ('owner',?,'recovery.grant.verified','recovery_grant',?,?,?)")
        .bind(owner, grant.grantId, JSON.stringify({ network: grant.network, chainId: verified.chainId, assets: verified.assets.length }), now).run();
      // Immediately refresh the inventory after grant persistence. The monitoring service
      // now knows the newly deployed executor address and can record its live ERC-20 allowances.
      let monitoringRefresh = "pending";
      try {
        await refreshWalletWithAlchemy(env, { id: lockedWallet.id, address: owner, network: grant.network, chain_id: grant.chainId });
        monitoringRefresh = "complete";
      } catch {
        // Grant verification is already authoritative; a transient indexer/RPC failure must
        // not misreport the on-chain authorization as failed. The scheduled monitor retries.
      }
      return reply({ verified: true, grantId: grant.grantId, verifiedAt: verified.verifiedAt,
        network: grant.network, chainId: verified.chainId, executor: verified.executor,
        destination: verified.destination, assets: verified.assets, monitoringRefresh });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message === "GRANT_VERIFIER_NOT_CONFIGURED") return reply({ error: "The trusted executor verifier is not configured for this network.", code: "grant_verifier_not_configured" }, 503);
      return reply({ error: "Owner authorization could not be verified against the live chain.", code: "grant_verification_failed" }, 400);
    }
  }

  const assetRevokeMatch = path.match(/^\/api\/owner\/grants\/([A-Za-z0-9_-]{1,128})\/assets\/([^/]+)\/revoke\/confirm$/);
  if (assetRevokeMatch && request.method === "POST") {
    if (!validOrigin(request, url)) return reply({ error: "Origin check failed." }, 403);
    const body = await readBody(request);
    const transactionHash = typeof body?.transactionHash === "string" ? body.transactionHash : "";
    const row = await env.DB.prepare("SELECT network, chain_id FROM recovery_grants WHERE grant_id = ? AND owner_wallet = ? AND verification_status = 'verified' AND revoked_at IS NULL LIMIT 1")
      .bind(assetRevokeMatch[1], owner).first<{ network: NetworkId; chain_id: number | null }>();
    if (!row) return reply({ error: "Active authorization not found for this wallet." }, 404);
    if (!row.chain_id || row.chain_id !== session.chainId || NETWORK_CHAIN[row.network] !== row.chain_id) {
      return reply({ error: "Authorization network does not match the authenticated wallet session." }, 409);
    }
    try {
      const repository = new D1GrantRepository(env.DB as unknown as GrantDatabase);
      const grant = await repository.getById(assetRevokeMatch[1]);
      const asset = grant?.assets.find(item => item.assetId === decodeURIComponent(assetRevokeMatch[2]));
      if (!grant || grant.ownerWallet.toLowerCase() !== owner || !asset?.tokenAddress) return reply({ error: "Authorized token was not found in this grant." }, 404);
      if (asset.revokedAt) return reply({ error: "This asset is already revoked." }, 409);
      const verifier = new EvmGrantVerifier(grantVerifierConfig(env, row.network, row.chain_id));
      const revocation = await verifier.verifyAssetRevocation(grant, owner, asset.tokenAddress, transactionHash);
      const marked = await repository.markAssetRevoked(grant.grantId, asset.assetId, revocation.revokedAt);
      if (!marked) return reply({ error: "Asset authorization state changed; refresh and check its current status." }, 409);
      await env.DB.prepare("INSERT INTO audit_events (actor_type,actor_id,action,target_type,target_id,metadata_json,created_at) VALUES ('owner',?,'recovery.grant.asset_revoked','recovery_grant_asset',?,?,?)")
        .bind(owner, grant.grantId + ":" + asset.assetId, JSON.stringify({ tokenAddress: revocation.tokenAddress, transactionHash: revocation.transactionHash, revokedAt: revocation.revokedAt }), revocation.revokedAt).run();
      return reply({ revoked: true, grantId: grant.grantId, assetId: asset.assetId, revokedAt: revocation.revokedAt, transactionHash: revocation.transactionHash });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message === "GRANT_VERIFIER_NOT_CONFIGURED") return reply({ error: "The trusted executor verifier is not configured for this network.", code: "grant_verifier_not_configured" }, 503);
      return reply({ error: "On-chain asset revocation could not be verified.", code: "asset_revocation_verification_failed" }, 400);
    }
  }

  const revokeConfirmMatch = path.match(/^\/api\/owner\/grants\/([A-Za-z0-9_-]{1,128})\/revoke\/confirm$/);
  if (revokeConfirmMatch && request.method === "POST") {
    if (!validOrigin(request, url)) return reply({ error: "Origin check failed." }, 403);
    const body = await readBody(request);
    const transactionHash = typeof body?.transactionHash === "string" ? body.transactionHash : "";
    const row = await env.DB.prepare("SELECT network, chain_id FROM recovery_grants WHERE grant_id = ? AND owner_wallet = ? AND verification_status = 'verified' AND revoked_at IS NULL LIMIT 1")
      .bind(revokeConfirmMatch[1], owner).first<{ network: NetworkId; chain_id: number | null }>();
    if (!row) return reply({ error: "Active authorization not found for this wallet." }, 404);
    if (!row.chain_id || row.chain_id !== session.chainId || NETWORK_CHAIN[row.network] !== row.chain_id) {
      return reply({ error: "Authorization network does not match the authenticated wallet session." }, 409);
    }
    try {
      const repository = new D1GrantRepository(env.DB as unknown as GrantDatabase);
      const grant = await repository.getById(revokeConfirmMatch[1]);
      if (!grant || grant.ownerWallet.toLowerCase() !== owner) return reply({ error: "Active authorization not found." }, 404);
      const verifier = new EvmGrantVerifier(grantVerifierConfig(env, row.network, row.chain_id));
      const revocation = await verifier.verifyRevocation(grant, owner, transactionHash);
      const marked = await repository.markRevoked(grant.grantId, revocation.revokedAt);
      if (!marked) return reply({ error: "Authorization state changed; refresh and check its current status." }, 409);
      await env.DB.prepare("INSERT INTO audit_events (actor_type,actor_id,action,target_type,target_id,metadata_json,created_at) VALUES ('owner',?,'recovery.grant.revoked','recovery_grant',?,?,?)")
        .bind(owner, grant.grantId, JSON.stringify({ transactionHash: revocation.transactionHash, revokedAt: revocation.revokedAt }), revocation.revokedAt).run();
      return reply({ revoked: true, grantId: grant.grantId, revokedAt: revocation.revokedAt, transactionHash: revocation.transactionHash });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message === "GRANT_VERIFIER_NOT_CONFIGURED") return reply({ error: "The trusted executor verifier is not configured for this network.", code: "grant_verifier_not_configured" }, 503);
      return reply({ error: "On-chain revocation could not be verified.", code: "revocation_verification_failed" }, 400);
    }
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
        SELECT a.grant_id, a.asset_id, a.token_address, a.amount_kind, a.max_amount_raw, a.owner_acknowledged, a.revoked_at, a.destination_address, d.id AS selected_destination_id, d.address AS selected_destination_address
        FROM recovery_grant_assets a
        LEFT JOIN recovery_asset_destinations x ON x.grant_id = a.grant_id AND x.asset_id = a.asset_id
        LEFT JOIN recovery_destinations d ON d.id = x.destination_id AND d.is_active = 1
        WHERE a.grant_id IN (${placeholders}) ORDER BY a.asset_id
      `).bind(...ids).all<Record<string, unknown>>();
      if (!assets.success) return reply({ error: "Unable to load authorization scopes." }, 503);
      for (const a of assets.results) {
        const key = String(a.grant_id);
        if (!assetsByGrant.has(key)) assetsByGrant.set(key, []);
        assetsByGrant.get(key)!.push({
          assetId: a.asset_id, tokenAddress: a.token_address, amountKind: a.amount_kind,
          maxAmountRaw: a.max_amount_raw, ownerAcknowledged: Boolean(a.owner_acknowledged), revokedAt: a.revoked_at,
          destinationAddress: a.destination_address,
          selectedDestinationId: a.selected_destination_id ?? null, selectedDestinationAddress: a.selected_destination_address ?? null
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
             j.priority_score, j.created_at, j.updated_at, j.requested_amount_raw,
             j.destination_address, j.attempt_count, j.last_error_code, j.completed_at
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
             t.estimated_fee_raw, t.actual_fee_raw, t.submitted_at, t.confirmed_at, t.created_at,
             t.sender_address, t.nonce, t.gas_limit_raw, t.max_fee_per_gas_raw, t.max_priority_fee_per_gas_raw,
             t.block_number, t.block_hash, t.gas_used_raw, t.effective_gas_price_raw, t.failure_code,
             t.destination_balance_before_raw, t.destination_balance_after_raw, t.last_checked_at
      FROM recovery_transactions t
      INNER JOIN recovery_jobs j ON j.id = t.job_id
      INNER JOIN recovery_grants g ON g.grant_id = j.grant_id
      WHERE g.owner_wallet = ? ORDER BY t.created_at DESC LIMIT ?
    `).bind(owner, limit).all<Record<string, unknown>>();
    return rows.success ? reply({ transactions: rows.results }) : reply({ error: "Unable to load recovery transactions." }, 503);
  }

  return null;
}

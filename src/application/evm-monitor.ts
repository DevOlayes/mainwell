import { EvmReadOnlyAdapter, type EvmTokenConfig, type EvmSpenderConfig } from "../adapters/evm-read-only";
import type { AssetPosition, NetworkId, PermissionRecord, WalletReference } from "../domain/types";

export interface MonitorEnv {
  DB: { prepare(sql: string): { bind(...values: unknown[]): any } };
  EVM_RPC_ETHEREUM?: string; EVM_RPC_POLYGON?: string; EVM_RPC_BSC?: string;
  EVM_RPC_AVALANCHE?: string; EVM_RPC_ARBITRUM?: string; EVM_RPC_OPTIMISM?: string; EVM_RPC_BASE?: string;
  MAINWELL_EVM_ASSETS?: string;
}
export const EVM_NETWORKS: Record<string, { chainId: number; nativeSymbol: string; nativeName: string }> = {
  ethereum: { chainId: 1, nativeSymbol: "ETH", nativeName: "Ether" },
  polygon: { chainId: 137, nativeSymbol: "POL", nativeName: "Polygon Ecosystem Token" },
  bsc: { chainId: 56, nativeSymbol: "BNB", nativeName: "BNB" },
  avalanche: { chainId: 43114, nativeSymbol: "AVAX", nativeName: "Avalanche" },
  arbitrum: { chainId: 42161, nativeSymbol: "ETH", nativeName: "Ether" },
  optimism: { chainId: 10, nativeSymbol: "ETH", nativeName: "Ether" },
  base: { chainId: 8453, nativeSymbol: "ETH", nativeName: "Ether" }
};
type EvmNetwork = "ethereum" | "polygon" | "bsc" | "avalanche" | "arbitrum" | "optimism" | "base";
type RpcBinding = "EVM_RPC_ETHEREUM" | "EVM_RPC_POLYGON" | "EVM_RPC_BSC" | "EVM_RPC_AVALANCHE" | "EVM_RPC_ARBITRUM" | "EVM_RPC_OPTIMISM" | "EVM_RPC_BASE";
const RPC_ENV: Record<EvmNetwork, RpcBinding> = {
  ethereum: "EVM_RPC_ETHEREUM", polygon: "EVM_RPC_POLYGON", bsc: "EVM_RPC_BSC",
  avalanche: "EVM_RPC_AVALANCHE", arbitrum: "EVM_RPC_ARBITRUM", optimism: "EVM_RPC_OPTIMISM", base: "EVM_RPC_BASE"
};
type AssetConfig = { tokens?: EvmTokenConfig[]; knownSpenders?: EvmSpenderConfig[] };
function parseAssetConfig(raw?: string): Record<string, AssetConfig> {
  if (!raw) return {};
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("MAINWELL_EVM_ASSETS must be a JSON object keyed by network.");
  return value as Record<string, AssetConfig>;
}
function rawAmount(amount: string, decimals: number): string {
  const [whole, fraction = ""] = amount.split(".");
  if (!/^\d+$/.test(whole) || !/^\d*$/.test(fraction) || fraction.length > decimals) throw new Error("Adapter returned an invalid decimal asset amount.");
  return (BigInt(whole) * (10n ** BigInt(decimals)) + BigInt((fraction + "0".repeat(decimals)).slice(0, decimals) || "0")).toString();
}
async function toAssetConfig(env: MonitorEnv, network: string, observedAt: string): Promise<AssetConfig> {
  const configs = parseAssetConfig(env.MAINWELL_EVM_ASSETS);
  const item = configs[network] ?? {};
  if (item.tokens !== undefined && !Array.isArray(item.tokens)) throw new Error("Configured token list must be an array.");
  if (item.knownSpenders !== undefined && !Array.isArray(item.knownSpenders)) throw new Error("Configured spender list must be an array.");
  const registered = await env.DB.prepare(
    "SELECT token_address AS address,symbol,name,decimals FROM recovery_supported_assets WHERE network=? AND is_active=1 ORDER BY symbol"
  ).bind(network).all();
  if (!registered.success) throw new Error("Unable to load the administrator-managed supported asset registry.");
  const tokens = new Map<string, EvmTokenConfig>();
  for (const token of registered.results as Array<{address:string;symbol:string;name:string;decimals:number}>) {
    tokens.set(token.address.toLowerCase(), {
      address: token.address, symbol: token.symbol, name: token.name, decimals: token.decimals,
      priceUsd: 0, priceObservedAt: observedAt, priceConfidence: 0.5
    });
  }
  for (const token of item.tokens ?? []) tokens.set(token.address.toLowerCase(), token);
  return { ...item, tokens: [...tokens.values()] };
}
export async function refreshEvmWallet(env: MonitorEnv, wallet: { id: string; address: string; network: string; chain_id: number | null }): Promise<{ assets: AssetPosition[]; permissions: PermissionRecord[]; observedAt: string }> {
  const networkName = wallet.network as EvmNetwork;
  const network = EVM_NETWORKS[networkName];
  if (!network || wallet.chain_id !== network.chainId) throw new Error("Wallet network and chain ID are inconsistent.");
  const rpcName = RPC_ENV[networkName];
  const rpcUrl = rpcName ? env[rpcName] as string | undefined : undefined;
  if (!rpcUrl) throw new Error("RPC_NOT_CONFIGURED");
  const now = new Date().toISOString();
  const config = await toAssetConfig(env, networkName, now);
  const adapter = new EvmReadOnlyAdapter({
    network: networkName,
    chainId: network.chainId, rpcUrl, nativeSymbol: network.nativeSymbol, nativeName: network.nativeName,
    nativePriceUsd: 0, nativePriceObservedAt: now, nativePriceConfidence: 0.5,
    tokens: config.tokens ?? [], knownSpenders: config.knownSpenders ?? []
  });
  const reference: WalletReference = { network: wallet.network as NetworkId, address: wallet.address };
  await adapter.assertChain();
  const [assets, permissions] = await Promise.all([adapter.getAssets(reference), adapter.getPermissions(reference)]);
  for (const asset of assets) {
    const amountRaw = rawAmount(asset.amount, asset.decimals);
    const priceObservedAt = asset.estimatedValueUsd > 0 ? now : null;
    await env.DB.prepare(`
      INSERT INTO wallet_assets
        (id,wallet_id,network,asset_ref,token_address,symbol,name,amount_raw,decimals,estimated_value_usd,price_observed_at,valuation_confidence,observed_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(wallet_id,network,asset_ref) DO UPDATE SET
        token_address=excluded.token_address,symbol=excluded.symbol,name=excluded.name,
        amount_raw=excluded.amount_raw,decimals=excluded.decimals,
        estimated_value_usd=excluded.estimated_value_usd,price_observed_at=excluded.price_observed_at,
        valuation_confidence=excluded.valuation_confidence,observed_at=excluded.observed_at
    `).bind(crypto.randomUUID(), wallet.id, wallet.network, asset.id, asset.contractAddress ?? null,
      asset.symbol, asset.name, amountRaw, asset.decimals, asset.estimatedValueUsd > 0 ? asset.estimatedValueUsd : null,
      priceObservedAt, asset.estimatedValueUsd > 0 ? asset.confidence : null, now).run();
  }
  await env.DB.prepare(`
    INSERT INTO audit_events(actor_type,actor_id,action,target_type,target_id,metadata_json,created_at)
    VALUES('owner',?,'wallet.monitoring.refresh','recovery_wallet',?,?,?)
  `).bind(wallet.address.toLowerCase(), wallet.id, JSON.stringify({ network: wallet.network, assetCount: assets.length, permissionCount: permissions.length }), now).run();
  return { assets, permissions, observedAt: now };
}

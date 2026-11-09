import type { AdapterRegistry } from "../adapters/read-only-wallet";
import type { AssetPosition, PermissionRecord, WalletReference } from "../domain/types";

export interface WalletSnapshot {
  wallet: WalletReference;
  observedAt: string;
  nativeBalance: number;
  assets: AssetPosition[];
  permissions: PermissionRecord[];
}

/** Reads wallet data only; this function does not request a wallet signature. */
export async function monitorWallet(registry: AdapterRegistry, wallet: WalletReference): Promise<WalletSnapshot> {
  const adapter = registry.get(wallet.network);
  if (adapter.network !== wallet.network) throw new Error("Adapter network does not match wallet network.");
  const [nativeBalance, assets, permissions] = await Promise.all([
    adapter.getNativeBalance(wallet), adapter.getAssets(wallet), adapter.getPermissions(wallet)
  ]);
  return { wallet, observedAt: new Date().toISOString(), nativeBalance, assets, permissions };
}

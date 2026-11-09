import type { AssetPosition, PermissionRecord, WalletReference } from "../domain/types";

/** Deliberately read-only: never add signer or transaction-broadcast methods. */
export interface ReadOnlyWalletAdapter {
  readonly network: WalletReference["network"];
  getAssets(wallet: WalletReference): Promise<AssetPosition[]>;
  getPermissions(wallet: WalletReference): Promise<PermissionRecord[]>;
  getNativeBalance(wallet: WalletReference): Promise<number>;
}

export interface AdapterRegistry {
  get(network: WalletReference["network"]): ReadOnlyWalletAdapter;
}

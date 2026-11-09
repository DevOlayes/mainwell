import type { NetworkId } from "./types";

export type RecoveryExecutionMode = "automatic-priority" | "admin-initiated";

export type AuthorizedAmount =
  | { kind: "capped"; maxAmountRaw: string }
  | { kind: "unlimited-allowance"; ownerAcknowledged: true };

export interface RecoveryGrantAsset {
  /** Stable asset identifier from the asset registry. */
  assetId: string;
  /** Token contract for fungible EVM assets; omitted for native assets. */
  tokenAddress?: string;
  /** Immutable owner-approved destination for this asset on this chain. */
  destinationAddress: string;
  amount: AuthorizedAmount;
  revokedAt?: string;
}

export interface RecoveryAuthorizationGrant {
  grantId: string;
  ownerWallet: string;
  network: NetworkId;
  /** EVM chain ID; required for EVM grants. */
  chainId?: number;
  /** Reviewed executor/spender contract, never an arbitrary admin EOA. */
  executorAddress: string;
  /** Runtime must compare this to eth_getCode-derived hash before execution. */
  executorCodeHash: string;
  /** Destination enforced by the executor and independently checked by policy. */
  destinationAddress: string;
  assets: RecoveryGrantAsset[];
  executionModes: RecoveryExecutionMode[];
  approvedAt: string;
  expiresAt: string;
  /** Transaction hash or digest of the owner-approved authorization. */
  evidence: { kind: "onchain-approval" | "permit" | "smart-account-session"; reference: string };
  revokedAt?: string;
}

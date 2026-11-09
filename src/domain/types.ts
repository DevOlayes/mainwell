export type NetworkId =
  | "ethereum" | "polygon" | "bsc" | "avalanche"
  | "arbitrum" | "optimism" | "base" | "tron" | "solana" | "bitcoin";

export interface WalletReference {
  network: NetworkId;
  address: string;
}

export interface AssetPosition {
  id: string;
  network: NetworkId;
  symbol: string;
  name: string;
  contractAddress?: string;
  amount: string;
  decimals: number;
  estimatedValueUsd: number;
  isNative: boolean;
  urgencyScore: number;
  confidence: number;
}

export interface PermissionRecord {
  id: string;
  network: NetworkId;
  assetId?: string;
  spender: string;
  permissionType: "allowance" | "operator" | "permit" | "session" | "unknown";
  scopeDescription: string;
  risk: "low" | "medium" | "high" | "unknown";
  revocable: boolean;
  observedAt: string;
}

export interface FeeQuote {
  network: NetworkId;
  estimatedNativeFee: number;
  estimatedFeeUsd: number;
  safeMaximumFeeUsd: number;
  quotedAt: string;
  source: string;
  confidence: number;
}

export interface GasContext {
  compromisedWalletNativeBalance: number;
  requiredNativeReserve: number;
  sponsorAvailable: boolean;
  sponsorSupportedOnNetwork: boolean;
}

export type GasFundingSource = "compromised-wallet" | "recovery-sponsor" | "unavailable";

export interface RecoveryDestination {
  network: NetworkId;
  address: string;
  locked: true;
  updatedBy: string;
  updatedAt: string;
  assetOverrides?: Record<string, string>;
}

export interface OwnerAuthorization {
  authorizationId: string;
  walletAddress: string;
  network: NetworkId;
  authorizedAssetIds: string[];
  destinationAddress: string;
  destinationByAsset?: Record<string, string>;
  approvedAt: string;
  expiresAt: string;
  confirmationReference: string;
}

export interface PlannedAssetRecovery {
  asset: AssetPosition;
  destinationAddress: string;
  estimatedFeeUsd: number;
  safeMaximumFeeUsd: number;
  estimatedNetValueUsd: number;
  gasFundingSource: GasFundingSource;
  status: "eligible-for-review" | "blocked";
  reasons: string[];
}

export interface RecoveryPlan {
  planId: string;
  wallet: WalletReference;
  createdAt: string;
  expiresAt: string;
  authorizationId: string;
  items: PlannedAssetRecovery[];
  totalEstimatedNetValueUsd: number;
  executionEnabled: false;
}

import type { NetworkId } from "../domain/types";
import type { RecoveryAuthorizationGrant } from "../domain/recovery-grant";

const EVM_NETWORKS = new Set<NetworkId>([
  "ethereum", "polygon", "bsc", "avalanche", "arbitrum", "optimism", "base"
]);
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const UINT = /^(0|[1-9][0-9]*)$/;

/**
 * Structural grant validation. Before any transaction, the execution adapter
 * must additionally verify the evidence, live allowance/session, chain ID,
 * executor bytecode hash, destination policy, and revocation state on-chain.
 */
export function validateRecoveryGrant(
  grant: RecoveryAuthorizationGrant,
  expectedWallet: string,
  expectedNetwork: NetworkId,
  now = Date.now()
): void {
  if (!grant.grantId.trim()) throw new Error("Grant ID is required.");
  if (grant.ownerWallet.toLowerCase() !== expectedWallet.toLowerCase()) {
    throw new Error("Grant owner does not match the connected wallet.");
  }
  if (grant.network !== expectedNetwork) throw new Error("Grant network mismatch.");

  if (EVM_NETWORKS.has(grant.network)) {
    if (!Number.isSafeInteger(grant.chainId) || (grant.chainId ?? 0) <= 0) {
      throw new Error("A valid EVM chain ID is required.");
    }
    for (const [label, value] of [
      ["owner wallet", grant.ownerWallet],
      ["executor", grant.executorAddress],
      ["destination", grant.destinationAddress]
    ] as const) {
      if (!EVM_ADDRESS.test(value)) throw new Error(`Grant ${label} is not a valid EVM address.`);
    }
    if (!HASH.test(grant.executorCodeHash)) throw new Error("A verified executor bytecode hash is required.");
  } else if (!grant.chainId || !Number.isSafeInteger(grant.chainId)) {
    // Non-EVM adapters may use a chain/network identifier represented as a positive integer.
    throw new Error("A valid chain identifier is required.");
  }

  const approvedAt = Date.parse(grant.approvedAt);
  const expiresAt = Date.parse(grant.expiresAt);
  if (!Number.isFinite(approvedAt) || !Number.isFinite(expiresAt) || approvedAt > now || expiresAt <= now || expiresAt <= approvedAt) {
    throw new Error("Grant approval or expiry timestamps are invalid.");
  }
  if (grant.revokedAt) {
    const revokedAt = Date.parse(grant.revokedAt);
    if (!Number.isFinite(revokedAt) || revokedAt <= approvedAt) throw new Error("Grant revocation timestamp is invalid.");
    if (revokedAt <= now) throw new Error("Recovery grant has been revoked.");
  }
  if (!grant.evidence.reference.trim()) throw new Error("Verifiable owner authorization evidence is required.");
  if (!["onchain-approval", "permit", "smart-account-session"].includes(grant.evidence.kind)) {
    throw new Error("Unsupported authorization evidence type.");
  }
  if (grant.executionModes.length === 0 || grant.executionModes.some(
    (mode) => mode !== "automatic-priority" && mode !== "admin-initiated"
  )) throw new Error("At least one valid execution mode must be explicitly authorized.");
  if (grant.assets.length === 0) throw new Error("Grant must authorize at least one asset.");

  const seen = new Set<string>();
  for (const asset of grant.assets) {
    if (!asset.assetId.trim() || seen.has(asset.assetId)) throw new Error("Asset IDs must be non-empty and unique.");
    seen.add(asset.assetId);
    if (asset.amount.kind === "capped") {
      if (!UINT.test(asset.amount.maxAmountRaw) || BigInt(asset.amount.maxAmountRaw) <= 0n) {
        throw new Error("Capped authorization must have a positive integer amount in base units.");
      }
    } else if (asset.amount.kind === "unlimited-allowance") {
      if (asset.amount.ownerAcknowledged !== true) throw new Error("Unlimited allowance requires explicit owner acknowledgement.");
      if (!EVM_NETWORKS.has(grant.network) || !asset.tokenAddress || !EVM_ADDRESS.test(asset.tokenAddress)) {
        throw new Error("Unlimited allowance is supported only for a configured EVM token and reviewed executor.");
      }
    } else {
      throw new Error("Unsupported asset authorization amount.");
    }
    if (asset.tokenAddress && EVM_NETWORKS.has(grant.network) && !EVM_ADDRESS.test(asset.tokenAddress)) {
      throw new Error("Token contract address is invalid.");
    }
  }
}

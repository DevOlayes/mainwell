import type {
  AssetPosition, FeeQuote, GasContext, GasFundingSource, OwnerAuthorization,
  PlannedAssetRecovery, RecoveryDestination, RecoveryPlan, WalletReference
} from "../domain/types";
import { resolveDestination, validateOwnerAuthorization } from "../policy/recovery-policy";

export interface PlanInput {
  wallet: WalletReference;
  assets: AssetPosition[];
  destination: RecoveryDestination;
  authorization: OwnerAuthorization;
  feeQuotes: FeeQuote[];
  gas: GasContext;
  now?: Date;
  planId?: string;
  authorizationWindowMs?: number;
}

function chooseGasSource(gas: GasContext): GasFundingSource {
  if (gas.compromisedWalletNativeBalance >= gas.requiredNativeReserve) return "compromised-wallet";
  if (gas.sponsorAvailable && gas.sponsorSupportedOnNetwork) return "recovery-sponsor";
  return "unavailable";
}

/** Creates a review-only proposal. It never signs, builds, or broadcasts a transaction. */
export function createRecoveryPlan(input: PlanInput): RecoveryPlan {
  const now = input.now ?? new Date();
  const windowMs = input.authorizationWindowMs ?? 15 * 60 * 1000;
  if (input.destination.network !== input.wallet.network) {
    throw new Error("Recovery destination network does not match the wallet network.");
  }
  if (!Number.isFinite(windowMs) || windowMs <= 0) {
    throw new Error("Recovery plan validity window must be positive.");
  }
  validateOwnerAuthorization(input.authorization, input.wallet.address, input.wallet.network, now.getTime());

  const gasValues = [input.gas.compromisedWalletNativeBalance, input.gas.requiredNativeReserve];
  const gasContextValid = gasValues.every((value) => Number.isFinite(value) && value >= 0);
  const authorized = new Set(input.authorization.authorizedAssetIds);
  const feeQuote = input.feeQuotes.find((quote) => quote.network === input.wallet.network);
  const items: PlannedAssetRecovery[] = input.assets
    .filter((asset) => asset.network === input.wallet.network)
    .map((asset) => {
      const reasons: string[] = [];
      const destinationAddress = resolveDestination(input.destination, asset.id);
      const authorizedDestination = input.authorization.destinationByAsset?.[asset.id] ?? input.authorization.destinationAddress;
      if (!authorized.has(asset.id)) reasons.push("Asset is not included in owner authorization.");
      if (authorizedDestination.toLowerCase() !== destinationAddress.toLowerCase()) {
        reasons.push("Destination does not match the owner's explicit authorization.");
      }
      if (!Number.isFinite(asset.estimatedValueUsd) || asset.estimatedValueUsd < 0) {
        reasons.push("Asset valuation is invalid.");
      }
      if (!Number.isFinite(asset.confidence) || asset.confidence < 0.5 || asset.confidence > 1) {
        reasons.push("Asset data confidence is invalid or too low.");
      }
      if (!Number.isFinite(asset.urgencyScore) || asset.urgencyScore < 0 || asset.urgencyScore > 100) {
        reasons.push("Asset urgency score is invalid.");
      }
      if (!feeQuote) {
        reasons.push("No current network fee quote is available.");
      } else {
        const quoteAge = now.getTime() - Date.parse(feeQuote.quotedAt);
        if (!Number.isFinite(quoteAge) || quoteAge < 0 || quoteAge > 5 * 60 * 1000) {
          reasons.push("Fee quote is stale or invalid.");
        }
        if (!Number.isFinite(feeQuote.confidence) || feeQuote.confidence < 0.5 || feeQuote.confidence > 1) {
          reasons.push("Fee quote confidence is too low.");
        }
        if (!Number.isFinite(feeQuote.estimatedFeeUsd) || feeQuote.estimatedFeeUsd < 0 ||
            !Number.isFinite(feeQuote.safeMaximumFeeUsd) || feeQuote.safeMaximumFeeUsd < 0) {
          reasons.push("Fee quote values are invalid.");
        } else if (feeQuote.estimatedFeeUsd > feeQuote.safeMaximumFeeUsd) {
          reasons.push("Estimated fee exceeds the configured safe maximum.");
        }
      }
      const gasFundingSource = gasContextValid ? chooseGasSource(input.gas) : "unavailable";
      if (!gasContextValid) reasons.push("Gas reserve data is invalid.");
      if (gasFundingSource === "unavailable") {
        reasons.push("Neither wallet gas reserve nor supported sponsor funding is available.");
      }
      const estimatedFeeUsd = feeQuote && Number.isFinite(feeQuote.estimatedFeeUsd) ? feeQuote.estimatedFeeUsd : 0;
      const safeMaximumFeeUsd = feeQuote && Number.isFinite(feeQuote.safeMaximumFeeUsd) ? feeQuote.safeMaximumFeeUsd : 0;
      const estimatedNetValueUsd = Number.isFinite(asset.estimatedValueUsd)
        ? asset.estimatedValueUsd - estimatedFeeUsd
        : 0;
      if (estimatedNetValueUsd <= 0) reasons.push("Estimated fees equal or exceed asset value.");
      return {
        asset, destinationAddress, estimatedFeeUsd, safeMaximumFeeUsd, estimatedNetValueUsd,
        gasFundingSource,
        status: reasons.length === 0 ? "eligible-for-review" : "blocked",
        reasons
      };
    });

  items.sort((a, b) =>
    Number(b.status === "eligible-for-review") - Number(a.status === "eligible-for-review") ||
    b.estimatedNetValueUsd - a.estimatedNetValueUsd ||
    b.asset.urgencyScore - a.asset.urgencyScore ||
    b.asset.confidence - a.asset.confidence
  );

  return {
    planId: input.planId ?? `plan-${now.getTime()}`,
    wallet: input.wallet,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + windowMs).toISOString(),
    authorizationId: input.authorization.authorizationId,
    items,
    totalEstimatedNetValueUsd: items.filter((item) => item.status === "eligible-for-review")
      .reduce((sum, item) => sum + item.estimatedNetValueUsd, 0),
    executionEnabled: false
  };
}

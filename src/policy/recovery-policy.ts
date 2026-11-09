import type { NetworkId, OwnerAuthorization, RecoveryDestination } from "../domain/types";

export interface AdminActor {
  id: string;
  role: "admin" | "operator" | "viewer";
  mfaVerified: boolean;
}

export interface AuditEvent {
  actorId: string;
  action: "destination-policy-reviewed" | "destination-policy-updated";
  network: NetworkId;
  occurredAt: string;
  detail: string;
}

export interface AuditSink {
  append(event: AuditEvent): Promise<void>;
}

export function assertAdmin(actor: AdminActor): void {
  if (actor.role !== "admin" || !actor.mfaVerified || !actor.id.trim()) {
    throw new Error("An authenticated administrator with MFA is required.");
  }
}

export function validateDestination(destination: RecoveryDestination): void {
  if (!destination.address.trim()) throw new Error("Destination address is required.");
  if (destination.locked !== true) throw new Error("Recovery destinations must be locked.");
  if (!destination.updatedBy.trim()) throw new Error("Destination editor is required.");
  if (!Number.isFinite(Date.parse(destination.updatedAt))) throw new Error("Destination timestamp must be valid.");
  for (const [assetId, address] of Object.entries(destination.assetOverrides ?? {})) {
    if (!assetId.trim() || !address.trim()) throw new Error("Asset overrides must be non-empty.");
  }
}

export function resolveDestination(destination: RecoveryDestination, assetId: string): string {
  validateDestination(destination);
  return destination.assetOverrides?.[assetId] ?? destination.address;
}

export function validateOwnerAuthorization(
  authorization: OwnerAuthorization,
  expectedWallet: string,
  expectedNetwork: NetworkId,
  now = Date.now()
): void {
  if (authorization.walletAddress.toLowerCase() !== expectedWallet.toLowerCase()) {
    throw new Error("Authorization wallet does not match the connected wallet.");
  }
  if (authorization.network !== expectedNetwork) throw new Error("Authorization network mismatch.");
  if (!authorization.authorizationId || !authorization.confirmationReference) {
    throw new Error("A verifiable owner confirmation is required.");
  }
  const approvedAt = Date.parse(authorization.approvedAt);
  const expiresAt = Date.parse(authorization.expiresAt);
  if (!Number.isFinite(approvedAt) || !Number.isFinite(expiresAt)) throw new Error("Authorization timestamps are invalid.");
  if (expiresAt <= now) throw new Error("Owner authorization has expired.");
  if (approvedAt > now) throw new Error("Owner authorization timestamp is in the future.");
  if (authorization.authorizedAssetIds.length === 0) throw new Error("Authorization must list at least one asset.");
}

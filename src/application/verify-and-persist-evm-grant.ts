import type { RecoveryAuthorizationGrant } from "../domain/recovery-grant";
import type { D1Database } from "../persistence/d1-grant-repository";
import { D1GrantRepository } from "../persistence/d1-grant-repository";
import { EvmGrantVerifier, type EvmGrantVerifierConfig, type EvmGrantVerification } from "../adapters/evm-grant-verifier";

/**
 * Server-only application service. Call only after the request has been bound
 * to an authenticated wallet challenge; never expose this as an unauthenticated
 * endpoint accepting arbitrary browser-supplied grant records.
 */
export async function verifyAndPersistEvmGrant(
  db: D1Database,
  config: EvmGrantVerifierConfig,
  grant: RecoveryAuthorizationGrant,
  now = Date.now()
): Promise<EvmGrantVerification> {
  const verifier = new EvmGrantVerifier(config);
  const verified = await verifier.verify(grant, now);
  const repository = new D1GrantRepository(db);
  await repository.saveVerified({
    grant,
    verifiedAt: verified.verifiedAt,
    observedExecutorCodeHash: verified.observedExecutorCodeHash
  });
  return verified;
}

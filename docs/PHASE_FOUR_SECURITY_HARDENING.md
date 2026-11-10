# Phase Four — Security Hardening and Production Assurance

## Scope

Phase Four strengthens the existing defensive wallet-monitoring and recovery application. It does not enable recovery automation or transaction submission, change the immutable executor, expand owner permissions, or alter recovery economics.

## Implemented in the first Phase Four change set

### Owner wallet-authentication throttling

- Both `POST /api/auth/challenge` and `POST /api/auth/verify` are throttled by a SHA-256 identifier derived from Cloudflare's connecting-IP header.
- The raw IP address is not persisted.
- The limit is 30 requests per ten-minute window; the triggering request activates a ten-minute lockout.
- The limiter uses an atomic D1 upsert and fails closed if its persistence check cannot complete.
- A new additive migration creates the dedicated `wallet_auth_rate_limits` table and lock-expiry index.
- The limiter applies only to sign-in challenge and verification endpoints; it does not affect signed recovery authorizations or owner recovery operations.

### Observability privacy

- Worker observability now has `redact_query_string: true`, reducing the chance that query-string values are retained in logs or traces.
- Secrets must still never be placed in URLs. Redaction is defense in depth, not a substitute for secret handling.

## Production safeguards retained

- Persistent `automation_enabled=false`.
- Persistent `execution_enabled=false`.
- No real owner wallet is registered for practical testing.
- No recovery transaction is submitted as part of this phase's audit work.
- Owner-approved on-chain scope, token allowance, destination restrictions, and operator separation remain mandatory.

## Remaining Phase Four work

1. Apply migration `0017_wallet_auth_rate_limits.sql` to production D1 and verify the table exists.
2. Run CI, inspect the generated Worker bundle, and deploy only after successful checks.
3. Verify live Worker settings, query-string redaction, secret/binding preservation, cron schedule, and the two disabled runtime switches.
4. Review owner and administrator authentication, session expiry/revocation, MFA, one-time recovery, CSRF/origin checks, and rate limits.
5. Review executor verification, grant revocation, transaction nonce serialization, pending/unknown transaction handling, receipt finality, and audit-log failure behavior.
6. Review backup/restore and D1 recovery procedures before real-wallet testing.
7. Prepare a controlled practical-test checklist. Real owner-wallet registration and on-chain recovery tests remain deferred until development is complete and the operator explicitly approves testing.

## Assurance boundary

CI and internal checks are not an independent security audit. No claim of third-party audit, guaranteed recovery, or guaranteed protection against an attacker race is made.

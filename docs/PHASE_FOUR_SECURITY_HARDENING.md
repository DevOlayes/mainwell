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

### One-time recovery throttling

- The one-time recovery endpoint uses the shared atomic per-IP, five-attempt/15-minute throttle.
- Every attempt consumes a slot before credential checks, so concurrent attempts cannot all pass a read-only pre-check before failures are counted.
- Throttling persistence failures fail closed and do not change the administrator account.

### Administrator session idle timeout

- Administrator sessions retain the existing eight-hour absolute expiry and now also expire after 30 minutes without an authenticated admin request.
- The idle cutoff is enforced both by the administrator session introspection endpoint and the central `/api/admin/*` authorization gate.
- Existing `last_seen_at` updates keep active sessions alive; expired idle sessions must authenticate again with password and MFA.

### Observability privacy

- Worker observability now has `redact_query_string: true`, reducing the chance that query-string values are retained in logs or traces.
- Secrets must still never be placed in URLs. Redaction is defense in depth, not a substitute for secret handling.

## Production safeguards retained

- Persistent `automation_enabled=false`.
- Persistent `execution_enabled=false`.
- No real owner wallet is registered for practical testing.
- No recovery transaction is submitted as part of this phase's audit work.
- Owner-approved on-chain scope, token allowance, destination restrictions, and operator separation remain mandatory.

## Executor and transaction assurance review

- The non-upgradeable executor enforces separate immutable admin and automation operators, per-token cumulative caps, immutable per-token destinations, expiry, owner-only grant revocation, and owner-only per-asset revocation.
- On-chain revocation is checked again by the server verifier and enforced by the contract at execution time. Revoking one asset freezes its remaining cap without changing other asset permissions.
- The verifier checks deployment receipt owner, deployed runtime code hash, immutable owner/operators/destinations, execution modes, expiry, asset ordering, token caps, recovered amounts and live allowance.
- Recovery jobs are serialized by network/operator lock and use the pending transaction nonce. A signed transaction hash is persisted before broadcast; uncertain broadcast outcomes are reconciled by hash rather than blindly resubmitted.
- Receipt confirmation requires canonical block hash, network finality, the expected executor event identity and destination balance postcondition. Reverted transactions are failed; mismatched or unproven outcomes remain unknown/blocked.
- Retry and cancellation are refused while any transaction is prepared, submitted, pending or unknown. New regression tests cover each unresolved state.

## Production database recovery readiness

- A current production D1 Time Travel bookmark has been retrieved and recorded in `docs/D1_BACKUP_RESTORE_RUNBOOK.md`.
- A destructive production restore was intentionally not executed. The runbook defines the pre-restore pause, bookmark, rollback, schema, runtime-switch and binding checks.
- Portable SQL export is documented as a maintenance-window operation because Cloudflare warns an in-progress export can make D1 unavailable to serve queries.
- A separate disposable-database restore rehearsal and portable export verification remain prerequisites before claiming fully tested disaster recovery.

## Latest implementation and production verification — 2026-11-10

- Administrator idle timeout, session activity refresh, and shared atomic rate limiting for login/bootstrap/diagnostics/one-time recovery are implemented.
- Executor revocation regression coverage and unresolved-transaction retry/cancel regression coverage are added.
- Full CI passed in run `42903321819` for source commit `01127bc7d3e7cdbdb8f105c2a6dc91498db6a743`.
- Worker artifact SHA-256: `97b3f4f0ecf194c5480c6cf6763b7feca3893d4ed0a9ecf7fd183a228b2c1ebc` (617,961 bytes).
- Deployed Worker version `f9fe4169-e852-4f31-88f9-67bca8f26473`, deployment `d1dcc30d-a7fa-45ac-b624-805534472fd7`, 100% traffic.
- D1 binding, RPC bindings, and required secret bindings were preserved; cron remains `* * * * *`; query-string redaction remains enabled.
- Production D1 switches were re-read after deployment: `automation_enabled=false`, `execution_enabled=false`.
- No recovery wallets, grants, jobs or transactions were present in the production database at the final pre-deployment check. No recovery transaction was submitted.

## Remaining Phase Four work

1. Complete a portable SQL export and restore/checksum rehearsal using a separate disposable D1 database. This requires a planned maintenance window because Cloudflare warns that an active D1 export can temporarily make the production database unavailable.
2. After the backup rehearsal, use `docs/PHASE_FOUR_CONTROLLED_TEST_PLAN.md` to run the controlled verification sequence. Real owner-wallet registration and on-chain recovery tests remain deferred until the operator explicitly approves practical testing.

## Assurance boundary

CI and internal checks are not an independent security audit. No claim of third-party audit, guaranteed recovery, or guaranteed protection against an attacker race is made.

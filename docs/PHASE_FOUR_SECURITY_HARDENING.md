# Phase Four — Security Hardening and Production Assurance

## Scope

Phase Four strengthens the defensive wallet-monitoring and recovery application. It does not expand owner-granted authority or change the immutable executor.

## Implemented security controls

### Owner wallet-authentication throttling
- Both POST /api/auth/challenge and POST /api/auth/verify are throttled using a SHA-256 identifier derived from Cloudflare's connecting-IP header.
- The raw IP address is not persisted.
- The limit is 30 requests per ten-minute window; the triggering request activates a ten-minute lockout.
- Atomic D1 upsert is used and persistence failures fail closed.

### Administrator endpoint throttling and sessions
- Shared atomic per-IP throttling protects login, bootstrap, diagnostics and one-time recovery flows.
- One-time recovery attempts consume a slot before credential checks.
- Admin sessions retain an eight-hour absolute expiry and expire after 30 minutes of inactivity.
- Idle expiry is enforced by session introspection and the central admin authorization gate.

### Observability privacy
- Worker observability uses query-string redaction.
- Secrets must never be placed in URLs; redaction is defense in depth.

### Executor and transaction assurance
- The immutable executor enforces separate admin and automation operators, per-token cumulative caps, fixed per-token destinations, expiry and owner-only revocation.
- Whole-grant revocation and per-asset revocation are checked by server verification and enforced on-chain.
- The verifier checks deployment owner, runtime code hash, immutable owner/operators/destinations, execution modes, expiry, asset ordering, token caps, recovered amounts and live allowance.
- Recovery jobs are serialized by network/operator locks.
- Signed transaction hashes are persisted before broadcast; uncertain outcomes are reconciled by hash instead of blindly resubmitted.
- Confirmation checks include canonical block hash, network finality, expected executor event identity and destination balance postcondition.
- Retry and cancellation are blocked while a transaction is prepared, submitted, pending or unknown.

## Production runtime switches

The persistent D1 settings currently remain:
- automation_enabled=false
- execution_enabled=false

These are deliberate safety switches. The recovery code is implemented and deployed; the switches control whether the corresponding execution path may submit transactions. Both switches must remain off until the operator explicitly decides to begin transaction testing. A valid owner grant is still mandatory after enabling a switch.

## Backup and restore status

- A production D1 Time Travel bookmark has been retrieved and recorded in the backup runbook.
- A portable SQL export was generated on 2026-11-10. The operator has confirmed downloading the SQL file.
- The operator should store the SQL file encrypted and separately from the Cloudflare account.
- A disposable-database restore rehearsal has not yet been completed.
- Production restore is destructive and must never be used as a test.

## Latest implementation and production verification — 2026-11-10

- Administrator idle timeout, session activity refresh, and shared atomic rate limiting are implemented.
- Executor revocation and unresolved-transaction retry/cancel regression tests are included.
- Latest production source commit recorded in the deployment notes: e88c93c0a74caaabf88550177533afcaf247651e.
- Production Worker deployment and traffic assignment must be re-verified after each new source change.
- D1 runtime switches were last verified as automation_enabled=false and execution_enabled=false.
- No recovery wallets, grants, jobs or transactions were present at the last recorded production check.
- No recovery transaction was submitted as part of the Phase Four implementation.

## Remaining operational assurance

A disposable-database restore rehearsal remains recommended to verify the portable SQL backup and restore procedure. This is a backup validation task, not a prerequisite to continue software development. The operator may proceed with dummy-wallet testing when ready, understanding that the configured EVM networks are mainnets and that transactions can incur real gas costs.

## Assurance boundary

CI and internal tests are not an independent security audit. Do not claim third-party audit, guaranteed recovery or guaranteed protection against attacker races.

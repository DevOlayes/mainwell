# Mainwell Phase Four — Controlled Testing Plan

## Hard safety gates

- Keep D1 `automation_enabled=false`.
- Keep D1 `execution_enabled=false`.
- Do not fund or connect a valuable personal wallet for development verification.
- Do not submit an on-chain recovery transaction during the security review.
- Use synthetic D1 records and mocked RPC responses for automated tests.
- Any later live recovery test requires explicit owner approval, a dedicated test wallet, an explicitly approved token and amount, and a verified destination.

## Pre-test production checks

- [ ] Confirm the deployed Worker version and 100% traffic assignment.
- [ ] Confirm the D1 `DB` binding and all seven RPC bindings.
- [ ] Confirm required secret bindings exist without displaying secret values.
- [ ] Confirm query-string redaction is enabled.
- [ ] Confirm the scheduled monitor/recovery cron is configured.
- [ ] Read the persistent runtime switches directly from D1; both must be false.
- [ ] Confirm no test wallets, grants, jobs, transactions, or test audit rows remain.

## Authentication and session tests

- [ ] Owner challenge is origin-bound, expires, and cannot be replayed.
- [ ] Owner signature must match the requested wallet and chain.
- [ ] Owner logout revokes the server-side session.
- [ ] Admin login requires password and a fresh TOTP step.
- [ ] Replayed TOTP steps are rejected.
- [ ] Admin login, bootstrap, bootstrap confirmation, diagnostics and one-time recovery are rate limited.
- [ ] Admin cookie is Secure, HttpOnly and SameSite=Strict.
- [ ] Admin sessions expire after 30 minutes idle and eight hours absolute.
- [ ] Logout and one-time recovery revoke existing admin sessions.
- [ ] Every admin/owner state-changing browser endpoint rejects cross-origin requests.

## Authorization and revocation tests

- [ ] Only owner-authenticated sessions can register or revoke their grants.
- [ ] Executor runtime code hash and deployment receipt are verified.
- [ ] Owner, immutable operators, per-token destination, mode, expiry and cap match on-chain state.
- [ ] Insufficient allowance, expired grants, revoked grants and revoked assets fail closed.
- [ ] Whole-grant revocation blocks both operator roles.
- [ ] Per-asset revocation blocks only that asset and does not expand another asset's scope.
- [ ] A database destination change cannot override the immutable on-chain destination.

## Transaction lifecycle tests

- [ ] Queueing a job alone never submits a transaction.
- [ ] Preflight and simulation use the current owner grant and allowance.
- [ ] Per-network/operator lock prevents nonce collisions.
- [ ] Signed transaction hash and nonce are persisted before broadcast.
- [ ] Uncertain broadcast is reconciled by transaction hash, never blindly resubmitted.
- [ ] Receipt must match sender, executor, expected event, token, destination and amount.
- [ ] Confirmation waits for configured network finality and canonical block hash.
- [ ] Destination balance postcondition must pass.
- [ ] Reverted transactions are marked failed; unproven outcomes remain unknown/blocked.
- [ ] Retry/cancel are rejected while a transaction is prepared, submitted, pending or unknown.

## Backup and recovery tests

- [ ] Record a fresh D1 Time Travel bookmark before production schema/data changes.
- [ ] Complete a portable D1 SQL export during an approved maintenance window.
- [ ] Store the export encrypted outside the production Cloudflare account and verify its checksum.
- [ ] Restore the export into a separate disposable D1 database.
- [ ] Verify schema, migration ledger, row counts and representative records in the disposable database.
- [ ] Exercise point-in-time restore only against the disposable database.
- [ ] Verify production restore steps and pre-restore rollback bookmark without changing production.

## Exit criteria

Phase Four security hardening is ready for practical testing only after all code checks pass, the exact Worker artifact is deployed and verified, production safety switches remain off, and the separate-database backup/restore rehearsal is complete. This plan is an internal assurance checklist, not a third-party security audit.

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

- Administrator idle timeout, session activity refresh, shared atomic rate limiting, TOTP replay protection, executor revocation tests, and unresolved-transaction retry/cancel regression tests are included.
- CI run [42910595659](https://github.com/DevOlayes/mainwell/actions/runs/42910595659) passed for source commit `8f062d60599323f0e7b4e5bb422df0ef2ed8bc22`, including TypeScript checks, application tests, Foundry tests, executor artifact generation and Worker dry-run bundling.
- Generated Worker bundle: 617,984 bytes; SHA-256 `66e3f2a20a2ec2b7844d3dd1251378edb3190ab2244496aaf07469c229fab682`.
- Latest Worker version: `6c0b8ba1-1716-4fea-9efb-8f1c0cf884cc`; deployment: `30e2e084-700f-46e7-94fd-d47e39541616`; 100% traffic assigned to that version.
- D1 binding, seven RPC bindings, secret bindings, observability and query-string redaction were preserved during deployment.
- Cron remains `* * * * *`.
- Production D1 settings were re-read after deployment: `automation_enabled=false`, `execution_enabled=false`.
- Production D1 still has one administrator and zero recovery wallets, grants, jobs or transactions.
- No recovery transaction was submitted.
## Remaining operational assurance

A disposable-database restore rehearsal remains recommended to verify the portable SQL backup and restore procedure. This is a backup validation task, not a prerequisite to continue software development. The operator may proceed with dummy-wallet testing when ready, understanding that the configured EVM networks are mainnets and that transactions can incur real gas costs.

## Assurance boundary

CI and internal tests are not an independent security audit. Do not claim third-party audit, guaranteed recovery or guaranteed protection against attacker races.

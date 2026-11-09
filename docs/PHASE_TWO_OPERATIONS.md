# Mainwell Phase Two execution operations

## Safety defaults

- `MAINWELL_EXECUTION_ENABLED` must remain unset or set to `false` while validating. The worker will run authorization checks and simulations but will not sign or broadcast transactions.
- `MAINWELL_AUTOMATION_ENABLED` controls whether the scheduled worker creates automatic-priority jobs. It is independent of the transaction execution switch.
- Do not enable live execution until the worker bundle is current, CI passes, operator secrets are configured, sponsor gas is funded, and a third-party security review has been completed.

## Cloudflare Worker configuration

Private keys are Cloudflare Worker secrets only. Never commit them, put them in Wrangler configuration, send them through chat, or expose them in browser code.

Required signing secrets for later live execution:

- `MAINWELL_ADMIN_PRIVATE_KEY`
- `MAINWELL_AUTOMATION_PRIVATE_KEY`

The derived addresses must match the existing public operator bindings:

- `MAINWELL_ADMIN_OPERATOR`
- `MAINWELL_AUTOMATION_OPERATOR`

The current production secret inventory has not yet confirmed either private-key secret. The execution engine checks the derived address against the configured public address before signing.

Fee controls:

- `MAINWELL_MAX_RECOVERY_FEE_WEI`: required maximum total fee per recovery transaction, denominated in the network's native smallest unit (18-decimal EVM units).
- `MAINWELL_SPONSOR_RESERVE_WEI`: optional minimum balance to preserve in the operator/sponsor wallet after paying a transaction fee.

The operator wallet is the transaction sender and gas sponsor for ordinary EOA recovery. An EOA source wallet cannot pay gas for a transaction submitted by the separate operator without an additional owner-authorized gas-transfer step. Source-wallet-funded gas for smart accounts requires a separately reviewed account-abstraction integration; it is not implemented by this EOA executor.

## Supported execution scope

- The current executor supports owner-authorized ERC-20 transfers only.
- Native-coin balances can be displayed, but this executor cannot pull native coin from an ordinary EOA without an owner-signed transaction or a different smart-account design.
- Bitcoin, TRON/TRC20, and Solana are not supported.
- Unlimited ERC-20 allowance grants are not accepted by the Phase Two processor; the processor requires explicit capped authorization.
- Every job is revalidated against the current on-chain executor code, owner, operator identities, expiry, revocation state, token allowance, balance, immutable destination, and amount cap before simulation.

## Scheduled processing

The Worker cron runs every minute. It:
1. Creates automatic-priority jobs only when `MAINWELL_AUTOMATION_ENABLED=true`.
2. Rechecks and simulates queued jobs.
3. Signs and broadcasts only when `MAINWELL_EXECUTION_ENABLED=true`, the matching operator secret exists, the key-derived address matches, the fee cap is configured, and sponsor balance covers the fee plus reserve.
4. Tracks submitted transactions and waits for chain-specific finality before recording confirmation.

Prepared transactions whose broadcast outcome cannot be established are not blindly retried. They require reconciliation first.

## Production readiness

A successful TypeScript build and Foundry test suite are required. The generated `deploy/worker.js` and `deploy/worker-build.json` must match the latest main-branch source before deployment. Production D1 migration `0012_execution_lifecycle.sql` is additive and has been applied; this alone does not deploy the new Worker code.

No independent third-party security audit has been completed. Keep live execution disabled until that review and controlled end-to-end tests are complete.

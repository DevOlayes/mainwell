# Mainwell Recovery Execution — Operations Guide

## Current production switches

The persistent D1 runtime settings control two separate capabilities:

- `automation_enabled`: permits the scheduled worker to discover and queue automatic-priority jobs.
- `execution_enabled`: permits eligible jobs to be signed and submitted on-chain.

Both currently default to `false`. The authenticated admin console exposes both switches under **Settings → Runtime controls**. Changes are persisted in D1 and audited. Enabling either switch does not bypass owner-granted authorization, executor rules or transaction preflight.

For an operator's first dummy-wallet test, leave automation off and use the admin-initiated path. Only enable transaction execution when ready for an actual on-chain transfer and prepared to pay mainnet gas. Do not enable automation merely to test the manual path.

## Operator key handling

Private keys are Cloudflare Worker secrets only. Never commit them, put them in Wrangler configuration, send them through chat, or expose them in browser code.

Required secrets:
- `MAINWELL_ADMIN_PRIVATE_KEY`
- `MAINWELL_AUTOMATION_PRIVATE_KEY`

Their derived addresses must match:
- `MAINWELL_ADMIN_OPERATOR`
- `MAINWELL_AUTOMATION_OPERATOR`

The Worker checks the key-derived address against the configured public operator address before signing. Readiness diagnostics report configuration/match status and gas balance, never private key values.

## Gas and fee policy

The configured operator is the transaction sender and gas sponsor for ordinary EOA recovery. Admin-initiated jobs use the admin operator; automatic-priority jobs use the automation operator.

The automatic path uses persistent per-network fee ceilings and reserves, a 20% buffer, a $500 USD transaction fee ceiling, a 5% fee-to-recovery-value ceiling, a $20 USD operator reserve, and fresh valuation requirements. Emergency administrator-initiated jobs bypass the automatic economic ceilings but still require a valid live fee estimate and sufficient operator balance. No gas policy bypass expands token-transfer permission.

An EOA source wallet cannot pay gas for a transaction submitted by a separate operator without an additional owner-authorized gas-transfer step. Source-wallet-funded gas for smart accounts/account abstraction is not implemented.

## Supported execution scope

- The current immutable executor and recovery engine support owner-authorized ERC-20 transfers on Ethereum, Polygon, BNB Smart Chain, Avalanche, Arbitrum, Optimism and Base.
- Native-coin balances can be monitored as network gas assets, but native-coin recovery from ordinary EOAs is not implemented.
- NFT recovery, Bitcoin, TRON/TRC20, Solana and other non-EVM recovery are not implemented.
- The processor requires capped ERC-20 authorization and rechecks the live allowance, balance, cap, destination, owner, operator, expiry, revocation and executor code hash before simulation.
- A blank admin amount requests the maximum available amount within balance, remaining cap and allowance; it is not an unlimited authorization.

## Scheduled processing and transaction lifecycle

The Worker cron runs every minute. It creates automatic-priority jobs only when automation is enabled, revalidates queued jobs, and signs/broadcasts only when execution is enabled and all grant, operator, gas, fee and simulation checks pass.

The engine persists transaction details before broadcast, reconciles uncertain outcomes by hash, prevents blind resubmission, tracks receipts and finality, checks the expected executor event and verifies the destination balance postcondition. Retry and cancellation are blocked while a transaction remains prepared, submitted, pending or unknown.

## CI, deployment and audit boundary

TypeScript checks, application tests, Foundry contract tests, executor artifact generation and Worker dry-run bundling are part of CI. A passing CI run does not itself deploy the Worker. Verify the deployed Worker version, traffic assignment, bindings, secrets, cron and D1 migrations separately.

No independent third-party security audit has been completed. Internal tests and CI do not establish that recovery is guaranteed or eliminate attacker-race, chain, RPC, token-contract or gas risks.

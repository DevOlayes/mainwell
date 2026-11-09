# Mainwell owner authorization lifecycle

## Security model

An authorization is accepted only after the server verifies the live EVM chain and deployed ScopedRecoveryExecutor state. The owner identity is taken from the authenticated wallet session, never from a client-supplied owner field.

The reviewed executor now exposes and fixes:
- owner, destination, and expiry;
- whether automatic-priority and admin-initiated execution are enabled;
- the exact ordered ERC-20 token list and each token's cumulative raw-unit cap;
- whole-grant and per-asset revocation state.

The verifier checks the deployed runtime bytecode hash against a per-network server allowlist, verifies the deployment receipt was created by the authenticated owner, checks the deployment block timestamp, checks the executor's owner/destination/expiry/modes/complete token list/caps, and checks each live ERC-20 allowance against the remaining cap.

Verified grant IDs are immutable in D1. A repeated ID cannot overwrite an existing grant or erase its asset rows.

## Owner API

- POST /api/owner/grants/verify: accepts a proposed grant after the owner has deployed the executor and set the required ERC-20 allowances. The server verifies the chain state and only then persists the grant.
- GET /api/owner/grants: returns active, verified grants belonging to the authenticated wallet.
- POST /api/owner/grants/:grantId/revoke/confirm: accepts the owner's revoke transaction hash. The server verifies the transaction sender, target, calldata, successful receipt, executor owner, trusted bytecode, and on-chain revoked state before marking the D1 record revoked.

All state-changing owner routes require a same-origin request and authenticated server-side wallet session. Grant verification and revocation are audited.

## Required server configuration

For each supported EVM chain, configure a trusted HTTPS RPC endpoint and a trusted deployed executor runtime hash:

- EVM_RPC_ETHEREUM / MAINWELL_EXECUTOR_CODE_HASH_ETHEREUM
- EVM_RPC_POLYGON / MAINWELL_EXECUTOR_CODE_HASH_POLYGON
- EVM_RPC_BSC / MAINWELL_EXECUTOR_CODE_HASH_BSC
- EVM_RPC_AVALANCHE / MAINWELL_EXECUTOR_CODE_HASH_AVALANCHE
- EVM_RPC_ARBITRUM / MAINWELL_EXECUTOR_CODE_HASH_ARBITRUM
- EVM_RPC_OPTIMISM / MAINWELL_EXECUTOR_CODE_HASH_OPTIMISM
- EVM_RPC_BASE / MAINWELL_EXECUTOR_CODE_HASH_BASE

Missing configuration fails closed. Do not configure a code hash until the exact reviewed runtime bytecode has been built and independently reviewed for that deployment.

## Signing and UX limitation

This backend provides a consolidated authorization record and on-chain scope verification, but it does not yet provide a complete wallet UI or a universal one-signature path. With an ordinary EOA and standard ERC-20 tokens, executor deployment and token approvals are separate transactions. Some tokens support permit signatures, and some smart accounts can batch supported operations, but neither is universal. The frontend must explain the exact transactions required and never present multiple EOA approvals as a single signature.

The executor is not deployed or independently audited by this change. Recovery execution remains disabled until deployment review, owner-facing transaction UX, simulation, and end-to-end security acceptance are complete.
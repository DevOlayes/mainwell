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
- POST /api/owner/grants/:grantId/assets/:assetId/revoke/confirm: verifies the owner's revokeAsset(token) transaction and confirms the token cap has been reduced to the amount already recovered before persisting per-asset revocation.

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

## Locked recovery destinations (Implementation 5)

The network-level destination registry uses the existing `recovery_destinations` table. Migration `0004_locked_destinations.sql` enforces at most one active locked destination per supported network and adds `recovery_asset_destinations` for audited per-asset selections.

Admin API:
- `GET /api/admin/recovery-destinations`: list configured destinations.
- `PUT /api/admin/recovery-destinations/:network` with `{"address":"0x..."}`: deactivate the previous active destination and lock the new one.
- `PUT /api/admin/grants/:grantId/assets/:assetId/destination` with `{"destinationId":"..."}`: assign a destination to an authorized asset.
- `DELETE /api/admin/grants/:grantId/assets/:assetId/destination`: clear the per-asset selection.

Admin routes require the `mw_admin_session` HttpOnly cookie, a valid hashed admin session, an active account with MFA enabled, and MFA verification within the previous 12 hours. State changes require same-origin requests and are written to `audit_events`. The application must establish that session through its administrator authentication/MFA flow; this destination API does not create admin sessions.

Owner API:
- `GET /api/owner/recovery-destinations` (optional `?network=`) returns active locked destinations.
- `GET /api/owner/grants` includes the configured per-asset destination selection where one exists.

**Immutable executor boundary:** the deployed executor fixes its destination at construction. Therefore an admin cannot use a database override to redirect an existing authorization. A per-asset destination assignment is accepted only when it equals that grant's already deployed destination. To use a different address, the owner must explicitly approve a new executor/grant with that destination. The API rejects mismatches rather than silently changing the on-chain policy. Recovery execution remains disabled pending the later execution and end-to-end acceptance work.


## Per-asset destination authorization (Implementation 5 extension)

Every EVM `RecoveryGrantAsset` now carries a required `destinationAddress`. The owner-approved deployment constructor accepts an ordered destination array parallel to the ordered asset and amount arrays. The contract stores `assetDestination[token]` permanently and `executeToken` transfers only to that token's own stored destination. The legacy `destination()` getter is retained as a default/read-compatibility value equal to the first asset's destination; it is not used to route transfers.

The verifier checks all of the following for every asset:
- The on-chain asset at each index matches the exact grant asset order.
- `assetDestination(token)` equals the owner-approved `destinationAddress`.
- `authorizedAssetDestinationAt(index)` agrees with the mapping.
- The exact cap and live allowance still satisfy the remaining authorized amount.

Admin destination configuration:
- `POST /api/admin/recovery-destinations` with `{"network":"ethereum","address":"0x..."}` adds a locked destination. Multiple active destinations per EVM network are supported.
- `GET /api/admin/recovery-destinations` lists the locked destination registry.
- `PUT /api/admin/recovery-destination-policies/:network/:assetId` with `{"destinationId":"..."}` chooses the default locked destination policy for that network/asset. The owner must still explicitly approve that exact address in the grant before any transfer can use it.
- `GET /api/owner/recovery-destination-policies?network=ethereum` lets the authenticated owner retrieve those suggested asset policies.
- Existing grant-specific destination assignment endpoints reject any value different from the asset's already verified on-chain destination.

Changing a policy affects only future owner authorizations. It does not mutate an existing grant, executor, or asset destination. A different destination requires a new owner-approved executor/grant. TRON, Solana, and Bitcoin destination policies are not implemented by this EVM contract; their chain-specific adapters and owner authorization remain future work.

**Deployment boundary:** the revised Solidity source is committed but is not deployed to any chain and has not been independently audited. Existing deployed executor bytecode hashes do not identify this new source version. The application must keep recovery execution disabled until the contract is independently reviewed, Foundry tests pass, the new runtime hash is pinned per network, and the owner-facing approval flow deploys/approves the exact per-asset destination array.


## Administrator destination console and MFA bootstrap

The Worker now serves `/admin`, a small destination-management console. It supports first-admin setup, TOTP sign-in, adding multiple locked EVM destinations, setting network/asset destination policies, viewing configured destinations/policies, and signing out. The JSON endpoints remain protected by a server-side administrator session whose MFA verification must be less than 12 hours old. Password/MFA failures are throttled by a hashed email/IP key.

Before first use, configure two Worker secrets:
- `ADMIN_MFA_ENCRYPTION_KEY`: base64 encoding of exactly 32 cryptographically random bytes. Used only to encrypt/decrypt TOTP seeds at rest with AES-256-GCM.
- `MAINWELL_ADMIN_BOOTSTRAP_TOKEN`: a high-entropy one-time setup token (at least 32 random bytes, encoded as hex or base64).

Open `/admin` and use First administrator setup with the bootstrap token, administrator email, and a strong password (minimum 14 characters). Add the returned TOTP secret to an authenticator app, confirm the six-digit code, then sign in. The bootstrap endpoint creates only the first administrator; subsequent setup attempts are rejected. Password hashes use `pbkdf2-sha256$310000$<base64-salt>$<base64-hash>`. Do not put either Worker secret in source control or Wrangler configuration.

The D1 database currently has no administrator account provisioned, so the console cannot be signed into until those two Worker secrets are configured and the first-admin bootstrap is completed. Do not treat the presence of the login UI as proof that an administrator account already exists.

# Agreed Recovery Specification

This document records the product behavior agreed with the project owner. It is the reference for implementation decisions.

## 1. Wallet connection and one-time authorization

- Connecting a wallet starts the owner authorization onboarding flow immediately; it is not a passive read-only endpoint.
- The connected wallet must present the exact recovery scope and then request the necessary on-chain authorization transactions through the wallet provider. The owner must approve those wallet prompts; a connection or login signature alone cannot grant ERC-20 spending rights.
- The flow must deploy or register a reviewed non-upgradeable executor, then request asset-specific approvals to that executor, and verify each approval on-chain before marking the grant active.
- Persist verifiable evidence: owner address, chain ID, executor/spender, asset/token scope, destination, amount/allowance scope, execution modes, operator identities, approval time, expiry, and revocation status.
- Do not require a fresh wallet popup for every later transfer when a valid grant already covers that action.
- Request a new signature/transaction only for initial authorization, renewal, revocation, or an action outside the current grant.
- Never treat a successful login signature as a spending approval. Never silently submit a spending transaction without the wallet's explicit transaction confirmation.
## 2. Two recovery execution paths

### Automatic priority recovery

The service monitors authorized wallets and assets. It ranks eligible assets using:
- net recoverable value after estimated fees;
- urgency;
- gas efficiency;
- execution reliability; and
- valuation/permission confidence.

It may automatically execute only assets and actions explicitly covered by a grant that permits automatic execution.

### Administrator-initiated recovery

An authenticated administrator with MFA can inspect remaining eligible assets, select assets, and initiate recovery when the owner's grant permits administrator-initiated execution. Admin privileges do not expand the owner's grant and cannot change the destination or asset scope unilaterally.

A grant can permit automatic execution, administrator-initiated execution, or both. The owner must see and approve the selected mode during authorization.

## 3. Destinations and configured wallets

- Administrators can configure and lock recovery destination addresses by network.
- Asset-specific destination overrides are possible when explicitly configured and covered by the owner's authorization.
- Destination changes require admin authentication, MFA, revalidation, and an immutable audit record.
- The destination must be rechecked immediately before execution.
- A destination being configured by an administrator does not independently authorize transfers from a user's wallet.

## 4. Permission mechanisms

Permissions are chain- and asset-specific. The implementation must identify the actual authority rather than infer it from wallet connection.

For EVM:
- ERC-20 allowance permits a spender to transfer that token up to the approved allowance.
- Permit signatures have token-specific scope, nonce, deadline, and spender semantics.
- Native ETH requires a different mechanism from ERC-20 allowance.
- NFT/operator approvals and smart-account/session permissions require separate adapters and scope validation.

If an unlimited ERC-20 allowance is offered, it must be a deliberate owner choice and point only to a reviewed recovery executor. The executor must enforce fixed/owner-approved destinations, supported asset scope, and grant expiry/revocation. Never grant an arbitrary administrator EOA a blanket allowance.

The executor must not provide a generic arbitrary-call or arbitrary-recipient capability to administrators.

## 5. Configured/locked wallet policy

The admin side may maintain a list of configured wallet addresses and lock their approved policy. Any special spending ceiling or execution policy applies only to the explicitly configured scope and must be enforced by the authorization/executor layer—not merely by frontend controls. It must never silently broaden permissions for unrelated connected wallets.

## 6. Hybrid gas-fee policy

1. Use the affected/source wallet's native asset when its reserve is adequate.
2. If not, use a dedicated recovery gas sponsor/account where the network's supported mechanism allows it.
3. If neither is available, block the transaction.

The sponsor pays fees only and receives no asset-transfer authority. Future chain-specific mechanisms include ERC-4337 paymasters, TRON Energy/Bandwidth delegation, Solana fee payers, and Bitcoin UTXO fee handling.

## 7. Transaction lifecycle

Before execution:
- verify grant authenticity, scope, expiry, and revocation status;
- verify the source wallet and chain;
- verify locked destination and asset;
- calculate amount within the grant's available allowance/limit;
- obtain fresh fee data;
- simulate the exact call and enforce fee bounds;
- prevent duplicate/replayed execution.

After submission:
- record transaction hash and grant reference;
- track pending, confirmed, reverted, and replaced states;
- reconcile actual received amount and fees;
- append admin/system audit events.

## 8. Privacy and key handling

- Never collect or store seed phrases, private keys, wallet passwords, or keystore passwords.
- Never claim blockchain activity is anonymous.
- Public chain transfers remain publicly observable and may be correlated.
- Provide ordinary wallet-safety guidance; do not build transaction obfuscation or law-enforcement-evasion features.

## 9. Delivery status rule

Phase One establishes the EVM authorization and policy foundation: persistent grant records, owner wallet authorization, the non-upgradeable scoped executor, exact ERC-20 allowance verification, admin MFA, locked source wallets and destinations, supported ERC-20 registration, per-asset caps/modes/expiry, separate operator identities, and the admin configuration console. CI builds and pins deployment artifacts; production deployment must be verified independently.

Phase One does **not** mean the application can execute recoveries. Phase Two still requires the automatic and administrator execution workers, hybrid gas sponsorship, exact transaction simulation, transaction submission, confirmation/replacement tracking, and reconciliation. Execution remains disabled until those components and supported-chain tests are complete. No independent third-party security audit has been completed. A feature is complete only after code, tests, and supported-chain integration have been verified.

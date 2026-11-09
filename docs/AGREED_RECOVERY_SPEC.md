# Agreed Recovery Specification

This document records the product behavior agreed with the project owner. It is the reference for implementation decisions.

## 1. Wallet connection and one-time authorization

- Support common EVM wallets through standard wallet-provider interfaces.
- Connecting a wallet is read-only and must never be interpreted as transfer authorization.
- The owner reviews a clear authorization summary and grants the recovery tool the permissions supported by the chain and asset.
- Persist verifiable evidence: owner address, chain ID, executor/spender, asset/token scope, destination, amount/allowance scope, execution modes, approval time, expiry, and revocation status.
- Do not require a fresh wallet popup for every later transfer when a valid grant already covers that action.
- Request a new signature only for initial authorization, renewal, revocation, or an action outside the current grant.

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

The current code is not a complete or production-ready recovery application. Read-only EVM monitoring exists in an initial form. Authorization persistence, executor contract, admin UI/authentication/MFA, automated scheduling, admin execution workflow, simulation, gas sponsorship, transaction submission, receipt tracking, and non-EVM adapters remain implementation work. A feature is complete only after code, tests, and supported-chain integration have been verified.

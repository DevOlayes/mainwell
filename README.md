# Wallet Recovery — Defensive Foundation

A security-first wallet monitoring and recovery application. The product goal is to support one-time, clearly explained authorization followed by automated recovery and administrator-initiated recovery **only within the permissions the wallet owner granted**.

## Agreed recovery workflow

1. A wallet owner connects a supported wallet and reviews the exact recovery authority being requested.
2. The owner grants supported, persistent permissions through their wallet. The application records verifiable on-chain authorization evidence; merely connecting a wallet is never treated as permission.
3. The monitor discovers supported assets and permissions across configured networks.
4. The recovery planner ranks eligible assets by net recoverable value, urgency, fee efficiency, data confidence, and execution reliability.
5. Eligible priority assets may be processed automatically when a valid grant explicitly permits automatic execution.
6. Other eligible assets may be selected and initiated by an authenticated administrator when the grant explicitly permits administrator-initiated execution.
7. The application tracks submitted transactions through on-chain confirmation and records an audit trail.

A new wallet popup for every transfer is **not** the intended universal workflow. A fresh owner signature is needed only when the underlying chain or authorization standard requires it, when a grant must be renewed, or when the requested action falls outside the existing grant.

## Authorization and security boundaries

- Never request, accept, store, log, or transmit seed phrases, private keys, or wallet passwords.
- A wallet connection alone grants no transfer authority.
- Every grant must be verifiable and bound to the owner wallet, chain, approved recovery executor, locked destination, permitted assets, execution mode, amount/allowance scope, and expiry/revocation state.
- Automatic and administrator-initiated execution must both remain inside that same grant. Admin role does not create additional wallet authority.
- Admin-configured destinations are network-specific, locked, and audited. Asset-specific overrides require explicit policy and owner authorization.
- Any unlimited token allowance, if a chain/token requires it and the owner explicitly chooses it, must be to a reviewed recovery executor whose on-chain rules enforce the approved destination and asset scope. Never request blanket approvals to an arbitrary admin wallet or generic spender.
- Native assets and non-EVM chains require their own authorization mechanisms; ERC-20 allowance is not universal permission.
- Gas sponsorship pays fees only and never grants control over assets.
- No hidden transactions: authorization, transaction purpose, destination, asset, amount/scope, and status must be visible in the product and recorded on-chain where applicable.

## Current implementation status

The repository currently contains the domain model, policy checks, deterministic recovery planner, and a generic **read-only** EVM JSON-RPC adapter for native balances, configured ERC-20 balances, and configured spender allowance checks. The current planner is review-only. Persistent authorization storage, a reviewed on-chain recovery executor, admin authentication/MFA, UI, asset indexing/pricing, transaction simulation, execution adapters, and receipt tracking are **not yet implemented**. Do not treat this repository as ready to move real funds.

## Hybrid gas policy

1. Use the source wallet's native gas when its reserve is adequate.
2. Otherwise use a dedicated recovery gas sponsor only on a supported network.
3. Otherwise block execution.

The sponsor is fee payer only.

## Development

- Node.js 20+
- npm 10+

```sh
npm install
npm run check
npm test
npm run build
```

See [the agreed recovery specification](docs/AGREED_RECOVERY_SPEC.md), [architecture](docs/ARCHITECTURE.md), and [security model](docs/SECURITY.md).

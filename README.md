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

**Phase One authorization and policy foundation is implemented** in the repository and deployed to Cloudflare. It includes:

- EVM read-only monitoring and the recovery planning foundation across the seven configured EVM networks.
- Cloudflare D1 persistence for recovery grants, owner sessions, admin accounts/sessions, locked source wallets and destinations, supported ERC-20 assets, per-asset caps, execution modes, and expiry.
- Administrator authentication with MFA, rate limiting, and a one-time recovery path.
- Owner authorization flow that deploys the pinned, non-upgradeable `ScopedRecoveryExecutor`, requests exact per-token allowances, and submits evidence for independent server-side verification.
- Server-side checks for owner, chain, executor runtime code hash, asset scope, destination, amount cap, execution modes, expiry, operator identities, and allowance evidence.
- Separate automation and administrator operator identities, with client-side wallet generation and encrypted local backup.
- CI checks and reproducibly generated/pinned Worker and executor artifacts. Production deployment is performed separately and verified.
- An authenticated admin console for wallet, destination, asset, and policy configuration.

**Phase Two execution is not implemented or enabled.** The automatic-priority worker, administrator-initiated recovery execution, sponsor/gas handling, exact-call simulation, transaction submission, confirmation/replacement tracking, and execution reconciliation remain outstanding. The app must not be treated as ready to move real funds. The executor has not received an independent third-party security audit.

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


## Cloudflare deployment

Mainwell runs on Cloudflare Workers with Cloudflare D1 as its primary relational database. The production D1 database is bound as `DB`; schema changes live in `migrations/`. See [Cloudflare D1 deployment notes](docs/CLOUDFLARE_D1.md).

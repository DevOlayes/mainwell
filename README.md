# Mainwell — Defensive Wallet Monitoring and Recovery

Mainwell is a security-first EVM wallet monitoring and scoped recovery application. Recovery is permitted only within explicit, verifiable permissions granted by the wallet owner.

## Agreed recovery workflow

1. The owner connects a supported wallet. Connection and login signatures are not spending permission.
2. The owner reviews and authorizes a scoped recovery grant through their wallet.
3. Mainwell verifies the grant against the owner, chain, immutable executor, locked destination, asset scope, cap, execution mode, expiry and revocation state.
4. Monitoring discovers supported ERC-20 assets and retrieves balances, metadata and fresh price information.
5. The planner ranks eligible work by recoverable value, urgency, fee efficiency, confidence and execution reliability.
6. Admin-initiated or automatic-priority execution may proceed only when the persistent runtime switch and the owner's grant both permit it.
7. Transactions are simulated, signed by the appropriate configured operator, submitted, reconciled and checked for canonical confirmation and destination-balance postconditions.

## Security boundaries

- Never request, accept, store, log or transmit wallet seed phrases, private keys or wallet passwords.
- A wallet connection or authentication signature never authorizes spending.
- The immutable, non-upgradeable ScopedRecoveryExecutor enforces owner-granted scope.
- Admin role does not expand owner-granted authority.
- Source wallets and recovery destinations are explicitly registered and locked.
- ERC-20 allowances and per-asset caps are scoped; the executable amount cannot exceed balance, remaining cap or allowance.
- Admin and automation operators are separate.
- Gas sponsorship pays fees only and does not grant asset authority.
- Native assets, NFTs and non-EVM chains require separate authorization and executor designs; they are not supported by the current ERC-20 executor.
- No third-party security audit or guaranteed recovery claim is made.

## Implemented capabilities

### Phase One — authorization and policy foundation
- EVM owner wallet authentication and persistent sessions.
- Locked source-wallet and destination registration.
- Supported ERC-20 registry and token metadata verification.
- Per-asset caps, execution modes and expiry.
- Owner deployment and authorization of the immutable ScopedRecoveryExecutor.
- Exact per-token allowance setup and independent server-side verification.
- Separate administrator and automation operator identities.
- MFA-protected admin authentication, rate limiting and one-time recovery.
- Admin console for wallet, destination, asset and policy configuration.

### Phase Two — recovery execution
- Automatic-priority and administrator-initiated recovery orchestration.
- Grant, owner, chain, executor code hash, operator, destination, expiry, cap and allowance revalidation.
- Transaction simulation, gas estimation, EIP-1559 and legacy fee handling.
- Operator signing, transaction hash persistence and broadcast reconciliation.
- Receipt, canonical block hash, finality, executor-event and destination-balance verification.
- Execution locks, queue prioritization, retry/cancel safeguards and audit events.
- Automatic-path fee/value/gas safeguards and emergency admin fee-policy bypass subject to available gas and live fee estimates.

### Phase Three — monitoring
- Alchemy-based ERC-20 discovery, balance and metadata retrieval across seven EVM networks.
- Fresh token price retrieval and asset-history recording.
- Scheduled monitoring every minute, processing one due wallet per invocation.
- Manual owner refresh using the same monitoring path.
- Discovered assets are not automatically whitelisted or authorized.
- Spender-permission monitoring is limited to known spenders configured through MAINWELL_EVM_ASSETS; that configuration is currently deferred.

### Phase Four — security hardening
- Atomic wallet-authentication and admin endpoint rate limiting.
- Admin idle and absolute session expiry.
- Executor whole-grant and per-asset revocation checks.
- Blocking of retry/cancel while transaction outcome is unresolved.
- Query-string redaction in Worker observability.
- D1 backup and restore runbook and production recovery-point tracking.

## Production configuration and readiness

The recovery engine and monitoring service are deployed. Production D1 currently reports:
- automation_enabled = true
- execution_enabled = true
- One source-wallet network registered (Ethereum).
- No verified owner recovery grants, recovery jobs or recovery transactions recorded.
- The registered source wallet is not yet admin-locked.
- The seven network RPC bindings and seven locked destination records are present.
- MAINWELL_EVM_ASSETS is not configured, so allowance monitoring has no configured spender set.

The global switches only permit the relevant workflow to run; they do not create owner grants, deploy executors, approve tokens, lock source wallets, or fund operators. No transfer is possible without the full chain-specific owner authorization and execution prerequisites. The current production state is therefore configured but not recovery-ready.

The supported EVM networks are Ethereum, Polygon, BNB Smart Chain, Avalanche, Arbitrum, Optimism and Base. Native-coin recovery, NFT recovery, Bitcoin, TRON and other non-EVM networks are not implemented.

The automatic path currently applies a $500 USD absolute fee ceiling, a 5% fee-to-recovery-value ceiling, a $20 USD per-network operator reserve, fee buffers and fresh-price requirements. Emergency administrator-initiated recovery bypasses those automatic economic ceilings but still requires sufficient operator funds and a valid live fee estimate. It does not bypass on-chain owner permissions or executor caps.

## Backup and restore

D1 backups do not include Worker code, bindings, secrets or operator private keys. Keep those recovery materials separately protected. The production SQL export was generated and the operator has confirmed downloading it. A disposable-database restore rehearsal has not yet been completed. Never test restore against the live production database.

## Development

- Node.js 20+
- npm 10+

```sh
npm install
npm run check
npm test
npm run build
```

See [the agreed recovery specification](docs/AGREED_RECOVERY_SPEC.md), [architecture](docs/ARCHITECTURE.md), [security model](docs/SECURITY.md), [Phase Four hardening](docs/PHASE_FOUR_SECURITY_HARDENING.md), and [D1 backup/restore runbook](docs/D1_BACKUP_RESTORE_RUNBOOK.md).

## Cloudflare deployment

Mainwell runs on Cloudflare Workers with Cloudflare D1 as its primary relational database. The production D1 database is bound as DB; schema changes live in migrations/. Deployment must be verified separately from CI.

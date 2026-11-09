# Wallet Recovery — Defensive Foundation

A security-first foundation for monitoring wallets and preparing owner-authorized recovery plans. This repository is **not** a wallet drainer.

## Safety boundary

- Never request, accept, store, log, or transmit a seed phrase or private key.
- Wallet discovery is read-only. The adapter contract exposes balances, assets, and permissions only.
- Recovery plans are proposals. This release has no transaction signer or broadcaster.
- Every asset must be explicitly included in an owner authorization.
- Recovery destinations are admin-configured, locked by policy, and audited by the future persistence layer.
- A gas sponsor pays fees only; it never receives transfer authority.
- No automatic sweeping, hidden transfers, unlimited wallet permissions, or silent execution.

## Current implementation status

This commit establishes the domain model, policy validation, read-only adapter boundary, deterministic recovery planner, documentation, and unit tests. It does **not** include live RPC adapters, a user interface, a database, authentication, an admin dashboard, or transaction execution. Network names in the catalog are design targets, not a claim that live integrations are complete.

## Requirements

- Node.js 20+
- npm 10+

## Commands

```sh
npm install
npm run check
npm test
npm run build
```

## Project map

- `src/domain`: shared types and network catalog
- `src/adapters`: read-only integration contracts
- `src/policy`: locked destination and authorization policy
- `src/planner`: fee-aware asset prioritization and gas strategy
- `src/application`: read-only wallet monitoring and plan creation
- `docs`: architecture, security, supported-network and developer notes
- `tests`: planner and policy tests

## Important

Do not paste wallet secrets into issues, logs, configuration, environment variables, or ChatGPT. Use a clean device and hardware-backed wallet where appropriate. A public address is not a signing credential.

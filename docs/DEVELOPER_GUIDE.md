# Developer Guide

## Local setup

```sh
npm install
npm run check
npm test
```

## Adding a read-only adapter

1. Implement `ReadOnlyWalletAdapter` for exactly one network.
2. Validate address/network pairing with a maintained chain-specific library.
3. Fetch native balance, token positions, and permission metadata without signing access.
4. Attach source, observation time, and confidence to valuation and fee data.
5. Add fixture tests for empty wallets, malformed responses, stale data, RPC failure, and rate limits.
6. Register the adapter only after tests pass.

## Authorization and execution

Use `RecoveryAuthorizationGrant` as the domain contract for persistent permissions. Structural validation is not proof of authorization: before execution, the chain adapter must verify the grant evidence, chain ID, live allowance/session, executor bytecode hash, destination, expiry, and revocation state against trusted chain data.

Automatic-priority and admin-initiated execution are separate grant modes. A background worker may only process the former. The admin service may only initiate the latter. Both must call the same scope-enforcing executor. Admin privileges must never bypass the grant.

Do not add a backend private-key signer or generic arbitrary-call executor. For EVM, any unlimited allowance must be a deliberate owner choice directed to a reviewed executor contract that enforces the fixed destination and approved assets on-chain.

## Policy changes

Destination changes belong behind an authenticated admin service. Require MFA, validate network-specific addresses, persist the change, and append an audit event. A frontend lock is not an enforcement boundary. A destination update cannot silently rewrite an existing owner grant.

## Operations

- Review and pin dependency updates.
- Keep credentials in the deployment secret manager, never in Git.
- Never store private keys or seed phrases.
- Do not describe catalog-only networks as integrated.
- Do not enable execution until the executor, simulation, receipt tracking, and production security gate are complete.

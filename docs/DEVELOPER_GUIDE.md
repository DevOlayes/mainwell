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

## Policy changes

Destination changes belong behind an authenticated admin service. Require MFA, validate network-specific addresses, persist the change, and append an audit event. A frontend lock is not an enforcement boundary.

## Recovery planning

The planner is deterministic and side-effect free. It creates review plans only. Keep transaction execution in a separate module until an independent security review approves a narrowly scoped design.

## Operations

- Review and pin dependency updates.
- Keep credentials in the deployment secret manager, never in Git.
- Never store private keys or seed phrases.
- Do not describe catalog-only networks as integrated.

# Architecture

## Target data flow

1. The owner connects a supported wallet. Connection is read-only and grants no transfer authority.
2. Network adapters discover balances, assets, and current permissions.
3. The owner reviews a consolidated authorization setup and approves persistent permissions supported by each chain/asset.
4. The authorization registry stores verifiable evidence bound to the owner, network, reviewed executor, locked destination, asset scope, amount/allowance scope, execution modes, expiry, and revocation state.
5. Monitoring and indexing discover existing and incoming authorized assets.
6. The planner ranks eligible assets by net value after fees, urgency, gas efficiency, execution reliability, and confidence.
7. Assets covered by an automatic-priority grant may enter the automated execution queue.
8. Other assets covered by an admin-initiated grant appear in the authenticated admin dashboard for selection and initiation.
9. Both paths use the same grant validation and reviewed executor. Admin role never expands owner-granted authority.
10. Transaction simulation, submission, receipt tracking, and audit records complete the lifecycle.

A fresh owner wallet popup is not required for every transfer if a valid persistent grant already covers the transfer. A new owner authorization is required for initial grants, renewal, revocation, or out-of-scope actions.

## Boundaries

- Read-only adapters: balances, assets, and permission metadata.
- Authorization registry: verifiable grants, explicit execution modes, scope, expiry, and revocation.
- Destination policy: network-specific locked destinations and optional asset overrides.
- Planner: fee-aware ranking and hybrid gas source decision.
- Automatic worker: only processes grants that explicitly permit automatic-priority execution.
- Admin service: only initiates transfers within grants that explicitly permit admin-initiated execution.
- Executor: reviewed chain-specific contract/adapter enforces approved destination and asset scope.
- Audit and receipt services: durable event trail and on-chain status reconciliation.

## Ranking

Eligible assets are ranked by net recoverable value after estimated fees, then urgency and confidence. Unsupported permissions, missing/stale data, invalid destinations, insufficient gas, revoked/expired grants, or fee bounds violations block execution.

## Hybrid gas policy

1. Prefer native gas from the affected wallet only when the configured reserve is satisfied.
2. Otherwise use a dedicated sponsor only when the network integration supports it.
3. Otherwise block the item.

A sponsor funds fees only; it never receives transfer authority. Future network-specific approaches include ERC-4337 paymasters where compatible, TRON Energy/Bandwidth delegation, Solana fee payers, and Bitcoin UTXO fee selection.

## Current implementation status

The Phase One foundation is implemented: read-only EVM monitoring and planning; persistent D1 grant and policy records; administrator authentication with MFA; locked source-wallet and destination management; supported ERC-20 registry; per-asset caps, execution modes, and expiry; the non-upgradeable scoped executor; owner deployment and exact token-allowance authorization; independent server-side verification of grant evidence; and the authenticated administration console. CI generates and pins the Worker and executor artifacts, while production deployment is a separate verified step.

Phase Two is still outstanding: automatic-priority execution worker, administrator-initiated execution flow, hybrid gas sponsorship, exact transaction simulation, submission, receipt and replacement tracking, and execution reconciliation. `RECOVERY_EXECUTION_ENABLED` remains false. Do not attempt real asset transfers. The executor has not received an independent third-party security audit.

# Architecture

## Data flow

1. The user supplies a public wallet address and selects a network.
2. A network-specific read-only adapter discovers native balances, assets, and permission records.
3. Findings and data uncertainty are shown to the owner.
4. The owner confirms the exact assets, network, and destination in a time-limited authorization.
5. The planner validates that authorization, applies the admin-locked destination policy, checks fee and gas conditions, and ranks eligible assets.
6. The application presents a review-only plan. This version cannot sign or broadcast transactions.

## Boundaries

- Read-only adapters: balances, assets, and permission metadata only.
- Policy: locked network destination plus optional asset-specific overrides.
- Authorization: exact wallet, network, asset IDs, destination, confirmation reference, and expiry.
- Planner: net value after fees, fee guard, gas-source decision, urgency and confidence ranking.
- Future execution: intentionally absent in this release.

## Ranking

Eligible assets are ranked by net recoverable value after estimated fees, then urgency and data confidence. Non-authorized assets are blocked. Missing, stale, low-confidence, or over-limit fee quotes and unavailable gas funding block an item.

## Hybrid gas policy

1. Prefer native gas from the affected wallet only when the configured reserve is satisfied.
2. Otherwise use a dedicated sponsor only when the network integration supports it.
3. Otherwise block the item.

A sponsor funds fees only; it never receives transfer authority. Future network-specific approaches include ERC-4337 paymasters where compatible, TRON Energy/Bandwidth delegation, Solana fee payers, and Bitcoin UTXO fee selection.

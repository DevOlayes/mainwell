# Architecture

## Target data flow

1. The owner connects a supported EVM wallet. Connection is read-only and grants no transfer authority.
2. Network adapters discover ERC-20 balances, metadata and configured permission information.
3. The owner reviews and authorizes a persistent, scoped grant through their wallet.
4. The authorization registry stores evidence bound to owner, network, immutable executor, locked destination, asset scope, amount cap, execution modes, expiry and revocation state.
5. Monitoring records supported assets, balances, metadata and fresh price information.
6. The planner ranks eligible assets by net value after fees, urgency, fee efficiency, confidence and execution reliability.
7. Eligible assets may enter the automatic-priority queue only when the owner grant and persistent automation switch both permit it.
8. Assets covered by an admin-initiated grant may be selected in the authenticated admin dashboard only when the persistent execution switch permits it.
9. Both execution paths use the same grant verifier and immutable scoped executor. Admin role never expands owner authority.
10. Simulation, signing, submission, receipt reconciliation, destination postcondition checks and audit records complete the transaction lifecycle.

A fresh owner signature is not required for every transfer when a valid persistent grant covers it. A new owner authorization is required for initial grants, renewal, revocation or out-of-scope actions.

## Security boundaries

- Read-only monitoring adapters retrieve balances, ERC-20 metadata and supported permission information.
- Authorization registry stores verifiable grants, execution modes, caps, expiry and revocation state.
- Destination policy stores network-specific locked destinations.
- Planner ranks eligible work and checks fee and gas policy.
- Automatic worker processes only grants permitting automatic-priority execution and only when automation_enabled is true.
- Admin service initiates only grants permitting admin execution and only when execution_enabled is true.
- The immutable executor enforces owner-approved token scope, destinations, caps, operators, expiry and revocation.
- Audit and receipt services record transaction lifecycle and reconcile uncertain outcomes.

## Execution and gas

The automation and administrator operators are distinct. The configured operator signs the transaction and sponsors its gas. The current implementation does not use source-wallet-funded EOA gas because an operator-signed EOA transaction cannot spend the source EOA's native balance without its signature. Smart-account/account-abstraction paymaster flows are not implemented.

Automatic execution retains its fee ceiling, fee-to-value ratio, operator reserve, buffer, gas ceiling and fresh valuation requirements. Emergency admin-initiated execution bypasses the automatic economic ceilings but remains limited by available operator funds, live fee estimates and all on-chain owner authorization constraints.

## Monitoring scope

Alchemy-based ERC-20 discovery, balances, metadata and prices are implemented across Ethereum, Polygon, BNB Smart Chain, Avalanche, Arbitrum, Optimism and Base. The scheduled monitor processes one due wallet per invocation. Discovered tokens are not automatically whitelisted or authorized.

Permission monitoring checks configured known spenders only. MAINWELL_EVM_ASSETS is currently absent from production Worker bindings, so there is no configured spender set and allowance coverage is not operational.

## Current implementation status

Phases One through Four have implementation in the repository and production deployment. The deployed recovery engine includes owner/grant validation, simulation, gas estimation, operator signing, transaction submission, reconciliation, confirmation checks, automatic-priority planning and administrator-initiated job management. Monitoring includes ERC-20 discovery, balances, metadata, fresh prices and scheduled scans.

Production D1 currently reports automation_enabled=true and execution_enabled=true. These switches are only global gates; they do not supply owner grants or chain-specific permissions. The live database snapshot has one registered source wallet on Ethereum, no verified recovery grants, no recovery jobs or transactions, and that source wallet is not admin-locked. Seven network RPC bindings and seven locked destination records exist, but they do not establish end-to-end recovery readiness. Operator key/address matches, per-chain executor deployments and live gas funding still require verification.

## Explicitly unsupported scope

The current executor and recovery engine are ERC-20/EVM scoped. Native-coin recovery, NFT recovery, Bitcoin, TRON and other non-EVM recovery are not implemented. They require separate asset-specific authorization, executor/transaction semantics, fee handling, monitoring, simulation and tests. Do not present these as available merely because a network's native coin is used for gas.

## Assurance limits

CI, internal tests and production configuration checks are not an independent security audit. Recovery is not guaranteed: attacker races, chain congestion, RPC failures, insufficient gas, token behavior and other chain conditions can prevent or delay execution.

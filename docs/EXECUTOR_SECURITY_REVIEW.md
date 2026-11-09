# Scoped Recovery Executor — Internal Security Review

**Status:** Internal implementation review completed; independent third-party audit not completed. Mainnet authorization remains fail-closed until the independent review gate is approved.

## Reviewed implementation

- contracts/src/ScopedRecoveryExecutor.sol is a non-upgradeable ERC-20 recovery executor.
- The owner deploys the executor; the constructor fixes the owner, per-token destinations, per-token cumulative caps, expiry, execution modes and distinct automation/admin operator identities.
- Each execution entry point is role-gated. Automatic execution cannot use the admin entry point and admin execution cannot use the automation entry point.
- Transfers use transferFrom(owner, immutableDestination, amount), with a cumulative cap check and a reentrancy guard.
- Owner revocation is available for the whole grant or an individual token.
- The constructor rejects token addresses without deployed contract code.
- The browser workflow requests the deployment and each exact ERC-20 allowance as separate explicit wallet transactions. It never requests a seed phrase or private key.
- The server verifier checks chain ID, deployment receipt sender and contract address, normalized runtime bytecode hash, executor owner, expiry, revocation state, operators, execution modes, exact asset order, per-asset destinations, caps and live allowances.
- The grant API compares every requested asset, token, cap, destination, mode and expiry against the latest administrator-locked database policy before chain verification and persistence.

## Security properties enforced

1. No owner grant can be created for a source wallet that is not registered and admin-locked on the exact network.
2. A grant cannot authorize a token or destination outside the administrator's current policy.
3. A database policy update cannot redirect an already deployed executor; its destinations and caps are constructor-bound.
4. The owner must explicitly approve the deployment transaction and exact token allowances in their wallet.
5. The server persists only after independently verifying the deployed contract and live allowance state.
6. The trusted runtime hash is computed from the reproducible Foundry runtime template with constructor-patched immutable slots normalized. The immutable operator addresses are independently read and checked against configured service identities.
7. Recovery caps are bounded to uint256 and are cumulative per token.

## Scope and limitations

- The executor currently supports ERC-20 tokens only. Native coin recovery is not supported by this contract.
- Execution mode is a grant-level setting. The owner interface permits a batch only when all selected assets share at least one execution mode; it uses the intersection, never the union, of the asset policies.
- The application has no configured production operator signing service in this code change. Operator addresses alone are not signing keys and do not submit transactions.
- Hybrid gas sponsorship, automatic recovery scheduling, administrator execution orchestration and transaction lifecycle monitoring belong to later implementation work.
- This review is not an independent audit, formal verification, bug bounty or guarantee against malicious/non-standard token contracts, compromised RPCs, compromised operators, wallet-provider compromise or chain-specific behavior.

## Deployment gate

The owner authorization page requires the internal code review and explicit owner acknowledgement that the contract has not received an independent third-party audit. An independent audit is strongly recommended before high-value use. Do not configure or enable recovery operators until their signing infrastructure, access controls, key rotation and gas funding arrangements have been reviewed.

## Reproducible build

Foundry configuration pins Solidity 0.8.24 with optimizer enabled and 200 runs. CI runs TypeScript checks, application tests, Foundry tests and publishes the compiled executor artifact with its source commit.
# EVM scoped recovery executor: design review

## Status

**Source implementation and Foundry tests added. Not audited. Not deployed. Not enabled for production transfers.**

The contract is the first EVM execution primitive for Mainwell. It is deliberately narrow: it can call only ERC-20 `transferFrom(owner, immutableDestination, amount)` for constructor-allowlisted token contracts, subject to a per-token cumulative cap and grant expiry/revocation.

## Enforced on-chain invariants

- The owner is the account that deploys the executor.
- The destination is immutable and cannot be changed by an administrator or caller.
- The asset allowlist and raw-unit limits are set in the constructor.
- A token can be recovered only if it is allowlisted and has remaining cap.
- The owner must separately grant the executor ERC-20 allowance for each selected token.
- The live ERC-20 allowance is an additional limit; the executor cannot transfer more than the token permits.
- Any caller may pay gas and invoke recovery, but cannot choose the recipient, token scope, or amount above the remaining configured cap.
- The owner can revoke the whole grant or permanently revoke an individual token.
- Expired and revoked grants cannot execute.
- There is no arbitrary-call function, administrator withdrawal function, proxy, upgrade path, or server-held signing key.

## Deliberate limitations

- ERC-20 tokens only. Native ETH, NFTs, fee-on-transfer tokens, rebasing tokens, and non-EVM networks are not supported by this contract.
- Each grant has one immutable destination. A different destination requires a new owner-deployed executor and new owner approvals.
- Unlimited scope is represented by a maximum uint256 cap. The owner-facing authorization UI must explain this explicitly before deployment and require a deliberate acknowledgement. The token's allowance remains independently revocable.
- The contract is not a substitute for checking the exact runtime bytecode hash, chain ID, token allowance, expiry, revocation state, destination, and owner grant before scheduling work.
- A public caller can trigger only the owner-approved transfer to the fixed destination. This supports fee sponsorship without giving a sponsor asset-transfer authority.
- Some non-standard ERC-20 implementations may behave unexpectedly. Token compatibility must be reviewed and tested individually.

## Required before production

1. Independent Solidity security audit and remediation of all findings.
2. Reproducible compiler/build settings and verified source on each supported EVM chain.
3. Deployment ceremony that records chain ID, executor address, runtime code hash, owner, destination, expiry, asset list, caps, and approval transactions.
4. Owner UI that displays the destination, each asset, exact cap or unlimited choice, executor address, expiry, revocation method, and the fact that public callers can trigger only the constrained transfer.
5. Runtime grant verifier that reads the deployed contract state and token allowances immediately before simulation and execution.
6. Fork tests against representative supported EVM networks and token implementations.
7. End-to-end simulation, fee policy, transaction submission, confirmation tracking, and audit-log tests.
8. Explicit production enablement only after the above gates pass.

## Test coverage

`contracts/test/ScopedRecoveryExecutor.t.sol` covers fixed destination, cumulative caps, asset allowlisting, expiry, whole-grant revocation, per-asset revocation, owner-only revocation, and allowance failure. Run with `forge test`.

These tests are necessary but do not constitute an external audit or a guarantee of safety.

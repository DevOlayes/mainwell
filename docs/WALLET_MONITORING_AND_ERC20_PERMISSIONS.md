# Mainwell wallet monitoring and ERC-20 permission model

## Connection and monitoring

A successful wallet login proves control of an EOA address. The same EOA address is valid across EVM networks, so the owner workspace registers that address for read-only monitoring on Ethereum, Polygon, BNB Smart Chain, Avalanche, Arbitrum, Optimism and Base. Each network is registered with its own chain ID and refreshed through that network's configured RPC and Alchemy endpoint.

A wallet connection or `personal_sign` login message is not a token spending authorization. Smart-account wallets whose account address differs by chain, and EIP-1271 contract-signature wallets, require a separate identity-verification design; this flow is for EOA addresses.

## Asset discovery coverage

Mainwell records the native coin balance and ERC-20 balances returned by Alchemy's Token API, then reads ERC-20 metadata from the token contract. This is an indexed discovery mechanism, not a mathematical guarantee that every token contract on a network can be enumerated. A token absent from the indexer's returned wallet history may not appear until discovered through another trusted source. Spam tokens and unverified contracts must not become automatically recoverable merely because they are detected.

Native coins are displayed for monitoring and gas context. The current recovery executor transfers ERC-20 tokens only; native coin recovery is not supported.

## ERC-20 spending authorization

The ERC-20 allowance is keyed by token, owner and spender. For Mainwell, the spender is the exact immutable recovery executor deployed by the owner on that network. It is not the website, administrator EOA or automation operator EOA.

For each selected supported token, the owner authorization flow:

1. Reviews the network, token contract, locked destination, maximum token amount, execution modes and expiry.
2. Deploys the immutable executor with those exact token/destination/cap settings and the separate administrator and automation operator identities.
3. Reads the token's existing `allowance(owner, executor)`.
4. If a non-zero allowance already exists, resets it to zero before setting the new exact cap, following the ERC-20 allowance update safety guidance.
5. Calls `approve(executor, exactCap)` and waits for the transaction receipt.
6. Asks the server to independently verify the deployed executor bytecode, owner, immutable token scope, destination, cap, execution modes, operators and live token allowance before recording the grant.

The executor's on-chain cap is cumulative and independently enforced. The recovery worker rechecks live balance, remaining cap, allowance, grant expiry, revocation, locked destination, code hash and execution mode before submitting a transfer.

## Permit support

EIP-2612 permits can set an ERC-20 allowance by an EIP-712 signature without an owner-sent approval transaction, but only tokens that implement the standard support it. Permit signatures are chain/domain/nonce/deadline-specific and can be front-run or withheld. They are not a universal replacement for `approve`.

Mainwell currently uses the broadly compatible explicit `approve` path. Do not silently substitute unlimited approvals or accept a permit as broader intent than its exact signed value and domain.

## Allowance visibility

The monitoring service reads `allowance(owner, spender)` for configured spender addresses and Mainwell executor addresses recorded in grants. It persists observed values and status in `wallet_permissions` and records changes in `wallet_permission_history`.

Mainwell cannot infer every arbitrary third-party spender allowance for every token from an ERC-20 wallet balance index. A zero or missing Mainwell executor allowance is not proof that no other contract has permission. External spender monitoring requires an explicit trusted spender configuration.

After a grant is verified, Mainwell immediately refreshes the wallet inventory so the new executor's allowance can be recorded. If the indexer or RPC is temporarily unavailable, the grant verification remains authoritative and scheduled monitoring retries.

## Admin inventory and manual recovery

The admin wallet inventory combines monitored balances, token registry status, locked source-wallet status, destination policy, verified owner grant, approved execution modes and observed Mainwell executor allowance.

The Recovery Operations queue remains limited to verified, unexpired owner grants that include administrator-initiated execution for the selected asset. A detected token without a supported-token record, locked policy, owner-approved grant or sufficient live allowance is visible but is not transferable.

The administrator can queue a recovery only within the owner's on-chain cap and current allowance. The execution and automation runtime switches remain OFF until an administrator explicitly enables them. No wallet connection automatically signs or submits a recovery transaction.

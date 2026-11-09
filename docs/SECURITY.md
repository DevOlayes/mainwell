# Security Model

## Non-negotiable controls

- Never ask for or handle seed phrases, private keys, keystore passwords, or wallet passwords.
- Wallet connection immediately begins the owner-approved authorization workflow; the app must clearly display scope and obtain explicit wallet-provider transaction approval for the executor and each selected asset.
- A login signature alone is not spending authority. A persistent authorization must be verifiable and bound to the owner wallet, chain, reviewed executor, destination, assets, amount/allowance scope, execution modes, operator identities, expiry, and revocation state.
- A persistent authorization must be verifiable and bound to the owner wallet, chain, reviewed executor, destination, assets, amount/allowance scope, execution modes, expiry, and revocation state.
- Automatic and administrator-initiated transfers are separate modes explicitly included in the owner's grant.
- Admin role, configured wallet lists, and dashboard controls never create or expand transfer authority.
- Admin-configured recovery destinations are network-specific, locked, and audited. Asset overrides must also be covered by the owner's grant.
- Any unlimited token allowance must be an explicit owner choice and may only target a reviewed executor whose on-chain code enforces the approved destination and asset scope. Never request blanket allowances to an arbitrary administrator wallet or generic spender.
- Native assets, NFTs, and non-EVM chains require their own authorization mechanisms; ERC-20 allowance is not universal permission.
- A gas sponsor is a fee payer, not a transfer authority.
- All authorization and transaction activity must be transparent to the owner and recorded in the audit trail. "No fresh popup for every transfer" does not mean invisible or unlogged execution.

## Threat considerations

A malicious website may obtain authority through a signed transaction, token allowance, permit, session key, or leaked signing secret. Merely connecting a wallet does not itself grant token-transfer authority. Permission inspection must report spender, asset, scope, observed time, risk, and revocability. Revocation must be supported where the underlying authorization standard permits it.

## Wallet privacy

Do not expose recovery destinations in public pages, analytics, or unnecessary logs. Do not promise anonymity: public-chain activity can be correlated. Provide wallet safety and separation guidance, not transaction obfuscation or evasion features.

## Production gate

Before execution is enabled, require:
- independent review of the executor contract and admin services;
- on-chain verification of executor bytecode and authorization evidence;
- destination and scope enforcement in the executor, not just frontend/backend code;
- exact transaction simulation and bounded fee policy;
- replay/nonce protection and revalidation immediately before submission;
- durable audit logs, monitoring, incident response, and revocation;
- testnet plus controlled mainnet testing.

The authorization and policy foundation is deployed, but the application is not production-ready for asset movement: transaction execution remains disabled. Before enabling execution, complete the production gates above and obtain an independent third-party review of the executor and admin services.

# Security Model

## Non-negotiable controls

- Never ask for or handle seed phrases, private keys, keystore passwords, or wallet passwords.
- Do not persist secrets. This project contains no secret-handling code.
- Wallet discovery uses public addresses and read-only RPC/indexer adapters.
- No automatic sweeping or silent transfers.
- Only owner-authorized asset IDs may be eligible in a plan.
- Authorization is bound to wallet, network, asset list, destination, confirmation reference, and expiry.
- Recovery destinations are admin-configured and locked; asset overrides are explicit.
- Production destination changes require authenticated admin role, MFA, persistence, and immutable audit logging.
- A gas sponsor is a fee payer, not a transfer authority.
- Transaction execution is disabled in this release.

## Threat considerations

A malicious website may obtain authority through a signed transaction, token allowance, permit, session key, or leaked signing secret. Merely connecting a wallet does not itself grant token-transfer authority. Permission inspection must report spender, asset, scope, observed time, risk, and revocability. Revocation must be a separate owner-approved action with a clear network fee preview.

## Wallet privacy

Do not expose recovery destinations in public pages, analytics, or unnecessary logs. Avoid automatically creating public transaction links between wallets. Do not promise anonymity: public-chain activity can be correlated.

## Production gate

Before any transaction feature is enabled, require independent security review, chain-specific simulation, explicit confirmation of each transaction, replay protection, destination revalidation, bounded fee policy, monitoring, incident response, and testnet plus controlled mainnet testing.

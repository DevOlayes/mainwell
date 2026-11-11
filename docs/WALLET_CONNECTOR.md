# Mainwell Wallet Connector

## Purpose

Mainwell provides its own wallet-selection interface without requiring a Reown account, WalletConnect Cloud project ID, third-party modal service, or new wallet-connection subscription.

The connector is intentionally compatible with the existing vanilla-JavaScript owner workspace and keeps the current authentication flow.

## Desktop browser behavior

1. Listen for EIP-6963 `eip6963:announceProvider` events.
2. Request provider announcements only when the user opens the wallet picker.
3. Display each discovered EIP-1193 provider as a separate wallet choice.
4. Use the selected provider for `eth_requestAccounts`, `eth_chainId`, and the existing Mainwell sign-in challenge.
5. If EIP-6963 is unavailable, inspect the legacy injected `window.ethereum` provider (including its `providers` array) as a compatibility fallback.
6. If no provider is injected, show official wallet download destinations rather than pretending a wallet is already connected.

This supports compatible extensions such as MetaMask, Trust Wallet, Coinbase/Base Wallet, Rabby, Rainbow, and Brave Wallet when those wallets inject an EVM provider. EIP-6963 metadata is treated as untrusted display text; provider icons are not loaded.

## Mobile browser behavior

Mobile browsers do not expose a standard API for enumerating every installed wallet application. Mainwell therefore does not claim to detect all installed mobile wallets.

The picker offers:

- **MetaMask:** opens Mainwell using MetaMask's documented `https://link.metamask.io/dapp/` universal link.
- **Trust Wallet:** opens Mainwell using Trust Wallet's documented `https://link.trustwallet.com/open_url` route.
- **Base app (formerly Coinbase Wallet), Rainbow, and Rabby:** offers a copy-link action and clear instructions to open Mainwell in the wallet's own DApp/Web3 browser.
- **Other EVM wallets:** the same copy-link route for a compatible wallet's built-in DApp browser.

When a wallet opens Mainwell inside its own browser, its injected provider is discovered by the same EIP-6963 / EIP-1193 flow used on desktop.

A wallet-specific universal link opens the wallet's in-app browser; it does not guarantee that the original Chrome/Safari tab receives a live provider session. This initial connector does not implement WalletConnect relay sessions or QR pairing. Those require a separate transport integration and, for common WalletConnect v2 implementations, a project ID/relay service.

## Authentication and safety invariants

The connector must preserve all of the following:

- Never request or accept a seed phrase or private key.
- Wallet connection only requests account access.
- Sign-in uses the existing one-time, origin-bound, expiring `personal_sign` challenge.
- Sign-in does not submit a blockchain transaction.
- Wallet connection does not create token allowances, recovery grants, or recovery jobs.
- Only the seven existing supported EVM chain IDs are accepted: Ethereum (1), Polygon (137), BNB Smart Chain (56), Avalanche (43114), Arbitrum (42161), Optimism (10), and Base (8453).
- No change to recovery execution or automation switches.

Provider names are rendered with `textContent`; wallet-supplied icon URLs are not rendered. The current page CSP remains self-contained and does not add third-party script, image, or connection origins.

## Verification status

- GitHub TypeScript check and application tests passed for the initial connector commit.
- Foundry contract tests/build and Cloudflare Worker dry-run passed for that commit.
- The expanded mobile choice list is a subsequent commit and requires its own CI run.
- Real-device verification remains necessary on Android Chrome, Android Brave, iOS Safari, and the in-app browsers of the selected wallet apps.
- No live wallet authorization or recovery transaction has been performed as part of this change.

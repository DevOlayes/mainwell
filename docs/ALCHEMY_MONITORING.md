# Alchemy wallet monitoring

Mainwell uses one Cloudflare Worker secret, `ALCHEMY_API_KEY`, for both Alchemy data products:

- **Token API:** `alchemy_getTokenBalances` discovers ERC-20 contracts with balances/history for an owner.
- **Standard JSON-RPC:** metadata (`name`, `symbol`, `decimals`) and configured ERC-20 `allowance(owner,spender)` values are read with batched `eth_call` requests. This is deliberate: Alchemy does not support JSON-RPC batching for its enhanced `alchemy_*` Token APIs, while standard JSON-RPC methods can be batched.
- **Prices API:** the address-based price endpoint returns USD prices for network-and-contract pairs. Prices are accepted only when the provider timestamp is no more than five minutes old and no more than one minute in the future.

## Network mapping

| Mainwell network | Alchemy RPC host / Prices API network |
|---|---|
| Ethereum | `eth-mainnet` |
| Polygon | `polygon-mainnet` |
| BNB Smart Chain | `bnb-mainnet` |
| Avalanche | `avax-mainnet` |
| Arbitrum | `arb-mainnet` |
| Optimism | `opt-mainnet` |
| Base | `base-mainnet` |

Native balances continue to come from each network's configured HTTPS RPC endpoint. Native USD prices are looked up using the network's wrapped-native token address.

## Scheduled monitoring (Phase Three item 3)

The existing Worker cron runs once per minute. Each invocation processes at most one due wallet; an individual wallet is eligible again after five minutes. A conditional D1 claim prevents overlapping cron invocations from scanning the same wallet simultaneously. Metadata and configured allowance reads use standard JSON-RPC batches, and each wallet is isolated to keep its request budget from starving other wallets. Requests have timeouts, bounded retries for rate limits/transient server errors, and pagination. A scan fails closed rather than marking assets missing if token-balance pagination exceeds the configured 25-page/2,500-token safety limit.

Manual owner refresh uses the same Alchemy-backed scanner as scheduled refresh.

## Safety and limitations

- Discovery is read-only. Discovered tokens are stored as unverified and are **not** inserted into the administrator-controlled recovery-supported-asset registry or treated as owner authorization.
- Missing or stale prices remain null; the monitor does not invent a USD value.
- ERC-20 `allowance(owner,spender)` is queried for every Mainwell executor address previously issued to that source wallet (from its grant records), plus any external spender addresses explicitly configured under `knownSpenders` in the per-network `MAINWELL_EVM_ASSETS` Worker variable. This automatically covers Mainwell grants, including revoked or expired grants so lingering allowances remain visible. Alchemy does not enumerate arbitrary historical third-party spenders; those require an explicit verified address list. Existing permissions outside the checked set remain unknown and are never automatically declared revoked.
- Monitoring never enables recovery automation or transaction execution. Those persistent switches remain independent and must stay disabled during provider validation.

## Secret handling

Set `ALCHEMY_API_KEY` as a Cloudflare Worker secret. Do not place the value in source code, Wrangler configuration, a committed environment file, or chat. The same key authenticates the Token API RPC calls and the Prices API HTTP requests.

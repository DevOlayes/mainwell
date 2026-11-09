# Network Roadmap

The following are design targets only. No live chain adapter is shipped in this foundation.

| Network | Family | Required adapter work |
|---|---|---|
| Ethereum | EVM | Native/ERC-20 balances, allowance and permit inspection, fee quote |
| Polygon | EVM | Native/ERC-20 balances, allowance and permit inspection, fee quote |
| BNB Smart Chain | EVM | Native/BEP-20 balances, allowance inspection, fee quote |
| Avalanche C-Chain | EVM | Native/ERC-20 balances, allowance inspection, fee quote |
| Arbitrum | EVM | Native/ERC-20 balances, allowance inspection, fee quote |
| Optimism | EVM | Native/ERC-20 balances, allowance inspection, fee quote |
| Base | EVM | Native/ERC-20 balances, allowance inspection, fee quote |
| TRON | TRON | TRX/TRC-20 balances, approvals, Energy/Bandwidth status |
| Solana | Solana | SOL/SPL balances, delegate and token authority inspection |
| Bitcoin | Bitcoin | UTXO discovery, script/address analysis, fee estimation |

Every adapter must initially be read-only and include fixture tests, rate-limit handling, freshness checks, and explicit unsupported-feature reporting.

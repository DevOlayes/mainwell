import type { AssetPosition, PermissionRecord, WalletReference, NetworkId } from "../domain/types";
import type { ReadOnlyWalletAdapter } from "./read-only-wallet";

export interface EvmTokenConfig {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  /** Supplied by a trusted pricing adapter; never inferred from token metadata. */
  priceUsd: number;
  priceObservedAt: string;
  priceConfidence: number;
  urgencyScore?: number;
}

export interface EvmSpenderConfig {
  address: string;
  label: string;
}

export interface EvmAdapterConfig {
  network: Extract<NetworkId, "ethereum" | "polygon" | "bsc" | "avalanche" | "arbitrum" | "optimism" | "base">;
  chainId: number;
  rpcUrl: string;
  nativeSymbol: string;
  nativeName: string;
  nativeDecimals?: number;
  nativePriceUsd: number;
  nativePriceObservedAt: string;
  nativePriceConfidence: number;
  tokens: EvmTokenConfig[];
  knownSpenders?: EvmSpenderConfig[];
  fetcher?: typeof fetch;
  requestTimeoutMs?: number;
}

interface JsonRpcResponse<T> { jsonrpc: "2.0"; id: number; result?: T; error?: { code: number; message: string } }

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const UINT256 = /^0x[0-9a-fA-F]+$/;
const SELECTOR = {
  balanceOf: "70a08231",
  allowance: "dd62ed3e",
  symbol: "95d89b41",
  decimals: "313ce567"
} as const;

function assertAddress(address: string, label: string): void {
  if (!ADDRESS.test(address)) throw new Error(`${label} must be a valid EVM address.`);
}
function addressWord(address: string): string {
  assertAddress(address, "Address");
  return address.slice(2).toLowerCase().padStart(64, "0");
}
function decodeUint(value: string): bigint {
  if (!UINT256.test(value)) throw new Error("RPC returned an invalid uint256 value.");
  return BigInt(value);
}
function units(value: bigint, decimals: number): string {
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const fraction = (value % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}
function usdValue(amount: string, price: number): number {
  const result = Number(amount) * price;
  return Number.isFinite(result) ? result : 0;
}
function validatePrice(price: number, observedAt: string, confidence: number): void {
  if (!Number.isFinite(price) || price < 0) throw new Error("Token price must be a finite non-negative number.");
  const age = Date.now() - Date.parse(observedAt);
  if (!Number.isFinite(age) || age < 0 || age > 5 * 60_000) throw new Error("Token price is stale or has an invalid timestamp.");
  if (!Number.isFinite(confidence) || confidence < 0.5 || confidence > 1) throw new Error("Token price confidence must be between 0.5 and 1.");
}

/**
 * Generic EVM read-only adapter. Token and spender discovery is deliberately
 * configuration/indexer driven: JSON-RPC cannot enumerate every ERC-20 token
 * or every spender that has ever been approved for an address.
 */
export class EvmReadOnlyAdapter implements ReadOnlyWalletAdapter {
  readonly network: EvmAdapterConfig["network"];
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;
  private requestId = 0;

  constructor(private readonly config: EvmAdapterConfig) {
    this.network = config.network;
    this.fetcher = config.fetcher ?? fetch;
    this.timeoutMs = config.requestTimeoutMs ?? 12_000;
    if (!Number.isSafeInteger(config.chainId) || config.chainId <= 0) throw new Error("A valid EVM chain ID is required.");
    if (!config.rpcUrl.startsWith("https://")) throw new Error("RPC endpoint must use HTTPS.");
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1000 || this.timeoutMs > 60_000) throw new Error("RPC timeout is outside the allowed range.");
    for (const token of config.tokens) {
      assertAddress(token.address, "Token contract");
      if (!Number.isInteger(token.decimals) || token.decimals < 0 || token.decimals > 36) throw new Error("Token decimals are invalid.");
    }
    for (const spender of config.knownSpenders ?? []) assertAddress(spender.address, "Known spender");
  }

  private async rpc<T>(method: string, params: unknown[]): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetcher(this.config.rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++this.requestId, method, params }),
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`EVM RPC HTTP error: ${response.status}`);
      const payload = await response.json() as JsonRpcResponse<T>;
      if (payload.error) throw new Error(`EVM RPC error ${payload.error.code}: ${payload.error.message}`);
      if (payload.result === undefined) throw new Error("EVM RPC response did not contain a result.");
      return payload.result;
    } finally {
      clearTimeout(timeout);
    }
  }

  async assertChain(): Promise<void> {
    const chainHex = await this.rpc<string>("eth_chainId", []);
    if (decodeUint(chainHex) !== BigInt(this.config.chainId)) throw new Error("RPC endpoint chain ID does not match the configured network.");
  }

  private async call(contract: string, data: string): Promise<string> {
    assertAddress(contract, "Contract");
    return this.rpc<string>("eth_call", [{ to: contract, data: `0x${data}` }, "latest"]);
  }

  async getNativeBalance(wallet: WalletReference): Promise<number> {
    this.assertWallet(wallet);
    const raw = await this.rpc<string>("eth_getBalance", [wallet.address, "latest"]);
    const amount = Number(units(decodeUint(raw), this.config.nativeDecimals ?? 18));
    if (!Number.isFinite(amount)) throw new Error("Native balance exceeds supported numeric precision.");
    return amount;
  }

  async getAssets(wallet: WalletReference): Promise<AssetPosition[]> {
    this.assertWallet(wallet);
    validatePrice(this.config.nativePriceUsd, this.config.nativePriceObservedAt, this.config.nativePriceConfidence);
    const nativeAmount = await this.getNativeBalance(wallet);
    const nativeString = nativeAmount.toString();
    const assets: AssetPosition[] = [{
      id: `${this.network}:native`, network: this.network, symbol: this.config.nativeSymbol,
      name: this.config.nativeName, amount: nativeString, decimals: this.config.nativeDecimals ?? 18,
      estimatedValueUsd: usdValue(nativeString, this.config.nativePriceUsd), isNative: true,
      urgencyScore: 50, confidence: this.config.nativePriceConfidence
    }];
    for (const token of this.config.tokens) {
      validatePrice(token.priceUsd, token.priceObservedAt, token.priceConfidence);
      const raw = await this.call(token.address, SELECTOR.balanceOf + addressWord(wallet.address));
      const amount = units(decodeUint(raw), token.decimals);
      assets.push({
        id: `${this.network}:erc20:${token.address.toLowerCase()}`, network: this.network,
        symbol: token.symbol, name: token.name, contractAddress: token.address,
        amount, decimals: token.decimals, estimatedValueUsd: usdValue(amount, token.priceUsd),
        isNative: false, urgencyScore: token.urgencyScore ?? 50, confidence: token.priceConfidence
      });
    }
    return assets;
  }

  async getPermissions(wallet: WalletReference): Promise<PermissionRecord[]> {
    this.assertWallet(wallet);
    const records: PermissionRecord[] = [];
    for (const token of this.config.tokens) {
      for (const spender of this.config.knownSpenders ?? []) {
        const raw = await this.call(token.address, SELECTOR.allowance + addressWord(wallet.address) + addressWord(spender.address));
        const allowance = decodeUint(raw);
        if (allowance === 0n) continue;
        records.push({
          id: `${this.network}:${token.address.toLowerCase()}:${spender.address.toLowerCase()}`,
          network: this.network, assetId: `${this.network}:erc20:${token.address.toLowerCase()}`,
          spender: spender.address, permissionType: "allowance",
          scopeDescription: `ERC-20 allowance for ${spender.label}: ${allowance === (2n ** 256n - 1n) ? "unlimited" : "non-zero"}`,
          risk: allowance === (2n ** 256n - 1n) ? "high" : "medium",
          revocable: true, observedAt: new Date().toISOString()
        });
      }
    }
    return records;
  }

  private assertWallet(wallet: WalletReference): void {
    if (wallet.network !== this.network) throw new Error("Wallet network does not match this EVM adapter.");
    assertAddress(wallet.address, "Wallet address");
  }
}

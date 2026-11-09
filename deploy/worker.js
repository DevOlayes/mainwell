var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/adapters/keccak.ts
var MASK = (1n << 64n) - 1n;
var ROT = [0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14];
var RC = [
  0x0000000000000001n,
  0x0000000000008082n,
  0x800000000000808an,
  0x8000000080008000n,
  0x000000000000808bn,
  0x0000000080000001n,
  0x8000000080008081n,
  0x8000000000008009n,
  0x000000000000008an,
  0x0000000000000088n,
  0x0000000080008009n,
  0x000000008000000an,
  0x000000008000808bn,
  0x800000000000008bn,
  0x8000000000008089n,
  0x8000000000008003n,
  0x8000000000008002n,
  0x8000000000000080n,
  0x000000000000800an,
  0x800000008000000an,
  0x8000000080008081n,
  0x8000000000008080n,
  0x0000000080000001n,
  0x8000000080008008n
];
function rol(value, shift) {
  if (shift === 0) return value & MASK;
  const n = BigInt(shift);
  return (value << n | value >> 64n - n) & MASK;
}
__name(rol, "rol");
function permutation(a) {
  for (const rc of RC) {
    const c = new Array(5), d = new Array(5);
    for (let x = 0; x < 5; x++) c[x] = a[x] ^ a[x + 5] ^ a[x + 10] ^ a[x + 15] ^ a[x + 20];
    for (let x = 0; x < 5; x++) d[x] = c[(x + 4) % 5] ^ rol(c[(x + 1) % 5], 1);
    for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) a[x + 5 * y] = (a[x + 5 * y] ^ d[x]) & MASK;
    const b = new Array(25).fill(0n);
    for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) {
      const i = x + 5 * y, nx = y, ny = (2 * x + 3 * y) % 5;
      b[nx + 5 * ny] = rol(a[i], ROT[i]);
    }
    for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) {
      a[x + 5 * y] = (b[x + 5 * y] ^ ~b[(x + 1) % 5 + 5 * y] & b[(x + 2) % 5 + 5 * y]) & MASK;
    }
    a[0] ^= rc;
  }
}
__name(permutation, "permutation");
function keccak256(input) {
  const rate = 136, paddedLength = Math.ceil((input.length + 1) / rate) * rate || rate;
  const padded = new Uint8Array(paddedLength);
  padded.set(input);
  padded[input.length] = 1;
  padded[padded.length - 1] |= 128;
  const state = new Array(25).fill(0n);
  for (let offset = 0; offset < padded.length; offset += rate) {
    for (let i = 0; i < rate; i++) {
      const lane = Math.floor(i / 8), shift = BigInt(i % 8 * 8);
      state[lane] ^= BigInt(padded[offset + i]) << shift;
    }
    permutation(state);
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = Number(state[Math.floor(i / 8)] >> BigInt(i % 8 * 8) & 0xffn);
  return "0x" + Array.from(out, (b) => b.toString(16).padStart(2, "0")).join("");
}
__name(keccak256, "keccak256");
function keccak256Hex(hex3) {
  if (!/^0x(?:[0-9a-fA-F]{2})*$/.test(hex3)) throw new Error("Invalid hex input.");
  const bytes = new Uint8Array((hex3.length - 2) / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Number.parseInt(hex3.slice(2 + i * 2, 4 + i * 2), 16);
  return keccak256(bytes);
}
__name(keccak256Hex, "keccak256Hex");

// src/adapters/evm-signature.ts
var P = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
var N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
var G = {
  x: 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n,
  y: 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n
};
function mod(a, m) {
  const r = a % m;
  return r < 0n ? r + m : r;
}
__name(mod, "mod");
function pow(base, exponent, modulus) {
  let x = mod(base, modulus), n = exponent, out = 1n;
  while (n > 0n) {
    if (n & 1n) out = out * x % modulus;
    x = x * x % modulus;
    n >>= 1n;
  }
  return out;
}
__name(pow, "pow");
function inv(a, m) {
  let oldR = mod(a, m), r = m, oldS = 1n, s = 0n;
  while (r !== 0n) {
    const q = oldR / r;
    [oldR, r] = [r, oldR - q * r];
    [oldS, s] = [s, oldS - q * s];
  }
  if (oldR !== 1n) throw new Error("Invalid elliptic-curve signature.");
  return mod(oldS, m);
}
__name(inv, "inv");
function add(a, b) {
  if (!a) return b;
  if (!b) return a;
  if (a.x === b.x && mod(a.y + b.y, P) === 0n) return null;
  const slope = a.x === b.x && a.y === b.y ? mod(3n * a.x * a.x * inv(2n * a.y, P), P) : mod((b.y - a.y) * inv(b.x - a.x, P), P);
  const x = mod(slope * slope - a.x - b.x, P);
  return { x, y: mod(slope * (a.x - x) - a.y, P) };
}
__name(add, "add");
function multiply(point, scalar) {
  let p = point, n = mod(scalar, N), out = null;
  while (n > 0n) {
    if (n & 1n) out = add(out, p);
    p = add(p, p);
    n >>= 1n;
  }
  return out;
}
__name(multiply, "multiply");
function hexBytes(hex3) {
  const clean = hex3.startsWith("0x") ? hex3.slice(2) : hex3;
  if (clean.length % 2 || !/^[0-9a-f]+$/i.test(clean)) throw new Error("Malformed hexadecimal data.");
  return Uint8Array.from(clean.match(/.{2}/g) ?? [], (x) => parseInt(x, 16));
}
__name(hexBytes, "hexBytes");
function bytesToHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
__name(bytesToHex, "bytesToHex");
function recoverPersonalSignAddress(message, signature) {
  if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) throw new Error("Wallet signature must be 65-byte hex.");
  const sig = hexBytes(signature);
  const r = BigInt("0x" + bytesToHex(sig.slice(0, 32)));
  const s = BigInt("0x" + bytesToHex(sig.slice(32, 64)));
  let recovery = sig[64];
  if (recovery >= 27) recovery -= 27;
  if (recovery !== 0 && recovery !== 1 || r <= 0n || r >= N || s <= 0n || s > N / 2n) {
    throw new Error("Wallet signature is invalid or non-canonical.");
  }
  const messageBytes = new TextEncoder().encode(message);
  const prefix = new TextEncoder().encode("Ethereum Signed Message:\n" + messageBytes.length);
  const payload = new Uint8Array(prefix.length + messageBytes.length);
  payload.set(prefix);
  payload.set(messageBytes, prefix.length);
  const digest = BigInt(keccak256Hex("0x" + bytesToHex(payload)));
  const x = r;
  if (x >= P) throw new Error("Wallet signature recovery point is invalid.");
  const alpha = mod(x * x * x + 7n, P);
  let y = pow(alpha, (P + 1n) / 4n, P);
  if (mod(y * y, P) !== alpha) throw new Error("Wallet signature recovery point is invalid.");
  if (Number(y & 1n) !== recovery) y = P - y;
  const R = { x, y };
  const q = multiply(add(multiply(R, s), multiply(G, -digest)), inv(r, N));
  if (!q) throw new Error("Wallet signature could not be recovered.");
  const publicKey = "0x" + q.x.toString(16).padStart(64, "0") + q.y.toString(16).padStart(64, "0");
  const addressHash = keccak256Hex(publicKey);
  return "0x" + addressHash.slice(-40).toLowerCase();
}
__name(recoverPersonalSignAddress, "recoverPersonalSignAddress");

// src/adapters/evm-read-only.ts
var ADDRESS = /^0x[0-9a-fA-F]{40}$/;
var UINT256 = /^0x[0-9a-fA-F]+$/;
var SELECTOR = {
  balanceOf: "70a08231",
  allowance: "dd62ed3e",
  symbol: "95d89b41",
  decimals: "313ce567"
};
function assertAddress(address, label) {
  if (!ADDRESS.test(address)) throw new Error(`${label} must be a valid EVM address.`);
}
__name(assertAddress, "assertAddress");
function addressWord(address) {
  assertAddress(address, "Address");
  return address.slice(2).toLowerCase().padStart(64, "0");
}
__name(addressWord, "addressWord");
function decodeUint(value) {
  if (!UINT256.test(value)) throw new Error("RPC returned an invalid uint256 value.");
  return BigInt(value);
}
__name(decodeUint, "decodeUint");
function units(value, decimals) {
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const fraction = (value % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}
__name(units, "units");
function usdValue(amount, price) {
  const result = Number(amount) * price;
  return Number.isFinite(result) ? result : 0;
}
__name(usdValue, "usdValue");
function validatePrice(price, observedAt, confidence) {
  if (!Number.isFinite(price) || price < 0) throw new Error("Token price must be a finite non-negative number.");
  const age = Date.now() - Date.parse(observedAt);
  if (!Number.isFinite(age) || age < 0 || age > 5 * 6e4) throw new Error("Token price is stale or has an invalid timestamp.");
  if (!Number.isFinite(confidence) || confidence < 0.5 || confidence > 1) throw new Error("Token price confidence must be between 0.5 and 1.");
}
__name(validatePrice, "validatePrice");
var EvmReadOnlyAdapter = class {
  constructor(config) {
    this.config = config;
    this.network = config.network;
    this.fetcher = config.fetcher ?? fetch;
    this.timeoutMs = config.requestTimeoutMs ?? 12e3;
    if (!Number.isSafeInteger(config.chainId) || config.chainId <= 0) throw new Error("A valid EVM chain ID is required.");
    if (!config.rpcUrl.startsWith("https://")) throw new Error("RPC endpoint must use HTTPS.");
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1e3 || this.timeoutMs > 6e4) throw new Error("RPC timeout is outside the allowed range.");
    for (const token of config.tokens) {
      assertAddress(token.address, "Token contract");
      if (!Number.isInteger(token.decimals) || token.decimals < 0 || token.decimals > 36) throw new Error("Token decimals are invalid.");
    }
    for (const spender of config.knownSpenders ?? []) assertAddress(spender.address, "Known spender");
  }
  config;
  static {
    __name(this, "EvmReadOnlyAdapter");
  }
  network;
  fetcher;
  timeoutMs;
  requestId = 0;
  async rpc(method, params) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response2 = await this.fetcher(this.config.rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++this.requestId, method, params }),
        signal: controller.signal
      });
      if (!response2.ok) throw new Error(`EVM RPC HTTP error: ${response2.status}`);
      const payload = await response2.json();
      if (payload.error) throw new Error(`EVM RPC error ${payload.error.code}: ${payload.error.message}`);
      if (payload.result === void 0) throw new Error("EVM RPC response did not contain a result.");
      return payload.result;
    } finally {
      clearTimeout(timeout);
    }
  }
  async assertChain() {
    const chainHex = await this.rpc("eth_chainId", []);
    if (decodeUint(chainHex) !== BigInt(this.config.chainId)) throw new Error("RPC endpoint chain ID does not match the configured network.");
  }
  async call(contract, data) {
    assertAddress(contract, "Contract");
    return this.rpc("eth_call", [{ to: contract, data: `0x${data}` }, "latest"]);
  }
  async getNativeBalanceAmount(wallet) {
    this.assertWallet(wallet);
    const raw = await this.rpc("eth_getBalance", [wallet.address, "latest"]);
    return units(decodeUint(raw), this.config.nativeDecimals ?? 18);
  }
  async getNativeBalance(wallet) {
    const amount = Number(await this.getNativeBalanceAmount(wallet));
    if (!Number.isFinite(amount)) throw new Error("Native balance exceeds supported numeric precision.");
    return amount;
  }
  async getAssets(wallet) {
    this.assertWallet(wallet);
    validatePrice(this.config.nativePriceUsd, this.config.nativePriceObservedAt, this.config.nativePriceConfidence);
    const nativeString = await this.getNativeBalanceAmount(wallet);
    const assets = [{
      id: `${this.network}:native`,
      network: this.network,
      symbol: this.config.nativeSymbol,
      name: this.config.nativeName,
      amount: nativeString,
      decimals: this.config.nativeDecimals ?? 18,
      estimatedValueUsd: usdValue(nativeString, this.config.nativePriceUsd),
      isNative: true,
      urgencyScore: 50,
      confidence: this.config.nativePriceConfidence
    }];
    for (const token of this.config.tokens) {
      validatePrice(token.priceUsd, token.priceObservedAt, token.priceConfidence);
      const raw = await this.call(token.address, SELECTOR.balanceOf + addressWord(wallet.address));
      const amount = units(decodeUint(raw), token.decimals);
      assets.push({
        id: `${this.network}:erc20:${token.address.toLowerCase()}`,
        network: this.network,
        symbol: token.symbol,
        name: token.name,
        contractAddress: token.address,
        amount,
        decimals: token.decimals,
        estimatedValueUsd: usdValue(amount, token.priceUsd),
        isNative: false,
        urgencyScore: token.urgencyScore ?? 50,
        confidence: token.priceConfidence
      });
    }
    return assets;
  }
  async getPermissions(wallet) {
    this.assertWallet(wallet);
    const records = [];
    for (const token of this.config.tokens) {
      for (const spender of this.config.knownSpenders ?? []) {
        const raw = await this.call(token.address, SELECTOR.allowance + addressWord(wallet.address) + addressWord(spender.address));
        const allowance = decodeUint(raw);
        if (allowance === 0n) continue;
        records.push({
          id: `${this.network}:${token.address.toLowerCase()}:${spender.address.toLowerCase()}`,
          network: this.network,
          assetId: `${this.network}:erc20:${token.address.toLowerCase()}`,
          spender: spender.address,
          permissionType: "allowance",
          scopeDescription: `ERC-20 allowance for ${spender.label}: ${allowance === 2n ** 256n - 1n ? "unlimited" : "non-zero"}`,
          risk: allowance === 2n ** 256n - 1n ? "high" : "medium",
          revocable: true,
          observedAt: (/* @__PURE__ */ new Date()).toISOString()
        });
      }
    }
    return records;
  }
  assertWallet(wallet) {
    if (wallet.network !== this.network) throw new Error("Wallet network does not match this EVM adapter.");
    assertAddress(wallet.address, "Wallet address");
  }
};

// src/application/evm-monitor.ts
var EVM_NETWORKS = {
  ethereum: { chainId: 1, nativeSymbol: "ETH", nativeName: "Ether" },
  polygon: { chainId: 137, nativeSymbol: "POL", nativeName: "Polygon Ecosystem Token" },
  bsc: { chainId: 56, nativeSymbol: "BNB", nativeName: "BNB" },
  avalanche: { chainId: 43114, nativeSymbol: "AVAX", nativeName: "Avalanche" },
  arbitrum: { chainId: 42161, nativeSymbol: "ETH", nativeName: "Ether" },
  optimism: { chainId: 10, nativeSymbol: "ETH", nativeName: "Ether" },
  base: { chainId: 8453, nativeSymbol: "ETH", nativeName: "Ether" }
};
var RPC_ENV = {
  ethereum: "EVM_RPC_ETHEREUM",
  polygon: "EVM_RPC_POLYGON",
  bsc: "EVM_RPC_BSC",
  avalanche: "EVM_RPC_AVALANCHE",
  arbitrum: "EVM_RPC_ARBITRUM",
  optimism: "EVM_RPC_OPTIMISM",
  base: "EVM_RPC_BASE"
};
function parseAssetConfig(raw) {
  if (!raw) return {};
  const value = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("MAINWELL_EVM_ASSETS must be a JSON object keyed by network.");
  return value;
}
__name(parseAssetConfig, "parseAssetConfig");
function rawAmount(amount, decimals) {
  const [whole, fraction = ""] = amount.split(".");
  if (!/^\d+$/.test(whole) || !/^\d*$/.test(fraction) || fraction.length > decimals) throw new Error("Adapter returned an invalid decimal asset amount.");
  return (BigInt(whole) * 10n ** BigInt(decimals) + BigInt((fraction + "0".repeat(decimals)).slice(0, decimals) || "0")).toString();
}
__name(rawAmount, "rawAmount");
async function toAssetConfig(env, network, observedAt) {
  const configs = parseAssetConfig(env.MAINWELL_EVM_ASSETS);
  const item = configs[network] ?? {};
  if (item.tokens !== void 0 && !Array.isArray(item.tokens)) throw new Error("Configured token list must be an array.");
  if (item.knownSpenders !== void 0 && !Array.isArray(item.knownSpenders)) throw new Error("Configured spender list must be an array.");
  const registered = await env.DB.prepare(
    "SELECT token_address AS address,symbol,name,decimals FROM recovery_supported_assets WHERE network=? AND is_active=1 ORDER BY symbol"
  ).bind(network).all();
  if (!registered.success) throw new Error("Unable to load the administrator-managed supported asset registry.");
  const tokens = /* @__PURE__ */ new Map();
  for (const token of registered.results) {
    tokens.set(token.address.toLowerCase(), {
      address: token.address,
      symbol: token.symbol,
      name: token.name,
      decimals: token.decimals,
      priceUsd: 0,
      priceObservedAt: observedAt,
      priceConfidence: 0.5
    });
  }
  for (const token of item.tokens ?? []) tokens.set(token.address.toLowerCase(), token);
  return { ...item, tokens: [...tokens.values()] };
}
__name(toAssetConfig, "toAssetConfig");
async function refreshEvmWallet(env, wallet) {
  const networkName = wallet.network;
  const network = EVM_NETWORKS[networkName];
  if (!network || wallet.chain_id !== network.chainId) throw new Error("Wallet network and chain ID are inconsistent.");
  const rpcName = RPC_ENV[networkName];
  const rpcUrl = rpcName ? env[rpcName] : void 0;
  if (!rpcUrl) throw new Error("RPC_NOT_CONFIGURED");
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const config = await toAssetConfig(env, networkName, now);
  const adapter = new EvmReadOnlyAdapter({
    network: networkName,
    chainId: network.chainId,
    rpcUrl,
    nativeSymbol: network.nativeSymbol,
    nativeName: network.nativeName,
    nativePriceUsd: 0,
    nativePriceObservedAt: now,
    nativePriceConfidence: 0.5,
    tokens: config.tokens ?? [],
    knownSpenders: config.knownSpenders ?? []
  });
  const reference = { network: wallet.network, address: wallet.address };
  await adapter.assertChain();
  const [assets, permissions] = await Promise.all([adapter.getAssets(reference), adapter.getPermissions(reference)]);
  for (const asset of assets) {
    const amountRaw = rawAmount(asset.amount, asset.decimals);
    const priceObservedAt = asset.estimatedValueUsd > 0 ? now : null;
    await env.DB.prepare(`
      INSERT INTO wallet_assets
        (id,wallet_id,network,asset_ref,token_address,symbol,name,amount_raw,decimals,estimated_value_usd,price_observed_at,valuation_confidence,observed_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(wallet_id,network,asset_ref) DO UPDATE SET
        token_address=excluded.token_address,symbol=excluded.symbol,name=excluded.name,
        amount_raw=excluded.amount_raw,decimals=excluded.decimals,
        estimated_value_usd=excluded.estimated_value_usd,price_observed_at=excluded.price_observed_at,
        valuation_confidence=excluded.valuation_confidence,observed_at=excluded.observed_at
    `).bind(
      crypto.randomUUID(),
      wallet.id,
      wallet.network,
      asset.id,
      asset.contractAddress ?? null,
      asset.symbol,
      asset.name,
      amountRaw,
      asset.decimals,
      asset.estimatedValueUsd > 0 ? asset.estimatedValueUsd : null,
      priceObservedAt,
      asset.estimatedValueUsd > 0 ? asset.confidence : null,
      now
    ).run();
  }
  await env.DB.prepare(`
    INSERT INTO audit_events(actor_type,actor_id,action,target_type,target_id,metadata_json,created_at)
    VALUES('owner',?,'wallet.monitoring.refresh','recovery_wallet',?,?,?)
  `).bind(wallet.address.toLowerCase(), wallet.id, JSON.stringify({ network: wallet.network, assetCount: assets.length, permissionCount: permissions.length }), now).run();
  return { assets, permissions, observedAt: now };
}
__name(refreshEvmWallet, "refreshEvmWallet");

// src/policy/recovery-grant.ts
var EVM_NETWORKS2 = /* @__PURE__ */ new Set([
  "ethereum",
  "polygon",
  "bsc",
  "avalanche",
  "arbitrum",
  "optimism",
  "base"
]);
var EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
var HASH = /^0x[0-9a-fA-F]{64}$/;
var UINT = /^(0|[1-9][0-9]*)$/;
var UINT256_MAX = (1n << 256n) - 1n;
function validateRecoveryGrant(grant, expectedWallet, expectedNetwork, now = Date.now()) {
  if (!grant.grantId.trim()) throw new Error("Grant ID is required.");
  if (grant.ownerWallet.toLowerCase() !== expectedWallet.toLowerCase()) {
    throw new Error("Grant owner does not match the connected wallet.");
  }
  if (grant.network !== expectedNetwork) throw new Error("Grant network mismatch.");
  if (EVM_NETWORKS2.has(grant.network)) {
    if (!Number.isSafeInteger(grant.chainId) || (grant.chainId ?? 0) <= 0) {
      throw new Error("A valid EVM chain ID is required.");
    }
    for (const [label, value] of [
      ["owner wallet", grant.ownerWallet],
      ["executor", grant.executorAddress],
      ["default destination", grant.destinationAddress]
    ]) {
      if (!EVM_ADDRESS.test(value)) throw new Error(`Grant ${label} is not a valid EVM address.`);
    }
    if (!HASH.test(grant.executorCodeHash)) throw new Error("A verified executor bytecode hash is required.");
  }
  const approvedAt = Date.parse(grant.approvedAt);
  const expiresAt = Date.parse(grant.expiresAt);
  if (!Number.isFinite(approvedAt) || !Number.isFinite(expiresAt) || approvedAt > now + 12e4 || expiresAt <= now || expiresAt <= approvedAt) {
    throw new Error("Grant approval or expiry timestamps are invalid.");
  }
  if (grant.revokedAt) {
    const revokedAt = Date.parse(grant.revokedAt);
    if (!Number.isFinite(revokedAt) || revokedAt <= approvedAt) throw new Error("Grant revocation timestamp is invalid.");
    if (revokedAt <= now) throw new Error("Recovery grant has been revoked.");
  }
  if (!grant.evidence.reference.trim()) throw new Error("Verifiable owner authorization evidence is required.");
  if (!["onchain-approval", "permit", "smart-account-session"].includes(grant.evidence.kind)) {
    throw new Error("Unsupported authorization evidence type.");
  }
  if (grant.executionModes.length === 0 || grant.executionModes.some(
    (mode) => mode !== "automatic-priority" && mode !== "admin-initiated"
  )) throw new Error("At least one valid execution mode must be explicitly authorized.");
  if (!grant.executionOperators || !EVM_ADDRESS.test(grant.executionOperators.automation) || !EVM_ADDRESS.test(grant.executionOperators.administrator)) {
    throw new Error("Both immutable execution operator addresses must be valid EVM addresses.");
  }
  if (grant.executionModes.includes("automatic-priority") && grant.executionOperators.automation.toLowerCase() === "0x0000000000000000000000000000000000000000") {
    throw new Error("Automatic recovery requires a configured automation operator.");
  }
  if (grant.executionModes.includes("admin-initiated") && grant.executionOperators.administrator.toLowerCase() === "0x0000000000000000000000000000000000000000") {
    throw new Error("Administrator recovery requires a configured administrator operator.");
  }
  if (grant.assets.length === 0) throw new Error("Grant must authorize at least one asset.");
  const seen = /* @__PURE__ */ new Set();
  for (const asset of grant.assets) {
    if (!asset.assetId.trim() || seen.has(asset.assetId)) throw new Error("Asset IDs must be non-empty and unique.");
    seen.add(asset.assetId);
    if (EVM_NETWORKS2.has(grant.network) && !EVM_ADDRESS.test(asset.destinationAddress)) {
      throw new Error("Every EVM asset must have its own valid owner-approved destination address.");
    }
    if (asset.amount.kind === "capped") {
      if (!UINT.test(asset.amount.maxAmountRaw) || BigInt(asset.amount.maxAmountRaw) <= 0n || BigInt(asset.amount.maxAmountRaw) > UINT256_MAX) {
        throw new Error("Capped authorization must have a positive integer amount in base units.");
      }
    } else if (asset.amount.kind === "unlimited-allowance") {
      if (asset.amount.ownerAcknowledged !== true) throw new Error("Unlimited allowance requires explicit owner acknowledgement.");
      if (!EVM_NETWORKS2.has(grant.network) || !asset.tokenAddress || !EVM_ADDRESS.test(asset.tokenAddress)) {
        throw new Error("Unlimited allowance is supported only for a configured EVM token and reviewed executor.");
      }
    } else {
      throw new Error("Unsupported asset authorization amount.");
    }
    if (asset.tokenAddress && EVM_NETWORKS2.has(grant.network) && !EVM_ADDRESS.test(asset.tokenAddress)) {
      throw new Error("Token contract address is invalid.");
    }
  }
  if (EVM_NETWORKS2.has(grant.network) && grant.assets[0].destinationAddress.toLowerCase() !== grant.destinationAddress.toLowerCase()) {
    throw new Error("The grant default destination must match the first asset's immutable destination.");
  }
}
__name(validateRecoveryGrant, "validateRecoveryGrant");

// src/application/executor-artifact.ts
var EXECUTOR_CREATION_BYTECODE = "0x60c0604052600160035534801562000015575f80fd5b506040516200100e3803806200100e8339810160408190526200003891620004fe565b42886001600160401b031611620000615760405162d36c8560e81b815260040160405180910390fd5b831580156200006e575082155b156200008d5760405163c522a9e160e01b815260040160405180910390fd5b838015620000a257506001600160a01b038216155b80620000be5750828015620000be57506001600160a01b038116155b15620000dd5760405163c522a9e160e01b815260040160405180910390fd5b86511580620000ee57508451875114155b80620000fc57508551875114155b156200011b5760405163c522a9e160e01b815260040160405180910390fd5b5f8054336001600160a01b03199091161781556001600160a01b03838116608052821660a05260018054600160a01b61ff0160e01b031916600160a01b6001600160401b038c160260ff60e81b191617600160e81b871515021760ff60f01b1916600160f01b861515021790555b87518110156200031e575f888281518110620001a957620001a9620005e6565b602002602001015190505f888381518110620001c957620001c9620005e6565b602002602001015190505f888481518110620001e957620001e9620005e6565b602002602001015190505f6001600160a01b0316836001600160a01b031614806200021c57506001600160a01b0383163b155b806200022f57506001600160a01b038216155b8062000239575080155b15620002585760405163c522a9e160e01b815260040160405180910390fd5b6001600160a01b0383165f90815260046020526040902054156200029e5760405163437a40b160e01b81526001600160a01b038416600482015260240160405180910390fd5b6001600160a01b039283165f81815260046020908152604080832094909455600690529182208054939094166001600160a01b0319938416179093556002805460018181018355919092527f405787fa12a823e0f2b7631cc41b3ba8828b3321ca811111fa75cd3aa3bb5ace909101805490921690921790550162000189565b50855f81518110620003345762000334620005e6565b602002602001015160015f6101000a8154816001600160a01b0302191690836001600160a01b031602179055505050505050505050620005fa565b80516001600160401b038116811462000386575f80fd5b919050565b634e487b7160e01b5f52604160045260245ffd5b604051601f8201601f191681016001600160401b0381118282101715620003ca57620003ca6200038b565b604052919050565b5f6001600160401b03821115620003ed57620003ed6200038b565b5060051b60200190565b80516001600160a01b038116811462000386575f80fd5b5f82601f8301126200041e575f80fd5b81516020620004376200043183620003d2565b6200039f565b8083825260208201915060208460051b87010193508684111562000459575f80fd5b602086015b8481101562000480576200047281620003f7565b83529183019183016200045e565b509695505050505050565b5f82601f8301126200049b575f80fd5b81516020620004ae6200043183620003d2565b8083825260208201915060208460051b870101935086841115620004d0575f80fd5b602086015b84811015620004805780518352918301918301620004d5565b8051801515811462000386575f80fd5b5f805f805f805f80610100898b03121562000517575f80fd5b62000522896200036f565b60208a01519098506001600160401b03808211156200053f575f80fd5b6200054d8c838d016200040e565b985060408b015191508082111562000563575f80fd5b620005718c838d016200040e565b975060608b015191508082111562000587575f80fd5b50620005968b828c016200048b565b955050620005a760808a01620004ee565b9350620005b760a08a01620004ee565b9250620005c760c08a01620003f7565b9150620005d760e08a01620003f7565b90509295985092959890939650565b634e487b7160e01b5f52603260045260245ffd5b60805160a0516109e46200062a5f395f81816102e801526104f701525f81816101ac015261044901526109e45ff3fe608060405234801561000f575f80fd5b5060043610610111575f3560e01c8063b6549f751161009e578063d0e043de1161006e578063d0e043de14610295578063e5b07f0b146102b4578063e728c0ef146102c8578063e7f36c63146102db578063e900a491146102e3575f80fd5b8063b6549f7514610254578063bd3def631461025c578063c23ab1b91461026f578063c6d51a8414610282575f80fd5b8063655fb24a116100e4578063655fb24a146101a757806385a708a8146101ce5780638622a689146101fb5780638da5cb5b1461022f578063b269681d14610241575f80fd5b80630b81c9a7146101155780630f3bdd5f1461013e57806313bb4f961461015357806363d256ce14610193575b5f80fd5b60015461012990600160f01b900460ff1681565b60405190151581526020015b60405180910390f35b61015161014c3660046108b0565b61030a565b005b61017b6101613660046108b0565b60066020525f90815260409020546001600160a01b031681565b6040516001600160a01b039091168152602001610135565b60015461012990600160e01b900460ff1681565b61017b7f000000000000000000000000000000000000000000000000000000000000000081565b6101ed6101dc3660046108b0565b60056020525f908152604090205481565b604051908152602001610135565b60015461021690600160a01b900467ffffffffffffffff1681565b60405167ffffffffffffffff9091168152602001610135565b5f5461017b906001600160a01b031681565b60015461017b906001600160a01b031681565b6101516103ca565b61015161026a3660046108d0565b61043e565b61015161027d3660046108d0565b6104ec565b61017b6102903660046108f8565b610587565b6101ed6102a33660046108b0565b60046020525f908152604090205481565b60015461012990600160e81b900460ff1681565b61017b6102d63660046108f8565b6105ce565b6002546101ed565b61017b7f000000000000000000000000000000000000000000000000000000000000000081565b5f546001600160a01b0316331461033457604051630b2db9b760e31b815260040160405180910390fd5b6001600160a01b0381165f90815260046020526040812054900361037b57604051630a23366560e41b81526001600160a01b03821660048201526024015b60405180910390fd5b6001600160a01b0381165f81815260056020908152604080832054600490925280832091909155517fba5ecd908aab4d79cf7e9fc9d22735958a8f4befc4ac4c9f1fb7f2297797dbbd9190a250565b5f546001600160a01b031633146103f457604051630b2db9b760e31b815260040160405180910390fd5b6001805460ff60e01b1916600160e01b1790555f80546040516001600160a01b03909116917fbadc5b2ca6241beb42d4f1c0481f982a91e7aceaca195b8825f6187ad50018e591a2565b336001600160a01b037f000000000000000000000000000000000000000000000000000000000000000016146104875760405163031142d360e11b815260040160405180910390fd5b6003546001146104aa576040516306fda65d60e31b815260040160405180910390fd5b6002600355600154600160e81b900460ff166104d95760405163031142d360e11b815260040160405180910390fd5b6104e382826105fc565b50506001600355565b336001600160a01b037f000000000000000000000000000000000000000000000000000000000000000016146105355760405163143ee67560e21b815260040160405180910390fd5b600354600114610558576040516306fda65d60e31b815260040160405180910390fd5b6002600355600154600160f01b900460ff166104d95760405163143ee67560e21b815260040160405180910390fd5b5f60065f6002848154811061059e5761059e61090f565b5f9182526020808320909101546001600160a01b0390811684529083019390935260409091019020541692915050565b5f600282815481106105e2576105e261090f565b5f918252602090912001546001600160a01b031692915050565b600154600160e01b900460ff16156106275760405163a0c81e5f60e01b815260040160405180910390fd5b600154600160a01b900467ffffffffffffffff16421061065a5760405163075ff6cf60e11b815260040160405180910390fd5b6001600160a01b0382165f908152600460205260408120549081900361069e57604051630a23366560e41b81526001600160a01b0384166004820152602401610372565b6001600160a01b0383165f90815260056020526040812054906106c18284610937565b90508315806106cf57508084115b156106f757604051631beda7db60e31b81526004810185905260248101829052604401610372565b6001600160a01b038086165f90815260066020526040902054168061072f5760405163c522a9e160e01b815260040160405180910390fd5b6107398584610950565b6001600160a01b038781165f81815260056020908152604080832095909555815485519085166024820152938616604485015260648085018b90528551808603909101815260849094018552830180516001600160e01b03166323b872dd60e01b179052925183926107aa91610963565b5f604051808303815f865af19150503d805f81146107e3576040519150601f19603f3d011682016040523d82523d5f602084013e6107e8565b606091505b50915091508115806108165750805115801590610816575080806020019051810190610814919061098f565b155b15610834576040516312171d8360e31b815260040160405180910390fd5b336001600160a01b0316836001600160a01b0316896001600160a01b03167ffe28fceecb7dd637d5601fefa0516fc4c3b757be702d47e296d4921d89d56c1c8a60405161088391815260200190565b60405180910390a45050505050505050565b80356001600160a01b03811681146108ab575f80fd5b919050565b5f602082840312156108c0575f80fd5b6108c982610895565b9392505050565b5f80604083850312156108e1575f80fd5b6108ea83610895565b946020939093013593505050565b5f60208284031215610908575f80fd5b5035919050565b634e487b7160e01b5f52603260045260245ffd5b634e487b7160e01b5f52601160045260245ffd5b8181038181111561094a5761094a610923565b92915050565b8082018082111561094a5761094a610923565b5f82515f5b818110156109825760208186018101518583015201610968565b505f920191825250919050565b5f6020828403121561099f575f80fd5b815180151581146108c9575f80fdfea2646970667358221220102a26af16b60f4b576ab29b4e036d6e6ed52b2f75fecb9e06bd43e657d45e4d64736f6c63430008180033";
var EXECUTOR_NORMALIZED_RUNTIME_CODE_HASH = "0xa7f073a21c09677f888baa49343d517f52d13383d84010a86ffff9a0d1a8117f";
var EXECUTOR_IMMUTABLE_RANGES = [{ "start": 428, "length": 32 }, { "start": 744, "length": 32 }, { "start": 1097, "length": 32 }, { "start": 1271, "length": 32 }];
var EXECUTOR_BUILD_SOURCE_COMMIT = "374a3e9d9bf9b1eeb5ee5d5a4b1c7c6b2ebf43d3";

// src/adapters/evm-grant-verifier.ts
var ADDRESS2 = /^0x[0-9a-fA-F]{40}$/;
var HASH2 = /^0x[0-9a-fA-F]{64}$/;
var UINT256_MAX2 = (1n << 256n) - 1n;
var NETWORK_CHAIN_IDS = {
  ethereum: 1,
  polygon: 137,
  bsc: 56,
  avalanche: 43114,
  arbitrum: 42161,
  optimism: 10,
  base: 8453
};
function normalizedExecutorRuntimeHash(code) {
  if (!/^0x(?:[0-9a-fA-F]{2})+$/.test(code)) throw new Error("Malformed executor runtime bytecode.");
  const bytes = code.slice(2).toLowerCase().split("");
  const minBytes = Math.max(...EXECUTOR_IMMUTABLE_RANGES.map((range) => range.start + range.length));
  if (bytes.length < minBytes) return keccak256Hex(code);
  for (const range of EXECUTOR_IMMUTABLE_RANGES) {
    const start = range.start * 2, end = (range.start + range.length) * 2;
    if (end > bytes.length) throw new Error("Executor immutable reference is outside runtime bytecode.");
    for (let i = start; i < end; i++) bytes[i] = "0";
  }
  return keccak256Hex("0x" + bytes.join(""));
}
__name(normalizedExecutorRuntimeHash, "normalizedExecutorRuntimeHash");
var EvmGrantVerifier = class {
  constructor(config) {
    this.config = config;
    this.fetcher = config.fetcher ?? fetch;
    if (!/^https:\/\//i.test(config.rpcUrl)) throw new Error("A server-configured HTTPS RPC URL is required.");
    if (!HASH2.test(config.trustedExecutorCodeHash)) throw new Error("Trusted executor code hash is invalid.");
    if (!Number.isSafeInteger(config.expectedChainId) || config.expectedChainId <= 0) throw new Error("Expected EVM chain ID must be configured.");
    if (!ADDRESS2.test(config.expectedAutomationOperator) || !ADDRESS2.test(config.expectedAdminOperator)) throw new Error("Trusted execution operator addresses must be configured.");
  }
  config;
  static {
    __name(this, "EvmGrantVerifier");
  }
  nextId = 1;
  fetcher;
  async rpc(method, params) {
    const id = this.nextId++;
    const response2 = await this.fetcher(this.config.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params })
    });
    if (!response2.ok) throw new Error("Configured EVM RPC request failed.");
    const body3 = await response2.json();
    if (body3.error || body3.id !== id || !("result" in body3)) {
      throw new Error(body3.error?.message ? "EVM RPC error: " + body3.error.message : "Malformed EVM RPC response.");
    }
    return body3.result;
  }
  async call(to, signature, args = "") {
    const selector = keccak256Hex("0x" + Array.from(new TextEncoder().encode(signature), (b) => b.toString(16).padStart(2, "0")).join("")).slice(0, 10);
    const result = await this.rpc("eth_call", [{ to, data: selector + args }, "latest"]);
    if (typeof result !== "string" || !/^0x[0-9a-fA-F]*$/.test(result) || result.length < 66) {
      throw new Error("Malformed executor contract response for " + signature + ".");
    }
    return result;
  }
  async verify(grant, authenticatedWallet, now = Date.now()) {
    validateRecoveryGrant(grant, authenticatedWallet, grant.network, now);
    if (!["ethereum", "polygon", "bsc", "avalanche", "arbitrum", "optimism", "base"].includes(grant.network)) {
      throw new Error("This verifier supports EVM networks only.");
    }
    if (grant.evidence.kind !== "onchain-approval" || !HASH2.test(grant.evidence.reference)) {
      throw new Error("This executor requires an owner deployment transaction as authorization evidence.");
    }
    if (!ADDRESS2.test(grant.executorAddress) || !ADDRESS2.test(grant.ownerWallet) || !ADDRESS2.test(grant.destinationAddress)) {
      throw new Error("Malformed EVM address in grant.");
    }
    if (grant.executorCodeHash.toLowerCase() !== this.config.trustedExecutorCodeHash.toLowerCase()) {
      throw new Error("Grant executor hash is not in the server's trusted executor allowlist.");
    }
    const chainHex = await this.rpc("eth_chainId", []);
    if (typeof chainHex !== "string" || !/^0x[0-9a-fA-F]+$/.test(chainHex)) throw new Error("Malformed chain ID response.");
    const chainId = Number(BigInt(chainHex));
    const expectedNetworkChainId = NETWORK_CHAIN_IDS[grant.network];
    if (!Number.isSafeInteger(chainId) || expectedNetworkChainId === void 0 || chainId !== expectedNetworkChainId || chainId !== this.config.expectedChainId || chainId !== grant.chainId) {
      throw new Error("Connected RPC chain ID does not match the configured chain, network, and grant.");
    }
    const code = await this.rpc("eth_getCode", [grant.executorAddress, "latest"]);
    if (typeof code !== "string" || !/^0x[0-9a-fA-F]+$/.test(code) || code === "0x") throw new Error("Executor contract is not deployed.");
    const observedExecutorCodeHash = normalizedExecutorRuntimeHash(code);
    if (observedExecutorCodeHash.toLowerCase() !== this.config.trustedExecutorCodeHash.toLowerCase()) {
      throw new Error("Deployed executor runtime bytecode hash is not trusted.");
    }
    const receipt = await this.rpc("eth_getTransactionReceipt", [grant.evidence.reference]);
    if (!receipt || receipt.status !== "0x1" || receipt.from?.toLowerCase() !== grant.ownerWallet.toLowerCase() || receipt.contractAddress?.toLowerCase() !== grant.executorAddress.toLowerCase()) {
      throw new Error("Owner deployment transaction receipt does not prove this executor deployment.");
    }
    if (!receipt.blockNumber || !/^0x[0-9a-fA-F]+$/.test(receipt.blockNumber)) throw new Error("Deployment receipt is missing its block number.");
    const block = await this.rpc("eth_getBlockByNumber", [receipt.blockNumber, false]);
    if (!block?.timestamp || !/^0x[0-9a-fA-F]+$/.test(block.timestamp)) throw new Error("Deployment block timestamp is unavailable.");
    const deployedAt = Number(BigInt(block.timestamp)) * 1e3;
    if (Math.abs(Date.parse(grant.approvedAt) - deployedAt) > 1e3) throw new Error("Grant approval timestamp does not match the owner deployment block.");
    const owner = this.decodeAddress(await this.call(grant.executorAddress, "owner()"));
    const destination = this.decodeAddress(await this.call(grant.executorAddress, "destination()"));
    const expiry = BigInt("0x" + (await this.call(grant.executorAddress, "expiresAt()")).slice(-64));
    const revoked = BigInt("0x" + (await this.call(grant.executorAddress, "revoked()")).slice(-64));
    const expectedExpiry = BigInt(Math.floor(Date.parse(grant.expiresAt) / 1e3));
    if (owner !== grant.ownerWallet.toLowerCase()) throw new Error("Executor owner does not match the grant owner.");
    if (destination !== grant.destinationAddress.toLowerCase()) throw new Error("Executor destination does not match the approved destination.");
    if (expiry !== expectedExpiry || expiry <= BigInt(Math.floor(now / 1e3))) throw new Error("Executor expiry is mismatched or expired.");
    if (revoked !== 0n) throw new Error("Executor grant has been revoked on-chain.");
    const automaticEnabled = BigInt("0x" + (await this.call(grant.executorAddress, "automaticPriorityEnabled()")).slice(-64)) === 1n;
    const adminEnabled = BigInt("0x" + (await this.call(grant.executorAddress, "adminInitiatedEnabled()")).slice(-64)) === 1n;
    if (automaticEnabled !== grant.executionModes.includes("automatic-priority") || adminEnabled !== grant.executionModes.includes("admin-initiated")) {
      throw new Error("On-chain execution modes do not match the owner's declared authorization.");
    }
    const automationOperator = this.decodeAddress(await this.call(grant.executorAddress, "automationOperator()"));
    const adminOperator = this.decodeAddress(await this.call(grant.executorAddress, "adminOperator()"));
    if (automationOperator !== grant.executionOperators.automation.toLowerCase() || adminOperator !== grant.executionOperators.administrator.toLowerCase() || automationOperator !== this.config.expectedAutomationOperator.toLowerCase() || adminOperator !== this.config.expectedAdminOperator.toLowerCase()) {
      throw new Error("Immutable executor operators do not match the owner grant and trusted Mainwell service identities.");
    }
    const authorizedCount = BigInt("0x" + (await this.call(grant.executorAddress, "authorizedAssetCount()")).slice(-64));
    if (authorizedCount !== BigInt(grant.assets.length)) throw new Error("On-chain authorized asset count does not match the grant.");
    const assets = [];
    for (let assetIndex = 0; assetIndex < grant.assets.length; assetIndex++) {
      const asset = grant.assets[assetIndex];
      const indexArg = BigInt(assetIndex).toString(16).padStart(64, "0");
      const onchainAsset = this.decodeAddress(await this.call(grant.executorAddress, "authorizedAssetAt(uint256)", indexArg));
      if (!asset.tokenAddress || !ADDRESS2.test(asset.tokenAddress)) throw new Error("Native assets are not supported by this ERC-20 executor.");
      const token = asset.tokenAddress.toLowerCase();
      if (onchainAsset !== token) throw new Error("On-chain asset order or token address does not match the grant.");
      const onchainDestination = this.decodeAddress(await this.call(grant.executorAddress, "assetDestination(address)", token.slice(2).padStart(64, "0")));
      if (!ADDRESS2.test(asset.destinationAddress) || onchainDestination !== asset.destinationAddress.toLowerCase()) {
        throw new Error("On-chain destination for asset " + asset.assetId + " does not match its owner-approved destination.");
      }
      const destinationAtIndex = this.decodeAddress(await this.call(grant.executorAddress, "authorizedAssetDestinationAt(uint256)", indexArg));
      if (destinationAtIndex !== onchainDestination) throw new Error("On-chain asset destination index does not match its immutable mapping.");
      const arg = token.slice(2).padStart(64, "0");
      const cap = BigInt("0x" + (await this.call(grant.executorAddress, "assetLimit(address)", arg)).slice(-64));
      const recovered = BigInt("0x" + (await this.call(grant.executorAddress, "amountRecovered(address)", arg)).slice(-64));
      const expectedCap = asset.amount.kind === "capped" ? BigInt(asset.amount.maxAmountRaw) : UINT256_MAX2;
      if (cap !== expectedCap || recovered > cap) throw new Error("On-chain asset cap does not exactly match the owner's grant for " + asset.assetId + ".");
      const allowanceArg = grant.ownerWallet.slice(2).padStart(64, "0") + grant.executorAddress.slice(2).padStart(64, "0");
      const allowance = BigInt("0x" + (await this.call(token, "allowance(address,address)", allowanceArg)).slice(-64));
      const remaining = cap - recovered;
      if (allowance < remaining) throw new Error("Live ERC-20 allowance is below the remaining authorized scope for " + asset.assetId + ".");
      assets.push({ tokenAddress: token, destinationAddress: onchainDestination, cap: cap.toString(), recovered: recovered.toString(), allowance: allowance.toString(), remaining: remaining.toString() });
    }
    return {
      verifiedAt: new Date(now).toISOString(),
      observedExecutorCodeHash,
      chainId,
      executor: grant.executorAddress.toLowerCase(),
      destination,
      expiresAt: Number(expiry),
      assets
    };
  }
  async verifyAssetRevocation(grant, authenticatedWallet, tokenAddress, transactionHash, now = Date.now()) {
    if (grant.ownerWallet.toLowerCase() !== authenticatedWallet.toLowerCase()) throw new Error("Grant owner does not match the authenticated wallet.");
    if (!ADDRESS2.test(tokenAddress) || !HASH2.test(transactionHash)) throw new Error("Asset address or revocation transaction hash is invalid.");
    const asset = grant.assets.find((item) => item.tokenAddress?.toLowerCase() === tokenAddress.toLowerCase());
    if (!asset) throw new Error("Asset is not part of this owner grant.");
    const chainHex = await this.rpc("eth_chainId", []);
    if (typeof chainHex !== "string" || !/^0x[0-9a-fA-F]+$/.test(chainHex) || Number(BigInt(chainHex)) !== this.config.expectedChainId || this.config.expectedChainId !== NETWORK_CHAIN_IDS[grant.network] || grant.chainId !== this.config.expectedChainId) {
      throw new Error("Asset revocation RPC chain does not match the stored grant.");
    }
    const code = await this.rpc("eth_getCode", [grant.executorAddress, "latest"]);
    if (typeof code !== "string" || code === "0x" || normalizedExecutorRuntimeHash(code).toLowerCase() !== this.config.trustedExecutorCodeHash.toLowerCase()) {
      throw new Error("Executor runtime bytecode is no longer trusted.");
    }
    const executorOwner = this.decodeAddress(await this.call(grant.executorAddress, "owner()"));
    if (executorOwner !== authenticatedWallet.toLowerCase()) throw new Error("Executor owner does not match the authenticated wallet.");
    const selector = keccak256Hex("0x" + Array.from(new TextEncoder().encode("revokeAsset(address)"), (b) => b.toString(16).padStart(2, "0")).join("")).slice(0, 10);
    const expectedInput = selector + tokenAddress.slice(2).toLowerCase().padStart(64, "0");
    const tx = await this.rpc("eth_getTransactionByHash", [transactionHash]);
    const receipt = await this.rpc("eth_getTransactionReceipt", [transactionHash]);
    if (!tx || !receipt || receipt.status !== "0x1" || tx.from?.toLowerCase() !== authenticatedWallet.toLowerCase() || tx.to?.toLowerCase() !== grant.executorAddress.toLowerCase() || tx.input?.toLowerCase() !== expectedInput) {
      throw new Error("Transaction does not prove that the authenticated owner successfully called revokeAsset() for this token.");
    }
    const arg = tokenAddress.slice(2).toLowerCase().padStart(64, "0");
    const cap = BigInt("0x" + (await this.call(grant.executorAddress, "assetLimit(address)", arg)).slice(-64));
    const recovered = BigInt("0x" + (await this.call(grant.executorAddress, "amountRecovered(address)", arg)).slice(-64));
    if (cap !== recovered) throw new Error("Executor has not disabled further recovery for this asset.");
    if (!receipt.blockNumber || !/^0x[0-9a-fA-F]+$/.test(receipt.blockNumber)) throw new Error("Asset revocation receipt is missing its block number.");
    const block = await this.rpc("eth_getBlockByNumber", [receipt.blockNumber, false]);
    if (!block?.timestamp || !/^0x[0-9a-fA-F]+$/.test(block.timestamp)) throw new Error("Asset revocation block timestamp is unavailable.");
    const revokedAt = new Date(Number(BigInt(block.timestamp)) * 1e3).toISOString();
    if (Date.parse(revokedAt) < Date.parse(grant.approvedAt) || Date.parse(revokedAt) > now + 6e4) {
      throw new Error("Asset revocation block timestamp is outside the authorization window.");
    }
    return { revokedAt, transactionHash: transactionHash.toLowerCase(), tokenAddress: tokenAddress.toLowerCase() };
  }
  async verifyRevocation(grant, authenticatedWallet, transactionHash, now = Date.now()) {
    if (grant.ownerWallet.toLowerCase() !== authenticatedWallet.toLowerCase()) {
      throw new Error("Grant owner does not match the authenticated wallet.");
    }
    if (!HASH2.test(transactionHash)) throw new Error("A valid revocation transaction hash is required.");
    const chainHex = await this.rpc("eth_chainId", []);
    if (typeof chainHex !== "string" || !/^0x[0-9a-fA-F]+$/.test(chainHex) || Number(BigInt(chainHex)) !== this.config.expectedChainId || this.config.expectedChainId !== NETWORK_CHAIN_IDS[grant.network] || grant.chainId !== this.config.expectedChainId) {
      throw new Error("Revocation RPC chain does not match the stored grant.");
    }
    const code = await this.rpc("eth_getCode", [grant.executorAddress, "latest"]);
    if (typeof code !== "string" || code === "0x" || keccak256Hex(code).toLowerCase() !== this.config.trustedExecutorCodeHash.toLowerCase()) {
      throw new Error("Executor runtime bytecode is no longer trusted.");
    }
    const executorOwner = this.decodeAddress(await this.call(grant.executorAddress, "owner()"));
    if (executorOwner !== authenticatedWallet.toLowerCase()) throw new Error("Executor owner does not match the authenticated wallet.");
    const tx = await this.rpc("eth_getTransactionByHash", [transactionHash]);
    const receipt = await this.rpc("eth_getTransactionReceipt", [transactionHash]);
    const revokeSelector = keccak256Hex("0x" + Array.from(new TextEncoder().encode("revoke()"), (b) => b.toString(16).padStart(2, "0")).join("")).slice(0, 10);
    if (!tx || !receipt || receipt.status !== "0x1" || tx.from?.toLowerCase() !== authenticatedWallet.toLowerCase() || tx.to?.toLowerCase() !== grant.executorAddress.toLowerCase() || tx.input?.toLowerCase() !== revokeSelector) {
      throw new Error("Transaction does not prove that the authenticated owner successfully called revoke() on this executor.");
    }
    const revoked = BigInt("0x" + (await this.call(grant.executorAddress, "revoked()")).slice(-64));
    if (revoked !== 1n) throw new Error("Executor does not report an on-chain revoked state.");
    if (!receipt.blockNumber || !/^0x[0-9a-fA-F]+$/.test(receipt.blockNumber)) throw new Error("Revocation receipt is missing its block number.");
    const block = await this.rpc("eth_getBlockByNumber", [receipt.blockNumber, false]);
    if (!block?.timestamp || !/^0x[0-9a-fA-F]+$/.test(block.timestamp)) throw new Error("Revocation block timestamp is unavailable.");
    const revokedAt = new Date(Number(BigInt(block.timestamp)) * 1e3).toISOString();
    if (Date.parse(revokedAt) < Date.parse(grant.approvedAt)) throw new Error("Revocation block predates the owner authorization.");
    if (Date.parse(revokedAt) > now + 6e4) throw new Error("Revocation block timestamp is unexpectedly in the future.");
    return { revokedAt, transactionHash: transactionHash.toLowerCase() };
  }
  decodeAddress(data) {
    const word = data.slice(-64);
    if (!/^[0-9a-fA-F]{64}$/.test(word) || !/^0{24}/i.test(word)) throw new Error("Malformed address returned by executor.");
    return "0x" + word.slice(24).toLowerCase();
  }
};

// src/persistence/d1-grant-repository.ts
function parseModes(value) {
  const parsed = JSON.parse(value);
  if (!Array.isArray(parsed) || parsed.some(
    (mode) => mode !== "automatic-priority" && mode !== "admin-initiated"
  )) throw new Error("Stored grant has invalid execution modes.");
  return parsed;
}
__name(parseModes, "parseModes");
function mapAsset(row) {
  return {
    assetId: row.asset_id,
    ...row.token_address ? { tokenAddress: row.token_address } : {},
    destinationAddress: row.destination_address,
    amount: row.amount_kind === "capped" ? { kind: "capped", maxAmountRaw: row.max_amount_raw ?? "" } : { kind: "unlimited-allowance", ownerAcknowledged: true },
    ...row.revoked_at ? { revokedAt: row.revoked_at } : {}
  };
}
__name(mapAsset, "mapAsset");
var D1GrantRepository = class {
  constructor(db) {
    this.db = db;
  }
  db;
  static {
    __name(this, "D1GrantRepository");
  }
  async saveVerified(record) {
    const { grant } = record;
    if (!record.verifiedAt || !Number.isFinite(Date.parse(record.verifiedAt))) {
      throw new Error("A valid server verification timestamp is required.");
    }
    validateRecoveryGrant(grant, grant.ownerWallet, grant.network, Date.parse(record.verifiedAt));
    if (grant.revokedAt) throw new Error("A revoked grant cannot be persisted as verified.");
    if (record.observedExecutorCodeHash.toLowerCase() !== grant.executorCodeHash.toLowerCase()) {
      throw new Error("Observed executor code hash does not match the approved grant.");
    }
    const grantStatement = this.db.prepare(`
      INSERT INTO recovery_grants (
        grant_id, owner_wallet, network, chain_id, executor_address,
        executor_code_hash, destination_address, execution_modes_json,
        automation_operator, admin_operator, evidence_kind, evidence_reference, approved_at, expires_at,
        revoked_at, verification_status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'verified', ?, ?)
      ON CONFLICT(grant_id) DO NOTHING
    `).bind(
      grant.grantId,
      grant.ownerWallet.toLowerCase(),
      grant.network,
      grant.chainId ?? null,
      grant.executorAddress.toLowerCase(),
      grant.executorCodeHash.toLowerCase(),
      grant.destinationAddress.toLowerCase(),
      JSON.stringify(grant.executionModes),
      grant.executionOperators.automation.toLowerCase(),
      grant.executionOperators.administrator.toLowerCase(),
      grant.evidence.kind,
      grant.evidence.reference,
      grant.approvedAt,
      grant.expiresAt,
      record.verifiedAt,
      record.verifiedAt
    );
    const statements = [grantStatement];
    for (const asset of grant.assets) {
      statements.push(this.db.prepare(`
        INSERT INTO recovery_grant_assets (
          grant_id, asset_id, token_address, amount_kind, max_amount_raw, owner_acknowledged, destination_address
        )
        SELECT ?, ?, ?, ?, ?, ?, ?
        WHERE changes() = 1 AND EXISTS (
          SELECT 1 FROM recovery_grants
          WHERE grant_id = ? AND verification_status = 'verified'
        )
      `).bind(
        grant.grantId,
        asset.assetId,
        asset.tokenAddress?.toLowerCase() ?? null,
        asset.amount.kind,
        asset.amount.kind === "capped" ? asset.amount.maxAmountRaw : null,
        asset.amount.kind === "unlimited-allowance" && asset.amount.ownerAcknowledged ? 1 : 0,
        asset.destinationAddress.toLowerCase(),
        grant.grantId
      ));
    }
    const results = await this.db.batch(statements);
    if (results.some((result) => !result.success)) {
      throw new Error("D1 did not confirm every recovery grant write.");
    }
    if ((results[0]?.meta?.changes ?? 0) < 1) {
      throw new Error("Grant is already revoked or was not eligible for verification; reauthorization is required.");
    }
  }
  async getById(grantId) {
    const row = await this.db.prepare(`
      SELECT * FROM recovery_grants
      WHERE grant_id = ? AND verification_status = 'verified'
        AND revoked_at IS NULL AND expires_at > ?
      LIMIT 1
    `).bind(grantId, (/* @__PURE__ */ new Date()).toISOString()).first();
    if (!row || row.verification_status !== "verified") return null;
    const assets = await this.db.prepare(`
      SELECT asset_id, token_address, amount_kind, max_amount_raw, owner_acknowledged, revoked_at, destination_address
      FROM recovery_grant_assets WHERE grant_id = ? ORDER BY asset_id
    `).bind(grantId).all();
    return {
      grantId: row.grant_id,
      ownerWallet: row.owner_wallet,
      network: row.network,
      ...row.chain_id === null ? {} : { chainId: row.chain_id },
      executorAddress: row.executor_address,
      executorCodeHash: row.executor_code_hash,
      destinationAddress: row.destination_address,
      executionModes: parseModes(row.execution_modes_json),
      executionOperators: { automation: row.automation_operator, administrator: row.admin_operator },
      assets: assets.results.map(mapAsset),
      approvedAt: row.approved_at,
      expiresAt: row.expires_at,
      evidence: { kind: row.evidence_kind, reference: row.evidence_reference },
      ...row.revoked_at ? { revokedAt: row.revoked_at } : {}
    };
  }
  async markAssetRevoked(grantId, assetId, revokedAt) {
    if (!Number.isFinite(Date.parse(revokedAt))) throw new Error("Invalid asset revocation timestamp.");
    const result = await this.db.prepare(`
      UPDATE recovery_grant_assets
      SET revoked_at = ?
      WHERE grant_id = ? AND asset_id = ? AND revoked_at IS NULL
        AND EXISTS (
          SELECT 1 FROM recovery_grants
          WHERE grant_id = ? AND verification_status = 'verified'
            AND revoked_at IS NULL
        )
    `).bind(revokedAt, grantId, assetId, grantId).run();
    return (result.meta?.changes ?? 0) === 1;
  }
  async markRevoked(grantId, revokedAt) {
    if (!Number.isFinite(Date.parse(revokedAt))) throw new Error("Invalid revocation timestamp.");
    const result = await this.db.prepare(`
      UPDATE recovery_grants
      SET revoked_at = ?, verification_status = 'revoked', updated_at = ?
      WHERE grant_id = ? AND verification_status = 'verified' AND revoked_at IS NULL
    `).bind(revokedAt, revokedAt, grantId).run();
    return (result.meta?.changes ?? 0) === 1;
  }
};

// src/application/verify-and-persist-evm-grant.ts
async function verifyAndPersistEvmGrant(db, config, authenticatedWallet, grant, now = Date.now()) {
  const verifier = new EvmGrantVerifier(config);
  const verified = await verifier.verify(grant, authenticatedWallet, now);
  const repository = new D1GrantRepository(db);
  await repository.saveVerified({
    grant,
    verifiedAt: verified.verifiedAt,
    observedExecutorCodeHash: verified.observedExecutorCodeHash
  });
  return verified;
}
__name(verifyAndPersistEvmGrant, "verifyAndPersistEvmGrant");

// src/application/owner-api.ts
var NETWORK_CHAIN = {
  ethereum: 1,
  polygon: 137,
  bsc: 56,
  avalanche: 43114,
  arbitrum: 42161,
  optimism: 10,
  base: 8453
};
var NETWORKS = new Set(Object.keys(NETWORK_CHAIN));
var ADDRESS3 = /^0x[0-9a-fA-F]{40}$/;
function reply(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer"
  } });
}
__name(reply, "reply");
function validOrigin(request, url) {
  return request.headers.get("origin") === url.origin;
}
__name(validOrigin, "validOrigin");
async function readBody(request) {
  if (Number(request.headers.get("content-length") ?? "0") > 2048) return null;
  try {
    const raw = await request.text();
    if (raw.length > 2048) return null;
    const value = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}
__name(readBody, "readBody");
var GRANT_RPC = {
  ethereum: "EVM_RPC_ETHEREUM",
  polygon: "EVM_RPC_POLYGON",
  bsc: "EVM_RPC_BSC",
  avalanche: "EVM_RPC_AVALANCHE",
  arbitrum: "EVM_RPC_ARBITRUM",
  optimism: "EVM_RPC_OPTIMISM",
  base: "EVM_RPC_BASE"
};
var GRANT_HASH = {
  ethereum: "MAINWELL_EXECUTOR_CODE_HASH_ETHEREUM",
  polygon: "MAINWELL_EXECUTOR_CODE_HASH_POLYGON",
  bsc: "MAINWELL_EXECUTOR_CODE_HASH_BSC",
  avalanche: "MAINWELL_EXECUTOR_CODE_HASH_AVALANCHE",
  arbitrum: "MAINWELL_EXECUTOR_CODE_HASH_ARBITRUM",
  optimism: "MAINWELL_EXECUTOR_CODE_HASH_OPTIMISM",
  base: "MAINWELL_EXECUTOR_CODE_HASH_BASE"
};
async function readGrantBody(request) {
  if (Number(request.headers.get("content-length") ?? "0") > 16384) return null;
  try {
    const raw = await request.text();
    if (raw.length > 16384) return null;
    const value = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}
__name(readGrantBody, "readGrantBody");
function grantVerifierConfig(env, network, chainId) {
  const rpcName = GRANT_RPC[network], hashName = GRANT_HASH[network];
  const rpcUrl = rpcName ? env[rpcName] : void 0;
  const configuredExecutorCodeHash = hashName ? env[hashName] : void 0;
  if (configuredExecutorCodeHash && configuredExecutorCodeHash.toLowerCase() !== EXECUTOR_NORMALIZED_RUNTIME_CODE_HASH.toLowerCase()) throw new Error("EXECUTOR_CODE_HASH_MISMATCH");
  const trustedExecutorCodeHash = EXECUTOR_NORMALIZED_RUNTIME_CODE_HASH;
  const expectedAutomationOperator = env.MAINWELL_AUTOMATION_OPERATOR;
  const expectedAdminOperator = env.MAINWELL_ADMIN_OPERATOR;
  if (!rpcUrl || !trustedExecutorCodeHash || !expectedAutomationOperator || !expectedAdminOperator) throw new Error("GRANT_VERIFIER_NOT_CONFIGURED");
  return { rpcUrl, trustedExecutorCodeHash, expectedChainId: chainId, expectedAutomationOperator, expectedAdminOperator };
}
__name(grantVerifierConfig, "grantVerifierConfig");
function limitFrom(url) {
  const value = Number(url.searchParams.get("limit") ?? "50");
  return Number.isInteger(value) ? Math.min(100, Math.max(1, value)) : 50;
}
__name(limitFrom, "limitFrom");
function ownerFilter(session2) {
  return session2.wallet.toLowerCase();
}
__name(ownerFilter, "ownerFilter");
async function handleOwnerApi(request, env, session2) {
  const url = new URL(request.url), path = url.pathname, owner = ownerFilter(session2);
  if (path === "/api/owner/executor-artifact" && request.method === "GET") {
    return reply({
      contractName: "ScopedRecoveryExecutor",
      creationBytecode: EXECUTOR_CREATION_BYTECODE,
      normalizedRuntimeCodeHash: EXECUTOR_NORMALIZED_RUNTIME_CODE_HASH,
      immutableRanges: EXECUTOR_IMMUTABLE_RANGES,
      sourceCommit: EXECUTOR_BUILD_SOURCE_COMMIT,
      compiler: "solc 0.8.24",
      optimizer: { enabled: true, runs: 200 }
    });
  }
  if (path === "/api/owner/authorization-plan" && request.method === "GET") {
    const network = Object.entries(NETWORK_CHAIN).find(([, chain]) => chain === session2.chainId)?.[0];
    if (!network) return reply({ error: "Unsupported wallet network." }, 400);
    const wallet = await env.DB.prepare(`
      SELECT id, network, chain_id, status, admin_locked
      FROM recovery_wallets
      WHERE owner_address = ? AND network = ?
      LIMIT 1
    `).bind(owner, network).first();
    const missingWalletHashName = GRANT_HASH[network];
    const missingWalletConfiguredHash = missingWalletHashName ? env[missingWalletHashName] : void 0;
    if (!wallet) return reply({
      network,
      chainId: session2.chainId,
      ownerWallet: owner,
      sourceWallet: null,
      assets: [],
      policies: [],
      readiness: {
        sourceWalletLocked: false,
        rpcConfigured: Boolean(env[GRANT_RPC[network]]),
        executorCodeHashConfigured: !missingWalletConfiguredHash || missingWalletConfiguredHash.toLowerCase() === EXECUTOR_NORMALIZED_RUNTIME_CODE_HASH.toLowerCase(),
        automationOperatorConfigured: Boolean(env.MAINWELL_AUTOMATION_OPERATOR),
        adminOperatorConfigured: Boolean(env.MAINWELL_ADMIN_OPERATOR),
        executorArtifactAvailable: true
      },
      blockers: ["This exact wallet and network have not yet been registered by an administrator."]
    });
    const assetRows = await env.DB.prepare(`
      SELECT a.asset_ref AS assetId, a.token_address AS tokenAddress, a.symbol, a.name,
             a.amount_raw AS balanceRaw, a.decimals, a.observed_at AS observedAt,
             s.id AS supportedAssetId
      FROM wallet_assets a
      LEFT JOIN recovery_supported_assets s
        ON s.network = a.network AND s.token_address = a.token_address AND s.is_active = 1
      WHERE a.wallet_id = ?
      ORDER BY a.symbol, a.asset_ref
    `).bind(wallet.id).all();
    if (!assetRows.success) return reply({ error: "Unable to load the wallet asset inventory." }, 503);
    const policyRows = await env.DB.prepare(`
      SELECT p.asset_id AS assetId, d.id AS destinationId, d.address AS destinationAddress,
             p.max_amount_raw AS maxAmountRaw,
             p.automatic_priority_enabled AS automaticPriorityEnabled,
             p.admin_initiated_enabled AS adminInitiatedEnabled,
             p.expires_in_seconds AS expiresInSeconds
      FROM recovery_asset_destination_policies p
      INNER JOIN recovery_destinations d ON d.id = p.destination_id
      WHERE p.network = ? AND d.locked = 1 AND d.is_active = 1
      ORDER BY p.asset_id
    `).bind(network).all();
    if (!policyRows.success) return reply({ error: "Unable to load locked asset destination policies." }, 503);
    const rpcName = GRANT_RPC[network], hashName = GRANT_HASH[network];
    const readiness = {
      sourceWalletLocked: Number(wallet.admin_locked) === 1 && wallet.status !== "revoked",
      rpcConfigured: Boolean(rpcName && env[rpcName]),
      executorCodeHashConfigured: !(hashName ? env[hashName] : void 0) || (hashName ? env[hashName]?.toLowerCase() : void 0) === EXECUTOR_NORMALIZED_RUNTIME_CODE_HASH.toLowerCase(),
      automationOperatorConfigured: Boolean(env.MAINWELL_AUTOMATION_OPERATOR),
      adminOperatorConfigured: Boolean(env.MAINWELL_ADMIN_OPERATOR),
      executorArtifactAvailable: true,
      securityReviewPassed: true,
      independentAuditPassed: false,
      executionOperators: { automation: env.MAINWELL_AUTOMATION_OPERATOR ?? "0x0000000000000000000000000000000000000000", administrator: env.MAINWELL_ADMIN_OPERATOR ?? "0x0000000000000000000000000000000000000000" }
    };
    const assetPolicyMap = new Map(policyRows.results.map((row) => [String(row.assetId), row]));
    const scopedAssets = assetRows.results.map((asset) => {
      const policy = assetPolicyMap.get(String(asset.assetId));
      const isToken = typeof asset.tokenAddress === "string" && ADDRESS3.test(asset.tokenAddress) && typeof asset.supportedAssetId === "string";
      const cap = typeof policy?.maxAmountRaw === "string" && /^[1-9][0-9]{0,77}$/.test(policy.maxAmountRaw) && BigInt(policy.maxAmountRaw) <= (1n << 256n) - 1n;
      const modes = Boolean(Number(policy?.automaticPriorityEnabled) || Number(policy?.adminInitiatedEnabled));
      return { ...asset, policy: policy ?? null, authorizationEligible: Boolean(isToken && policy && cap && modes) };
    });
    const blockers = [];
    if (!readiness.sourceWalletLocked) blockers.push("The administrator has not locked this exact source wallet and network.");
    if (!readiness.rpcConfigured) blockers.push("The trusted RPC endpoint is not configured for this network.");
    if (!readiness.automationOperatorConfigured || !readiness.adminOperatorConfigured) blockers.push("Trusted automatic and administrator operator identities are not fully configured.");
    if (scopedAssets.some((asset) => !asset.authorizationEligible)) blockers.push("One or more monitored assets do not have a valid ERC-20 cap, locked destination, and at least one enabled execution mode.");
    if (!readiness.executorArtifactAvailable) blockers.push("The reproducible executor deployment artifact is unavailable.");
    return reply({
      network,
      chainId: session2.chainId,
      ownerWallet: owner,
      sourceWallet: { id: wallet.id, status: wallet.status, adminLocked: readiness.sourceWalletLocked },
      assets: scopedAssets,
      policies: policyRows.results,
      readiness,
      blockers
    });
  }
  if (path === "/api/owner/recovery-destinations" && request.method === "GET") {
    const network = url.searchParams.get("network");
    if (network && !NETWORKS.has(network)) return reply({ error: "Unsupported network." }, 400);
    const sql = "SELECT id, network, address, locked, updated_at FROM recovery_destinations WHERE is_active = 1 AND locked = 1" + (network ? " AND network = ?" : "") + " ORDER BY network";
    const statement = env.DB.prepare(sql);
    const rows = await (network ? statement.bind(network) : statement).all();
    return rows.success ? reply({ destinations: rows.results }) : reply({ error: "Unable to load locked destinations." }, 503);
  }
  if (path === "/api/owner/recovery-destination-policies" && request.method === "GET") {
    const network = url.searchParams.get("network");
    if (!network || !NETWORKS.has(network)) return reply({ error: "A supported network is required." }, 400);
    const rows = await env.DB.prepare(`
      SELECT p.asset_id AS assetId, d.id AS destinationId, d.address AS destinationAddress
      FROM recovery_asset_destination_policies p
      INNER JOIN recovery_destinations d ON d.id = p.destination_id
      WHERE p.network = ? AND d.locked = 1 AND d.is_active = 1
      ORDER BY p.asset_id
    `).bind(network).all();
    return rows.success ? reply({ network, policies: rows.results }) : reply({ error: "Unable to load asset destination policies." }, 503);
  }
  if (path === "/api/owner/profile" && request.method === "GET") {
    const result = await env.DB.prepare(`
      SELECT COUNT(*) AS wallet_count FROM recovery_wallets WHERE owner_address = ?
    `).bind(owner).first();
    const grants = await env.DB.prepare(`
      SELECT COUNT(*) AS grant_count FROM recovery_grants
      WHERE owner_wallet = ? AND verification_status = 'verified'
        AND revoked_at IS NULL AND expires_at > ?
    `).bind(owner, (/* @__PURE__ */ new Date()).toISOString()).first();
    return reply({
      wallet: owner,
      authenticatedChainId: session2.chainId,
      monitoredWalletCount: result?.wallet_count ?? 0,
      activeVerifiedGrantCount: grants?.grant_count ?? 0
    });
  }
  if (path === "/api/owner/wallets" && request.method === "GET") {
    const rows = await env.DB.prepare(`
      SELECT w.id, w.owner_address, w.network, w.chain_id, w.status,
             w.first_seen_at, w.created_at, w.updated_at,
             a.id AS asset_row_id, a.asset_ref, a.token_address, a.symbol, a.name,
             a.amount_raw, a.decimals, a.estimated_value_usd, a.price_observed_at,
             a.valuation_confidence, a.observed_at
      FROM recovery_wallets w
      LEFT JOIN wallet_assets a ON a.wallet_id = w.id
      WHERE w.owner_address = ?
      ORDER BY w.network, a.observed_at DESC
    `).bind(owner).all();
    if (!rows.success) return reply({ error: "Unable to load owner wallets." }, 503);
    const wallets = /* @__PURE__ */ new Map();
    for (const row of rows.results) {
      const id = String(row.id);
      if (!wallets.has(id)) wallets.set(id, {
        id,
        address: row.owner_address,
        network: row.network,
        chainId: row.chain_id,
        status: row.status,
        adminLocked: Number(row.admin_locked) === 1,
        firstSeenAt: row.first_seen_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        assets: []
      });
      if (row.asset_row_id) {
        wallets.get(id).assets.push({
          id: row.asset_row_id,
          assetId: row.asset_ref,
          tokenAddress: row.token_address,
          symbol: row.symbol,
          name: row.name,
          amountRaw: row.amount_raw,
          decimals: row.decimals,
          estimatedValueUsd: row.estimated_value_usd,
          priceObservedAt: row.price_observed_at,
          valuationConfidence: row.valuation_confidence,
          observedAt: row.observed_at
        });
      }
    }
    return reply({ wallets: Array.from(wallets.values()) });
  }
  if (path === "/api/owner/wallets" && request.method === "POST") {
    if (!validOrigin(request, url)) return reply({ error: "Origin check failed." }, 403);
    const body3 = await readBody(request);
    const network = typeof body3?.network === "string" ? body3.network : "";
    const chainId = Number(body3?.chainId);
    if (!NETWORKS.has(network) || NETWORK_CHAIN[network] !== chainId || chainId !== session2.chainId) {
      return reply({ error: "The requested network must match the authenticated wallet session chain." }, 400);
    }
    const now = (/* @__PURE__ */ new Date()).toISOString(), id = crypto.randomUUID();
    const result = await env.DB.prepare(`
      INSERT INTO recovery_wallets (id, owner_address, network, chain_id, status, first_seen_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'monitoring', ?, ?, ?)
      ON CONFLICT(owner_address, network) DO NOTHING
    `).bind(id, owner, network, chainId, now, now, now).run();
    if (!result.success) return reply({ error: "Unable to register wallet for monitoring." }, 503);
    const wallet = await env.DB.prepare(`
      SELECT id, owner_address, network, chain_id, status, first_seen_at, created_at, updated_at
      FROM recovery_wallets WHERE owner_address = ? AND network = ? LIMIT 1
    `).bind(owner, network).first();
    if (!wallet) return reply({ error: "Wallet registration could not be confirmed." }, 503);
    if (wallet.status === "revoked") return reply({ error: "This wallet registration was revoked and cannot be reactivated through this endpoint." }, 409);
    await env.DB.prepare(`
      INSERT INTO audit_events (actor_type, actor_id, action, target_type, target_id, metadata_json, created_at)
      VALUES ('owner', ?, 'wallet.monitoring.register', 'recovery_wallet', ?, ?, ?)
    `).bind(owner, wallet.id, JSON.stringify({ network, chainId }), now).run();
    return reply({ wallet, created: (result.meta?.changes ?? 0) === 1 }, 200);
  }
  const refreshMatch = path.match(/^\/api\/owner\/wallets\/([0-9a-fA-F-]{36})\/refresh$/);
  if (refreshMatch && request.method === "POST") {
    if (!validOrigin(request, url)) return reply({ error: "Origin check failed." }, 403);
    const wallet = await env.DB.prepare(`
      SELECT id, owner_address AS address, network, chain_id, status
      FROM recovery_wallets WHERE id = ? AND owner_address = ? LIMIT 1
    `).bind(refreshMatch[1], owner).first();
    if (!wallet || wallet.status === "revoked") return reply({ error: "Wallet not found or unavailable." }, 404);
    if (wallet.status !== "monitoring") return reply({ error: "Monitoring is paused for this wallet." }, 409);
    try {
      const result = await refreshEvmWallet(env, wallet);
      return reply({
        refreshed: true,
        network: wallet.network,
        observedAt: result.observedAt,
        assets: result.assets.map((a) => ({
          id: a.id,
          symbol: a.symbol,
          name: a.name,
          amount: a.amount,
          decimals: a.decimals,
          contractAddress: a.contractAddress ?? null,
          estimatedValueUsd: a.estimatedValueUsd || null
        })),
        permissions: result.permissions
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Monitoring failed.";
      if (message === "RPC_NOT_CONFIGURED") return reply({ error: "This network's RPC endpoint is not configured on the server.", code: "rpc_not_configured" }, 503);
      return reply({ error: "Wallet monitoring failed. Check the network RPC and configured asset list.", code: "monitoring_failed" }, 502);
    }
  }
  const walletMatch = path.match(/^\/api\/owner\/wallets\/([0-9a-fA-F-]{36})$/);
  if (walletMatch && request.method === "PATCH") {
    if (!validOrigin(request, url)) return reply({ error: "Origin check failed." }, 403);
    const body3 = await readBody(request), status = body3?.status;
    if (status !== "monitoring" && status !== "paused") return reply({ error: "Status must be monitoring or paused." }, 400);
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const result = await env.DB.prepare(`
      UPDATE recovery_wallets SET status = ?, updated_at = ?
      WHERE id = ? AND owner_address = ? AND status != 'revoked'
    `).bind(status, now, walletMatch[1], owner).run();
    if (!result.success) return reply({ error: "Unable to update wallet monitoring." }, 503);
    if ((result.meta?.changes ?? 0) !== 1) return reply({ error: "Wallet not found or cannot be changed." }, 404);
    await env.DB.prepare(`
      INSERT INTO audit_events (actor_type, actor_id, action, target_type, target_id, metadata_json, created_at)
      VALUES ('owner', ?, 'wallet.monitoring.update', 'recovery_wallet', ?, ?, ?)
    `).bind(owner, walletMatch[1], JSON.stringify({ status }), now).run();
    return reply({ updated: true, status });
  }
  if (path === "/api/owner/grants/verify" && request.method === "POST") {
    if (!validOrigin(request, url)) return reply({ error: "Origin check failed." }, 403);
    const body3 = await readGrantBody(request);
    const grant = body3?.grant;
    if (!grant || typeof grant.network !== "string" || NETWORK_CHAIN[grant.network] !== session2.chainId || grant.chainId !== session2.chainId || typeof grant.ownerWallet !== "string" || grant.ownerWallet.toLowerCase() !== owner || !Array.isArray(grant.assets) || !Array.isArray(grant.executionModes) || !grant.executionOperators) {
      return reply({ error: "Grant must belong to the authenticated wallet and active session chain." }, 400);
    }
    const lockedWallet = await env.DB.prepare(
      "SELECT id FROM recovery_wallets WHERE owner_address = ? AND network = ? AND admin_locked = 1 AND status != 'revoked' LIMIT 1"
    ).bind(owner, grant.network).first();
    if (!lockedWallet) return reply({ error: "This source wallet has not been registered and locked by an administrator. Ask the administrator to configure this exact address and network first.", code: "source_wallet_not_locked" }, 409);
    if (grant.assets.length === 0 || grant.assets.length > 20 || grant.assets.some((asset) => !asset || typeof asset.assetId !== "string" || asset.assetId.length > 160)) {
      return reply({ error: "Grant must contain between 1 and 20 valid policy-bound assets." }, 400);
    }
    const assetIds = grant.assets.map((asset) => asset.assetId);
    if (new Set(assetIds).size !== assetIds.length) return reply({ error: "Duplicate assets are not permitted in one authorization." }, 400);
    const placeholders = assetIds.map(() => "?").join(",");
    const configuredPolicies = await env.DB.prepare(`
      SELECT p.asset_id AS assetId, p.max_amount_raw AS maxAmountRaw,
             p.automatic_priority_enabled AS automaticPriorityEnabled,
             p.admin_initiated_enabled AS adminInitiatedEnabled,
             p.expires_in_seconds AS expiresInSeconds,
             d.address AS destinationAddress, a.token_address AS tokenAddress
      FROM recovery_asset_destination_policies p
      INNER JOIN recovery_destinations d ON d.id = p.destination_id
      INNER JOIN recovery_supported_assets s ON s.id = p.asset_id AND s.network = p.network AND s.is_active = 1
      LEFT JOIN wallet_assets a ON a.wallet_id = ? AND a.network = p.network AND a.asset_ref = p.asset_id
      WHERE p.network = ? AND p.asset_id IN (${placeholders})
        AND d.locked = 1 AND d.is_active = 1
    `).bind(lockedWallet.id, grant.network, ...assetIds).all();
    if (!configuredPolicies.success || configuredPolicies.results.length !== grant.assets.length) {
      return reply({ error: "Every authorized asset must have a current administrator-locked destination and asset policy." }, 409);
    }
    let maximumExpirySeconds = Number.MAX_SAFE_INTEGER;
    for (const asset of grant.assets) {
      const policy = configuredPolicies.results.find((row) => String(row.assetId) === asset.assetId);
      const policyCapValid = typeof policy?.maxAmountRaw === "string" && /^[1-9][0-9]{0,77}$/.test(policy.maxAmountRaw) && BigInt(policy.maxAmountRaw) <= (1n << 256n) - 1n;
      if (!policy || !policyCapValid || typeof policy.tokenAddress !== "string" || !ADDRESS3.test(policy.tokenAddress) || !asset.tokenAddress || asset.tokenAddress.toLowerCase() !== policy.tokenAddress.toLowerCase() || !asset.amount || asset.amount.kind !== "capped" || asset.amount.maxAmountRaw !== policy.maxAmountRaw || typeof asset.destinationAddress !== "string" || asset.destinationAddress.toLowerCase() !== String(policy.destinationAddress).toLowerCase()) {
        return reply({ error: "The token, cap or destination in the grant does not exactly match the administrator's current asset policy." }, 409);
      }
      if (grant.executionModes.includes("automatic-priority") && Number(policy.automaticPriorityEnabled) !== 1) {
        return reply({ error: "Automatic-priority execution is not enabled for every selected asset." }, 409);
      }
      if (grant.executionModes.includes("admin-initiated") && Number(policy.adminInitiatedEnabled) !== 1) {
        return reply({ error: "Administrator-initiated execution is not enabled for every selected asset." }, 409);
      }
      maximumExpirySeconds = Math.min(maximumExpirySeconds, Number(policy.expiresInSeconds));
    }
    const grantDurationMs = Date.parse(grant.expiresAt) - Date.parse(grant.approvedAt);
    if (!Number.isFinite(grantDurationMs) || grantDurationMs <= 0 || grantDurationMs > maximumExpirySeconds * 1e3 + 1e3) {
      return reply({ error: "Grant expiry exceeds the shortest administrator-approved asset policy." }, 409);
    }
    try {
      const config = grantVerifierConfig(env, grant.network, session2.chainId);
      const verified = await verifyAndPersistEvmGrant(env.DB, config, owner, grant);
      const now = (/* @__PURE__ */ new Date()).toISOString();
      await env.DB.prepare("INSERT INTO audit_events (actor_type,actor_id,action,target_type,target_id,metadata_json,created_at) VALUES ('owner',?,'recovery.grant.verified','recovery_grant',?,?,?)").bind(owner, grant.grantId, JSON.stringify({ network: grant.network, chainId: verified.chainId, assets: verified.assets.length }), now).run();
      return reply({
        verified: true,
        grantId: grant.grantId,
        verifiedAt: verified.verifiedAt,
        network: grant.network,
        chainId: verified.chainId,
        executor: verified.executor,
        destination: verified.destination,
        assets: verified.assets
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message === "GRANT_VERIFIER_NOT_CONFIGURED") return reply({ error: "The trusted executor verifier is not configured for this network.", code: "grant_verifier_not_configured" }, 503);
      return reply({ error: "Owner authorization could not be verified against the live chain.", code: "grant_verification_failed" }, 400);
    }
  }
  const assetRevokeMatch = path.match(/^\/api\/owner\/grants\/([A-Za-z0-9_-]{1,128})\/assets\/([^/]+)\/revoke\/confirm$/);
  if (assetRevokeMatch && request.method === "POST") {
    if (!validOrigin(request, url)) return reply({ error: "Origin check failed." }, 403);
    const body3 = await readBody(request);
    const transactionHash = typeof body3?.transactionHash === "string" ? body3.transactionHash : "";
    const row = await env.DB.prepare("SELECT network, chain_id FROM recovery_grants WHERE grant_id = ? AND owner_wallet = ? AND verification_status = 'verified' AND revoked_at IS NULL LIMIT 1").bind(assetRevokeMatch[1], owner).first();
    if (!row) return reply({ error: "Active authorization not found for this wallet." }, 404);
    if (!row.chain_id || row.chain_id !== session2.chainId || NETWORK_CHAIN[row.network] !== row.chain_id) {
      return reply({ error: "Authorization network does not match the authenticated wallet session." }, 409);
    }
    try {
      const repository = new D1GrantRepository(env.DB);
      const grant = await repository.getById(assetRevokeMatch[1]);
      const asset = grant?.assets.find((item) => item.assetId === decodeURIComponent(assetRevokeMatch[2]));
      if (!grant || grant.ownerWallet.toLowerCase() !== owner || !asset?.tokenAddress) return reply({ error: "Authorized token was not found in this grant." }, 404);
      if (asset.revokedAt) return reply({ error: "This asset is already revoked." }, 409);
      const verifier = new EvmGrantVerifier(grantVerifierConfig(env, row.network, row.chain_id));
      const revocation = await verifier.verifyAssetRevocation(grant, owner, asset.tokenAddress, transactionHash);
      const marked = await repository.markAssetRevoked(grant.grantId, asset.assetId, revocation.revokedAt);
      if (!marked) return reply({ error: "Asset authorization state changed; refresh and check its current status." }, 409);
      await env.DB.prepare("INSERT INTO audit_events (actor_type,actor_id,action,target_type,target_id,metadata_json,created_at) VALUES ('owner',?,'recovery.grant.asset_revoked','recovery_grant_asset',?,?,?)").bind(owner, grant.grantId + ":" + asset.assetId, JSON.stringify({ tokenAddress: revocation.tokenAddress, transactionHash: revocation.transactionHash, revokedAt: revocation.revokedAt }), revocation.revokedAt).run();
      return reply({ revoked: true, grantId: grant.grantId, assetId: asset.assetId, revokedAt: revocation.revokedAt, transactionHash: revocation.transactionHash });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message === "GRANT_VERIFIER_NOT_CONFIGURED") return reply({ error: "The trusted executor verifier is not configured for this network.", code: "grant_verifier_not_configured" }, 503);
      return reply({ error: "On-chain asset revocation could not be verified.", code: "asset_revocation_verification_failed" }, 400);
    }
  }
  const revokeConfirmMatch = path.match(/^\/api\/owner\/grants\/([A-Za-z0-9_-]{1,128})\/revoke\/confirm$/);
  if (revokeConfirmMatch && request.method === "POST") {
    if (!validOrigin(request, url)) return reply({ error: "Origin check failed." }, 403);
    const body3 = await readBody(request);
    const transactionHash = typeof body3?.transactionHash === "string" ? body3.transactionHash : "";
    const row = await env.DB.prepare("SELECT network, chain_id FROM recovery_grants WHERE grant_id = ? AND owner_wallet = ? AND verification_status = 'verified' AND revoked_at IS NULL LIMIT 1").bind(revokeConfirmMatch[1], owner).first();
    if (!row) return reply({ error: "Active authorization not found for this wallet." }, 404);
    if (!row.chain_id || row.chain_id !== session2.chainId || NETWORK_CHAIN[row.network] !== row.chain_id) {
      return reply({ error: "Authorization network does not match the authenticated wallet session." }, 409);
    }
    try {
      const repository = new D1GrantRepository(env.DB);
      const grant = await repository.getById(revokeConfirmMatch[1]);
      if (!grant || grant.ownerWallet.toLowerCase() !== owner) return reply({ error: "Active authorization not found." }, 404);
      const verifier = new EvmGrantVerifier(grantVerifierConfig(env, row.network, row.chain_id));
      const revocation = await verifier.verifyRevocation(grant, owner, transactionHash);
      const marked = await repository.markRevoked(grant.grantId, revocation.revokedAt);
      if (!marked) return reply({ error: "Authorization state changed; refresh and check its current status." }, 409);
      await env.DB.prepare("INSERT INTO audit_events (actor_type,actor_id,action,target_type,target_id,metadata_json,created_at) VALUES ('owner',?,'recovery.grant.revoked','recovery_grant',?,?,?)").bind(owner, grant.grantId, JSON.stringify({ transactionHash: revocation.transactionHash, revokedAt: revocation.revokedAt }), revocation.revokedAt).run();
      return reply({ revoked: true, grantId: grant.grantId, revokedAt: revocation.revokedAt, transactionHash: revocation.transactionHash });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message === "GRANT_VERIFIER_NOT_CONFIGURED") return reply({ error: "The trusted executor verifier is not configured for this network.", code: "grant_verifier_not_configured" }, 503);
      return reply({ error: "On-chain revocation could not be verified.", code: "revocation_verification_failed" }, 400);
    }
  }
  if (path === "/api/owner/grants" && request.method === "GET") {
    const now = (/* @__PURE__ */ new Date()).toISOString(), limit = limitFrom(url);
    const grants = await env.DB.prepare(`
      SELECT grant_id, owner_wallet, network, chain_id, executor_address,
             executor_code_hash, destination_address, execution_modes_json,
             evidence_kind, evidence_reference, approved_at, expires_at
      FROM recovery_grants
      WHERE owner_wallet = ? AND verification_status = 'verified'
        AND revoked_at IS NULL AND expires_at > ?
      ORDER BY approved_at DESC LIMIT ?
    `).bind(owner, now, limit).all();
    if (!grants.success) return reply({ error: "Unable to load owner authorizations." }, 503);
    const ids = grants.results.map((g) => String(g.grant_id));
    const assetsByGrant = /* @__PURE__ */ new Map();
    if (ids.length) {
      const placeholders = ids.map(() => "?").join(",");
      const assets = await env.DB.prepare(`
        SELECT a.grant_id, a.asset_id, a.token_address, a.amount_kind, a.max_amount_raw, a.owner_acknowledged, a.revoked_at, a.destination_address, d.id AS selected_destination_id, d.address AS selected_destination_address
        FROM recovery_grant_assets a
        LEFT JOIN recovery_asset_destinations x ON x.grant_id = a.grant_id AND x.asset_id = a.asset_id
        LEFT JOIN recovery_destinations d ON d.id = x.destination_id AND d.is_active = 1
        WHERE a.grant_id IN (${placeholders}) ORDER BY a.asset_id
      `).bind(...ids).all();
      if (!assets.success) return reply({ error: "Unable to load authorization scopes." }, 503);
      for (const a of assets.results) {
        const key = String(a.grant_id);
        if (!assetsByGrant.has(key)) assetsByGrant.set(key, []);
        assetsByGrant.get(key).push({
          assetId: a.asset_id,
          tokenAddress: a.token_address,
          amountKind: a.amount_kind,
          maxAmountRaw: a.max_amount_raw,
          ownerAcknowledged: Boolean(a.owner_acknowledged),
          revokedAt: a.revoked_at,
          destinationAddress: a.destination_address,
          selectedDestinationId: a.selected_destination_id ?? null,
          selectedDestinationAddress: a.selected_destination_address ?? null
        });
      }
    }
    return reply({ grants: grants.results.map((g) => ({
      id: g.grant_id,
      network: g.network,
      chainId: g.chain_id,
      executorAddress: g.executor_address,
      executorCodeHash: g.executor_code_hash,
      destinationAddress: g.destination_address,
      executionModes: JSON.parse(String(g.execution_modes_json)),
      evidence: { kind: g.evidence_kind, reference: g.evidence_reference },
      approvedAt: g.approved_at,
      expiresAt: g.expires_at,
      assets: assetsByGrant.get(String(g.grant_id)) ?? []
    })) });
  }
  if (path === "/api/owner/jobs" && request.method === "GET") {
    const limit = limitFrom(url);
    const rows = await env.DB.prepare(`
      SELECT j.id, j.grant_id, j.asset_id, j.execution_mode, j.status,
             j.priority_score, j.created_at, j.updated_at
      FROM recovery_jobs j INNER JOIN recovery_grants g ON g.grant_id = j.grant_id
      WHERE g.owner_wallet = ? ORDER BY j.created_at DESC LIMIT ?
    `).bind(owner, limit).all();
    return rows.success ? reply({ jobs: rows.results }) : reply({ error: "Unable to load recovery jobs." }, 503);
  }
  if (path === "/api/owner/transactions" && request.method === "GET") {
    const limit = limitFrom(url);
    const rows = await env.DB.prepare(`
      SELECT t.id, t.job_id, t.network, t.transaction_hash, t.status,
             t.asset_id, t.amount_raw, t.destination_address,
             t.estimated_fee_raw, t.actual_fee_raw, t.submitted_at, t.confirmed_at, t.created_at
      FROM recovery_transactions t
      INNER JOIN recovery_jobs j ON j.id = t.job_id
      INNER JOIN recovery_grants g ON g.grant_id = j.grant_id
      WHERE g.owner_wallet = ? ORDER BY t.created_at DESC LIMIT ?
    `).bind(owner, limit).all();
    return rows.success ? reply({ transactions: rows.results }) : reply({ error: "Unable to load recovery transactions." }, 503);
  }
  return null;
}
__name(handleOwnerApi, "handleOwnerApi");

// src/application/admin-destination-api.ts
var NETWORK_CHAIN2 = { ethereum: 1, polygon: 137, bsc: 56, avalanche: 43114, arbitrum: 42161, optimism: 10, base: 8453 };
var ADDRESS4 = /^0x[0-9a-fA-F]{40}$/;
var RPC_BY_NETWORK = {
  ethereum: "EVM_RPC_ETHEREUM",
  polygon: "EVM_RPC_POLYGON",
  bsc: "EVM_RPC_BSC",
  avalanche: "EVM_RPC_AVALANCHE",
  arbitrum: "EVM_RPC_ARBITRUM",
  optimism: "EVM_RPC_OPTIMISM",
  base: "EVM_RPC_BASE"
};
async function verifyRegisteredToken(env, network, address, decimals) {
  const rpcName = RPC_BY_NETWORK[network], rpcUrl = env[rpcName];
  if (!rpcUrl) throw new Error("RPC_NOT_CONFIGURED");
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 1e4);
  try {
    let id = 0;
    const rpc = /* @__PURE__ */ __name(async (method, params) => {
      const res = await fetch(rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }), signal: controller.signal });
      if (!res.ok) throw new Error("RPC_UNAVAILABLE");
      const payload = await res.json();
      if (payload.id !== id || payload.error || typeof payload.result !== "string") throw new Error("RPC_UNAVAILABLE");
      return payload.result;
    }, "rpc");
    const chain = await rpc("eth_chainId", []);
    if (BigInt(chain) !== BigInt(NETWORK_CHAIN2[network])) throw new Error("RPC_CHAIN_MISMATCH");
    const code = await rpc("eth_getCode", [address, "latest"]);
    if (!/^0x[0-9a-fA-F]+$/.test(code) || /^0x0*$/i.test(code)) throw new Error("TOKEN_CONTRACT_NOT_FOUND");
    const decimalsResult = await rpc("eth_call", [{ to: address, data: "0x313ce567" }, "latest"]);
    if (!/^0x[0-9a-fA-F]+$/.test(decimalsResult) || Number(BigInt(decimalsResult)) !== decimals) throw new Error("TOKEN_DECIMALS_MISMATCH");
  } finally {
    clearTimeout(timeout);
  }
}
__name(verifyRegisteredToken, "verifyRegisteredToken");
function response(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" } });
}
__name(response, "response");
function originOk(req, url) {
  return req.headers.get("origin") === url.origin;
}
__name(originOk, "originOk");
async function body(req) {
  try {
    if (Number(req.headers.get("content-length") ?? "0") > 2048) return null;
    const raw = await req.text();
    if (raw.length > 2048) return null;
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}
__name(body, "body");
async function handleAdminDestinationApi(request, env, admin) {
  const url = new URL(request.url), path = url.pathname, now = (/* @__PURE__ */ new Date()).toISOString();
  if (path === "/api/admin/supported-assets" && request.method === "GET") {
    const network = url.searchParams.get("network");
    if (network && !(network in NETWORK_CHAIN2)) return response({ error: "Unsupported network." }, 400);
    const stmt = env.DB.prepare("SELECT id,network,token_address AS tokenAddress,symbol,name,decimals,is_active AS isActive,created_at AS createdAt,updated_at AS updatedAt FROM recovery_supported_assets" + (network ? " WHERE network=?" : "") + " ORDER BY network,symbol");
    const rows = await (network ? stmt.bind(network) : stmt).all();
    return rows.success ? response({ assets: rows.results }) : response({ error: "Unable to load supported assets." }, 503);
  }
  if (path === "/api/admin/supported-assets" && request.method === "POST") {
    if (!originOk(request, url)) return response({ error: "Origin check failed." }, 403);
    const b = await body(request), network = typeof b?.network === "string" ? b.network : "";
    const address = typeof b?.address === "string" ? b.address : "";
    const symbol = typeof b?.symbol === "string" ? b.symbol.trim() : "";
    const name = typeof b?.name === "string" ? b.name.trim() : "";
    const decimals = Number(b?.decimals);
    if (!(network in NETWORK_CHAIN2) || !ADDRESS4.test(address) || !/^[A-Za-z0-9._-]{1,16}$/.test(symbol) || !name || name.length > 64 || !Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
      return response({ error: "Provide a supported network, token contract address, symbol, name and decimals from 0 to 36." }, 400);
    }
    const normalized = address.toLowerCase(), id = network + ":erc20:" + normalized;
    try {
      await verifyRegisteredToken(env, network, normalized, decimals);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "";
      if (reason === "RPC_NOT_CONFIGURED") return response({ error: "A trusted RPC endpoint must be configured for this network before registering tokens." }, 503);
      if (reason === "TOKEN_CONTRACT_NOT_FOUND" || reason === "TOKEN_DECIMALS_MISMATCH" || reason === "RPC_CHAIN_MISMATCH") return response({ error: "The token contract, network or decimals could not be verified on-chain." }, 400);
      return response({ error: "Unable to verify token contract with the configured RPC. Try again later." }, 502);
    }
    const saved = await env.DB.prepare("INSERT INTO recovery_supported_assets(id,network,token_address,symbol,name,decimals,is_active,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,1,?,?,?) ON CONFLICT(network,token_address) DO UPDATE SET symbol=excluded.symbol,name=excluded.name,decimals=excluded.decimals,is_active=1,updated_at=excluded.updated_at").bind(id, network, normalized, symbol, name, decimals, admin.adminId, now, now).run();
    if (!saved.success) return response({ error: "Unable to register supported token." }, 503);
    await env.DB.prepare("INSERT INTO audit_events(actor_type,actor_id,action,target_type,target_id,metadata_json,created_at) VALUES('admin',?,'recovery.supported_asset.add','recovery_supported_asset',?,?,?)").bind(admin.adminId, id, JSON.stringify({ network, address: normalized, symbol, name, decimals }), now).run();
    return response({ created: true, asset: { id, network, tokenAddress: normalized, symbol, name, decimals, isActive: true, createdAt: now, updatedAt: now } });
  }
  const supportedAssetMatch = path.match(/^\/api\/admin\/supported-assets\/([a-z-]+)\/(0x[0-9a-fA-F]{40})$/);
  if (supportedAssetMatch && request.method === "DELETE") {
    if (!originOk(request, url)) return response({ error: "Origin check failed." }, 403);
    const network = supportedAssetMatch[1], address = supportedAssetMatch[2].toLowerCase();
    if (!(network in NETWORK_CHAIN2)) return response({ error: "Unsupported network." }, 400);
    const id = network + ":erc20:" + address;
    const removed = await env.DB.prepare("UPDATE recovery_supported_assets SET is_active=0,updated_at=? WHERE network=? AND token_address=? AND is_active=1").bind(now, network, address).run();
    if (!removed.success) return response({ error: "Unable to deactivate supported asset." }, 503);
    await env.DB.prepare("INSERT INTO audit_events(actor_type,actor_id,action,target_type,target_id,metadata_json,created_at) VALUES('admin',?,'recovery.supported_asset.deactivate','recovery_supported_asset',?,?,?)").bind(admin.adminId, id, JSON.stringify({ network, address }), now).run();
    return response({ deactivated: true, id });
  }
  if (path === "/api/admin/recovery-wallets" && request.method === "GET") {
    const rows = await env.DB.prepare("SELECT id,owner_address AS address,network,chain_id,status,admin_locked AS adminLocked,locked_by AS lockedBy,locked_at AS lockedAt,created_at AS createdAt,updated_at AS updatedAt FROM recovery_wallets ORDER BY admin_locked DESC,updated_at DESC").all();
    return rows.success ? response({ wallets: rows.results }) : response({ error: "Unable to load configured source wallets." }, 503);
  }
  if (path === "/api/admin/recovery-wallets" && request.method === "POST") {
    if (!originOk(request, url)) return response({ error: "Origin check failed." }, 403);
    const b = await body(request), network = typeof b?.network === "string" ? b.network : "", address = typeof b?.address === "string" ? b.address : "";
    if (!(network in NETWORK_CHAIN2) || !ADDRESS4.test(address)) return response({ error: "A supported network and valid source wallet address are required." }, 400);
    const normalized = address.toLowerCase();
    const existing = await env.DB.prepare("SELECT id,status FROM recovery_wallets WHERE owner_address=? AND network=? LIMIT 1").bind(normalized, network).first();
    if (existing?.status === "revoked") return response({ error: "This source wallet was previously revoked and cannot be silently reactivated." }, 409);
    const id = existing?.id ?? crypto.randomUUID();
    const saved = await env.DB.prepare("INSERT INTO recovery_wallets(id,owner_address,network,chain_id,status,first_seen_at,created_at,updated_at,admin_locked,locked_by,locked_at) VALUES(?,?,?,?, 'monitoring',?,?,?,?,?,?) ON CONFLICT(owner_address,network) DO UPDATE SET admin_locked=1,locked_by=excluded.locked_by,locked_at=excluded.locked_at,updated_at=excluded.updated_at WHERE recovery_wallets.status!='revoked'").bind(id, normalized, network, NETWORK_CHAIN2[network], now, now, now, 1, admin.adminId, now).run();
    if (!saved.success) return response({ error: "Unable to lock this source wallet." }, 503);
    const row = await env.DB.prepare("SELECT id,owner_address AS address,network,chain_id,status,admin_locked AS adminLocked,locked_by AS lockedBy,locked_at AS lockedAt,updated_at AS updatedAt FROM recovery_wallets WHERE owner_address=? AND network=?").bind(normalized, network).first();
    if (!row || Number(row.adminLocked) !== 1) return response({ error: "Source-wallet lock could not be confirmed." }, 503);
    await env.DB.prepare("INSERT INTO audit_events(actor_type,actor_id,action,target_type,target_id,metadata_json,created_at) VALUES('admin',?,'recovery.source_wallet.lock','recovery_wallet',?,?,?)").bind(admin.adminId, id, JSON.stringify({ network, address: normalized, locked: true }), now).run();
    return response({ locked: true, wallet: row });
  }
  if (path === "/api/admin/recovery-destinations" && request.method === "POST") {
    if (!originOk(request, url)) return response({ error: "Origin check failed." }, 403);
    const b = await body(request), network = typeof b?.network === "string" ? b.network : "", address = typeof b?.address === "string" ? b.address : "";
    if (!(network in NETWORK_CHAIN2) || !ADDRESS4.test(address)) return response({ error: "A supported network and valid EVM destination address are required." }, 400);
    const normalized = address.toLowerCase(), id = crypto.randomUUID();
    const saved = await env.DB.prepare("INSERT INTO recovery_destinations(id,network,address,locked,is_active,updated_by,updated_at) VALUES(?,?,?,1,1,?,?) ON CONFLICT(network,address) DO UPDATE SET locked=1,is_active=1,updated_by=excluded.updated_by,updated_at=excluded.updated_at").bind(id, network, normalized, admin.adminId, now).run();
    if (!saved.success) return response({ error: "Unable to add locked destination." }, 503);
    const row = await env.DB.prepare("SELECT id,network,address,locked,is_active,updated_at FROM recovery_destinations WHERE network=? AND address=?").bind(network, normalized).first();
    await env.DB.prepare("INSERT INTO audit_events(actor_type,actor_id,action,target_type,target_id,metadata_json,created_at) VALUES('admin',?,'recovery.destination.add','recovery_destination',?,?,?)").bind(admin.adminId, String(row?.id ?? id), JSON.stringify({ network, address: normalized, locked: true }), now).run();
    return response({ created: true, destination: row });
  }
  const policyMatch = path.match(/^\/api\/admin\/recovery-destination-policies\/([a-z-]+)\/([^/]+)$/);
  if (policyMatch && request.method === "PUT") {
    if (!originOk(request, url)) return response({ error: "Origin check failed." }, 403);
    const network = policyMatch[1], b = await body(request), destinationId = typeof b?.destinationId === "string" ? b.destinationId : "";
    let assetId;
    try {
      assetId = decodeURIComponent(policyMatch[2]);
    } catch {
      return response({ error: "Invalid asset identifier." }, 400);
    }
    const maxAmountRaw = typeof b?.maxAmountRaw === "string" ? b.maxAmountRaw : "";
    const automaticPriorityEnabled = b?.automaticPriorityEnabled === true;
    const adminInitiatedEnabled = b?.adminInitiatedEnabled === true;
    const expiresInSeconds = Number(b?.expiresInSeconds);
    if (!(network in NETWORK_CHAIN2) || !assetId || assetId.length > 160 || !destinationId || !/^[1-9][0-9]{0,77}$/.test(maxAmountRaw) || BigInt(maxAmountRaw) > (1n << 256n) - 1n || !automaticPriorityEnabled && !adminInitiatedEnabled || !Number.isSafeInteger(expiresInSeconds) || expiresInSeconds < 3600 || expiresInSeconds > 31536e3) {
      return response({ error: "Provide a destination, positive asset cap in token base units, at least one execution mode, and expiry from 1 hour to 365 days." }, 400);
    }
    const asset = await env.DB.prepare("SELECT id,token_address AS tokenAddress FROM recovery_supported_assets WHERE id=? AND network=? AND is_active=1").bind(assetId, network).first();
    if (!asset) return response({ error: "Register and verify this ERC-20 token in the supported asset registry first." }, 409);
    const dest = await env.DB.prepare("SELECT id,address FROM recovery_destinations WHERE id=? AND network=? AND locked=1 AND is_active=1").bind(destinationId, network).first();
    if (!dest) return response({ error: "Select an active locked destination on the same network." }, 409);
    const saved = await env.DB.prepare("INSERT INTO recovery_asset_destination_policies(network,asset_id,destination_id,updated_by,updated_at,max_amount_raw,automatic_priority_enabled,admin_initiated_enabled,expires_in_seconds) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(network,asset_id) DO UPDATE SET destination_id=excluded.destination_id,updated_by=excluded.updated_by,updated_at=excluded.updated_at,max_amount_raw=excluded.max_amount_raw,automatic_priority_enabled=excluded.automatic_priority_enabled,admin_initiated_enabled=excluded.admin_initiated_enabled,expires_in_seconds=excluded.expires_in_seconds").bind(network, assetId, destinationId, admin.adminId, now, maxAmountRaw, automaticPriorityEnabled ? 1 : 0, adminInitiatedEnabled ? 1 : 0, expiresInSeconds).run();
    if (!saved.success) return response({ error: "Unable to save asset authorization policy." }, 503);
    await env.DB.prepare("INSERT INTO audit_events(actor_type,actor_id,action,target_type,target_id,metadata_json,created_at) VALUES('admin',?,'recovery.asset_authorization_policy.set','recovery_asset_destination_policy',?,?,?)").bind(admin.adminId, network + ":" + assetId, JSON.stringify({ destinationId, address: dest.address, maxAmountRaw, automaticPriorityEnabled, adminInitiatedEnabled, expiresInSeconds }), now).run();
    return response({ updated: true, network, assetId, destinationId, address: dest.address, maxAmountRaw, automaticPriorityEnabled, adminInitiatedEnabled, expiresInSeconds, ownerApprovalRequired: true });
  }
  if (path === "/api/admin/recovery-destination-policies" && request.method === "GET") {
    const network = url.searchParams.get("network");
    if (network && !(network in NETWORK_CHAIN2)) return response({ error: "Unsupported network." }, 400);
    const sql = "SELECT p.network,p.asset_id AS assetId,p.destination_id AS destinationId,d.address AS destinationAddress,p.max_amount_raw AS maxAmountRaw,p.automatic_priority_enabled AS automaticPriorityEnabled,p.admin_initiated_enabled AS adminInitiatedEnabled,p.expires_in_seconds AS expiresInSeconds,p.updated_at AS updatedAt FROM recovery_asset_destination_policies p INNER JOIN recovery_destinations d ON d.id=p.destination_id" + (network ? " WHERE p.network=?" : "") + " ORDER BY p.network,p.asset_id";
    const stmt = env.DB.prepare(sql), rows = await (network ? stmt.bind(network) : stmt).all();
    return rows.success ? response({ policies: rows.results }) : response({ error: "Unable to load asset destination policies." }, 503);
  }
  const clearPolicy = path.match(/^\/api\/admin\/recovery-destination-policies\/([a-z-]+)\/([^/]+)$/);
  if (clearPolicy && request.method === "DELETE") {
    if (!originOk(request, url)) return response({ error: "Origin check failed." }, 403);
    let assetId;
    try {
      assetId = decodeURIComponent(clearPolicy[2]);
    } catch {
      return response({ error: "Invalid asset identifier." }, 400);
    }
    const removed = await env.DB.prepare("DELETE FROM recovery_asset_destination_policies WHERE network=? AND asset_id=?").bind(clearPolicy[1], assetId).run();
    if (!removed.success) return response({ error: "Unable to clear destination policy." }, 503);
    await env.DB.prepare("INSERT INTO audit_events(actor_type,actor_id,action,target_type,target_id,metadata_json,created_at) VALUES('admin',?,'recovery.asset_destination_policy.clear','recovery_asset_destination_policy',?,'{}',?)").bind(admin.adminId, clearPolicy[1] + ":" + assetId, now).run();
    return response({ cleared: true });
  }
  if (path === "/api/admin/recovery-destinations" && request.method === "GET") {
    const rows = await env.DB.prepare("SELECT id,network,address,locked,is_active,updated_by,updated_at FROM recovery_destinations ORDER BY network,is_active DESC,updated_at DESC").all();
    return rows.success ? response({ destinations: rows.results }) : response({ error: "Unable to load recovery destinations." }, 503);
  }
  const networkMatch = path.match(/^\/api\/admin\/recovery-destinations\/([a-z-]+)$/);
  if (networkMatch && request.method === "PUT") {
    if (!originOk(request, url)) return response({ error: "Origin check failed." }, 403);
    const network = networkMatch[1], b = await body(request), address = typeof b?.address === "string" ? b.address : "";
    if (!(network in NETWORK_CHAIN2) || !ADDRESS4.test(address)) return response({ error: "A supported network and valid EVM destination address are required." }, 400);
    const normalized = address.toLowerCase(), existing = await env.DB.prepare("SELECT id FROM recovery_destinations WHERE network=? AND address=? LIMIT 1").bind(network, normalized).first();
    const id = existing?.id ?? crypto.randomUUID();
    const batch = await env.DB.batch([
      env.DB.prepare("INSERT INTO recovery_destinations(id,network,address,locked,is_active,updated_by,updated_at) VALUES(?,?,?,1,1,?,?) ON CONFLICT(network,address) DO UPDATE SET locked=1,is_active=1,updated_by=excluded.updated_by,updated_at=excluded.updated_at").bind(id, network, normalized, admin.adminId, now),
      env.DB.prepare("INSERT INTO audit_events(actor_type,actor_id,action,target_type,target_id,metadata_json,created_at) VALUES('admin',?,'recovery.destination.lock','recovery_destination',?,?,?)").bind(admin.adminId, id, JSON.stringify({ network, address: normalized, locked: true }), now)
    ]);
    if (batch.some((x) => !x.success)) return response({ error: "Destination update was not confirmed." }, 503);
    return response({ updated: true, destination: { id, network, address: normalized, locked: true, isActive: true, updatedAt: now } });
  }
  const overrideMatch = path.match(/^\/api\/admin\/grants\/([A-Za-z0-9_-]{1,128})\/assets\/([^/]+)\/destination$/);
  if (overrideMatch && request.method === "PUT") {
    if (!originOk(request, url)) return response({ error: "Origin check failed." }, 403);
    const b = await body(request), destinationId = typeof b?.destinationId === "string" ? b.destinationId : "";
    if (!destinationId) return response({ error: "destinationId is required." }, 400);
    let assetId;
    try {
      assetId = decodeURIComponent(overrideMatch[2]);
    } catch {
      return response({ error: "Invalid asset identifier." }, 400);
    }
    const grant = await env.DB.prepare("SELECT network FROM recovery_grants WHERE grant_id=? AND verification_status='verified' AND revoked_at IS NULL AND expires_at>?").bind(overrideMatch[1], now).first();
    if (!grant) return response({ error: "Active verified authorization not found." }, 404);
    const asset = await env.DB.prepare("SELECT asset_id,destination_address FROM recovery_grant_assets WHERE grant_id=? AND asset_id=? AND revoked_at IS NULL").bind(overrideMatch[1], assetId).first();
    if (!asset) return response({ error: "Active authorized asset not found." }, 404);
    const destination = await env.DB.prepare("SELECT id,network,address,locked,is_active FROM recovery_destinations WHERE id=?").bind(destinationId).first();
    if (!destination || destination.network !== grant.network || destination.locked !== 1 || destination.is_active !== 1) return response({ error: "Destination must be active, locked, and on the grant's network." }, 409);
    if (destination.address.toLowerCase() !== asset.destination_address.toLowerCase()) return response({ error: "This destination differs from the asset's immutable owner-approved on-chain destination. A new owner-approved grant/executor is required." }, 409);
    const saved = await env.DB.prepare("INSERT INTO recovery_asset_destinations(grant_id,asset_id,destination_id,updated_by,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(grant_id,asset_id) DO UPDATE SET destination_id=excluded.destination_id,updated_by=excluded.updated_by,updated_at=excluded.updated_at").bind(overrideMatch[1], assetId, destinationId, admin.adminId, now).run();
    if (!saved.success) return response({ error: "Unable to save the asset destination selection." }, 503);
    await env.DB.prepare("INSERT INTO audit_events(actor_type,actor_id,action,target_type,target_id,metadata_json,created_at) VALUES('admin',?,'recovery.asset_destination.set','recovery_grant_asset',?,?,?)").bind(admin.adminId, overrideMatch[1] + ":" + assetId, JSON.stringify({ destinationId, address: destination.address }), now).run();
    return response({ updated: true, grantId: overrideMatch[1], assetId, destinationId, address: destination.address });
  }
  if (overrideMatch && request.method === "DELETE") {
    if (!originOk(request, url)) return response({ error: "Origin check failed." }, 403);
    let assetId;
    try {
      assetId = decodeURIComponent(overrideMatch[2]);
    } catch {
      return response({ error: "Invalid asset identifier." }, 400);
    }
    const removed = await env.DB.prepare("DELETE FROM recovery_asset_destinations WHERE grant_id=? AND asset_id=?").bind(overrideMatch[1], assetId).run();
    if (!removed.success) return response({ error: "Unable to clear the asset destination selection." }, 503);
    await env.DB.prepare("INSERT INTO audit_events(actor_type,actor_id,action,target_type,target_id,metadata_json,created_at) VALUES('admin',?,'recovery.asset_destination.clear','recovery_grant_asset',?,?,?)").bind(admin.adminId, overrideMatch[1] + ":" + assetId, "{}", now).run();
    return response({ cleared: true });
  }
  return null;
}
__name(handleAdminDestinationApi, "handleAdminDestinationApi");

// src/application/admin-auth.ts
var SESSION_SECONDS = 8 * 60 * 60;
function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", ...headers } });
}
__name(json, "json");
function b64(s) {
  const raw = atob(s);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
__name(b64, "b64");
function hex(b) {
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}
__name(hex, "hex");
function randomHex(n) {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return hex(b);
}
__name(randomHex, "randomHex");
async function sha(s) {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))));
}
__name(sha, "sha");
function sameOrigin(req, url) {
  return req.headers.get("origin") === url.origin;
}
__name(sameOrigin, "sameOrigin");
async function read(req) {
  try {
    if (Number(req.headers.get("content-length") ?? "0") > 4096) return null;
    const raw = await req.text();
    if (raw.length > 4096) return null;
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}
__name(read, "read");
function cookie(req) {
  for (const p of (req.headers.get("cookie") ?? "").split(";")) {
    const [k, ...v] = p.trim().split("=");
    if (k === "mw_admin_session") return v.join("=") || null;
  }
  return null;
}
__name(cookie, "cookie");
function equal(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}
__name(equal, "equal");
function webBuffer(bytes) {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy.buffer;
}
__name(webBuffer, "webBuffer");
async function pbkdf2Stage(passwordBytes, salt, iterations) {
  const key = await crypto.subtle.importKey("raw", webBuffer(passwordBytes), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: webBuffer(salt), iterations }, key, 256);
  return new Uint8Array(bits);
}
__name(pbkdf2Stage, "pbkdf2Stage");
var HASH_STAGE_ITERATIONS = [1e5, 1e5, 1e5, 1e4];
function stageSalt(salt, index) {
  const label = new TextEncoder().encode("Mainwell admin password hash stage " + index + "\\0");
  const out = new Uint8Array(salt.length + label.length);
  out.set(salt);
  out.set(label, salt.length);
  return out;
}
__name(stageSalt, "stageSalt");
async function hashAdminPassword(password) {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  let derived = new TextEncoder().encode(password);
  for (let i = 0; i < HASH_STAGE_ITERATIONS.length; i++) derived = await pbkdf2Stage(derived, stageSalt(salt, i + 1), HASH_STAGE_ITERATIONS[i]);
  const enc = /* @__PURE__ */ __name((x) => btoa(String.fromCharCode(...x)), "enc");
  return "pbkdf2-sha256-chain$310000$" + enc(salt) + "$" + enc(derived);
}
__name(hashAdminPassword, "hashAdminPassword");
async function verifyAdminPassword(stored, password) {
  const p = stored.split("$");
  if (p.length !== 4) return false;
  try {
    const salt = b64(p[2]), expected = b64(p[3]);
    if (salt.length < 16 || expected.length !== 32) return false;
    if (p[0] === "pbkdf2-sha256-chain" && p[1] === "310000") {
      let derived = new TextEncoder().encode(password);
      for (let i = 0; i < HASH_STAGE_ITERATIONS.length; i++) derived = await pbkdf2Stage(derived, stageSalt(salt, i + 1), HASH_STAGE_ITERATIONS[i]);
      return equal(derived, expected);
    }
    if (p[0] !== "pbkdf2-sha256") return false;
    const iterations = Number(p[1]);
    if (!Number.isInteger(iterations) || iterations !== 1e5) return false;
    return equal(await pbkdf2Stage(new TextEncoder().encode(password), salt, iterations), expected);
  } catch {
    return false;
  }
}
__name(verifyAdminPassword, "verifyAdminPassword");
function base32(s) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0, value = 0;
  const out = [];
  for (const ch of s.toUpperCase().replace(/=+$/, "").replace(/\s/g, "")) {
    const n = alphabet.indexOf(ch);
    if (n < 0) throw new Error("Invalid TOTP secret.");
    value = value << 5 | n;
    bits += 5;
    if (bits >= 8) {
      out.push(value >> bits - 8 & 255);
      bits -= 8;
      value &= (1 << bits) - 1;
    }
  }
  return new Uint8Array(out);
}
__name(base32, "base32");
async function decryptTotpSecret(ciphertext, keyText) {
  const p = ciphertext.split(":");
  if (p.length !== 3 || p[0] !== "v1") throw new Error("Invalid encrypted MFA secret.");
  const keyBytes = b64(keyText);
  if (keyBytes.length !== 32) throw new Error("MFA encryption key must be 32 bytes.");
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["decrypt"]);
  const clear = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64(p[1]) }, key, b64(p[2]));
  return base32(new TextDecoder().decode(clear));
}
__name(decryptTotpSecret, "decryptTotpSecret");
async function verifyTotp(secret, code, now = Date.now()) {
  if (!/^\d{6}$/.test(code)) return false;
  const key = await crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const counter = Math.floor(now / 3e4);
  for (let offset = -1; offset <= 1; offset++) {
    const msg = new Uint8Array(8), n = BigInt(counter + offset);
    for (let i = 7; i >= 0; i--) msg[i] = Number(n >> BigInt((7 - i) * 8) & 255n);
    const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, msg)), idx = mac[mac.length - 1] & 15;
    const bin = (mac[idx] & 127) << 24 | mac[idx + 1] << 16 | mac[idx + 2] << 8 | mac[idx + 3];
    if (String(bin % 1e6).padStart(6, "0") === code) return true;
  }
  return false;
}
__name(verifyTotp, "verifyTotp");
function base32Encode(bytes) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0, value = 0, out = "";
  for (const byte of bytes) {
    value = value << 8 | byte;
    bits += 8;
    while (bits >= 5) {
      out += alphabet[value >> bits - 5 & 31];
      bits -= 5;
      value &= (1 << bits) - 1;
    }
  }
  if (bits) out += alphabet[value << 5 - bits & 31];
  return out;
}
__name(base32Encode, "base32Encode");
async function encryptTotpSecret(secret, keyText) {
  const keyBytes = b64(keyText);
  if (keyBytes.length !== 32) throw new Error("MFA encryption key must be 32 bytes.");
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["encrypt"]);
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(secret));
  const enc = /* @__PURE__ */ __name((x) => btoa(String.fromCharCode(...x)), "enc");
  return "v1:" + enc(iv) + ":" + enc(new Uint8Array(encrypted));
}
__name(encryptTotpSecret, "encryptTotpSecret");
var passwordHash = hashAdminPassword;
async function handleAdminAuthApi(request, env) {
  const url = new URL(request.url), now = (/* @__PURE__ */ new Date()).toISOString();
  if (url.pathname === "/api/admin/auth/bootstrap" && request.method === "POST") {
    if (!sameOrigin(request, url)) return json({ error: "Origin check failed." }, 403);
    if (!env.MAINWELL_ADMIN_BOOTSTRAP_TOKEN || !env.ADMIN_MFA_ENCRYPTION_KEY) return json({ error: "First-admin bootstrap secrets are not configured." }, 503);
    const b = await read(request), token = typeof b?.bootstrapToken === "string" ? b.bootstrapToken : "", email = typeof b?.email === "string" ? b.email.trim().toLowerCase() : "", password = typeof b?.password === "string" ? b.password : "";
    if (!await equal(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))), new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(env.MAINWELL_ADMIN_BOOTSTRAP_TOKEN)))) || !email.includes("@") || !email.includes(".") || email.length > 254 || password.length < 14 || password.length > 1024) return json({ error: "Bootstrap credentials are invalid." }, 401);
    const count = await env.DB.prepare("SELECT COUNT(*) AS total FROM admin_accounts").first();
    if ((count?.total ?? 0) !== 0) return json({ error: "Initial administrator has already been created." }, 409);
    const secretBytes = new Uint8Array(20);
    crypto.getRandomValues(secretBytes);
    const secret = base32Encode(secretBytes), id = crypto.randomUUID(), now2 = (/* @__PURE__ */ new Date()).toISOString();
    const stored = await env.DB.prepare("INSERT INTO admin_accounts(id,email,password_hash,mfa_enabled,mfa_secret_ciphertext,status,created_at,updated_at) SELECT ?,?,?,0,?,'active',?,? WHERE NOT EXISTS (SELECT 1 FROM admin_accounts)").bind(id, email, await passwordHash(password), await encryptTotpSecret(secret, env.ADMIN_MFA_ENCRYPTION_KEY), now2, now2).run();
    if (!stored.success || (stored.meta?.changes ?? 0) !== 1) return json({ error: "Initial administrator could not be created; refresh and check setup status." }, 409);
    await env.DB.prepare("INSERT INTO audit_events(actor_type,actor_id,action,target_type,target_id,metadata_json,created_at) VALUES('admin',?,'admin.bootstrap.pending','admin_account',?,'{}',?)").bind(id, id, now2).run();
    return json({ created: true, mfaEnabled: false, secret, otpauthUri: "otpauth://totp/Mainwell:" + encodeURIComponent(email) + "?secret=" + secret + "&issuer=Mainwell&algorithm=SHA1&digits=6&period=30", next: "POST /api/admin/auth/bootstrap/confirm with email and current six-digit authenticator code." }, 201);
  }
  if (url.pathname === "/api/admin/auth/bootstrap/confirm" && request.method === "POST") {
    if (!sameOrigin(request, url)) return json({ error: "Origin check failed." }, 403);
    const b = await read(request), email = typeof b?.email === "string" ? b.email.trim().toLowerCase() : "", otp = typeof b?.otp === "string" ? b.otp : "";
    const account = await env.DB.prepare("SELECT id,mfa_secret_ciphertext,mfa_enabled FROM admin_accounts WHERE email=? COLLATE NOCASE LIMIT 1").bind(email).first();
    if (!account || account.mfa_enabled !== 0 || !account.mfa_secret_ciphertext || !env.ADMIN_MFA_ENCRYPTION_KEY) return json({ error: "Pending administrator setup not found." }, 404);
    let valid = false;
    try {
      valid = await verifyTotp(await decryptTotpSecret(account.mfa_secret_ciphertext, env.ADMIN_MFA_ENCRYPTION_KEY), otp);
    } catch {
      return json({ error: "MFA setup is not configured correctly." }, 503);
    }
    if (!valid) return json({ error: "Authenticator code is invalid." }, 401);
    const enabled = await env.DB.prepare("UPDATE admin_accounts SET mfa_enabled=1,updated_at=? WHERE id=? AND mfa_enabled=0").bind(now, account.id).run();
    if (!enabled.success || (enabled.meta?.changes ?? 0) !== 1) return json({ error: "MFA setup state changed; sign in again." }, 409);
    await env.DB.prepare("INSERT INTO audit_events(actor_type,actor_id,action,target_type,target_id,metadata_json,created_at) VALUES('admin',?,'admin.mfa.enabled','admin_account',?,'{}',?)").bind(account.id, account.id, now).run();
    return json({ mfaEnabled: true, loginRequired: true });
  }
  if (url.pathname === "/api/admin/auth/login" && request.method === "POST") {
    if (!sameOrigin(request, url)) return json({ error: "Origin check failed." }, 403);
    const b = await read(request), email = typeof b?.email === "string" ? b.email.trim().toLowerCase() : "", password = typeof b?.password === "string" ? b.password : "", otp = typeof b?.otp === "string" ? b.otp : "";
    if (email.length > 254 || password.length > 1024 || !/^\S+@\S+\.\S+$/.test(email)) return json({ error: "Invalid administrator credentials." }, 401);
    const ip = request.headers.get("cf-connecting-ip") ?? "unknown", rateKey = await sha(email + "|" + ip), epoch = Math.floor(Date.now() / 1e3);
    const rate = await env.DB.prepare("SELECT attempts,window_started_at,locked_until FROM admin_auth_rate_limits WHERE identifier_hash=?").bind(rateKey).first();
    if (rate && rate.locked_until > epoch) return json({ error: "Too many sign-in attempts. Try again after the temporary lockout." }, 429);
    const account = await env.DB.prepare("SELECT id,password_hash,mfa_enabled,mfa_secret_ciphertext,status FROM admin_accounts WHERE email=? COLLATE NOCASE LIMIT 1").bind(email).first();
    if (!account || account.status !== "active" || account.mfa_enabled !== 1 || !account.mfa_secret_ciphertext || !env.ADMIN_MFA_ENCRYPTION_KEY || !await verifyAdminPassword(account.password_hash, password)) {
      await env.DB.prepare("INSERT INTO admin_auth_rate_limits(identifier_hash,attempts,window_started_at,locked_until) VALUES(?,1,?,0) ON CONFLICT(identifier_hash) DO UPDATE SET attempts=CASE WHEN ?-window_started_at>900 THEN 1 ELSE attempts+1 END,window_started_at=CASE WHEN ?-window_started_at>900 THEN ? ELSE window_started_at END,locked_until=CASE WHEN (CASE WHEN ?-window_started_at>900 THEN 1 ELSE attempts+1 END)>=5 THEN ?+900 ELSE locked_until END").bind(rateKey, epoch, epoch, epoch, epoch, epoch, epoch).run();
      return json({ error: "Invalid administrator credentials or MFA configuration." }, 401);
    }
    let valid = false;
    try {
      const secret = await decryptTotpSecret(account.mfa_secret_ciphertext, env.ADMIN_MFA_ENCRYPTION_KEY);
      valid = await verifyTotp(secret, otp);
    } catch {
      return json({ error: "Administrator MFA is not configured correctly." }, 503);
    }
    if (!valid) {
      await env.DB.prepare("INSERT INTO admin_auth_rate_limits(identifier_hash,attempts,window_started_at,locked_until) VALUES(?,1,?,0) ON CONFLICT(identifier_hash) DO UPDATE SET attempts=CASE WHEN ?-window_started_at>900 THEN 1 ELSE attempts+1 END,window_started_at=CASE WHEN ?-window_started_at>900 THEN ? ELSE window_started_at END,locked_until=CASE WHEN (CASE WHEN ?-window_started_at>900 THEN 1 ELSE attempts+1 END)>=5 THEN ?+900 ELSE locked_until END").bind(rateKey, epoch, epoch, epoch, epoch, epoch, epoch).run();
      return json({ error: "Invalid administrator credentials or MFA code." }, 401);
    }
    await env.DB.prepare("DELETE FROM admin_auth_rate_limits WHERE identifier_hash=?").bind(rateKey).run();
    const token = randomHex(32), id = crypto.randomUUID(), expires = new Date(Date.now() + SESSION_SECONDS * 1e3).toISOString();
    const saved = await env.DB.prepare("INSERT INTO admin_sessions(id,admin_id,token_hash,mfa_verified_at,expires_at,created_at,last_seen_at) VALUES(?,?,?,?,?,?,?)").bind(id, account.id, await sha(token), now, expires, now, now).run();
    if (!saved.success) return json({ error: "Unable to create administrator session." }, 503);
    await env.DB.prepare("INSERT INTO audit_events(actor_type,actor_id,action,target_type,target_id,metadata_json,created_at) VALUES('admin',?,'admin.login','admin_session',?,'{}',?)").bind(account.id, id, now).run();
    return json({ authenticated: true, mfaVerified: true, expiresAt: expires }, 200, { "set-cookie": "mw_admin_session=" + token + "; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=" + SESSION_SECONDS });
  }
  if (url.pathname === "/api/admin/auth/logout" && request.method === "POST") {
    if (!sameOrigin(request, url)) return json({ error: "Origin check failed." }, 403);
    const token = cookie(request);
    if (token && /^[0-9a-f]{64}$/.test(token)) await env.DB.prepare("DELETE FROM admin_sessions WHERE token_hash=?").bind(await sha(token)).run();
    return json({ authenticated: false }, 200, { "set-cookie": "mw_admin_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0" });
  }
  if (url.pathname === "/api/admin/auth/me" && request.method === "GET") {
    const token = cookie(request);
    if (!token || !/^[0-9a-f]{64}$/.test(token)) return json({ authenticated: false }, 401);
    const cutoff = new Date(Date.now() - 12 * 60 * 60 * 1e3).toISOString();
    const row = await env.DB.prepare("SELECT a.email,s.expires_at,s.mfa_verified_at FROM admin_sessions s INNER JOIN admin_accounts a ON a.id=s.admin_id WHERE s.token_hash=? AND s.expires_at>? AND s.mfa_verified_at>? AND a.status='active' AND a.mfa_enabled=1 LIMIT 1").bind(await sha(token), now, cutoff).first();
    return row ? json({ authenticated: true, email: row.email, mfaVerifiedAt: row.mfa_verified_at, expiresAt: row.expires_at }) : json({ authenticated: false }, 401);
  }
  return null;
}
__name(handleAdminAuthApi, "handleAdminAuthApi");

// src/application/admin-dashboard.ts
var HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#0b1220"><title>Mainwell \xB7 Admin Console</title>
<style>
:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#e8edf5;background:#0b1220;font-synthesis:none}
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(ellipse at 15% 0%,#203b48 0,transparent 42%),radial-gradient(ellipse at 100% 85%,#162b3b 0,transparent 40%),#0b1220}
button,input,select{font:inherit}button{cursor:pointer}.shell{max-width:1180px;margin:auto;padding:28px 24px 60px}.topbar{display:flex;align-items:center;justify-content:space-between;margin-bottom:48px}.brand{display:flex;align-items:center;gap:12px;font-weight:750;letter-spacing:.04em}.mark{width:38px;height:38px;border-radius:12px;background:linear-gradient(145deg,#b4e5d8,#5caa9d);display:grid;place-items:center;color:#102a2a;font-weight:900;font-size:19px;box-shadow:0 8px 30px #6dc2ad22}.brand small{display:block;color:#8193a5;font-size:10px;letter-spacing:.2em;font-weight:650;margin-top:2px}.secure{color:#a7cfc4;border:1px solid #31564f;background:#10231f;padding:8px 12px;border-radius:99px;font-size:12px;display:flex;gap:8px;align-items:center}.dot{width:7px;height:7px;background:#79cbb2;border-radius:50%;box-shadow:0 0 12px #79cbb2}
.layout{display:grid;grid-template-columns:minmax(0,1.05fr) minmax(360px,.95fr);gap:70px;align-items:center}.intro{padding:20px 0}.eyebrow{color:#83c8b5;font-size:11px;letter-spacing:.22em;font-weight:750;text-transform:uppercase}.intro h1{font-size:clamp(38px,5vw,62px);line-height:1.04;letter-spacing:-.055em;margin:18px 0 18px;max-width:600px}.intro h1 span{color:#9bd8c7}.lead{color:#9eacbb;line-height:1.75;font-size:15px;max-width:490px}.feature-list{display:grid;gap:16px;margin-top:36px}.feature{display:flex;gap:13px;align-items:flex-start;color:#bdc9d3;font-size:13px;line-height:1.55}.feature-icon{flex:0 0 30px;height:30px;border:1px solid #314c51;border-radius:9px;display:grid;place-items:center;color:#9bd8c7}.card{background:linear-gradient(145deg,#172432f2,#111d29f2);border:1px solid #30434c;border-radius:22px;padding:30px;box-shadow:0 28px 80px #0005;backdrop-filter:blur(18px)}.card-head{margin-bottom:26px}.card-head .eyebrow{font-size:10px}.card h2{font-size:23px;letter-spacing:-.03em;margin:9px 0 7px}.muted{color:#8fa0ad;line-height:1.6;font-size:13px;margin:0}.field{margin:17px 0}.field label{display:block;font-size:12px;color:#bdc9d2;font-weight:650;margin-bottom:8px}.field input,.field select{width:100%;border:1px solid #344a56;background:#0d1721;color:#f4f7f9;border-radius:11px;padding:14px 15px;outline:none;transition:border .18s,box-shadow .18s}.field input:focus,.field select:focus{border-color:#7fcbb6;box-shadow:0 0 0 3px #7fcbb61b}.field input::placeholder{color:#657785}.input-wrap{position:relative}.input-wrap input{padding-right:52px}.reveal{position:absolute;right:10px;top:50%;transform:translateY(-50%);border:0;background:transparent;color:#9aabb6;padding:7px;font-size:12px}.primary{width:100%;border:0;border-radius:11px;padding:14px 16px;background:linear-gradient(100deg,#b5e5d7,#80c9b5);color:#102b28;font-weight:800;margin-top:8px;box-shadow:0 8px 25px #7fcbb622;transition:transform .18s,filter .18s}.primary:hover{filter:brightness(1.06);transform:translateY(-1px)}.primary:disabled{opacity:.6;cursor:wait;transform:none}.status{min-height:22px;color:#a8d8c9;font-size:12px;line-height:1.5;margin:14px 0 0}.status.error{color:#f1a7a7}.footnote{border-top:1px solid #2a3b46;margin-top:22px;padding-top:17px;color:#748694;font-size:11px;line-height:1.6}.hidden{display:none!important}.console{margin-top:10px}.console-head{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:24px}.console-head h1{font-size:30px;letter-spacing:-.04em;margin:5px 0}.console-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}.panel{background:#14222e;border:1px solid #2b414c;border-radius:17px;padding:22px}.panel h2{font-size:16px;margin:0 0 7px}.panel .muted{margin-bottom:16px}.panel .field{margin:13px 0}.panel .primary{margin-top:4px}.secondary{border:1px solid #3b5661;background:#1b303b;color:#d9e6e8;border-radius:10px;padding:10px 14px;font-weight:650}.list{display:grid;gap:0}.item{padding:14px 0;border-top:1px solid #2b3e48;display:flex;justify-content:space-between;gap:14px;align-items:center;font-size:13px;overflow-wrap:anywhere}.item:first-child{border-top:0}.tag{font-size:10px;letter-spacing:.04em;padding:5px 8px;border-radius:99px;background:#19372f;color:#9ed8c4;white-space:nowrap}.empty{color:#8294a1;font-size:13px;padding:12px 0}.wide{grid-column:1/-1}.console-status{margin-top:14px}@media(max-width:850px){.layout{grid-template-columns:1fr;gap:30px}.intro{padding:0}.intro h1{font-size:43px}.feature-list{display:none}.shell{padding:20px 16px 40px}.topbar{margin-bottom:32px}.console-grid{grid-template-columns:1fr}.wide{grid-column:auto}.card{padding:24px}.console-head{align-items:flex-start;flex-direction:column}}@media(max-width:420px){.secure{font-size:10px;padding:7px 9px}.intro h1{font-size:37px}}
</style></head><body><div class="shell">
<header class="topbar"><div class="brand"><div class="mark">M</div><div>MAINWELL<small>RECOVERY INFRASTRUCTURE</small></div></div><div class="secure"><i class="dot"></i> Secure administrator access</div></header>
<section id="loginView" class="layout">
<div class="intro"><div class="eyebrow">CONTROL CENTRE \xB7 ADMINISTRATOR</div><h1>Clarity and control for <span>every recovery.</span></h1><p class="lead">Manage locked recovery destinations and owner-approved asset policies from one secure workspace. Every change is authenticated and recorded.</p>
<div class="feature-list"><div class="feature"><span class="feature-icon">\u25C7</span><span><b>Protected access</b><br>Administrator sign-in requires your password and authenticator code.</span></div><div class="feature"><span class="feature-icon">\u2311</span><span><b>Locked destinations</b><br>Maintain approved network destinations without changing existing owner grants.</span></div><div class="feature"><span class="feature-icon">\u2197</span><span><b>Auditable operations</b><br>Administrative changes are recorded for review.</span></div></div></div>
<section class="card"><div class="card-head"><div class="eyebrow">WELCOME BACK</div><h2>Administrator sign in</h2><p class="muted">Enter your administrator credentials to continue to the Mainwell console.</p></div>
<form id="loginForm"><div class="field"><label for="email">Administrator email</label><input id="email" name="email" type="email" autocomplete="username" placeholder="you@company.com" required></div>
<div class="field"><label for="password">Password</label><div class="input-wrap"><input id="password" name="password" type="password" autocomplete="current-password" placeholder="Enter your password" required><button type="button" class="reveal" id="togglePassword" aria-label="Show password">Show</button></div></div>
<div class="field"><label for="otp">Authenticator code</label><input id="otp" name="otp" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" placeholder="6-digit code" required></div>
<button class="primary" id="loginButton" type="submit">Sign in to console <span aria-hidden="true">\u2192</span></button></form>
<p id="loginStatus" class="status" role="status" aria-live="polite"></p><div class="footnote">Your session is protected with a secure, HTTP-only cookie. Never share your password or authenticator code.</div></section>
</section>
<section id="console" class="console hidden"><div class="console-head"><div><div class="eyebrow">MAINWELL / ADMINISTRATION</div><h1>Recovery settings</h1><p class="muted">Configure locked destinations and the default destination policy for each asset.</p></div><div style="display:flex;gap:10px;flex-wrap:wrap"><a class="secondary" style="text-decoration:none;display:inline-block" href="/admin/operators">Set up operator wallets</a><button class="secondary" id="logout">Sign out securely</button></div></div>
<div class="console-grid">
<section class="panel"><h2>Lock a source wallet</h2><p class="muted">Register the exact compromised wallet address and network. Only administrator-locked source wallets can receive a recovery authorization.</p><form id="sourceWalletForm"><div class="field"><label>Blockchain network</label><select name="network"><option value="ethereum">Ethereum</option><option value="polygon">Polygon</option><option value="bsc">BNB Smart Chain</option><option value="avalanche">Avalanche</option><option value="arbitrum">Arbitrum</option><option value="optimism">Optimism</option><option value="base">Base</option></select></div><div class="field"><label>Compromised source wallet address</label><input name="address" placeholder="0x\u2026" required></div><button class="primary">Register and lock source wallet</button></form><p id="sourceWalletStatus" class="status" role="status"></p></section>
<section class="panel wide"><h2>Locked source wallets</h2><p class="muted">These exact owner addresses are eligible for the owner authorization flow on their configured networks.</p><div id="sourceWallets" class="list"></div></section>
<section class="panel"><h2>Add a locked destination</h2><p class="muted">Register a destination address for one supported network.</p><form id="destinationForm"><div class="field"><label>Blockchain network</label><select name="network"><option value="ethereum">Ethereum</option><option value="polygon">Polygon</option><option value="bsc">BNB Smart Chain</option><option value="avalanche">Avalanche</option><option value="arbitrum">Arbitrum</option><option value="optimism">Optimism</option><option value="base">Base</option></select></div><div class="field"><label>Recovery wallet address</label><input name="address" placeholder="0x\u2026" required></div><button class="primary">Add locked destination</button></form><p id="destinationStatus" class="status" role="status"></p></section>
<section class="panel"><h2>Register a supported ERC-20</h2><p class="muted">Add the token contract that wallet monitoring should check. Use the token's verified contract address and official decimals. This does not grant spending permission.</p><form id="supportedAssetForm"><div class="field"><label>Blockchain network</label><select name="network"><option value="ethereum">Ethereum</option><option value="polygon">Polygon</option><option value="bsc">BNB Smart Chain</option><option value="avalanche">Avalanche</option><option value="arbitrum">Arbitrum</option><option value="optimism">Optimism</option><option value="base">Base</option></select></div><div class="field"><label>Token contract address</label><input name="address" placeholder="0x\u2026" required></div><div class="field"><label>Token symbol</label><input name="symbol" placeholder="USDC" maxlength="16" required></div><div class="field"><label>Token name</label><input name="name" placeholder="USD Coin" maxlength="64" required></div><div class="field"><label>Token decimals</label><input name="decimals" type="number" min="0" max="36" step="1" value="6" required></div><button class="primary">Register supported token</button></form><p id="supportedAssetStatus" class="status" role="status"></p></section>
<section class="panel wide"><h2>Supported ERC-20 assets</h2><p class="muted">Only active tokens in this registry are monitored. The owner must still approve each asset's separately configured recovery policy.</p><div id="supportedAssets" class="list"></div></section>
<section class="panel"><h2>Asset destination policy</h2><p class="muted">Set the exact monitored asset ID (network:erc20:token-address), destination, raw-unit cap, execution modes and expiry. The owner must still approve the exact policy on-chain.</p><form id="policyForm"><div class="field"><label>Blockchain network</label><select name="network"><option value="ethereum">Ethereum</option><option value="polygon">Polygon</option><option value="bsc">BNB Smart Chain</option><option value="avalanche">Avalanche</option><option value="arbitrum">Arbitrum</option><option value="optimism">Optimism</option><option value="base">Base</option></select></div><div class="field"><label>Asset ID</label><input name="assetId" placeholder="ethereum:erc20:0x\u2026" required></div><div class="field"><label>Locked destination</label><select name="destinationId" id="destinationChoices" required></select></div><div class="field"><label>Maximum recovery amount (token base units)</label><input name="maxAmountRaw" inputmode="numeric" pattern="[1-9][0-9]*" placeholder="e.g. 2500000" required><small class="muted">Enter the exact integer in the token\u2019s smallest units. For a 6-decimal token, 2500000 means 2.5 tokens.</small></div><div class="field"><label>Authorization expiry</label><select name="expiresInSeconds"><option value="86400">24 hours</option><option value="604800" selected>7 days</option><option value="2592000">30 days</option><option value="7776000">90 days</option><option value="31536000">365 days</option></select></div><div class="field"><label><input type="checkbox" name="automaticPriorityEnabled"> Allow automatic-priority recovery</label></div><div class="field"><label><input type="checkbox" name="adminInitiatedEnabled" checked> Allow administrator-initiated recovery</label></div><button class="primary">Save bounded authorization policy</button></form><p id="policyStatus" class="status" role="status"></p></section>
<section class="panel wide"><h2>Locked destinations</h2><p class="muted">Active destinations available to owner authorization flows.</p><div id="destinations" class="list"></div></section>
<section class="panel wide"><h2>Asset policies</h2><p class="muted">Configured defaults. These cannot redirect an existing authorization.</p><div id="policies" class="list"></div></section>
</div><p id="consoleStatus" class="status console-status" role="status"></p></section>
</div><script>
const $=id=>document.getElementById(id);
async function api(path,options={}){const r=await fetch(path,{credentials:"same-origin",...options,headers:{"content-type":"application/json",...(options.headers||{})}});let data={};try{data=await r.json()}catch{}if(!r.ok)throw new Error(data.error||"Request failed ("+r.status+")");return data}
function node(tag,text){const e=document.createElement(tag);e.textContent=text;return e}
let destinations=[];
function renderList(root,rows,formatter){root.replaceChildren();if(!rows.length){const e=node("p","Nothing configured yet.");e.className="empty";root.append(e);return}for(const row of rows){const item=node("div",formatter(row));item.className="item";root.append(item)}}
async function load(){const [d,p,w,a]=await Promise.all([api("/api/admin/recovery-destinations"),api("/api/admin/recovery-destination-policies"),api("/api/admin/recovery-wallets"),api("/api/admin/supported-assets")]);destinations=d.destinations||[];renderList($("sourceWallets"),w.wallets||[],x=>x.network+" \xB7 "+x.address+" \xB7 "+(x.adminLocked?"ADMIN LOCKED":"not locked")+" \xB7 "+x.status);$("destinationChoices").replaceChildren();for(const x of destinations.filter(x=>x.locked&&x.is_active)){const o=node("option",x.network+" \xB7 "+x.address);o.value=x.id;$("destinationChoices").append(o)}renderList($("destinations"),destinations,x=>x.network+" \xB7 "+x.address+" \xB7 "+(x.is_active?"active":"inactive")+" \xB7 "+(x.locked?"locked":"unlocked"));renderList($("policies"),p.policies||[],x=>x.network+" \xB7 "+x.assetId+" \u2192 "+x.destinationAddress+" \xB7 cap "+x.maxAmountRaw+" \xB7 modes "+(x.automaticPriorityEnabled?"automatic ":"")+(x.adminInitiatedEnabled?"admin":"")+" \xB7 "+x.expiresInSeconds+"s");renderList($("supportedAssets"),a.assets||[],x=>x.id+" \xB7 "+x.symbol+" ("+x.name+") \xB7 "+x.tokenAddress+" \xB7 "+x.decimals+" decimals"+(x.isActive?" \xB7 active":" \xB7 inactive"))}
async function showConsole(){$("loginView").classList.add("hidden");$("console").classList.remove("hidden");await load()}
$("togglePassword").addEventListener("click",()=>{const input=$("password"),show=input.type==="password";input.type=show?"text":"password";$("togglePassword").textContent=show?"Hide":"Show";$("togglePassword").setAttribute("aria-label",show?"Hide password":"Show password")});
$("loginForm").addEventListener("submit",async e=>{e.preventDefault();const b=Object.fromEntries(new FormData(e.currentTarget));const button=$("loginButton");button.disabled=true;button.textContent="Verifying credentials\u2026";$("loginStatus").className="status";$("loginStatus").textContent="Checking your secure session.";try{await api("/api/admin/auth/login",{method:"POST",body:JSON.stringify(b)});await showConsole()}catch(err){$("loginStatus").className="status error";$("loginStatus").textContent=err.message}finally{button.disabled=false;button.innerHTML='Sign in to console <span aria-hidden="true">\u2192</span>'}});
$("sourceWalletForm").addEventListener("submit",async e=>{e.preventDefault();const b=Object.fromEntries(new FormData(e.currentTarget));try{await api("/api/admin/recovery-wallets",{method:"POST",body:JSON.stringify(b)});$("sourceWalletStatus").textContent="Source wallet registered and locked. Existing grants are not modified.";e.currentTarget.reset();await load()}catch(err){$("sourceWalletStatus").className="status error";$("sourceWalletStatus").textContent=err.message}});
$("supportedAssetForm").addEventListener("submit",async e=>{e.preventDefault();const b=Object.fromEntries(new FormData(e.currentTarget));try{await api("/api/admin/supported-assets",{method:"POST",body:JSON.stringify({...b,decimals:Number(b.decimals)})});$("supportedAssetStatus").textContent="ERC-20 token registered. Refresh the source wallet to populate its monitored asset balance.";e.currentTarget.reset();await load()}catch(err){$("supportedAssetStatus").className="status error";$("supportedAssetStatus").textContent=err.message}});
$("destinationForm").addEventListener("submit",async e=>{e.preventDefault();const b=Object.fromEntries(new FormData(e.currentTarget));try{await api("/api/admin/recovery-destinations",{method:"POST",body:JSON.stringify(b)});$("destinationStatus").textContent="Locked destination added.";e.currentTarget.reset();await load()}catch(err){$("destinationStatus").className="status error";$("destinationStatus").textContent=err.message}});
$("policyForm").addEventListener("submit",async e=>{e.preventDefault();const b=Object.fromEntries(new FormData(e.currentTarget));try{await api("/api/admin/recovery-destination-policies/"+encodeURIComponent(b.network)+"/"+encodeURIComponent(b.assetId),{method:"PUT",body:JSON.stringify({destinationId:b.destinationId,maxAmountRaw:b.maxAmountRaw,expiresInSeconds:Number(b.expiresInSeconds),automaticPriorityEnabled:b.automaticPriorityEnabled==="on",adminInitiatedEnabled:b.adminInitiatedEnabled==="on"})});$("policyStatus").textContent="Asset policy saved. Owner approval is still required.";await load()}catch(err){$("policyStatus").className="status error";$("policyStatus").textContent=err.message}});
$("logout").addEventListener("click",async()=>{try{await api("/api/admin/auth/logout",{method:"POST",body:"{}"})}finally{location.reload()}});
api("/api/admin/auth/me").then(showConsole).catch(()=>{});
<\/script></body></html>`;
function adminDashboardResponse() {
  return new Response(HTML, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'" } });
}
__name(adminDashboardResponse, "adminDashboardResponse");

// src/application/owner-dashboard.ts
var OWNER_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#0b1220"><title>Mainwell \xB7 Wallet workspace</title>
<style>
:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#e8edf5;background:#0b1220}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(ellipse at 5% 0%,#203b48 0,transparent 40%),#0b1220}button,select{font:inherit}.shell{max-width:1120px;margin:auto;padding:24px 22px 60px}.top{display:flex;justify-content:space-between;align-items:center;margin-bottom:54px}.brand{display:flex;align-items:center;gap:11px;font-weight:800;letter-spacing:.05em}.mark{width:38px;height:38px;border-radius:12px;background:linear-gradient(145deg,#b4e5d8,#5caa9d);display:grid;place-items:center;color:#102a2a;font-size:18px}.brand small{display:block;font-size:10px;color:#8497a4;letter-spacing:.18em;margin-top:2px}.pill{border:1px solid #31564f;background:#10231f;color:#a7d9c8;padding:8px 12px;border-radius:99px;font-size:11px}.hero{max-width:680px;margin-bottom:34px}.eyebrow{color:#86cbb8;font-size:11px;font-weight:750;letter-spacing:.2em}.hero h1{font-size:clamp(36px,5vw,56px);letter-spacing:-.055em;line-height:1.06;margin:15px 0}.hero p,.muted{color:#96a8b4;line-height:1.7;font-size:14px}.card{background:linear-gradient(145deg,#172432,#111d29);border:1px solid #30444d;border-radius:20px;padding:25px;box-shadow:0 22px 70px #0003}.connect{max-width:580px}.connect h2,.panel h2{font-size:19px;margin:0 0 7px}.connect p{margin:0 0 20px}.primary{border:0;border-radius:11px;background:linear-gradient(100deg,#b5e5d7,#80c9b5);color:#102b28;padding:13px 18px;font-weight:800;cursor:pointer}.primary:disabled{opacity:.6;cursor:wait}.secondary{border:1px solid #3c5660;background:#1b303b;color:#dbe7e8;border-radius:10px;padding:10px 14px;cursor:pointer}.status{font-size:12px;min-height:20px;color:#a8d8c9;margin:13px 0 0}.status.error{color:#f0a3a3}.hidden{display:none!important}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:15px;margin:22px 0}.stat{padding:18px}.stat small{display:block;color:#8ea1ad;font-size:11px;margin-bottom:9px}.stat strong{font-size:27px;letter-spacing:-.04em}.workspace{display:grid;grid-template-columns:1.2fr .8fr;gap:16px}.panel{margin-bottom:16px}.panel-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:15px}.network{background:#0d1721;border:1px solid #344b55;border-radius:10px;padding:11px 13px;color:#edf5f4}.wallet{border-top:1px solid #2a3e49;padding:15px 0}.wallet:first-child{border-top:0}.wallet-head{display:flex;justify-content:space-between;gap:12px;align-items:center}.address{font-size:13px;overflow-wrap:anywhere;color:#d8e5e8}.tag{font-size:10px;border-radius:99px;padding:5px 9px;background:#19372f;color:#a5ddca;white-space:nowrap}.asset{display:flex;justify-content:space-between;gap:12px;color:#a8b7c1;font-size:12px;padding:7px 0;border-top:1px solid #233641}.asset:first-of-type{margin-top:12px}.actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.notice{border:1px solid #665b37;background:#292719;color:#d8c99b;border-radius:13px;padding:15px;font-size:12px;line-height:1.65}.empty{color:#8396a2;font-size:13px;padding:12px 0}.fine{color:#778b98;font-size:11px;line-height:1.65;margin-top:22px}@media(max-width:780px){.workspace{grid-template-columns:1fr}.grid{grid-template-columns:1fr 1fr}.top{margin-bottom:38px}}@media(max-width:480px){.shell{padding:18px 14px 40px}.grid{grid-template-columns:1fr}.card{padding:20px}.top{margin-bottom:32px}}
</style></head><body><main class="shell">
<header class="top"><div class="brand"><div class="mark">M</div><div>MAINWELL<small>WALLET WORKSPACE</small></div></div><span class="pill">Owner-controlled access</span></header>
<section id="connectView"><div class="hero"><div class="eyebrow">YOUR ASSETS \xB7 YOUR AUTHORITY</div><h1>Stay informed. Stay in control.</h1><p>Connect your EVM wallet to view and monitor assets you choose. Wallet login is read-only; after login, you can review the recovery scope and separately approve the required transactions.</p></div>
<section class="card connect"><h2>Connect your wallet</h2><p class="muted">Use a browser wallet such as MetaMask. Mainwell will ask you to sign a one-time login message \u2014 not a blockchain transaction.</p><button id="connect" class="primary">Connect wallet <span aria-hidden="true">\u2192</span></button><p id="connectStatus" class="status" role="status" aria-live="polite"></p><p class="fine">Never enter a seed phrase or private key into Mainwell. Your wallet provider keeps those credentials.</p></section></section>
<section id="dashboard" class="hidden"><div class="hero"><div class="eyebrow">OWNER WORKSPACE</div><h1>Your wallet overview</h1><p id="walletAddress" class="muted"></p><p><a href="/authorize" class="secondary">Review recovery authorization \u2192</a></p></div>
<div class="grid"><section class="card stat"><small>Monitored wallets</small><strong id="walletCount">0</strong></section><section class="card stat"><small>Verified recovery grants</small><strong id="grantCount">0</strong></section><section class="card stat"><small>Active network</small><strong id="networkName" style="font-size:19px">\u2014</strong></section></div>
<div class="workspace"><section class="card panel"><div class="panel-head"><div><h2>Wallet monitoring</h2><p class="muted">Register this connected wallet on its current network.</p></div><button class="secondary" id="refreshAll">Refresh</button></div><button class="primary" id="addWallet">Add wallet to monitoring</button><p id="walletStatus" class="status" role="status"></p><div id="wallets"></div></section>
<aside><section class="card panel"><h2>Network</h2><p class="muted">Switch your connected wallet to a supported network, then reconnect to open a session on that chain.</p><select id="networkSelect" class="network"><option value="1">Ethereum</option><option value="137">Polygon</option><option value="56">BNB Smart Chain</option><option value="43114">Avalanche</option><option value="42161">Arbitrum</option><option value="10">Optimism</option><option value="8453">Base</option></select><div class="actions"><button class="secondary" id="switchNetwork">Switch network in wallet</button></div></section>
<section class="notice"><b>Authorization is not active yet.</b><br>Monitoring does not give Mainwell permission to move assets. Recovery authorization will only be offered after the executor contract has completed independent review and on-chain verification. You remain in control of approvals and revocations.</section>
<button class="secondary" id="logout" style="margin-top:14px;width:100%">Disconnect session</button><p id="dashboardStatus" class="status" role="status"></p></aside></div>
</section><script>
const $=id=>document.getElementById(id);
const NETWORKS={1:"Ethereum",137:"Polygon",56:"BNB Smart Chain",43114:"Avalanche",42161:"Arbitrum",10:"Optimism",8453:"Base"};
let account="",chainId=0,wallets=[];
async function api(path,options={}){const r=await fetch(path,{credentials:"same-origin",...options,headers:{"content-type":"application/json",...(options.headers||{})}});let d={};try{d=await r.json()}catch{}if(!r.ok)throw new Error(d.error||"Request failed ("+r.status+")");return d}
function short(a){return a.slice(0,8)+"\u2026"+a.slice(-6)}
function setStatus(id,msg,error=false){$(id).textContent=msg;$(id).className="status"+(error?" error":"")}
async function provider(){if(!window.ethereum)throw new Error("No EVM wallet was found. Open this page in a wallet-enabled browser such as MetaMask.");return window.ethereum}
async function connect(){const button=$("connect");button.disabled=true;setStatus("connectStatus","Waiting for your wallet\u2026");try{const p=await provider();const accounts=await p.request({method:"eth_requestAccounts"});account=accounts?.[0]||"";if(!/^0x[0-9a-fA-F]{40}$/.test(account))throw new Error("Wallet did not return a valid account.");chainId=Number(BigInt(await p.request({method:"eth_chainId"})));if(!NETWORKS[chainId])throw new Error("Unsupported network. Select one of the supported EVM networks.");const challenge=await api("/api/auth/challenge",{method:"POST",body:JSON.stringify({address:account,chainId})});setStatus("connectStatus","Approve the sign-in message in your wallet. It does not authorize a transaction.");const signature=await p.request({method:"personal_sign",params:[challenge.message,account]});await api("/api/auth/verify",{method:"POST",body:JSON.stringify({address:account,chainId,nonce:challenge.nonce,signature})});location.assign("/authorize")}catch(e){setStatus("connectStatus",e.message,true)}finally{button.disabled=false}}
async function showDashboard(){$("connectView").classList.add("hidden");$("dashboard").classList.remove("hidden");$("walletAddress").textContent=short(account)+" \xB7 Signed in with your wallet";$("networkName").textContent=NETWORKS[chainId]||"Unsupported";$("networkSelect").value=String(chainId);await load()}
function renderWallets(){const root=$("wallets");root.replaceChildren();if(!wallets.length){const e=document.createElement("p");e.className="empty";e.textContent="No wallets registered for monitoring on this account yet.";root.append(e);return}for(const w of wallets){const item=document.createElement("article");item.className="wallet";const head=document.createElement("div");head.className="wallet-head";const addr=document.createElement("div");addr.className="address";addr.textContent=NETWORKS[w.chainId]||w.network;const tag=document.createElement("span");tag.className="tag";tag.textContent=w.status;head.append(addr,tag);item.append(head);const a=document.createElement("p");a.className="address";a.textContent=w.address;item.append(a);for(const asset of (w.assets||[])){const line=document.createElement("div");line.className="asset";const name=document.createElement("span");name.textContent=asset.symbol||asset.name||asset.assetId;const qty=document.createElement("span");qty.textContent=asset.estimatedValueUsd?"$"+Number(asset.estimatedValueUsd).toFixed(2):"Balance observed";line.append(name,qty);item.append(line)}const actions=document.createElement("div");actions.className="actions";const refresh=document.createElement("button");refresh.className="secondary";refresh.textContent="Refresh assets";refresh.addEventListener("click",()=>refreshWallet(w.id));const toggle=document.createElement("button");toggle.className="secondary";toggle.textContent=w.status==="paused"?"Resume monitoring":"Pause monitoring";toggle.addEventListener("click",()=>toggleWallet(w));actions.append(refresh,toggle);item.append(actions);root.append(item)}}
async function load(){const [profile,result]=await Promise.all([api("/api/owner/profile"),api("/api/owner/wallets")]);wallets=result.wallets||[];$("walletCount").textContent=profile.monitoredWalletCount;$("grantCount").textContent=profile.activeVerifiedGrantCount;renderWallets()}
$("connect").addEventListener("click",connect);
$("addWallet").addEventListener("click",async()=>{try{await api("/api/owner/wallets",{method:"POST",body:JSON.stringify({network:Object.keys(NETWORKS).map(Number).includes(chainId)?({1:"ethereum",137:"polygon",56:"bsc",43114:"avalanche",42161:"arbitrum",10:"optimism",8453:"base"})[chainId]:"",chainId})});setStatus("walletStatus","Wallet registered for read-only monitoring.");await load()}catch(e){setStatus("walletStatus",e.message,true)}});
async function refreshWallet(id){try{setStatus("walletStatus","Refreshing on-chain balances\u2026");const r=await api("/api/owner/wallets/"+id+"/refresh",{method:"POST",body:"{}"});setStatus("walletStatus","Refresh complete. "+r.assets.length+" asset entries observed.");await load()}catch(e){setStatus("walletStatus",e.message,true)}}
async function toggleWallet(w){try{await api("/api/owner/wallets/"+w.id,{method:"PATCH",body:JSON.stringify({status:w.status==="paused"?"monitoring":"paused"})});await load()}catch(e){setStatus("walletStatus",e.message,true)}}
$("refreshAll").addEventListener("click",async()=>{try{await load();setStatus("dashboardStatus","Workspace refreshed.")}catch(e){setStatus("dashboardStatus",e.message,true)}});
$("switchNetwork").addEventListener("click",async()=>{try{const p=await provider(),id=Number($("networkSelect").value);await p.request({method:"wallet_switchEthereumChain",params:[{chainId:"0x"+id.toString(16)}]});setStatus("dashboardStatus","Network switched. Reconnect to create a session for the selected chain.")}catch(e){setStatus("dashboardStatus",e.message,true)}});
$("logout").addEventListener("click",async()=>{try{await api("/api/auth/logout",{method:"POST",body:"{}"})}finally{location.reload()}});
api("/api/auth/me").then(async s=>{account=s.wallet;chainId=s.chainId;await showDashboard()}).catch(()=>{});
if(window.ethereum){window.ethereum.on?.("chainChanged",()=>setStatus("dashboardStatus","Wallet network changed. Reconnect to refresh the authenticated session."));window.ethereum.on?.("accountsChanged",()=>setStatus("dashboardStatus","Wallet account changed. Disconnect and reconnect to refresh your session."))}
<\/script></main></body></html>`;
function ownerDashboardResponse() {
  return new Response(OWNER_HTML, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'" } });
}
__name(ownerDashboardResponse, "ownerDashboardResponse");

// src/application/owner-authorization.ts
var AUTHORIZATION_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#0b1220"><title>Mainwell \xB7 Owner authorization</title>
<style>
:root{font-family:Inter,ui-sans-serif,system-ui,sans-serif;color:#e8edf5;background:#0b1220}*{box-sizing:border-box}body{margin:0;background:radial-gradient(ellipse at 5% 0%,#203b48 0,transparent 40%),#0b1220}.shell{max-width:1020px;margin:auto;padding:28px 20px 60px}.brand{font-weight:850;letter-spacing:.08em;margin-bottom:42px}.brand small{display:block;color:#8299a5;font-size:10px;letter-spacing:.18em;margin-top:5px}.eyebrow{color:#86cbb8;font-size:11px;font-weight:750;letter-spacing:.2em}.hero{max-width:760px;margin-bottom:25px}.hero h1{font-size:clamp(34px,5vw,52px);line-height:1.08;letter-spacing:-.05em;margin:13px 0}.muted{color:#96a8b4;line-height:1.7;font-size:14px}.card{background:linear-gradient(145deg,#172432,#111d29);border:1px solid #30444d;border-radius:18px;padding:22px;margin:14px 0}.row{display:flex;justify-content:space-between;gap:15px;align-items:center}.status{font-size:12px;color:#a8d8c9;line-height:1.6}.warn{border:1px solid #665b37;background:#292719;color:#e2d4a9;border-radius:13px;padding:16px;font-size:13px;line-height:1.7}.good{color:#9cdec8}.bad{color:#f0b3a3}.asset{padding:15px 0;border-top:1px solid #2a3e49;display:grid;grid-template-columns:34px 1fr;gap:12px;font-size:12px}.asset:first-child{border-top:0}.asset b{display:block;font-size:14px;margin-bottom:5px}.small{font-size:11px;color:#8ea1ad;overflow-wrap:anywhere;line-height:1.6}.btn{border:1px solid #3c5660;background:#1b303b;color:#dbe7e8;border-radius:10px;padding:11px 15px;font:inherit;cursor:pointer}.btn.primary{background:linear-gradient(100deg,#b5e5d7,#80c9b5);color:#102b28;border:0;font-weight:800}.btn:disabled{opacity:.45;cursor:not-allowed}.blocker{padding:9px 0;border-top:1px solid #3d3a2c;font-size:12px;color:#e2d4a9}.blocker:first-child{border-top:0}.asset input{margin-top:4px;accent-color:#8bd0bd;width:18px;height:18px}.pill{display:inline-block;padding:4px 8px;border:1px solid #36534f;border-radius:99px;color:#a9d8c8;font-size:10px;margin:3px 3px 0 0}.asset-meta{margin-top:7px}.actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:16px}.success{color:#9cdec8}.error{color:#f0b3a3}@media(max-width:600px){.shell{padding:20px 14px}.row{align-items:flex-start;flex-direction:column}.card{padding:18px}}
</style></head><body><main class="shell">
<div class="brand">MAINWELL<small>OWNER AUTHORIZATION</small></div>
<section class="hero"><div class="eyebrow">YOUR WALLET \xB7 YOUR PERMISSIONS</div><h1>Review and approve your recovery scope.</h1><p class="muted">Mainwell will only use the exact token, destination, maximum amount, execution mode and expiry that you approve. The deployment and token approvals are separate wallet transactions. No seed phrase or private key is ever requested.</p></section>
<section class="card"><div class="row"><div><b>Connected wallet</b><p id="wallet" class="muted">Checking authenticated wallet session\u2026</p></div><button id="refresh" class="btn">Refresh authorization plan</button></div><p id="status" class="status" role="status" aria-live="polite"></p></section>
<section class="card"><h2>Source wallet eligibility</h2><div id="eligibility" class="muted">Loading administrator lock status\u2026</div></section>
<section class="card"><h2>Choose assets to authorize</h2><p class="muted">Each asset has its own locked destination and cumulative recovery cap. Balances are informational; the cap is the maximum amount the executor can recover over the life of this grant.</p><div id="assets" class="muted">Loading asset inventory and policies\u2026</div><p id="selectionStatus" class="small"></p></section>
<section class="card"><h2>Execution identity and deployment readiness</h2><div id="readiness" class="muted">Checking configuration\u2026</div><div id="operators" class="small"></div></section>
<section class="card"><h2>Owner authorization</h2><p class="muted">When every prerequisite is verified, this button will deploy the immutable executor from your wallet, request exact token allowances, then ask Mainwell to independently verify and record the grant.</p><label class="small"><input type="checkbox" id="ack" disabled> I have reviewed the selected assets, destinations, caps, execution modes and expiry. I understand that approving a token allowance gives this exact executor permission to transfer only within those on-chain limits.</label><p></p><label class="small"><input type="checkbox" id="auditAck" disabled> I understand this contract has received an internal code review but has not received an independent third-party audit. I accept that additional risk for this authorization.</label><div class="actions"><button id="authorize" class="btn primary" disabled>Deploy executor and approve selected assets</button></div><p id="txStatus" class="status" role="status" aria-live="polite"></p></section>
<section class="warn"><b>Security gate:</b> Authorization remains disabled until trusted service operator identities and chain-specific RPC verification are configured. The deployment artifact is reproducibly built and pinned. An independent third-party audit is strongly recommended before high-value use. Creating a grant does not itself execute recovery; the automatic and administrator recovery workers are Phase 2. Never approve an unexpected transaction or share wallet credentials.</section>
<p class="muted"><a href="/" style="color:#9dd8c7">\u2190 Return to wallet workspace</a></p>
</main><script>
const $=id=>document.getElementById(id);
const ZERO="0x0000000000000000000000000000000000000000";
let plan=null,artifact=null,selected=new Set(),session=null,reviewedSelection="";
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
async function api(path,options={}){const r=await fetch(path,{credentials:"same-origin",cache:"no-store",...options,headers:{"content-type":"application/json",...(options.headers||{})}});let d={};try{d=await r.json()}catch{}if(!r.ok)throw new Error(d.error||"Request failed ("+r.status+")");return d}
function short(a){return a?a.slice(0,8)+"\u2026"+a.slice(-6):"\u2014"}
function formatUnits(raw,decimals){try{if(!/^d+$/.test(String(raw)))return "\u2014";const d=Number(decimals);if(!Number.isInteger(d)||d<0||d>36)return String(raw);const n=BigInt(raw),base=10n**BigInt(d),whole=(n/base).toString(),fraction=d?(n%base).toString().padStart(d,"0").replace(/0+$/,""):"";return fraction?whole+"."+fraction:whole}catch{return "\u2014"}}
function flag(label,value){return '<div class="blocker"><span class="'+(value?"good":"bad")+'">'+(value?"\u2713 ":"\u2022 ")+'</span>'+esc(label)+': '+(value?"Ready":"Not ready")+'</div>'}
function renderAssets(){const root=$("assets");root.replaceChildren();if(!plan.assets.length){root.textContent="No monitored assets found for this source wallet on this network.";return}
for(const a of plan.assets){const p=a.policy,ok=a.authorizationEligible;const item=document.createElement("div");item.className="asset";const cb=document.createElement("input");cb.type="checkbox";cb.disabled=!ok;cb.checked=ok&&selected.has(a.assetId);cb.addEventListener("change",()=>{if(cb.checked)selected.add(a.assetId);else selected.delete(a.assetId);updateSelection()});const body=document.createElement("div");const name=document.createElement("b");name.textContent=a.symbol||a.name||a.assetId;const addr=document.createElement("div");addr.className="small";addr.textContent=a.tokenAddress||"Native asset (not supported by the ERC-20 executor)";const balance=document.createElement("div");balance.className="small";balance.textContent="Observed balance: "+formatUnits(a.balanceRaw,a.decimals)+" "+(a.symbol||"tokens")+" ("+(a.balanceRaw||"\u2014")+" base units)";const destination=document.createElement("div");destination.className="small";destination.textContent="Locked destination: "+(p?.destinationAddress||"No destination policy");const cap=document.createElement("div");cap.className="small";cap.textContent="Maximum recovery: "+(p?.maxAmountRaw?formatUnits(p.maxAmountRaw,a.decimals)+" "+(a.symbol||"tokens")+" ("+p.maxAmountRaw+" base units)":"Not configured");const expiry=document.createElement("div");expiry.className="small";expiry.textContent="Expiry: "+(p?.expiresInSeconds?Math.round(p.expiresInSeconds/3600)+" hours":"Not configured");const modes=document.createElement("div");modes.className="asset-meta";if(p?.automaticPriorityEnabled)modes.insertAdjacentHTML("beforeend",'<span class="pill">Automatic-priority</span>');if(p?.adminInitiatedEnabled)modes.insertAdjacentHTML("beforeend",'<span class="pill">Admin-initiated</span>');if(!ok)modes.insertAdjacentHTML("beforeend",'<span class="pill" style="color:#f0b3a3">Not eligible</span>');body.append(name,addr,balance,destination,cap,expiry,modes);item.append(cb,body);root.append(item)}updateSelection()}
function updateSelection(){const signature=[...selected].sort().join("|");if(signature!==reviewedSelection){reviewedSelection=signature;$("ack").checked=false;$("auditAck").checked=false}const count=selected.size;$("selectionStatus").textContent=count+" eligible asset(s) selected. "+(count?"Execution modes will be restricted to those enabled for every selected asset.":"Select at least one eligible asset.");const chosen=plan?.assets.filter(a=>selected.has(a.assetId))||[];const commonAuto=chosen.length>0&&chosen.every(a=>Number(a.policy?.automaticPriorityEnabled)===1);const commonAdmin=chosen.length>0&&chosen.every(a=>Number(a.policy?.adminInitiatedEnabled)===1);if(chosen.length&& !commonAuto&&!commonAdmin)$("selectionStatus").textContent+=" The selected assets have no common execution mode; select assets with a shared mode.";return {chosen,commonAuto,commonAdmin}}
function readiness(){const r=plan?.readiness||{};const ops=r.executionOperators||{};const securityReviewPassed=r.securityReviewPassed===true;const items=[
["Exact source wallet locked by administrator",r.sourceWalletLocked],
["Trusted RPC configured for this network",r.rpcConfigured],
["Pinned executor artifact available",r.executorArtifactAvailable],
["Automation operator identity configured",r.automationOperatorConfigured],
["Administrator operator identity configured",r.adminOperatorConfigured],
["Internal executor code review completed",securityReviewPassed]
];$("readiness").innerHTML=items.map(x=>flag(x[0],x[1])).join("")+flag("Independent third-party audit (recommended)",r.independentAuditPassed===true);$("operators").textContent="Automation operator: "+short(ops.automation||ZERO)+" \xB7 Administrator operator: "+short(ops.administrator||ZERO);const selection=updateSelection();const ready=items.every(x=>x[1])&&artifact&&selection.chosen.length>0&&(selection.commonAuto||selection.commonAdmin);$("ack").disabled=!ready;$("auditAck").disabled=!ready;$("authorize").disabled=!ready||!$("ack").checked||!$("auditAck").checked}
async function load(){ reviewedSelection="";$("status").textContent="Loading authorization plan\u2026";try{session=await api("/api/auth/me");if(!session.authenticated)throw new Error("Connect your wallet to continue.");$("wallet").textContent=short(session.wallet)+" \xB7 Chain "+session.chainId;[plan,artifact]=await Promise.all([api("/api/owner/authorization-plan"),api("/api/owner/executor-artifact")]);selected=new Set(plan.assets.filter(a=>a.authorizationEligible).map(a=>a.assetId));$("eligibility").innerHTML=plan.sourceWallet?'<b class="'+(plan.readiness.sourceWalletLocked?"good":"bad")+'">'+(plan.readiness.sourceWalletLocked?"Administrator locked":"Not administrator-locked")+'</b><p class="small">Network: '+esc(plan.network)+' \xB7 '+esc(plan.sourceWallet.status)+'</p>':'<b class="bad">This exact wallet and network have not been locked by an administrator.</b>';renderAssets();readiness();const blockers=plan.blockers||[];$("status").textContent="Plan loaded. "+blockers.length+" server-side prerequisite(s) remain.";if(blockers.length)$("status").className="status error";}catch(e){$("status").textContent=e.message;$("status").className="status error"}}
function word(n){return BigInt(n).toString(16).padStart(64,"0")}
function addressWord(a){if(!/^0x[0-9a-fA-F]{40}$/.test(a))throw new Error("Invalid EVM address in authorization policy.");return a.slice(2).toLowerCase().padStart(64,"0")}
function encodeArray(values,encoder){return word(values.length)+values.map(encoder).join("")}
function scopeSignature(source,assetIds){return source.assets.filter(a=>assetIds.has(a.assetId)).map(a=>[a.assetId,a.tokenAddress,a.policy?.destinationAddress,a.policy?.maxAmountRaw,a.policy?.automaticPriorityEnabled,a.policy?.adminInitiatedEnabled,a.policy?.expiresInSeconds]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))).map(x=>JSON.stringify(x)).join("|")}
function constructorData(assets,destinations,caps,expiry,auto,admin,ops){const headSize=8*32;const aa=encodeArray(assets,addressWord),dd=encodeArray(destinations,addressWord),cc=encodeArray(caps,word);let offset=headSize;const aOffset=offset;offset+=aa.length/2;const dOffset=offset;offset+=dd.length/2;const cOffset=offset;const head=[word(expiry),word(aOffset),word(dOffset),word(cOffset),word(auto?1:0),word(admin?1:0),addressWord(ops.automation),addressWord(ops.administrator)].join("");return head+aa+dd+cc}
async function waitReceipt(provider,hash){for(let i=0;i<120;i++){const receipt=await provider.request({method:"eth_getTransactionReceipt",params:[hash]});if(receipt){if(receipt.status!=="0x1")throw new Error("A wallet transaction reverted: "+hash);return receipt}await new Promise(resolve=>setTimeout(resolve,2000))}throw new Error("Timed out waiting for transaction confirmation. Check the wallet explorer before retrying: "+hash)}
async function send(provider,tx){const hash=await provider.request({method:"eth_sendTransaction",params:[tx]});await waitReceipt(provider,hash);return hash}
async function executeAuthorization(){const button=$("authorize");button.disabled=true;$("txStatus").textContent="Preparing the owner-approved deployment\u2026";try{
if(!window.ethereum)throw new Error("Open Mainwell in a wallet-enabled browser.");
const accounts=await window.ethereum.request({method:"eth_accounts"});const from=accounts?.[0];const chain=Number(BigInt(await window.ethereum.request({method:"eth_chainId"})));if(!from||from.toLowerCase()!==session.wallet.toLowerCase()||chain!==plan.chainId)throw new Error("The connected wallet account or network changed. Reconnect before authorizing.");
const sel=updateSelection(),chosen=sel.chosen;if(!chosen.length||(!sel.commonAuto&&!sel.commonAdmin))throw new Error("Choose assets with at least one shared execution mode.");const latestPlan=await api("/api/owner/authorization-plan");if(scopeSignature(latestPlan,selected)!==scopeSignature(plan,selected))throw new Error("An administrator changed one or more selected asset policies. Refresh the plan and review it again before authorizing.");plan=latestPlan;
const ops=plan.readiness.executionOperators;if(!ops?.automation||!ops?.administrator)throw new Error("Trusted operator addresses are unavailable.");
const assets=chosen.map(a=>a.tokenAddress),destinations=chosen.map(a=>a.policy.destinationAddress),caps=chosen.map(a=>a.policy.maxAmountRaw);
const duration=Math.min(...chosen.map(a=>Number(a.policy.expiresInSeconds)));const expiry=Math.floor(Date.now()/1000)+duration;const data=artifact.creationBytecode+constructorData(assets,destinations,caps,expiry,sel.commonAuto,sel.commonAdmin,ops);
$("txStatus").textContent="Confirm the executor deployment in your wallet. Review the contract creation transaction carefully.";
const deploymentHash=await send(window.ethereum,{from,data});const receipt=await waitReceipt(window.ethereum,deploymentHash);const executor=receipt.contractAddress;if(!executor)throw new Error("Deployment receipt did not include a contract address.");const afterDeployPlan=await api("/api/owner/authorization-plan");if(scopeSignature(afterDeployPlan,selected)!==scopeSignature(plan,selected))throw new Error("The administrator policy changed after deployment. No token allowances were requested. The unused executor is deployed at "+executor+"; do not authorize it further.");
$("txStatus").textContent="Executor deployed. Now approve each selected token for its exact cap.";
for(let i=0;i<chosen.length;i++){const token=assets[i],cap=caps[i];const allowanceData="0xdd62ed3e"+addressWord(from)+addressWord(executor);const allowance=BigInt(await window.ethereum.request({method:"eth_call",params:[{to:token,data:allowanceData},"latest"]}));if(allowance>0n){$("txStatus").textContent="Resetting an existing allowance for "+chosen[i].symbol+".";await send(window.ethereum,{from,to:token,data:"0x095ea7b3"+addressWord(executor)+word(0)})}$("txStatus").textContent="Confirm exact "+chosen[i].symbol+" allowance ("+cap+" base units) in your wallet.";await send(window.ethereum,{from,to:token,data:"0x095ea7b3"+addressWord(executor)+word(cap)})}
const block=await window.ethereum.request({method:"eth_getBlockByNumber",params:[receipt.blockNumber,false]});if(!block?.timestamp)throw new Error("Could not read the deployment block timestamp.");const approvedAt=new Date(Number(BigInt(block.timestamp))*1000).toISOString();
const grant={grantId:crypto.randomUUID(),ownerWallet:from,network:plan.network,chainId:plan.chainId,executorAddress:executor,executorCodeHash:artifact.normalizedRuntimeCodeHash,destinationAddress:destinations[0],assets:chosen.map((a,i)=>({assetId:a.assetId,tokenAddress:assets[i],destinationAddress:destinations[i],amount:{kind:"capped",maxAmountRaw:caps[i]}})),executionModes:[...(sel.commonAuto?["automatic-priority"]:[]),...(sel.commonAdmin?["admin-initiated"]:[])],executionOperators:{automation:ops.automation,administrator:ops.administrator},approvedAt,expiresAt:new Date(expiry*1000).toISOString(),evidence:{kind:"onchain-approval",reference:deploymentHash}};
$("txStatus").textContent="All wallet approvals confirmed. Mainwell is independently verifying the executor, exact token scopes and live allowances.";
const verified=await api("/api/owner/grants/verify",{method:"POST",body:JSON.stringify({grant})});$("txStatus").className="status success";$("txStatus").textContent="Authorization verified and recorded. Executor: "+executor+" \xB7 Grant: "+verified.grantId;
}catch(e){$("txStatus").className="status error";$("txStatus").textContent=e.message}finally{readiness()}}
$("refresh").addEventListener("click",load);$("ack").addEventListener("change",readiness);$("auditAck").addEventListener("change",readiness);$("authorize").addEventListener("click",executeAuthorization);load();
<\/script></body></html>`;
function ownerAuthorizationResponse() {
  return new Response(AUTHORIZATION_HTML, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'" } });
}
__name(ownerAuthorizationResponse, "ownerAuthorizationResponse");

// src/application/operator-wallet-setup.ts
var HTML2 = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta name="theme-color" content="#0b1220"><title>Mainwell \xB7 Operator Wallet Setup</title>
<style>
:root{color-scheme:dark;font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#0b1220;color:#e8edf5}*{box-sizing:border-box}body{margin:0;background:radial-gradient(ellipse at 15% 0%,#203b48 0,transparent 42%),#0b1220}.shell{max-width:900px;margin:auto;padding:28px 18px 60px}.brand{font-weight:800;letter-spacing:.08em;margin-bottom:34px}.brand small{display:block;color:#8fa0ad;font-size:10px;letter-spacing:.2em}.panel{background:#14222e;border:1px solid #30434c;border-radius:18px;padding:24px;margin:18px 0}.muted{color:#9eacbb;font-size:13px;line-height:1.65}.warning{border:1px solid #795d32;background:#302617;color:#f4d9a6;border-radius:12px;padding:14px;font-size:13px;line-height:1.6}.row{display:grid;grid-template-columns:1fr 1fr;gap:16px}.wallet{border:1px solid #314a53;border-radius:13px;padding:16px;margin-top:14px}.wallet h3{margin:0 0 8px}.field{margin:14px 0}.field label{display:block;font-size:12px;margin-bottom:7px;color:#bdc9d2}.field input{width:100%;padding:12px;border-radius:10px;border:1px solid #40535d;background:#0b1720;color:#fff}.secret{font-family:ui-monospace,monospace;overflow-wrap:anywhere;background:#08121a;border:1px solid #344650;padding:12px;border-radius:9px;font-size:12px}.btn{border:0;border-radius:10px;background:#9bd8c7;color:#102b28;padding:12px 16px;font-weight:800;cursor:pointer}.btn:disabled{opacity:.5}.secondary{background:#1b303b;border:1px solid #3b5661;color:#e8edf5}.actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}.status{font-size:13px;color:#a8d8c9;min-height:22px}.error{color:#f1a7a7}.hidden{display:none!important}code{font-family:ui-monospace,monospace}@media(max-width:650px){.row{grid-template-columns:1fr}.shell{padding:20px 14px 40px}.panel{padding:18px}}
</style></head><body><main class="shell"><div class="brand">MAINWELL<small>OPERATOR WALLET OWNERSHIP SETUP</small></div>
<section class="panel"><h1>Set up your two operator wallets</h1><p class="muted">This page creates two independent EVM wallets locally in this browser. Private keys are not sent to Mainwell, Cloudflare, GitHub, or this chat. You will add them yourself as Cloudflare Worker secrets after saving your encrypted backup.</p>
<div class="warning"><b>Important:</b> Keep this page open until you have downloaded and checked your encrypted backup. Never screenshot, message, or share an unencrypted private key. Anyone with a private key can control that wallet and its funds.</div>
<p id="auth" class="status">Checking administrator session\u2026</p><button id="generate" class="btn" disabled>Generate both wallets</button>
<div id="wallets" class="hidden">
<div class="row">
<div class="wallet"><h3>Automation operator</h3><p class="muted">Cloudflare secret name: <code>MAINWELL_AUTOMATION_PRIVATE_KEY</code></p><p class="muted">Public address</p><div id="automationAddress" class="secret"></div><p class="muted">Private key \u2014 keep confidential</p><div id="automationKey" class="secret"></div><button class="btn secondary" data-copy="automationKey">Copy private key</button></div>
<div class="wallet"><h3>Admin operator</h3><p class="muted">Cloudflare secret name: <code>MAINWELL_ADMIN_PRIVATE_KEY</code></p><p class="muted">Public address</p><div id="adminAddress" class="secret"></div><p class="muted">Private key \u2014 keep confidential</p><div id="adminKey" class="secret"></div><button class="btn secondary" data-copy="adminKey">Copy private key</button></div>
</div>
<div class="panel"><h2>Download encrypted backup</h2><p class="muted">Choose a strong backup password. It is used only in this browser to encrypt the backup file with PBKDF2-SHA-256 and AES-256-GCM. Mainwell does not receive it.</p>
<div class="field"><label for="backupPassword">Backup password (at least 16 characters)</label><input id="backupPassword" type="password" autocomplete="new-password" minlength="16"></div>
<div class="field"><label for="backupConfirm">Confirm backup password</label><input id="backupConfirm" type="password" autocomplete="new-password" minlength="16"></div>
<button id="download" class="btn">Encrypt and download backup</button><p id="backupStatus" class="status"></p></div>
<p class="muted">After downloading, open Cloudflare Dashboard \u2192 Workers & Pages \u2192 mainwell \u2192 Settings \u2192 Variables and Secrets. Add the two private keys as secrets using the exact names above. Add the public addresses as plain-text variables named <code>MAINWELL_AUTOMATION_OPERATOR</code> and <code>MAINWELL_ADMIN_OPERATOR</code>. Do not put private keys in plain-text variables.</p>
</div><p id="status" class="status"></p>
</section></main>
<script>
const $=id=>document.getElementById(id);let generated=null;
const P=0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn,N=0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const G={x:0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n,y:0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n};
const mod=(a,m)=>{const r=a%m;return r<0n?r+m:r};
function pow(a,n,m){let x=mod(a,m),o=1n;while(n>0n){if(n&1n)o=o*x%m;x=x*x%m;n>>=1n}return o}
function inv(a,m){let r=mod(a,m),s=m,os=1n,ss=0n;while(s){const q=r/s;[r,s]=[s,r-q*s];[os,ss]=[ss,os-q*ss]}if(r!==1n)throw Error("Curve inversion failed");return mod(os,m)}
function add(a,b){if(!a)return b;if(!b)return a;if(a.x===b.x&&mod(a.y+b.y,P)===0n)return null;const m=a.x===b.x&&a.y===b.y?mod(3n*a.x*a.x*inv(2n*a.y,P),P):mod((b.y-a.y)*inv(b.x-a.x,P),P);const x=mod(m*m-a.x-b.x,P);return{x,y:mod(m*(a.x-x)-a.y,P)}}
function mul(point,k){let p=point,n=k,o=null;while(n){if(n&1n)o=add(o,p);p=add(p,p);n>>=1n}return o}
const MASK=(1n<<64n)-1n,ROT=[0,1,62,28,27,36,44,6,55,20,3,10,43,25,39,41,45,15,21,8,18,2,61,56,14],RC=[1n,0x8082n,0x800000000000808an,0x8000000080008000n,0x808bn,0x80000001n,0x8000000080008081n,0x8000000000008009n,0x8an,0x88n,0x80008009n,0x8000000an,0x8000808bn,0x800000000000008bn,0x8000000000008089n,0x8000000000008003n,0x8000000000008002n,0x8000000000000080n,0x800an,0x800000008000000an,0x8000000080008081n,0x8000000000008080n,0x80000001n,0x8000000080008008n];
function rol(v,n){if(!n)return v&MASK;const b=BigInt(n);return((v<<b)|(v>>(64n-b)))&MASK}
function keccak(bytes){const rate=136,len=Math.ceil((bytes.length+1)/rate)*rate,p=new Uint8Array(len);p.set(bytes);p[bytes.length]=1;p[len-1]|=128;const a=Array(25).fill(0n);for(let off=0;off<len;off+=rate){for(let i=0;i<rate;i++)a[Math.floor(i/8)]^=BigInt(p[off+i])<<BigInt(i%8*8);for(const rc of RC){const c=Array(5),d=Array(5);for(let x=0;x<5;x++)c[x]=a[x]^a[x+5]^a[x+10]^a[x+15]^a[x+20];for(let x=0;x<5;x++)d[x]=c[(x+4)%5]^rol(c[(x+1)%5],1);for(let y=0;y<5;y++)for(let x=0;x<5;x++)a[x+5*y]=(a[x+5*y]^d[x])&MASK;const b=Array(25).fill(0n);for(let y=0;y<5;y++)for(let x=0;x<5;x++){const i=x+5*y;b[y+5*((2*x+3*y)%5)]=rol(a[i],ROT[i])}for(let y=0;y<5;y++)for(let x=0;x<5;x++)a[x+5*y]=(b[x+5*y]^((~b[(x+1)%5+5*y])&b[(x+2)%5+5*y]))&MASK;a[0]^=rc}}const out=new Uint8Array(32);for(let i=0;i<32;i++)out[i]=Number(a[Math.floor(i/8)]>>BigInt(i%8*8)&255n);return out}
const hex=b=>Array.from(b,x=>x.toString(16).padStart(2,"0")).join("");
function createWallet(){let bytes=new Uint8Array(32),k=0n;do{crypto.getRandomValues(bytes);k=BigInt("0x"+hex(bytes))}while(k===0n||k>=N);const q=mul(G,k),pub=new Uint8Array(64);const put=(v,o)=>{let h=v.toString(16).padStart(64,"0");for(let i=0;i<32;i++)pub[o+i]=parseInt(h.slice(i*2,i*2+2),16)};put(q.x,0);put(q.y,32);const address="0x"+hex(keccak(pub).slice(12));return{address,privateKey:"0x"+hex(bytes)}}
async function checkAdmin(){try{const r=await fetch("/api/admin/auth/me",{credentials:"same-origin",cache:"no-store"});if(!r.ok)throw Error();$("auth").textContent="Administrator session verified."; $("generate").disabled=false}catch{$("auth").className="status error";$("auth").textContent="Sign in at /admin first, then reopen this page."}}
$("generate").addEventListener("click",()=>{if(generated)return;try{const automation=createWallet(),admin=createWallet();if(automation.address===admin.address)throw Error("Wallet collision; retry.");generated={automation,admin};$("automationAddress").textContent=automation.address;$("automationKey").textContent=automation.privateKey;$("adminAddress").textContent=admin.address;$("adminKey").textContent=admin.privateKey;$("wallets").classList.remove("hidden");$("generate").disabled=true;$("generate").textContent="Wallets generated \u2014 do not refresh";$("status").textContent="Both wallets were generated locally. Download your encrypted backup before leaving this page."}catch(e){$("status").className="status error";$("status").textContent=e.message}});
document.querySelectorAll("[data-copy]").forEach(b=>b.addEventListener("click",async()=>{try{await navigator.clipboard.writeText($(b.dataset.copy).textContent);$("status").textContent="Copied. Paste only into the matching Cloudflare secret field."}catch{$("status").className="status error";$("status").textContent="Clipboard access unavailable. Select and copy the key manually."}}));
$("download").addEventListener("click",async()=>{const pass=$("backupPassword").value,confirm=$("backupConfirm").value;if(!generated)return;if(pass.length<16||pass!==confirm){$("backupStatus").className="status error";$("backupStatus").textContent="Use a matching backup password of at least 16 characters.";return}const button=$("download");button.disabled=true;$("backupStatus").textContent="Encrypting locally\u2026";try{const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12)),base=await crypto.subtle.importKey("raw",new TextEncoder().encode(pass),"PBKDF2",false,["deriveKey"]),key=await crypto.subtle.deriveKey({name:"PBKDF2",salt,iterations:310000,hash:"SHA-256"},base,{name:"AES-GCM",length:256},false,["encrypt"]);const payload={format:"mainwell-operator-wallet-backup-v1",createdAt:new Date().toISOString(),wallets:generated};const cipher=await crypto.subtle.encrypt({name:"AES-GCM",iv},key,new TextEncoder().encode(JSON.stringify(payload)));const file={format:"mainwell-encrypted-backup-v1",kdf:"PBKDF2-SHA256",iterations:310000,salt:hex(salt),cipher:"AES-256-GCM",iv:hex(iv),ciphertext:hex(new Uint8Array(cipher))};const blob=new Blob([JSON.stringify(file,null,2)],{type:"application/json"}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download="mainwell-operator-wallets.encrypted.json";a.click();URL.revokeObjectURL(url);$("backupStatus").textContent="Encrypted backup download started. Keep the password separately; it cannot be recovered."; $("backupPassword").value="";$("backupConfirm").value=""}catch(e){$("backupStatus").className="status error";$("backupStatus").textContent="Backup encryption failed. Retry before closing this page."}finally{button.disabled=false}});
checkAdmin();
<\/script></body></html>`;
function operatorWalletSetupResponse() {
  return new Response(HTML2, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'" } });
}
__name(operatorWalletSetupResponse, "operatorWalletSetupResponse");

// src/worker.ts
var SESSION_SECONDS2 = 604800;
var CHALLENGE_SECONDS = 300;
var CHAINS = /* @__PURE__ */ new Set([1, 137, 56, 43114, 42161, 10, 8453]);
var ADDRESS5 = /^0x[0-9a-fA-F]{40}$/;
function json2(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", ...extra } });
}
__name(json2, "json");
function hex2(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
__name(hex2, "hex");
function randomHex2(n) {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return hex2(b);
}
__name(randomHex2, "randomHex");
async function hash(s) {
  return hex2(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))));
}
__name(hash, "hash");
function cookie2(req, name = "mw_owner_session") {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=") || null;
  }
  return null;
}
__name(cookie2, "cookie");
function sameOrigin2(req, url) {
  return req.headers.get("origin") === url.origin;
}
__name(sameOrigin2, "sameOrigin");
async function body2(req) {
  if (Number(req.headers.get("content-length") ?? "0") > 4096) return null;
  try {
    const s = await req.text();
    if (s.length > 4096) return null;
    const x = JSON.parse(s);
    return x && typeof x === "object" && !Array.isArray(x) ? x : null;
  } catch {
    return null;
  }
}
__name(body2, "body");
async function session(req, env) {
  const token = cookie2(req);
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  const now = (/* @__PURE__ */ new Date()).toISOString(), row = await env.DB.prepare("SELECT id,wallet_address,chain_id FROM wallet_sessions WHERE token_hash=? AND revoked_at IS NULL AND expires_at>?").bind(await hash(token), now).first();
  if (!row) return null;
  await env.DB.prepare("UPDATE wallet_sessions SET last_seen_at=? WHERE id=?").bind(now, row.id).run();
  return { wallet: row.wallet_address, chainId: row.chain_id };
}
__name(session, "session");
var worker_default = { async fetch(request, env) {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/admin") return adminDashboardResponse();
  if (request.method === "GET" && url.pathname === "/admin/operators") return operatorWalletSetupResponse();
  if (request.method === "GET" && url.pathname === "/") return ownerDashboardResponse();
  if (request.method === "GET" && url.pathname === "/authorize") return ownerAuthorizationResponse();
  if (request.method === "GET" && url.pathname === "/health") return json2({ service: "mainwell", status: "ok", database: "configured", timestamp: (/* @__PURE__ */ new Date()).toISOString() });
  if (request.method === "GET" && url.pathname === "/api/health/db") try {
    const db = await env.DB.prepare("SELECT 1 AS ok").first();
    const schema = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='recovery_grants'").first();
    const auth = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='wallet_sessions'").first();
    return json2({ service: "mainwell", database: db?.ok === 1 ? "connected" : "unavailable", schema: schema ? "initialized" : "pending", walletAuthSchema: auth ? "initialized" : "pending", timestamp: (/* @__PURE__ */ new Date()).toISOString() }, db?.ok === 1 ? 200 : 503);
  } catch {
    return json2({ service: "mainwell", database: "unavailable", error: "Database health check failed" }, 503);
  }
  if (url.pathname === "/api/auth/challenge" && request.method === "POST") {
    if (!sameOrigin2(request, url)) return json2({ error: "Origin check failed." }, 403);
    const b = await body2(request), address = typeof b?.address === "string" ? b.address : "", chainId = Number(b?.chainId);
    if (!ADDRESS5.test(address) || !Number.isSafeInteger(chainId) || !CHAINS.has(chainId)) return json2({ error: "Valid EVM address and supported chain ID required." }, 400);
    const now = Date.now(), issued = new Date(now).toISOString(), expires = new Date(now + CHALLENGE_SECONDS * 1e3).toISOString(), nonce = randomHex2(16);
    const message = [url.hostname + " wants you to sign in with your Ethereum account:", address, "", "Sign in to Mainwell. This request will not trigger a blockchain transaction or grant token permissions.", "", "URI: " + url.origin, "Version: 1", "Chain ID: " + chainId, "Nonce: " + nonce, "Issued At: " + issued, "Expiration Time: " + expires].join("\n");
    await env.DB.prepare("INSERT INTO wallet_auth_challenges(nonce,wallet_address,chain_id,message,origin,expires_at,created_at) VALUES(?,?,?,?,?,?,?)").bind(nonce, address.toLowerCase(), chainId, message, url.origin, expires, issued).run();
    await env.DB.prepare("DELETE FROM wallet_auth_challenges WHERE expires_at<=? OR consumed_at IS NOT NULL").bind(issued).run();
    return json2({ nonce, message, expiresAt: expires });
  }
  if (url.pathname === "/api/auth/verify" && request.method === "POST") {
    if (!sameOrigin2(request, url)) return json2({ error: "Origin check failed." }, 403);
    const b = await body2(request), address = typeof b?.address === "string" ? b.address : "", nonce = typeof b?.nonce === "string" ? b.nonce : "", signature = typeof b?.signature === "string" ? b.signature : "", chainId = Number(b?.chainId);
    if (!ADDRESS5.test(address) || !/^[0-9a-f]{32}$/.test(nonce) || !Number.isSafeInteger(chainId) || !CHAINS.has(chainId) || !/^0x[0-9a-fA-F]{130}$/.test(signature)) return json2({ error: "Malformed wallet authentication request." }, 400);
    const c = await env.DB.prepare("SELECT message,wallet_address,chain_id,origin,expires_at,consumed_at FROM wallet_auth_challenges WHERE nonce=?").bind(nonce).first();
    const now = (/* @__PURE__ */ new Date()).toISOString();
    if (!c || c.consumed_at || c.expires_at <= now || c.origin !== url.origin || c.wallet_address !== address.toLowerCase() || c.chain_id !== chainId) return json2({ error: "Challenge invalid, expired, or already used. Request a new one." }, 401);
    let recovered;
    try {
      recovered = recoverPersonalSignAddress(c.message, signature);
    } catch {
      return json2({ error: "Wallet signature verification failed." }, 401);
    }
    if (recovered !== c.wallet_address) return json2({ error: "Wallet signature does not match the challenged address." }, 401);
    const used = await env.DB.prepare("UPDATE wallet_auth_challenges SET consumed_at=? WHERE nonce=? AND consumed_at IS NULL AND expires_at>?").bind(now, nonce, now).run();
    if (!used.success || (used.meta?.changes ?? 0) !== 1) return json2({ error: "Challenge already consumed. Request a new one." }, 409);
    const token = randomHex2(32), id = crypto.randomUUID(), expires = new Date(Date.now() + SESSION_SECONDS2 * 1e3).toISOString();
    await env.DB.prepare("INSERT INTO wallet_sessions(id,wallet_address,chain_id,token_hash,expires_at,created_at,last_seen_at) VALUES(?,?,?,?,?,?,?)").bind(id, c.wallet_address, chainId, await hash(token), expires, now, now).run();
    await env.DB.prepare("INSERT INTO audit_events(actor_type,actor_id,action,target_type,target_id,metadata_json,created_at) VALUES('owner',?,'wallet.login','wallet_session',?,?,?)").bind(c.wallet_address, id, JSON.stringify({ chainId }), now).run();
    return json2({ authenticated: true, wallet: c.wallet_address, chainId, expiresAt: expires }, 200, { "set-cookie": "mw_owner_session=" + token + "; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=" + SESSION_SECONDS2 });
  }
  if (url.pathname === "/api/auth/me" && request.method === "GET") {
    const s = await session(request, env);
    return s ? json2({ authenticated: true, ...s }) : json2({ authenticated: false }, 401);
  }
  if (url.pathname.startsWith("/api/admin/auth/")) {
    const authResponse = await handleAdminAuthApi(request, env);
    if (authResponse) return authResponse;
  }
  if (url.pathname.startsWith("/api/admin/")) {
    const token = cookie2(request, "mw_admin_session");
    if (!token || !/^[0-9a-f]{64}$/.test(token)) return json2({ error: "MFA-verified administrator session required." }, 401);
    const now = (/* @__PURE__ */ new Date()).toISOString(), mfaCutoff = new Date(Date.now() - 12 * 60 * 60 * 1e3).toISOString();
    const admin = await env.DB.prepare("SELECT s.id,s.admin_id FROM admin_sessions s INNER JOIN admin_accounts a ON a.id=s.admin_id WHERE s.token_hash=? AND s.expires_at>? AND s.mfa_verified_at>? AND a.status='active' AND a.mfa_enabled=1 LIMIT 1").bind(await hash(token), now, mfaCutoff).first();
    if (!admin) return json2({ error: "MFA-verified administrator session required." }, 401);
    await env.DB.prepare("UPDATE admin_sessions SET last_seen_at=? WHERE id=?").bind(now, admin.id).run();
    const response2 = await handleAdminDestinationApi(request, env, { id: admin.id, adminId: admin.admin_id });
    if (response2) return response2;
    return json2({ error: "Not found" }, 404);
  }
  if (url.pathname.startsWith("/api/owner/")) {
    const authenticated = await session(request, env);
    if (!authenticated) return json2({ error: "Authentication required." }, 401);
    const response2 = await handleOwnerApi(request, env, authenticated);
    if (response2) return response2;
  }
  if (url.pathname === "/api/auth/logout" && request.method === "POST") {
    if (!sameOrigin2(request, url)) return json2({ error: "Origin check failed." }, 403);
    const token = cookie2(request);
    if (token && /^[0-9a-f]{64}$/.test(token)) await env.DB.prepare("UPDATE wallet_sessions SET revoked_at=? WHERE token_hash=? AND revoked_at IS NULL").bind((/* @__PURE__ */ new Date()).toISOString(), await hash(token)).run();
    return json2({ authenticated: false }, 200, { "set-cookie": "mw_owner_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0" });
  }
  return json2({ error: "Not found" }, 404);
} };
export {
  worker_default as default
};
//# sourceMappingURL=worker.js.map

import type { RecoveryAuthorizationGrant } from "../domain/recovery-grant";
import type { NetworkId } from "../domain/types";
import { validateRecoveryGrant } from "../policy/recovery-grant";
import { keccak256Hex } from "./keccak";
import { EXECUTOR_IMMUTABLE_RANGES } from "../application/executor-artifact";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const UINT256_MAX = (1n << 256n) - 1n;
const NETWORK_CHAIN_IDS: Partial<Record<NetworkId, number>> = {
  ethereum: 1, polygon: 137, bsc: 56, avalanche: 43114,
  arbitrum: 42161, optimism: 10, base: 8453
};

export interface EvmGrantVerifierConfig {
  /** Explicitly configured trusted RPC endpoint; never supplied by the browser. */
  rpcUrl: string;
  /** Reviewed runtime bytecode hash pinned by the server for this chain. */
  trustedExecutorCodeHash: string;
  /** Chain ID pinned to this RPC endpoint and executor hash configuration. */
  expectedChainId: number;
  /** Trusted service identities that must match immutable executor constructor values. */
  expectedAutomationOperator: string;
  expectedAdminOperator: string;
  /** Optional fetch injection for deterministic tests. */
  fetcher?: typeof fetch;
}

interface RpcEnvelope { jsonrpc?: string; id?: number; result?: unknown; error?: { code: number; message: string } }
/** Hash the compiler runtime template after zeroing constructor-patched immutable values. */
export function normalizedExecutorRuntimeHash(code: string): string {
  if (!/^0x(?:[0-9a-fA-F]{2})+$/.test(code)) throw new Error("Malformed executor runtime bytecode.");
  const bytes = code.slice(2).toLowerCase().split("");
  const minBytes = Math.max(...EXECUTOR_IMMUTABLE_RANGES.map(range => range.start + range.length));
  if (bytes.length < minBytes) return keccak256Hex(code);
  for (const range of EXECUTOR_IMMUTABLE_RANGES) {
    const start = range.start * 2, end = (range.start + range.length) * 2;
    if (end > bytes.length) throw new Error("Executor immutable reference is outside runtime bytecode.");
    for (let i = start; i < end; i++) bytes[i] = "0";
  }
  return keccak256Hex("0x" + bytes.join(""));
}

interface Receipt {
  status?: string;
  from?: string;
  contractAddress?: string | null;
  blockNumber?: string;
}
export interface EvmGrantVerification {
  verifiedAt: string;
  observedExecutorCodeHash: string;
  chainId: number;
  executor: string;
  destination: string;
  expiresAt: number;
  assets: Array<{ tokenAddress: string; destinationAddress: string; cap: string; recovered: string; allowance: string; remaining: string }>;
}

/** Fail-closed verifier for the reviewed ScopedRecoveryExecutor deployment. */
export class EvmGrantVerifier {
  private nextId = 1;
  private readonly fetcher: typeof fetch;
  constructor(private readonly config: EvmGrantVerifierConfig) {
    this.fetcher = config.fetcher ?? fetch;
    if (!/^https:\/\//i.test(config.rpcUrl)) throw new Error("A server-configured HTTPS RPC URL is required.");
    if (!HASH.test(config.trustedExecutorCodeHash)) throw new Error("Trusted executor code hash is invalid.");
    if (!Number.isSafeInteger(config.expectedChainId) || config.expectedChainId <= 0) throw new Error("Expected EVM chain ID must be configured.");
    if (!ADDRESS.test(config.expectedAutomationOperator) || !ADDRESS.test(config.expectedAdminOperator)) throw new Error("Trusted execution operator addresses must be configured.");
  }

  private async rpc(method: string, params: unknown[]): Promise<unknown> {
    const id=this.nextId++;
    const response=await this.fetcher(this.config.rpcUrl,{
      method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({jsonrpc:"2.0",id,method,params})
    });
    if (!response.ok) throw new Error("Configured EVM RPC request failed.");
    const body=await response.json() as RpcEnvelope;
    if (body.error || body.id!==id || !("result" in body)) {
      throw new Error(body.error?.message ? "EVM RPC error: "+body.error.message : "Malformed EVM RPC response.");
    }
    return body.result;
  }

  private async call(to: string, signature: string, args = ""): Promise<string> {
    const selector=keccak256Hex("0x"+Array.from(new TextEncoder().encode(signature),b=>b.toString(16).padStart(2,"0")).join("")).slice(0,10);
    const result=await this.rpc("eth_call",[{to,data:selector+args},"latest"]);
    if (typeof result!=="string" || !/^0x[0-9a-fA-F]*$/.test(result) || result.length<66) {
      throw new Error("Malformed executor contract response for "+signature+".");
    }
    return result;
  }

  async verify(grant: RecoveryAuthorizationGrant, authenticatedWallet: string, now = Date.now()): Promise<EvmGrantVerification> {
    validateRecoveryGrant(grant,authenticatedWallet,grant.network,now);
    if (!["ethereum","polygon","bsc","avalanche","arbitrum","optimism","base"].includes(grant.network)) {
      throw new Error("This verifier supports EVM networks only.");
    }
    if (grant.evidence.kind!=="onchain-approval" || !HASH.test(grant.evidence.reference)) {
      throw new Error("This executor requires an owner deployment transaction as authorization evidence.");
    }
    if (!ADDRESS.test(grant.executorAddress) || !ADDRESS.test(grant.ownerWallet) || !ADDRESS.test(grant.destinationAddress)) {
      throw new Error("Malformed EVM address in grant.");
    }
    if (grant.executorCodeHash.toLowerCase()!==this.config.trustedExecutorCodeHash.toLowerCase()) {
      throw new Error("Grant executor hash is not in the server's trusted executor allowlist.");
    }

    const chainHex=await this.rpc("eth_chainId",[]);
    if (typeof chainHex!=="string" || !/^0x[0-9a-fA-F]+$/.test(chainHex)) throw new Error("Malformed chain ID response.");
    const chainId=Number(BigInt(chainHex));
    const expectedNetworkChainId=NETWORK_CHAIN_IDS[grant.network];
    if (!Number.isSafeInteger(chainId) || expectedNetworkChainId===undefined ||
        chainId!==expectedNetworkChainId || chainId!==this.config.expectedChainId || chainId!==grant.chainId) {
      throw new Error("Connected RPC chain ID does not match the configured chain, network, and grant.");
    }

    const code=await this.rpc("eth_getCode",[grant.executorAddress,"latest"]);
    if (typeof code!=="string" || !/^0x[0-9a-fA-F]+$/.test(code) || code==="0x") throw new Error("Executor contract is not deployed.");
    const observedExecutorCodeHash=normalizedExecutorRuntimeHash(code);
    if (observedExecutorCodeHash.toLowerCase()!==this.config.trustedExecutorCodeHash.toLowerCase()) {
      throw new Error("Deployed executor runtime bytecode hash is not trusted.");
    }

    const receipt=await this.rpc("eth_getTransactionReceipt",[grant.evidence.reference]) as Receipt | null;
    if (!receipt || receipt.status!=="0x1" || receipt.from?.toLowerCase()!==grant.ownerWallet.toLowerCase() ||
        receipt.contractAddress?.toLowerCase()!==grant.executorAddress.toLowerCase()) {
      throw new Error("Owner deployment transaction receipt does not prove this executor deployment.");
    }

    if (!receipt.blockNumber || !/^0x[0-9a-fA-F]+$/.test(receipt.blockNumber)) throw new Error("Deployment receipt is missing its block number.");
    const block = await this.rpc("eth_getBlockByNumber", [receipt.blockNumber, false]) as { timestamp?: string } | null;
    if (!block?.timestamp || !/^0x[0-9a-fA-F]+$/.test(block.timestamp)) throw new Error("Deployment block timestamp is unavailable.");
    const deployedAt = Number(BigInt(block.timestamp)) * 1000;
    if (Math.abs(Date.parse(grant.approvedAt) - deployedAt) > 1000) throw new Error("Grant approval timestamp does not match the owner deployment block.");

    const owner=this.decodeAddress(await this.call(grant.executorAddress,"owner()"));
    const destination=this.decodeAddress(await this.call(grant.executorAddress,"destination()"));
    const expiry=BigInt("0x"+(await this.call(grant.executorAddress,"expiresAt()")).slice(-64));
    const revoked=BigInt("0x"+(await this.call(grant.executorAddress,"revoked()")).slice(-64));
    const expectedExpiry=BigInt(Math.floor(Date.parse(grant.expiresAt)/1000));
    if (owner!==grant.ownerWallet.toLowerCase()) throw new Error("Executor owner does not match the grant owner.");
    if (destination!==grant.destinationAddress.toLowerCase()) throw new Error("Executor destination does not match the approved destination.");
    if (expiry!==expectedExpiry || expiry<=BigInt(Math.floor(now/1000))) throw new Error("Executor expiry is mismatched or expired.");
    if (revoked!==0n) throw new Error("Executor grant has been revoked on-chain.");

    const automaticEnabled = BigInt("0x" + (await this.call(grant.executorAddress,"automaticPriorityEnabled()")).slice(-64)) === 1n;
    const adminEnabled = BigInt("0x" + (await this.call(grant.executorAddress,"adminInitiatedEnabled()")).slice(-64)) === 1n;
    if (automaticEnabled !== grant.executionModes.includes("automatic-priority") ||
        adminEnabled !== grant.executionModes.includes("admin-initiated")) {
      throw new Error("On-chain execution modes do not match the owner's declared authorization.");
    }
    const automationOperator = this.decodeAddress(await this.call(grant.executorAddress, "automationOperator()"));
    const adminOperator = this.decodeAddress(await this.call(grant.executorAddress, "adminOperator()"));
    if (automationOperator !== grant.executionOperators.automation.toLowerCase() ||
        adminOperator !== grant.executionOperators.administrator.toLowerCase() ||
        automationOperator !== this.config.expectedAutomationOperator.toLowerCase() ||
        adminOperator !== this.config.expectedAdminOperator.toLowerCase()) {
      throw new Error("Immutable executor operators do not match the owner grant and trusted Mainwell service identities.");
    }
    const authorizedCount = BigInt("0x" + (await this.call(grant.executorAddress,"authorizedAssetCount()")).slice(-64));
    if (authorizedCount !== BigInt(grant.assets.length)) throw new Error("On-chain authorized asset count does not match the grant.");

    const assets=[];
    for (let assetIndex = 0; assetIndex < grant.assets.length; assetIndex++) {
      const asset = grant.assets[assetIndex];
      const indexArg = BigInt(assetIndex).toString(16).padStart(64, "0");
      const onchainAsset = this.decodeAddress(await this.call(grant.executorAddress, "authorizedAssetAt(uint256)", indexArg));
      if (!asset.tokenAddress || !ADDRESS.test(asset.tokenAddress)) throw new Error("Native assets are not supported by this ERC-20 executor.");
      const token=asset.tokenAddress.toLowerCase();
      if (onchainAsset !== token) throw new Error("On-chain asset order or token address does not match the grant.");
      const onchainDestination = this.decodeAddress(await this.call(grant.executorAddress, "assetDestination(address)", token.slice(2).padStart(64, "0")));
      if (!ADDRESS.test(asset.destinationAddress) || onchainDestination !== asset.destinationAddress.toLowerCase()) {
        throw new Error("On-chain destination for asset " + asset.assetId + " does not match its owner-approved destination.");
      }
      const destinationAtIndex = this.decodeAddress(await this.call(grant.executorAddress, "authorizedAssetDestinationAt(uint256)", indexArg));
      if (destinationAtIndex !== onchainDestination) throw new Error("On-chain asset destination index does not match its immutable mapping.");
      const arg=token.slice(2).padStart(64,"0");
      const cap=BigInt("0x"+(await this.call(grant.executorAddress,"assetLimit(address)",arg)).slice(-64));
      const recovered=BigInt("0x"+(await this.call(grant.executorAddress,"amountRecovered(address)",arg)).slice(-64));
      const expectedCap=asset.amount.kind==="capped" ? BigInt(asset.amount.maxAmountRaw) : UINT256_MAX;
      if (recovered>cap) throw new Error("On-chain recovered amount exceeds the configured cap for "+asset.assetId+".");
      const allowanceArg=grant.ownerWallet.slice(2).padStart(64,"0")+grant.executorAddress.slice(2).padStart(64,"0");
      const allowance=BigInt("0x"+(await this.call(token,"allowance(address,address)",allowanceArg)).slice(-64));
      if(asset.revokedAt){
        if(cap!==recovered)throw new Error("Database marks asset "+asset.assetId+" revoked but its on-chain cap is still spendable.");
        assets.push({tokenAddress:token,destinationAddress:onchainDestination,cap:cap.toString(),recovered:recovered.toString(),allowance:allowance.toString(),remaining:"0"});
        continue;
      }
      if(cap!==expectedCap)throw new Error("On-chain asset cap does not exactly match the owner's grant for "+asset.assetId+".");
      const remaining=cap-recovered;
      if(allowance<remaining)throw new Error("Live ERC-20 allowance is below the remaining authorized scope for "+asset.assetId+".");
      assets.push({tokenAddress:token,destinationAddress:onchainDestination,cap:cap.toString(),recovered:recovered.toString(),allowance:allowance.toString(),remaining:remaining.toString()});
    }

    return {
      verifiedAt:new Date(now).toISOString(),observedExecutorCodeHash,chainId,
      executor:grant.executorAddress.toLowerCase(),destination,expiresAt:Number(expiry),assets
    };
  }

  async verifyAssetRevocation(
    grant: RecoveryAuthorizationGrant,
    authenticatedWallet: string,
    tokenAddress: string,
    transactionHash: string,
    now = Date.now()
  ): Promise<{ revokedAt: string; transactionHash: string; tokenAddress: string }> {
    if (grant.ownerWallet.toLowerCase() !== authenticatedWallet.toLowerCase()) throw new Error("Grant owner does not match the authenticated wallet.");
    if (!ADDRESS.test(tokenAddress) || !HASH.test(transactionHash)) throw new Error("Asset address or revocation transaction hash is invalid.");
    const asset = grant.assets.find(item => item.tokenAddress?.toLowerCase() === tokenAddress.toLowerCase());
    if (!asset) throw new Error("Asset is not part of this owner grant.");
    const chainHex = await this.rpc("eth_chainId", []);
    if (typeof chainHex !== "string" || !/^0x[0-9a-fA-F]+$/.test(chainHex) ||
        Number(BigInt(chainHex)) !== this.config.expectedChainId ||
        this.config.expectedChainId !== NETWORK_CHAIN_IDS[grant.network] || grant.chainId !== this.config.expectedChainId) {
      throw new Error("Asset revocation RPC chain does not match the stored grant.");
    }
    const code = await this.rpc("eth_getCode", [grant.executorAddress, "latest"]);
    if (typeof code !== "string" || code === "0x" || normalizedExecutorRuntimeHash(code).toLowerCase() !== this.config.trustedExecutorCodeHash.toLowerCase()) {
      throw new Error("Executor runtime bytecode is no longer trusted.");
    }
    const executorOwner = this.decodeAddress(await this.call(grant.executorAddress, "owner()"));
    if (executorOwner !== authenticatedWallet.toLowerCase()) throw new Error("Executor owner does not match the authenticated wallet.");
    const selector = keccak256Hex("0x" + Array.from(new TextEncoder().encode("revokeAsset(address)"), b => b.toString(16).padStart(2, "0")).join("")).slice(0, 10);
    const expectedInput = selector + tokenAddress.slice(2).toLowerCase().padStart(64, "0");
    const tx = await this.rpc("eth_getTransactionByHash", [transactionHash]) as { from?: string; to?: string | null; input?: string } | null;
    const receipt = await this.rpc("eth_getTransactionReceipt", [transactionHash]) as Receipt | null;
    if (!tx || !receipt || receipt.status !== "0x1" ||
        tx.from?.toLowerCase() !== authenticatedWallet.toLowerCase() ||
        tx.to?.toLowerCase() !== grant.executorAddress.toLowerCase() ||
        tx.input?.toLowerCase() !== expectedInput) {
      throw new Error("Transaction does not prove that the authenticated owner successfully called revokeAsset() for this token.");
    }
    const arg = tokenAddress.slice(2).toLowerCase().padStart(64, "0");
    const cap = BigInt("0x" + (await this.call(grant.executorAddress, "assetLimit(address)", arg)).slice(-64));
    const recovered = BigInt("0x" + (await this.call(grant.executorAddress, "amountRecovered(address)", arg)).slice(-64));
    if (cap !== recovered) throw new Error("Executor has not disabled further recovery for this asset.");
    if (!receipt.blockNumber || !/^0x[0-9a-fA-F]+$/.test(receipt.blockNumber)) throw new Error("Asset revocation receipt is missing its block number.");
    const block = await this.rpc("eth_getBlockByNumber", [receipt.blockNumber, false]) as { timestamp?: string } | null;
    if (!block?.timestamp || !/^0x[0-9a-fA-F]+$/.test(block.timestamp)) throw new Error("Asset revocation block timestamp is unavailable.");
    const revokedAt = new Date(Number(BigInt(block.timestamp)) * 1000).toISOString();
    if (Date.parse(revokedAt) < Date.parse(grant.approvedAt) || Date.parse(revokedAt) > now + 60_000) {
      throw new Error("Asset revocation block timestamp is outside the authorization window.");
    }
    return { revokedAt, transactionHash: transactionHash.toLowerCase(), tokenAddress: tokenAddress.toLowerCase() };
  }

  async verifyRevocation(
    grant: RecoveryAuthorizationGrant,
    authenticatedWallet: string,
    transactionHash: string,
    now = Date.now()
  ): Promise<{ revokedAt: string; transactionHash: string }> {
    if (grant.ownerWallet.toLowerCase() !== authenticatedWallet.toLowerCase()) {
      throw new Error("Grant owner does not match the authenticated wallet.");
    }
    if (!HASH.test(transactionHash)) throw new Error("A valid revocation transaction hash is required.");
    const chainHex = await this.rpc("eth_chainId", []);
    if (typeof chainHex !== "string" || !/^0x[0-9a-fA-F]+$/.test(chainHex) ||
        Number(BigInt(chainHex)) !== this.config.expectedChainId ||
        this.config.expectedChainId !== NETWORK_CHAIN_IDS[grant.network] ||
        grant.chainId !== this.config.expectedChainId) {
      throw new Error("Revocation RPC chain does not match the stored grant.");
    }
    const code = await this.rpc("eth_getCode", [grant.executorAddress, "latest"]);
    if (typeof code !== "string" || code === "0x" || keccak256Hex(code).toLowerCase() !== this.config.trustedExecutorCodeHash.toLowerCase()) {
      throw new Error("Executor runtime bytecode is no longer trusted.");
    }
    const executorOwner = this.decodeAddress(await this.call(grant.executorAddress, "owner()"));
    if (executorOwner !== authenticatedWallet.toLowerCase()) throw new Error("Executor owner does not match the authenticated wallet.");
    const tx = await this.rpc("eth_getTransactionByHash", [transactionHash]) as { from?: string; to?: string | null; input?: string } | null;
    const receipt = await this.rpc("eth_getTransactionReceipt", [transactionHash]) as Receipt | null;
    const revokeSelector = keccak256Hex("0x" + Array.from(new TextEncoder().encode("revoke()"), b => b.toString(16).padStart(2, "0")).join("")).slice(0, 10);
    if (!tx || !receipt || receipt.status !== "0x1" ||
        tx.from?.toLowerCase() !== authenticatedWallet.toLowerCase() ||
        tx.to?.toLowerCase() !== grant.executorAddress.toLowerCase() ||
        tx.input?.toLowerCase() !== revokeSelector) {
      throw new Error("Transaction does not prove that the authenticated owner successfully called revoke() on this executor.");
    }
    const revoked = BigInt("0x" + (await this.call(grant.executorAddress, "revoked()")).slice(-64));
    if (revoked !== 1n) throw new Error("Executor does not report an on-chain revoked state.");
    if (!receipt.blockNumber || !/^0x[0-9a-fA-F]+$/.test(receipt.blockNumber)) throw new Error("Revocation receipt is missing its block number.");
    const block = await this.rpc("eth_getBlockByNumber", [receipt.blockNumber, false]) as { timestamp?: string } | null;
    if (!block?.timestamp || !/^0x[0-9a-fA-F]+$/.test(block.timestamp)) throw new Error("Revocation block timestamp is unavailable.");
    const revokedAt = new Date(Number(BigInt(block.timestamp)) * 1000).toISOString();
    if (Date.parse(revokedAt) < Date.parse(grant.approvedAt)) throw new Error("Revocation block predates the owner authorization.");
    if (Date.parse(revokedAt) > now + 60_000) throw new Error("Revocation block timestamp is unexpectedly in the future.");
    return { revokedAt, transactionHash: transactionHash.toLowerCase() };
  }

  private decodeAddress(data: string): string {
    const word=data.slice(-64);
    if (!/^[0-9a-fA-F]{64}$/.test(word) || !/^0{24}/i.test(word)) throw new Error("Malformed address returned by executor.");
    return "0x"+word.slice(24).toLowerCase();
  }
}

import type { RecoveryAuthorizationGrant } from "../domain/recovery-grant";
import type { NetworkId } from "../domain/types";
import { validateRecoveryGrant } from "../policy/recovery-grant";
import { keccak256Hex } from "./keccak";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const UINT256_MAX = (1n << 256n) - 1n;

export interface EvmGrantVerifierConfig {
  /** Explicitly configured trusted RPC endpoint; never supplied by the browser. */
  rpcUrl: string;
  /** Reviewed runtime bytecode hash pinned by the server for this chain. */
  trustedExecutorCodeHash: string;
  /** Optional fetch injection for deterministic tests. */
  fetcher?: typeof fetch;
}

interface RpcEnvelope { jsonrpc?: string; id?: number; result?: unknown; error?: { code: number; message: string } }
interface Receipt {
  status?: string;
  from?: string;
  contractAddress?: string | null;
}
export interface EvmGrantVerification {
  verifiedAt: string;
  observedExecutorCodeHash: string;
  chainId: number;
  executor: string;
  destination: string;
  expiresAt: number;
  assets: Array<{ tokenAddress: string; cap: string; recovered: string; allowance: string; remaining: string }>;
}

/** Fail-closed verifier for the reviewed ScopedRecoveryExecutor deployment. */
export class EvmGrantVerifier {
  private nextId = 1;
  private readonly fetcher: typeof fetch;
  constructor(private readonly config: EvmGrantVerifierConfig) {
    this.fetcher = config.fetcher ?? fetch;
    if (!/^https:\/\//i.test(config.rpcUrl)) throw new Error("A server-configured HTTPS RPC URL is required.");
    if (!HASH.test(config.trustedExecutorCodeHash)) throw new Error("Trusted executor code hash is invalid.");
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
    const selector=keccak256Hex(new TextEncoder().encode(signature)).slice(0,10);
    const result=await this.rpc("eth_call",[{to,data:selector+args},"latest"]);
    if (typeof result!=="string" || !/^0x[0-9a-fA-F]*$/.test(result) || result.length<66) {
      throw new Error("Malformed executor contract response for "+signature+".");
    }
    return result;
  }

  async verify(grant: RecoveryAuthorizationGrant, now = Date.now()): Promise<EvmGrantVerification> {
    validateRecoveryGrant(grant,grant.ownerWallet,grant.network,now);
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
    if (!Number.isSafeInteger(chainId) || chainId!==grant.chainId) throw new Error("Connected RPC chain ID does not match the grant.");

    const code=await this.rpc("eth_getCode",[grant.executorAddress,"latest"]);
    if (typeof code!=="string" || !/^0x[0-9a-fA-F]+$/.test(code) || code==="0x") throw new Error("Executor contract is not deployed.");
    const observedExecutorCodeHash=keccak256Hex(code);
    if (observedExecutorCodeHash.toLowerCase()!==this.config.trustedExecutorCodeHash.toLowerCase()) {
      throw new Error("Deployed executor runtime bytecode hash is not trusted.");
    }

    const receipt=await this.rpc("eth_getTransactionReceipt",[grant.evidence.reference]) as Receipt | null;
    if (!receipt || receipt.status!=="0x1" || receipt.from?.toLowerCase()!==grant.ownerWallet.toLowerCase() ||
        receipt.contractAddress?.toLowerCase()!==grant.executorAddress.toLowerCase()) {
      throw new Error("Owner deployment transaction receipt does not prove this executor deployment.");
    }

    const owner=this.decodeAddress(await this.call(grant.executorAddress,"owner()"));
    const destination=this.decodeAddress(await this.call(grant.executorAddress,"destination()"));
    const expiry=BigInt("0x"+(await this.call(grant.executorAddress,"expiresAt()")).slice(-64));
    const revoked=BigInt("0x"+(await this.call(grant.executorAddress,"revoked()")).slice(-64));
    const expectedExpiry=BigInt(Math.floor(Date.parse(grant.expiresAt)/1000));
    if (owner!==grant.ownerWallet.toLowerCase()) throw new Error("Executor owner does not match the grant owner.");
    if (destination!==grant.destinationAddress.toLowerCase()) throw new Error("Executor destination does not match the approved destination.");
    if (expiry!==expectedExpiry || expiry<=BigInt(Math.floor(now/1000))) throw new Error("Executor expiry is mismatched or expired.");
    if (revoked!==0n) throw new Error("Executor grant has been revoked on-chain.");

    const assets=[];
    for (const asset of grant.assets) {
      if (!asset.tokenAddress || !ADDRESS.test(asset.tokenAddress)) throw new Error("Native assets are not supported by this ERC-20 executor.");
      const token=asset.tokenAddress.toLowerCase();
      const arg=token.slice(2).padStart(64,"0");
      const cap=BigInt("0x"+(await this.call(grant.executorAddress,"assetLimit(address)",arg)).slice(-64));
      const recovered=BigInt("0x"+(await this.call(grant.executorAddress,"amountRecovered(address)",arg)).slice(-64));
      const expectedCap=asset.amount.kind==="capped" ? BigInt(asset.amount.maxAmountRaw) : UINT256_MAX;
      if (cap!==expectedCap || recovered>cap) throw new Error("On-chain asset cap does not exactly match the owner's grant for "+asset.assetId+".");
      const allowanceArg=grant.ownerWallet.slice(2).padStart(64,"0")+grant.executorAddress.slice(2).padStart(64,"0");
      const allowance=BigInt("0x"+(await this.call(token,"allowance(address,address)",allowanceArg)).slice(-64));
      const remaining=cap-recovered;
      if (allowance<remaining) throw new Error("Live ERC-20 allowance is below the remaining authorized scope for "+asset.assetId+".");
      assets.push({tokenAddress:token,cap:cap.toString(),recovered:recovered.toString(),allowance:allowance.toString(),remaining:remaining.toString()});
    }

    return {
      verifiedAt:new Date(now).toISOString(),observedExecutorCodeHash,chainId,
      executor:grant.executorAddress.toLowerCase(),destination,expiresAt:Number(expiry),assets
    };
  }

  private decodeAddress(data: string): string {
    const word=data.slice(-64);
    if (!/^[0-9a-fA-F]{64}$/.test(word) || !/^0{24}/i.test(word)) throw new Error("Malformed address returned by executor.");
    return "0x"+word.slice(24).toLowerCase();
  }
}

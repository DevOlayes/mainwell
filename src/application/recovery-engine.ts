import {
  createPublicClient, encodeFunctionData, http, keccak256, parseAbi, decodeEventLog,
  type Address, type Chain, type Hex
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { EvmGrantVerifier } from "../adapters/evm-grant-verifier";
import { D1GrantRepository, type D1Database as GrantDatabase } from "../persistence/d1-grant-repository";
import { EXECUTOR_NORMALIZED_RUNTIME_CODE_HASH } from "./executor-artifact";
import type { OwnerApiEnv } from "./owner-api";

type EngineEnv = OwnerApiEnv & {
  MAINWELL_ADMIN_PRIVATE_KEY?: string;
  MAINWELL_AUTOMATION_PRIVATE_KEY?: string;
  MAINWELL_EXECUTION_ENABLED?: string;
  MAINWELL_AUTOMATION_ENABLED?: string;
  MAINWELL_MAX_RECOVERY_FEE_WEI?: string;
  MAINWELL_SPONSOR_RESERVE_WEI?: string;
};
type Network = "ethereum" | "polygon" | "bsc" | "avalanche" | "arbitrum" | "optimism" | "base";
const NETWORKS: Record<Network, {chainId:number;symbol:string;rpc:keyof OwnerApiEnv;hash:keyof OwnerApiEnv}> = {
  ethereum:{chainId:1,symbol:"ETH",rpc:"EVM_RPC_ETHEREUM",hash:"MAINWELL_EXECUTOR_CODE_HASH_ETHEREUM"},
  polygon:{chainId:137,symbol:"POL",rpc:"EVM_RPC_POLYGON",hash:"MAINWELL_EXECUTOR_CODE_HASH_POLYGON"},
  bsc:{chainId:56,symbol:"BNB",rpc:"EVM_RPC_BSC",hash:"MAINWELL_EXECUTOR_CODE_HASH_BSC"},
  avalanche:{chainId:43114,symbol:"AVAX",rpc:"EVM_RPC_AVALANCHE",hash:"MAINWELL_EXECUTOR_CODE_HASH_AVALANCHE"},
  arbitrum:{chainId:42161,symbol:"ETH",rpc:"EVM_RPC_ARBITRUM",hash:"MAINWELL_EXECUTOR_CODE_HASH_ARBITRUM"},
  optimism:{chainId:10,symbol:"ETH",rpc:"EVM_RPC_OPTIMISM",hash:"MAINWELL_EXECUTOR_CODE_HASH_OPTIMISM"},
  base:{chainId:8453,symbol:"ETH",rpc:"EVM_RPC_BASE",hash:"MAINWELL_EXECUTOR_CODE_HASH_BASE"}
};
const EXECUTOR_ABI = parseAbi([
  "function executeAdminToken(address token,uint256 amount)",
  "function executeAutomaticToken(address token,uint256 amount)",
  "event TokenRecovered(address indexed token,address indexed destination,uint256 amount,address indexed caller)"
]);
const ERC20_ABI = parseAbi(["function balanceOf(address owner) view returns (uint256)","function decimals() view returns (uint8)"]);
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const UINT = /^(0|[1-9][0-9]{0,77})$/;
function makeChain(network:Network,rpcUrl:string):Chain {
  const config=NETWORKS[network];
  return {id:config.chainId,name:network,nativeCurrency:{name:config.symbol,symbol:config.symbol,decimals:18},rpcUrls:{default:{http:[rpcUrl]}}};
}
function minBigInt(...values:bigint[]):bigint{return values.reduce((a,b)=>a<b?a:b);}

export function getRecoveryFeePolicy(mode:"admin-initiated"|"automatic-priority"):{emergency:boolean;enforceUsdFeeCeiling:boolean;enforceNativeFeeCap:boolean;retainGasReserve:boolean;enforceAutomaticEconomicRatio:boolean}{
  const emergency=mode==="admin-initiated";
  return {emergency,enforceUsdFeeCeiling:!emergency,enforceNativeFeeCap:!emergency,retainGasReserve:!emergency,enforceAutomaticEconomicRatio:!emergency};
}

const NATIVE_PRICE_IDS:Record<Network,string>={ethereum:"ethereum",polygon:"polygon-ecosystem-token",bsc:"binancecoin",avalanche:"avalanche-2",arbitrum:"ethereum",optimism:"ethereum",base:"ethereum"};
async function freshNativeUsdPrice(network:Network):Promise<number>{
  const id=NATIVE_PRICE_IDS[network];
  const response=await fetch("https://api.coingecko.com/api/v3/simple/price?ids="+encodeURIComponent(id)+"&vs_currencies=usd&include_last_updated_at=true",{headers:{"accept":"application/json"},signal:AbortSignal.timeout(7000)});
  if(!response.ok)throw new Error("native_usd_price_unavailable");
  const data=await response.json() as Record<string,{usd?:number;last_updated_at?:number}>;
  const quote=data[id],price=quote?.usd,updated=quote?.last_updated_at;
  if(typeof price!=="number"||!Number.isFinite(price)||price<=0||typeof updated!=="number"||Date.now()/1000-updated>300||Date.now()/1000<updated-60)throw new Error("native_usd_price_stale");
  return price;
}
function usdValue(raw:bigint,decimals:number,price:number):number{
  const whole=raw/10n**BigInt(decimals),fraction=raw%10n**BigInt(decimals);
  return (Number(whole)+Number(fraction)/10**decimals)*price;
}
function safeCode(error:unknown):string {
  const message=error instanceof Error?error.message:"";
  const known=["grant_inactive","source_wallet_not_locked","asset_not_authorized","destination_not_locked","token_not_active","token_decimals_changed",
    "execution_mode_not_owner_authorized","invalid_recovery_destination","operator_address_not_configured","operator_private_key_not_configured",
    "operator_private_key_address_mismatch","operator_execution_busy","onchain_asset_scope_mismatch","requested_amount_exceeds_live_authorization_or_balance",
    "eip1559_fee_quote_unavailable","gas_fee_quote_unavailable","estimated_gas_limit_exceeded","recovery_fee_cap_missing_or_exceeded","sponsor_gas_insufficient","sponsor_reserve_invalid","executor_code_hash_mismatch",
    "rpc_not_configured","unsupported_network","native_usd_price_unavailable","native_usd_price_stale","recovery_asset_valuation_unavailable","recovery_economic_value_invalid","recovery_usd_fee_cap_exceeded","recovery_fee_exceeds_five_percent_value"];
  if(known.includes(message))return message;
  if(message.includes("GRANT_VERIFIER_NOT_CONFIGURED"))return "grant_verifier_not_configured";
  if(message.includes("RPC")||message.includes("fetch"))return "rpc_unavailable";
  if(message.includes("insufficient funds"))return "sponsor_gas_insufficient";
  if(message.includes("revert")||message.includes("execution reverted"))return "simulation_reverted";
  if(message.includes("private key"))return "operator_key_invalid";
  return "preflight_failed";
}
async function audit(env:EngineEnv,jobId:string,action:string,details:Record<string,unknown>,at:string):Promise<void>{
  const id=crypto.randomUUID();
  try {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO recovery_job_events(id,job_id,event_type,actor_type,actor_id,details_json,created_at) VALUES(?,?,?,'system','mainwell-execution-engine',?,?)")
        .bind(id,jobId,action,JSON.stringify(details),at),
      env.DB.prepare("INSERT INTO audit_events(id,actor_type,actor_id,action,target_type,target_id,metadata_json,created_at) VALUES(?,'system','mainwell-execution-engine',?,'recovery_job',?,?,?)")
        .bind(crypto.randomUUID(),action,jobId,JSON.stringify(details),at)
    ]);
  } catch (error) {
    // Preserve transaction state; log only a sanitized code, never secrets or raw RPC payloads.
    console.error("mainwell_recovery_audit_write_failed", safeCode(error));
  }
}
async function queueAutomaticJobs(env:EngineEnv):Promise<number>{
  const runtimeAutomation=await env.DB.prepare("SELECT setting_value FROM mainwell_runtime_settings WHERE setting_key=?").bind("automation_enabled").first<{setting_value:string}>();
  if(runtimeAutomation?.setting_value!=="true")return 0;
  const now=new Date().toISOString(),minute=Math.floor(Date.now()/60000);
  const rows=await env.DB.prepare(`
    SELECT g.grant_id,g.owner_wallet,g.network,g.execution_modes_json,g.expires_at,
           a.asset_id,a.token_address,a.amount_kind,a.max_amount_raw,a.destination_address,
           w.id AS wallet_id,w.status AS wallet_status,w.admin_locked,d.locked AS destination_locked,d.is_active AS destination_active
    FROM recovery_grants g
    INNER JOIN recovery_grant_assets a ON a.grant_id=g.grant_id
    INNER JOIN recovery_wallets w ON lower(w.owner_address)=lower(g.owner_wallet) AND w.network=g.network
    INNER JOIN recovery_supported_assets s ON s.id=a.asset_id AND s.network=g.network AND s.is_active=1
    LEFT JOIN recovery_destinations d ON d.network=g.network AND lower(d.address)=lower(a.destination_address)
    WHERE g.verification_status='verified' AND g.revoked_at IS NULL AND g.expires_at>?
      AND a.revoked_at IS NULL AND w.status='monitoring' AND w.admin_locked=1
      AND d.locked=1 AND d.is_active=1 AND a.amount_kind='capped'
      AND NOT EXISTS (SELECT 1 FROM recovery_jobs j WHERE j.grant_id=g.grant_id AND j.asset_id=a.asset_id
        AND j.status IN ('queued','simulating','ready','submitted','blocked','failed','cancelled'))
    ORDER BY g.expires_at ASC LIMIT 50
  `).bind(now).all<Record<string,unknown>>();
  if(!rows.success)return 0;
  let queued=0;
  for(const row of rows.results){
    let modes:unknown;try{modes=JSON.parse(String(row.execution_modes_json));}catch{continue;}
    if(!Array.isArray(modes)||!modes.includes("automatic-priority")||!row.token_address||!ADDRESS.test(String(row.token_address)))continue;
    const active=await env.DB.prepare("SELECT id FROM recovery_jobs WHERE grant_id=? AND asset_id=? AND status IN ('queued','simulating','ready','submitted','blocked','failed') LIMIT 1")
      .bind(row.grant_id,row.asset_id).first<{id:string}>();
    if(active)continue;
    const valuation=await env.DB.prepare("SELECT estimated_value_usd,valuation_confidence,price_observed_at FROM wallet_assets WHERE wallet_id=? AND asset_ref=? LIMIT 1")
      .bind(row.wallet_id,row.asset_id).first<{estimated_value_usd:number|null;valuation_confidence:number|null;price_observed_at:string|null}>();
    const priceAge=valuation?.price_observed_at?Date.now()-Date.parse(valuation.price_observed_at):Number.POSITIVE_INFINITY;
    const score=valuation&&typeof valuation.estimated_value_usd==="number"&&Number.isFinite(valuation.estimated_value_usd)&&valuation.estimated_value_usd>0&&
      typeof valuation.valuation_confidence==="number"&&valuation.valuation_confidence>=0.75&&priceAge>=0&&priceAge<=5*60_000
      ? valuation.estimated_value_usd*valuation.valuation_confidence : 0;
    const id=crypto.randomUUID(),key="auto:"+String(row.grant_id)+":"+String(row.asset_id)+":"+minute;
    const result=await env.DB.prepare("INSERT INTO recovery_jobs(id,grant_id,asset_id,execution_mode,status,priority_score,idempotency_key,requested_by,created_at,updated_at,requested_amount_raw,destination_address,next_attempt_at) VALUES(?,?,?,'automatic-priority','queued',?,?,'system:auto',?,?,NULL,?,?) ON CONFLICT(idempotency_key) DO NOTHING")
      .bind(id,row.grant_id,row.asset_id,score,key,now,now,row.destination_address,now).run();
    if((result.meta?.changes??0)===1){
      await audit(env,id,"automatic_recovery.queued",{grantId:row.grant_id,assetId:row.asset_id,network:row.network},now);
      queued++;
    }
  }
  return queued;
}
async function processOne(env:EngineEnv):Promise<boolean>{
  const now=new Date().toISOString(),leaseId=crypto.randomUUID(),leaseUntil=new Date(Date.now()+840_000).toISOString();
  await env.DB.prepare("UPDATE recovery_jobs SET status='blocked',last_error_code='worker_lease_expired',last_error_at=?,lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE status='simulating' AND lease_expires_at IS NOT NULL AND lease_expires_at<?").bind(now,now,now).run();
  const automationSetting=await env.DB.prepare("SELECT setting_value FROM mainwell_runtime_settings WHERE setting_key=?").bind("automation_enabled").first<{setting_value:string}>();
  const candidate=await env.DB.prepare("SELECT id FROM recovery_jobs WHERE status='queued' AND (execution_mode!='automatic-priority' OR ?='true') AND (next_attempt_at IS NULL OR next_attempt_at<=?) AND (lease_expires_at IS NULL OR lease_expires_at<?) ORDER BY priority_score DESC,created_at ASC LIMIT 1")
    .bind(automationSetting?.setting_value??"false",now,now).first<{id:string}>();
  if(!candidate)return false;
  const claim=await env.DB.prepare("UPDATE recovery_jobs SET status='simulating',lease_owner=?,lease_expires_at=?,attempt_count=attempt_count+1,started_at=COALESCE(started_at,?),updated_at=? WHERE id=? AND status='queued' AND (lease_expires_at IS NULL OR lease_expires_at<?)")
    .bind(leaseId,leaseUntil,now,now,candidate.id,now).run();
  if((claim.meta?.changes??0)!==1)return false;
  const job=await env.DB.prepare("SELECT id,grant_id,asset_id,execution_mode,requested_amount_raw,attempt_count FROM recovery_jobs WHERE id=? AND lease_owner=?")
    .bind(candidate.id,leaseId).first<{id:string;grant_id:string;asset_id:string;execution_mode:"admin-initiated"|"automatic-priority";requested_amount_raw:string|null;attempt_count:number}>();
  if(!job)return false;
  const attemptId=crypto.randomUUID();
  let executionLock:{network:string;operatorAddress:string}|null=null;
  try{
    const scope=await env.DB.prepare(`
      SELECT g.network,g.owner_wallet,g.executor_address,g.expires_at,g.revoked_at,g.verification_status,w.id AS wallet_id,
             a.token_address,a.amount_kind,a.max_amount_raw,a.destination_address,a.revoked_at AS asset_revoked_at,
             w.status AS wallet_status,w.admin_locked,d.locked AS destination_locked,d.is_active AS destination_active,
             s.is_active AS token_active,s.decimals AS registered_decimals
      FROM recovery_grants g
      INNER JOIN recovery_grant_assets a ON a.grant_id=g.grant_id AND a.asset_id=?
      INNER JOIN recovery_wallets w ON lower(w.owner_address)=lower(g.owner_wallet) AND w.network=g.network
      LEFT JOIN recovery_destinations d ON d.network=g.network AND lower(d.address)=lower(a.destination_address)
      LEFT JOIN recovery_supported_assets s ON s.id=a.asset_id AND s.network=g.network
      WHERE g.grant_id=? LIMIT 1
    `).bind(job.asset_id,job.grant_id).first<Record<string,unknown>>();
    if(!scope||scope.verification_status!=="verified"||scope.revoked_at||String(scope.expires_at)<=now)throw new Error("grant_inactive");
    if(scope.wallet_status!=="monitoring"||Number(scope.admin_locked)!==1)throw new Error("source_wallet_not_locked");
    if(scope.asset_revoked_at||scope.amount_kind!=="capped"||!scope.token_address||!ADDRESS.test(String(scope.token_address)))throw new Error("asset_not_authorized");
    if(Number(scope.destination_locked)!==1||Number(scope.destination_active)!==1||!ADDRESS.test(String(scope.destination_address)))throw new Error("destination_not_locked");
    if(Number(scope.token_active)!==1)throw new Error("token_not_active");
    const network=String(scope.network) as Network;
    const config=NETWORKS[network];
    if(!config)throw new Error("unsupported_network");
    const rpcUrl=env[config.rpc] as string|undefined;
    const expectedHash=env[config.hash] as string|undefined;
    if(!rpcUrl||!/^https:\/\//i.test(rpcUrl))throw new Error("rpc_not_configured");
    if(expectedHash&&expectedHash.toLowerCase()!==EXECUTOR_NORMALIZED_RUNTIME_CODE_HASH.toLowerCase())throw new Error("executor_code_hash_mismatch");
    const repository=new D1GrantRepository(env.DB as unknown as GrantDatabase);
    const grant=await repository.getById(job.grant_id);
    if(!grant||grant.ownerWallet.toLowerCase()!==String(scope.owner_wallet).toLowerCase()||grant.executorAddress.toLowerCase()!==String(scope.executor_address).toLowerCase()||grant.network!==String(scope.network))throw new Error("grant_inactive");
    if(!grant.executionModes.includes(job.execution_mode))throw new Error("execution_mode_not_owner_authorized");
    const operatorAddress=job.execution_mode==="admin-initiated"?env.MAINWELL_ADMIN_OPERATOR:env.MAINWELL_AUTOMATION_OPERATOR;
    const privateKey=job.execution_mode==="admin-initiated"?env.MAINWELL_ADMIN_PRIVATE_KEY:env.MAINWELL_AUTOMATION_PRIVATE_KEY;
    if(!operatorAddress||!ADDRESS.test(operatorAddress))throw new Error("operator_address_not_configured");
    const verifier=new EvmGrantVerifier({rpcUrl,trustedExecutorCodeHash:EXECUTOR_NORMALIZED_RUNTIME_CODE_HASH,expectedChainId:config.chainId,expectedAutomationOperator:env.MAINWELL_AUTOMATION_OPERATOR??"",expectedAdminOperator:env.MAINWELL_ADMIN_OPERATOR??""});
    const verified=await verifier.verify(grant,grant.ownerWallet);
    const verifiedAsset=verified.assets.find(item=>item.tokenAddress.toLowerCase()===String(scope.token_address).toLowerCase());
    if(!verifiedAsset||verifiedAsset.destinationAddress.toLowerCase()!==String(scope.destination_address).toLowerCase())throw new Error("onchain_asset_scope_mismatch");
    if(verifiedAsset.destinationAddress.toLowerCase()===grant.ownerWallet.toLowerCase()||verifiedAsset.destinationAddress.toLowerCase()===grant.executorAddress.toLowerCase())throw new Error("invalid_recovery_destination");
    const chain=makeChain(network,rpcUrl),publicClient=createPublicClient({chain,transport:http(rpcUrl)});
    const owner=grant.ownerWallet as Address,token=String(scope.token_address) as Address,executor=grant.executorAddress as Address;
    const tokenDecimals=await publicClient.readContract({address:token,abi:ERC20_ABI,functionName:"decimals"});
    if(Number(tokenDecimals)!==Number(scope.registered_decimals))throw new Error("token_decimals_changed");
    const balance=await publicClient.readContract({address:token,abi:ERC20_ABI,functionName:"balanceOf",args:[owner]});
    const destinationBalanceBefore=await publicClient.readContract({address:token,abi:ERC20_ABI,functionName:"balanceOf",args:[verifiedAsset.destinationAddress as Address]});
    const available=minBigInt(balance,BigInt(verifiedAsset.remaining),BigInt(verifiedAsset.allowance));
    const amount=job.requested_amount_raw?BigInt(job.requested_amount_raw):available;
    if(!UINT.test(amount.toString())||amount<=0n||amount>available)throw new Error("requested_amount_exceeds_live_authorization_or_balance");
    const functionName=job.execution_mode==="admin-initiated"?"executeAdminToken":"executeAutomaticToken";
    const simulation=await publicClient.simulateContract({account:operatorAddress as Address,address:executor,abi:EXECUTOR_ABI,functionName,args:[token,amount]});
    const estimatedGas=await publicClient.estimateContractGas({account:operatorAddress as Address,address:executor,abi:EXECUTOR_ABI,functionName,args:[token,amount]});
    if(estimatedGas>1_000_000n)throw new Error("estimated_gas_limit_exceeded");
    const gas=estimatedGas*120n/100n;
    const feeQuote:{maxFeePerGas?:bigint;maxPriorityFeePerGas?:bigint;gasPrice?:bigint}=await publicClient.estimateFeesPerGas().catch(async()=>({gasPrice:await publicClient.getGasPrice()}));
    const useEip1559=feeQuote.maxFeePerGas!==undefined&&feeQuote.maxPriorityFeePerGas!==undefined&&
      feeQuote.maxFeePerGas>0n&&feeQuote.maxPriorityFeePerGas>0n&&feeQuote.maxPriorityFeePerGas<=feeQuote.maxFeePerGas;
    const maxFeePerGas=useEip1559?feeQuote.maxFeePerGas:undefined;
    const maxPriorityFeePerGas=useEip1559?feeQuote.maxPriorityFeePerGas:undefined;
    const gasPrice=useEip1559?undefined:feeQuote.gasPrice??await publicClient.getGasPrice();
    if(!useEip1559&&(!gasPrice||gasPrice<=0n))throw new Error("gas_fee_quote_unavailable");
    const feePerGasCap=useEip1559?maxFeePerGas!:gasPrice!;
    const estimatedFee=gas*feePerGasCap;
    // Automatic recovery is economically constrained. Emergency administrator-
    // initiated recovery deliberately has no USD fee ceiling, native-unit fee cap,
    // or retained gas reserve: the operator may spend its available balance to
    // recover the owner-authorized amount before an attacker moves it.
    const feePolicy=getRecoveryFeePolicy(job.execution_mode);\n    const administratorEmergency=feePolicy.emergency;
    let nativeUsd:number|null=null;
    let feeUsd:number|null=null;
    let recoveredValueUsd:number|null=null;
    let feeToRecoveryValueRatio:number|null=null;
    if(!administratorEmergency){
      nativeUsd=await freshNativeUsdPrice(network);
      feeUsd=usdValue(estimatedFee,18,nativeUsd);
      if(!Number.isFinite(feeUsd))throw new Error("recovery_economic_value_invalid");
      if(feeUsd>500)throw new Error("recovery_usd_fee_cap_exceeded");
      const assetValuation=await env.DB.prepare("SELECT estimated_value_usd,valuation_confidence,price_observed_at FROM wallet_assets WHERE wallet_id=? AND asset_ref=? LIMIT 1").bind(scope.wallet_id,job.asset_id).first<{estimated_value_usd:number|null;valuation_confidence:number|null;price_observed_at:string|null}>();
      const valuationAge=assetValuation?.price_observed_at?Date.now()-Date.parse(assetValuation.price_observed_at):Number.POSITIVE_INFINITY;
      if(!assetValuation||typeof assetValuation.estimated_value_usd!=="number"||!Number.isFinite(assetValuation.estimated_value_usd)||assetValuation.estimated_value_usd<=0||typeof assetValuation.valuation_confidence!=="number"||assetValuation.valuation_confidence<0.75||valuationAge<0||valuationAge>300_000)throw new Error("recovery_asset_valuation_unavailable");
      const recoveredFraction=Number((amount*1_000_000_000_000_000_000n)/balance)/1e18;
      recoveredValueUsd=assetValuation.estimated_value_usd*recoveredFraction;
      if(!Number.isFinite(recoveredValueUsd)||recoveredValueUsd<=0)throw new Error("recovery_economic_value_invalid");
      feeToRecoveryValueRatio=feeUsd/recoveredValueUsd;
      if(feeToRecoveryValueRatio>0.05)throw new Error("recovery_fee_exceeds_five_percent_value");
    }
    const feeCapSetting=feePolicy.enforceNativeFeeCap?await env.DB.prepare("SELECT setting_value FROM mainwell_runtime_settings WHERE setting_key=?").bind("fee_cap_wei:"+network).first<{setting_value:string}>();
    const maxAllowed=feeCapSetting?.setting_value&&UINT.test(feeCapSetting.setting_value)?BigInt(feeCapSetting.setting_value):null;
    const reserveSetting=feePolicy.retainGasReserve?await env.DB.prepare("SELECT setting_value FROM mainwell_runtime_settings WHERE setting_key=?").bind("reserve_wei:"+network).first<{setting_value:string}>();
    if(reserveSetting?.setting_value&&!UINT.test(reserveSetting.setting_value))throw new Error("sponsor_reserve_invalid");
    const reserve=reserveSetting?.setting_value?BigInt(reserveSetting.setting_value):0n;
    const attemptBase={id:attemptId,job_id:job.id,attempt_number:job.attempt_count,phase:"simulated",simulation_block_number:Number(await publicClient.getBlockNumber()),gas_funding_source:"recovery-sponsor",estimated_fee_raw:estimatedFee.toString(),fee_cap_raw:maxAllowed?.toString()??null,transaction_hash:null,error_code:null,created_at:now,updated_at:now};
    const sponsorBalance=await publicClient.getBalance({address:operatorAddress as Address});
    const sponsorGasSufficient=sponsorBalance>=estimatedFee+(feePolicy.retainGasReserve?reserve:0n);
    const runtimeExecution=await env.DB.prepare("SELECT setting_value FROM mainwell_runtime_settings WHERE setting_key=?").bind("execution_enabled").first<{setting_value:string}>();
    if(runtimeExecution?.setting_value!=="true"){
      await env.DB.batch([
        env.DB.prepare("INSERT INTO recovery_execution_attempts(id,job_id,attempt_number,phase,simulation_block_number,gas_funding_source,estimated_fee_raw,fee_cap_raw,transaction_hash,error_code,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)")
          .bind(attemptBase.id,attemptBase.job_id,attemptBase.attempt_number,attemptBase.phase,attemptBase.simulation_block_number,attemptBase.gas_funding_source,attemptBase.estimated_fee_raw,attemptBase.fee_cap_raw,attemptBase.transaction_hash,attemptBase.error_code,attemptBase.created_at,attemptBase.updated_at),
        env.DB.prepare("UPDATE recovery_jobs SET status='ready',requested_amount_raw=?,destination_address=?,lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE id=? AND lease_owner=?")
          .bind(amount.toString(),verifiedAsset.destinationAddress,now,job.id,leaseId)
      ]);
      await audit(env,job.id,"recovery.preflight.simulated",{network,assetId:job.asset_id,amountRaw:amount.toString(),gasEstimate:gas.toString(),estimatedFeeRaw:estimatedFee.toString(),gasFundingSource:"recovery-sponsor",sponsorBalanceRaw:sponsorBalance.toString(),sponsorGasSufficient,simulationSucceeded:true,executionEnabled:false,estimatedFeeUsd:feeUsd,recoveredValueUsd,feeToRecoveryValueRatio,economicReviewMode:feePolicy.emergency?"emergency-unbounded-admin":"automatic-5-percent-gate",nativeUsdPrice:nativeUsd},now);
      return true;
    }
    if(!privateKey)throw new Error("operator_private_key_not_configured");
    if(feePolicy.enforceNativeFeeCap&&(!maxAllowed||estimatedFee>maxAllowed))throw new Error("recovery_fee_cap_missing_or_exceeded");
    const account=privateKeyToAccount((privateKey.startsWith("0x")?privateKey:"0x"+privateKey) as Hex);
    if(account.address.toLowerCase()!==operatorAddress.toLowerCase())throw new Error("operator_private_key_address_mismatch");
    if(!sponsorGasSufficient)throw new Error("sponsor_gas_insufficient");
    const lockUntil=new Date(Date.now()+600_000).toISOString();
    const lockResult=await env.DB.prepare("INSERT INTO recovery_execution_locks(network,operator_address,lease_owner,lease_expires_at,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(network,operator_address) DO UPDATE SET lease_owner=excluded.lease_owner,lease_expires_at=excluded.lease_expires_at,updated_at=excluded.updated_at WHERE recovery_execution_locks.lease_expires_at<?")
      .bind(network,account.address,leaseId,lockUntil,now,now).run();
    if((lockResult.meta?.changes??0)!==1)throw new Error("operator_execution_busy");
    executionLock={network,operatorAddress:account.address};
    const nonce=await publicClient.getTransactionCount({address:account.address,blockTag:"pending"});
    const data=encodeFunctionData({abi:EXECUTOR_ABI,functionName,args:[token,amount]});
    const serialized=useEip1559
      ? await account.signTransaction({chainId:config.chainId,nonce,to:executor,data,value:0n,gas,maxFeePerGas:maxFeePerGas!,maxPriorityFeePerGas:maxPriorityFeePerGas!,type:"eip1559"})
      : await account.signTransaction({chainId:config.chainId,nonce,to:executor,data,value:0n,gas,gasPrice:gasPrice!,type:"legacy"});
    const hash=keccak256(serialized);
    const txId=crypto.randomUUID(),sentAt=new Date().toISOString();
    const prepared=await env.DB.batch([
      env.DB.prepare("INSERT INTO recovery_transactions(id,job_id,network,transaction_hash,status,asset_id,amount_raw,destination_address,destination_balance_before_raw,destination_balance_after_raw,estimated_fee_raw,actual_fee_raw,submitted_at,confirmed_at,created_at,sender_address,nonce,gas_limit_raw,max_fee_per_gas_raw,max_priority_fee_per_gas_raw,gas_price_raw) VALUES(?,?,?,?,'prepared',?,?,?,?,NULL,?,NULL,NULL,NULL,?,?,?,?,?,?,?)")
        .bind(txId,job.id,network,hash,job.asset_id,amount.toString(),verifiedAsset.destinationAddress,destinationBalanceBefore.toString(),estimatedFee.toString(),sentAt,account.address,nonce,gas.toString(),maxFeePerGas?.toString()??null,maxPriorityFeePerGas?.toString()??null,gasPrice?.toString()??null),
      env.DB.prepare("INSERT INTO recovery_execution_attempts(id,job_id,attempt_number,phase,simulation_block_number,gas_funding_source,estimated_fee_raw,fee_cap_raw,transaction_hash,error_code,created_at,updated_at) VALUES(?,?,?,?,?,'recovery-sponsor',?,?,?,NULL,?,?)")
        .bind(attemptId,job.id,job.attempt_count,"signed",Number(await publicClient.getBlockNumber()),estimatedFee.toString(),maxAllowed.toString(),hash,sentAt,sentAt)
    ]);
    if(prepared.some(x=>!x.success))throw new Error("signed_transaction_recording_failed");
    const submittedHash=await publicClient.sendRawTransaction({serializedTransaction:serialized});
    if(submittedHash.toLowerCase()!==hash.toLowerCase())throw new Error("rpc_transaction_hash_mismatch");
    const submittedAt=new Date().toISOString();
    const marked=await env.DB.batch([
      env.DB.prepare("UPDATE recovery_transactions SET status='submitted',submitted_at=? WHERE id=? AND status='prepared'").bind(submittedAt,txId),
      env.DB.prepare("UPDATE recovery_execution_attempts SET phase='submitted',updated_at=? WHERE id=?").bind(submittedAt,attemptId),
      env.DB.prepare("UPDATE recovery_jobs SET status='submitted',requested_amount_raw=?,destination_address=?,lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE id=? AND lease_owner=?")
        .bind(amount.toString(),verifiedAsset.destinationAddress,submittedAt,job.id,leaseId)
    ]);
    if(marked.some(x=>!x.success))throw new Error("transaction_submission_state_recording_failed");
    await audit(env,job.id,"recovery.transaction.submitted",{network,assetId:job.asset_id,amountRaw:amount.toString(),transactionHash:hash,gasFundingSource:"recovery-sponsor"},submittedAt);
    return true;
  }catch(error){
    const code=safeCode(error),at=new Date().toISOString();
    if(code==="operator_execution_busy"){
      const retryAt=new Date(Date.now()+30_000).toISOString();
      await env.DB.prepare("UPDATE recovery_jobs SET status='queued',next_attempt_at=?,lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE id=? AND lease_owner=?")
        .bind(retryAt,at,job.id,leaseId).run();
      return true;
    }
    await env.DB.batch([
      env.DB.prepare("INSERT INTO recovery_execution_attempts(id,job_id,attempt_number,phase,error_code,created_at,updated_at) VALUES(?,?,?,'blocked',?,?,?) ON CONFLICT(job_id,attempt_number) DO UPDATE SET phase='blocked',error_code=excluded.error_code,updated_at=excluded.updated_at")
        .bind(attemptId,job.id,job.attempt_count,code,at,at),
      env.DB.prepare("UPDATE recovery_jobs SET status='blocked',last_error_code=?,last_error_at=?,lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE id=? AND lease_owner=?")
        .bind(code,at,at,job.id,leaseId)
    ]);
    await audit(env,job.id,"recovery.preflight.blocked",{errorCode:code},at);
    return true;
  } finally {
    if(executionLock){
      try{
        await env.DB.prepare("DELETE FROM recovery_execution_locks WHERE network=? AND operator_address=? AND lease_owner=?")
          .bind(executionLock.network,executionLock.operatorAddress,leaseId).run();
      }catch{console.error("mainwell_execution_lock_release_failed");}
    }
  }
}
async function trackTransactions(env:EngineEnv):Promise<number>{
  const rows=await env.DB.prepare("SELECT t.id,t.job_id,t.network,t.transaction_hash,t.asset_id,t.amount_raw,t.destination_address,t.destination_balance_before_raw,t.sender_address,g.executor_address FROM recovery_transactions t INNER JOIN recovery_jobs j ON j.id=t.job_id INNER JOIN recovery_grants g ON g.grant_id=j.grant_id WHERE t.status IN ('prepared','submitted','pending') AND t.transaction_hash IS NOT NULL ORDER BY t.created_at ASC LIMIT 25")
    .all<Record<string,unknown>>();
  if(!rows.success)return 0;
  let checked=0;
  for(const row of rows.results){
    const network=String(row.network) as Network,config=NETWORKS[network],rpcUrl=config?env[config.rpc] as string|undefined:undefined;
    if(!config||!rpcUrl)continue;
    const chain=makeChain(network,rpcUrl),client=createPublicClient({chain,transport:http(rpcUrl)});
    const at=new Date().toISOString();
    try{
      const transaction=await client.getTransaction({hash:String(row.transaction_hash) as Hex});
      if(transaction.to?.toLowerCase()!==String(row.executor_address).toLowerCase()||transaction.from.toLowerCase()!==String(row.sender_address).toLowerCase()){
        await env.DB.prepare("UPDATE recovery_transactions SET status='unknown',failure_code='transaction_identity_mismatch',last_checked_at=? WHERE id=?").bind(at,row.id).run();
        continue;
      }
      let receipt: Awaited<ReturnType<typeof client.getTransactionReceipt>>;
      try{receipt=await client.getTransactionReceipt({hash:String(row.transaction_hash) as Hex});}
      catch{
        await env.DB.batch([
          env.DB.prepare("UPDATE recovery_transactions SET status='pending',last_checked_at=? WHERE id=?").bind(at,row.id),
          env.DB.prepare("UPDATE recovery_jobs SET status='submitted',updated_at=?,lease_owner=NULL,lease_expires_at=NULL WHERE id=? AND status IN ('simulating','blocked','ready')").bind(at,row.job_id),
          env.DB.prepare("UPDATE recovery_execution_attempts SET phase='submitted',updated_at=? WHERE transaction_hash=?").bind(at,row.transaction_hash)
        ]);
        continue;
      }
      const latest=await client.getBlockNumber();
      const canonicalBlock=await client.getBlock({blockNumber:receipt.blockNumber});
      if(canonicalBlock.hash.toLowerCase()!==receipt.blockHash.toLowerCase())continue;
      if(network==="arbitrum"||network==="optimism"||network==="base"){
        try{
          const finalized=await client.getBlock({blockTag:"finalized"});
          if(!finalized.number||finalized.number<receipt.blockNumber)continue;
        }catch{continue;}
      }else{
        const finality=network==="ethereum"?12n:network==="polygon"?64n:network==="bsc"?15n:2n;
        if(latest-receipt.blockNumber+1n<finality)continue;
      }
      const events=receipt.status==="success"?receipt.logs.filter(log=>log.address.toLowerCase()===String(row.executor_address).toLowerCase()).flatMap(log=>{
        try{return parseAbiEvent(log)}catch{return []}
      }):[];
      const event=events.find(e=>String(e.args.token).toLowerCase()===String(row.asset_id).split(":").pop()?.toLowerCase()&&String(e.args.destination).toLowerCase()===String(row.destination_address).toLowerCase()&&BigInt(e.args.amount as bigint)===BigInt(String(row.amount_raw))&&String(e.args.caller).toLowerCase()===String(row.sender_address).toLowerCase());
      const identityOk=Boolean(event)&&transaction.to?.toLowerCase()===String(row.executor_address).toLowerCase()&&transaction.from.toLowerCase()===String(row.sender_address).toLowerCase();
      let destinationBalanceAfter:bigint|null=null;
      if(receipt.status==="success"){
        const tokenAddress=String(row.asset_id).split(":").pop() as Address;
        try{destinationBalanceAfter=await client.readContract({address:tokenAddress,abi:ERC20_ABI,functionName:"balanceOf",args:[String(row.destination_address) as Address]});}catch{}
      }
      const balanceOk=typeof row.destination_balance_before_raw==="string"&&destinationBalanceAfter!==null&&
        destinationBalanceAfter>=BigInt(row.destination_balance_before_raw)+BigInt(String(row.amount_raw));
      const ok=receipt.status==="success"&&identityOk&&balanceOk;
      const txStatus=ok?"confirmed":receipt.status==="reverted"?"reverted":"unknown";
      const jobStatus=ok?"confirmed":receipt.status==="reverted"?"failed":"blocked";
      const failureCode=ok?null:receipt.status==="reverted"?"transaction_reverted":!identityOk?"receipt_or_event_verification_failed":"destination_balance_postcondition_failed";
      await env.DB.batch([
        env.DB.prepare("UPDATE recovery_transactions SET status=?,block_number=?,block_hash=?,gas_used_raw=?,effective_gas_price_raw=?,actual_fee_raw=?,destination_balance_after_raw=?,confirmed_at=?,last_checked_at=?,failure_code=? WHERE id=?")
          .bind(txStatus,Number(receipt.blockNumber),receipt.blockHash,receipt.gasUsed.toString(),receipt.effectiveGasPrice.toString(),(receipt.gasUsed*receipt.effectiveGasPrice).toString(),destinationBalanceAfter?.toString()??null,at,at,failureCode,row.id),
        env.DB.prepare("UPDATE recovery_jobs SET status=?,completed_at=?,updated_at=?,last_error_code=? WHERE id=? AND status IN ('submitted','ready','simulating','blocked')")
          .bind(jobStatus,at,at,failureCode,row.job_id),
        env.DB.prepare("UPDATE recovery_execution_attempts SET phase=?,updated_at=? WHERE transaction_hash=?")
          .bind(ok?"confirmed":receipt.status==="reverted"?"failed":"blocked",at,row.transaction_hash)
      ]);
      await audit(env,String(row.job_id),ok?"recovery.transaction.confirmed":receipt.status==="reverted"?"recovery.transaction.reverted":"recovery.transaction.postcondition_failed",{transactionHash:row.transaction_hash,blockNumber:receipt.blockNumber.toString(),actualFeeRaw:(receipt.gasUsed*receipt.effectiveGasPrice).toString(),destinationBalanceBeforeRaw:row.destination_balance_before_raw,destinationBalanceAfterRaw:destinationBalanceAfter?.toString()??null},at);
      checked++;
    }catch(error){
      // A missing receipt is normal while the transaction is pending; never resubmit blindly.
      if(error instanceof Error&&/could not be found|not found/i.test(error.message))continue;
      await env.DB.prepare("UPDATE recovery_transactions SET status='pending',last_checked_at=? WHERE id=?").bind(at,row.id).run();
    }
  }
  return checked;
}
function parseAbiEvent(log:{topics:readonly Hex[];data:Hex;address:Address}):Array<{args:Record<string,unknown>}>{
  if(log.topics.length===0)return [];
  const decoded=decodeEventLog({abi:EXECUTOR_ABI,data:log.data,topics:log.topics as [Hex,...Hex[]]});
  return decoded.eventName==="TokenRecovered"?[{args:decoded.args as unknown as Record<string,unknown>}]:[];
}

export async function runRecoveryAutomation(env:EngineEnv):Promise<void>{
  // Persistent administrator control is authoritative; missing settings fail closed.
  await queueAutomaticJobs(env);
  await trackTransactions(env);
  await processOne(env);
}

import {
  createPublicClient, encodeFunctionData, http, keccak256, parseAbi, decodeEventLog,
  privateKeyToAccount, type Address, type Chain, type Hex
} from "viem";
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
const ERC20_ABI = parseAbi(["function balanceOf(address owner) view returns (uint256)"]);
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const UINT = /^(0|[1-9][0-9]{0,77})$/;
function makeChain(network:Network,rpcUrl:string):Chain {
  const config=NETWORKS[network];
  return {id:config.chainId,name:network,nativeCurrency:{name:config.symbol,symbol:config.symbol,decimals:18},rpcUrls:{default:{http:[rpcUrl]}}};
}
function minBigInt(...values:bigint[]):bigint{return values.reduce((a,b)=>a<b?a:b);}
function safeCode(error:unknown):string {
  const message=error instanceof Error?error.message:"";
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
  } catch {
    // Never rewrite a submitted/confirmed transaction state because an audit write failed.
  }
}
async function queueAutomaticJobs(env:EngineEnv):Promise<number>{
  if(env.MAINWELL_AUTOMATION_ENABLED!=="true")return 0;
  const now=new Date().toISOString(),minute=Math.floor(Date.now()/60000);
  const rows=await env.DB.prepare(`
    SELECT g.grant_id,g.owner_wallet,g.network,g.execution_modes_json,g.expires_at,
           a.asset_id,a.token_address,a.amount_kind,a.max_amount_raw,a.destination_address,
           w.status AS wallet_status,w.admin_locked,d.locked AS destination_locked,d.is_active AS destination_active
    FROM recovery_grants g
    INNER JOIN recovery_grant_assets a ON a.grant_id=g.grant_id
    INNER JOIN recovery_wallets w ON lower(w.owner_address)=lower(g.owner_wallet) AND w.network=g.network
    LEFT JOIN recovery_destinations d ON d.network=g.network AND lower(d.address)=lower(a.destination_address)
    WHERE g.verification_status='verified' AND g.revoked_at IS NULL AND g.expires_at>?
      AND a.revoked_at IS NULL AND w.status='monitoring' AND w.admin_locked=1
      AND d.locked=1 AND d.is_active=1 AND a.amount_kind='capped'
    ORDER BY g.expires_at ASC LIMIT 50
  `).bind(now).all<Record<string,unknown>>();
  if(!rows.success)return 0;
  let queued=0;
  for(const row of rows.results){
    let modes:unknown;try{modes=JSON.parse(String(row.execution_modes_json));}catch{continue;}
    if(!Array.isArray(modes)||!modes.includes("automatic-priority")||!row.token_address||!ADDRESS.test(String(row.token_address)))continue;
    const active=await env.DB.prepare("SELECT id FROM recovery_jobs WHERE grant_id=? AND asset_id=? AND status IN ('queued','simulating','ready','submitted') LIMIT 1")
      .bind(row.grant_id,row.asset_id).first<{id:string}>();
    if(active)continue;
    const id=crypto.randomUUID(),key="auto:"+String(row.grant_id)+":"+String(row.asset_id)+":"+minute;
    const result=await env.DB.prepare("INSERT INTO recovery_jobs(id,grant_id,asset_id,execution_mode,status,priority_score,idempotency_key,requested_by,created_at,updated_at,requested_amount_raw,destination_address,next_attempt_at) VALUES(?,?,?,'automatic-priority','queued',0,?,'system:auto',?,?,NULL,?,?) ON CONFLICT(idempotency_key) DO NOTHING")
      .bind(id,row.grant_id,row.asset_id,key,now,now,row.destination_address,now).run();
    if((result.meta?.changes??0)===1){
      await audit(env,id,"automatic_recovery.queued",{grantId:row.grant_id,assetId:row.asset_id,network:row.network},now);
      queued++;
    }
  }
  return queued;
}
async function processOne(env:EngineEnv):Promise<boolean>{
  const now=new Date().toISOString(),leaseId=crypto.randomUUID(),leaseUntil=new Date(Date.now()+90_000).toISOString();
  await env.DB.prepare("UPDATE recovery_jobs SET status='blocked',last_error_code='worker_lease_expired',last_error_at=?,lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE status='simulating' AND lease_expires_at IS NOT NULL AND lease_expires_at<?").bind(now,now,now).run();
  const candidate=await env.DB.prepare("SELECT id FROM recovery_jobs WHERE status='queued' AND (next_attempt_at IS NULL OR next_attempt_at<=?) AND (lease_expires_at IS NULL OR lease_expires_at<?) ORDER BY priority_score DESC,created_at ASC LIMIT 1")
    .bind(now,now).first<{id:string}>();
  if(!candidate)return false;
  const claim=await env.DB.prepare("UPDATE recovery_jobs SET status='simulating',lease_owner=?,lease_expires_at=?,attempt_count=attempt_count+1,started_at=COALESCE(started_at,?),updated_at=? WHERE id=? AND status='queued' AND (lease_expires_at IS NULL OR lease_expires_at<?)")
    .bind(leaseId,leaseUntil,now,now,candidate.id,now).run();
  if((claim.meta?.changes??0)!==1)return false;
  const job=await env.DB.prepare("SELECT id,grant_id,asset_id,execution_mode,requested_amount_raw,attempt_count FROM recovery_jobs WHERE id=? AND lease_owner=?")
    .bind(candidate.id,leaseId).first<{id:string;grant_id:string;asset_id:string;execution_mode:"admin-initiated"|"automatic-priority";requested_amount_raw:string|null;attempt_count:number}>();
  if(!job)return false;
  const attemptId=crypto.randomUUID();
  try{
    const scope=await env.DB.prepare(`
      SELECT g.network,g.owner_wallet,g.executor_address,g.expires_at,g.revoked_at,g.verification_status,
             a.token_address,a.amount_kind,a.max_amount_raw,a.destination_address,a.revoked_at AS asset_revoked_at,
             w.status AS wallet_status,w.admin_locked,d.locked AS destination_locked,d.is_active AS destination_active,
             s.is_active AS token_active
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
    if(!grant||grant.ownerWallet.toLowerCase()!==String(scope.owner_wallet).toLowerCase())throw new Error("grant_inactive");
    if(!grant.executionModes.includes(job.execution_mode))throw new Error("execution_mode_not_owner_authorized");
    const operatorAddress=job.execution_mode==="admin-initiated"?env.MAINWELL_ADMIN_OPERATOR:env.MAINWELL_AUTOMATION_OPERATOR;
    const privateKey=job.execution_mode==="admin-initiated"?env.MAINWELL_ADMIN_PRIVATE_KEY:env.MAINWELL_AUTOMATION_PRIVATE_KEY;
    if(!operatorAddress||!ADDRESS.test(operatorAddress))throw new Error("operator_address_not_configured");
    const verifier=new EvmGrantVerifier({rpcUrl,trustedExecutorCodeHash:EXECUTOR_NORMALIZED_RUNTIME_CODE_HASH,expectedChainId:config.chainId,expectedAutomationOperator:env.MAINWELL_AUTOMATION_OPERATOR??"",expectedAdminOperator:env.MAINWELL_ADMIN_OPERATOR??""});
    const verified=await verifier.verify(grant,grant.ownerWallet);
    const verifiedAsset=verified.assets.find(item=>item.tokenAddress.toLowerCase()===String(scope.token_address).toLowerCase());
    if(!verifiedAsset||verifiedAsset.destinationAddress.toLowerCase()!==String(scope.destination_address).toLowerCase())throw new Error("onchain_asset_scope_mismatch");
    const chain=makeChain(network,rpcUrl),publicClient=createPublicClient({chain,transport:http(rpcUrl)});
    const owner=grant.ownerWallet as Address,token=String(scope.token_address) as Address,executor=grant.executorAddress as Address;
    const balance=await publicClient.readContract({address:token,abi:ERC20_ABI,functionName:"balanceOf",args:[owner]});
    const available=minBigInt(balance,BigInt(verifiedAsset.remaining),BigInt(verifiedAsset.allowance));
    const amount=job.requested_amount_raw?BigInt(job.requested_amount_raw):available;
    if(!UINT.test(amount.toString())||amount<=0n||amount>available)throw new Error("requested_amount_exceeds_live_authorization_or_balance");
    const functionName=job.execution_mode==="admin-initiated"?"executeAdminToken":"executeAutomaticToken";
    const simulation=await publicClient.simulateContract({account:operatorAddress as Address,address:executor,abi:EXECUTOR_ABI,functionName,args:[token,amount]});
    const gas=await publicClient.estimateContractGas({account:operatorAddress as Address,address:executor,abi:EXECUTOR_ABI,functionName,args:[token,amount]});
    const fees=await publicClient.estimateFeesPerGas();
    const maxFeePerGas=fees.maxFeePerGas;
    const maxPriorityFeePerGas=fees.maxPriorityFeePerGas;
    if(!maxFeePerGas||!maxPriorityFeePerGas)throw new Error("eip1559_fee_quote_unavailable");
    const estimatedFee=gas*maxFeePerGas;
    const maxAllowed=env.MAINWELL_MAX_RECOVERY_FEE_WEI&&UINT.test(env.MAINWELL_MAX_RECOVERY_FEE_WEI)?BigInt(env.MAINWELL_MAX_RECOVERY_FEE_WEI):null;
    const reserve=env.MAINWELL_SPONSOR_RESERVE_WEI&&UINT.test(env.MAINWELL_SPONSOR_RESERVE_WEI)?BigInt(env.MAINWELL_SPONSOR_RESERVE_WEI):0n;
    const attemptBase={id:attemptId,job_id:job.id,attempt_number:job.attempt_count,phase:"simulated",simulation_block_number:Number(await publicClient.getBlockNumber()),gas_funding_source:"recovery-sponsor",estimated_fee_raw:estimatedFee.toString(),fee_cap_raw:maxAllowed?.toString()??null,transaction_hash:null,error_code:null,created_at:now,updated_at:now};
    if(env.MAINWELL_EXECUTION_ENABLED!=="true"){
      await env.DB.batch([
        env.DB.prepare("INSERT INTO recovery_execution_attempts(id,job_id,attempt_number,phase,simulation_block_number,gas_funding_source,estimated_fee_raw,fee_cap_raw,transaction_hash,error_code,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)")
          .bind(attemptBase.id,attemptBase.job_id,attemptBase.attempt_number,attemptBase.phase,attemptBase.simulation_block_number,attemptBase.gas_funding_source,attemptBase.estimated_fee_raw,attemptBase.fee_cap_raw,attemptBase.transaction_hash,attemptBase.error_code,attemptBase.created_at,attemptBase.updated_at),
        env.DB.prepare("UPDATE recovery_jobs SET status='ready',requested_amount_raw=?,destination_address=?,lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE id=? AND lease_owner=?")
          .bind(amount.toString(),verifiedAsset.destinationAddress,now,job.id,leaseId)
      ]);
      await audit(env,job.id,"recovery.preflight.simulated",{network,assetId:job.asset_id,amountRaw:amount.toString(),gasEstimate:gas.toString(),estimatedFeeRaw:estimatedFee.toString(),gasFundingSource:"recovery-sponsor",simulationSucceeded:true,executionEnabled:false},now);
      return true;
    }
    if(!privateKey)throw new Error("operator_private_key_not_configured");
    if(!maxAllowed||estimatedFee>maxAllowed)throw new Error("recovery_fee_cap_missing_or_exceeded");
    const account=privateKeyToAccount((privateKey.startsWith("0x")?privateKey:"0x"+privateKey) as Hex);
    if(account.address.toLowerCase()!==operatorAddress.toLowerCase())throw new Error("operator_private_key_address_mismatch");
    const sponsorBalance=await publicClient.getBalance({address:account.address});
    if(sponsorBalance<estimatedFee+reserve)throw new Error("sponsor_gas_insufficient");
    const nonce=await publicClient.getTransactionCount({address:account.address,blockTag:"pending"});
    const data=encodeFunctionData({abi:EXECUTOR_ABI,functionName,args:[token,amount]});
    const serialized=await account.signTransaction({chain,nonce,to:executor,data,value:0n,gas,maxFeePerGas,maxPriorityFeePerGas,type:"eip1559"});
    const hash=keccak256(serialized);
    const txId=crypto.randomUUID(),sentAt=new Date().toISOString();
    const prepared=await env.DB.batch([
      env.DB.prepare("INSERT INTO recovery_transactions(id,job_id,network,transaction_hash,status,asset_id,amount_raw,destination_address,estimated_fee_raw,actual_fee_raw,submitted_at,confirmed_at,created_at,sender_address,nonce,gas_limit_raw,max_fee_per_gas_raw,max_priority_fee_per_gas_raw) VALUES(?,?,?,?,'prepared',?,?,?, ?,NULL,NULL,NULL,?,?,?,?,?,?)")
        .bind(txId,job.id,network,hash,job.asset_id,amount.toString(),verifiedAsset.destinationAddress,estimatedFee.toString(),sentAt,account.address,nonce,gas.toString(),maxFeePerGas.toString(),maxPriorityFeePerGas.toString()),
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
    await env.DB.batch([
      env.DB.prepare("INSERT INTO recovery_execution_attempts(id,job_id,attempt_number,phase,error_code,created_at,updated_at) VALUES(?,?,?,'blocked',?,?,?) ON CONFLICT(job_id,attempt_number) DO UPDATE SET phase='blocked',error_code=excluded.error_code,updated_at=excluded.updated_at")
        .bind(attemptId,job.id,job.attempt_count,code,at,at),
      env.DB.prepare("UPDATE recovery_jobs SET status='blocked',last_error_code=?,last_error_at=?,lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE id=? AND lease_owner=?")
        .bind(code,at,at,job.id,leaseId)
    ]);
    await audit(env,job.id,"recovery.preflight.blocked",{errorCode:code},at);
    return true;
  }
}
async function trackTransactions(env:EngineEnv):Promise<number>{
  const rows=await env.DB.prepare("SELECT t.id,t.job_id,t.network,t.transaction_hash,t.asset_id,t.amount_raw,t.destination_address,t.sender_address,g.executor_address FROM recovery_transactions t INNER JOIN recovery_jobs j ON j.id=t.job_id INNER JOIN recovery_grants g ON g.grant_id=j.grant_id WHERE t.status IN ('prepared','submitted','pending') AND t.transaction_hash IS NOT NULL ORDER BY t.created_at ASC LIMIT 25")
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
      const finality=network==="ethereum"?12n:network==="polygon"?64n:network==="bsc"?15n:2n;
      if(latest-receipt.blockNumber+1n<finality)continue;
      const events=receipt.status==="success"?receipt.logs.flatMap(log=>{
        try{return parseAbiEvent(log)}catch{return []}
      }):[];
      const event=events.find(e=>String(e.args.token).toLowerCase()===String(row.asset_id).split(":").pop()?.toLowerCase()&&String(e.args.destination).toLowerCase()===String(row.destination_address).toLowerCase()&&BigInt(e.args.amount as bigint)===BigInt(String(row.amount_raw))&&String(e.args.caller).toLowerCase()===String(row.sender_address).toLowerCase());
      const ok=receipt.status==="success"&&Boolean(event)&&transaction.to?.toLowerCase()===String(row.executor_address).toLowerCase()&&transaction.from.toLowerCase()===String(row.sender_address).toLowerCase();
      const status=ok?"confirmed":"reverted";
      await env.DB.batch([
        env.DB.prepare("UPDATE recovery_transactions SET status=?,block_number=?,block_hash=?,gas_used_raw=?,effective_gas_price_raw=?,actual_fee_raw=?,confirmed_at=?,last_checked_at=?,failure_code=? WHERE id=?")
          .bind(status,Number(receipt.blockNumber),receipt.blockHash,receipt.gasUsed.toString(),receipt.effectiveGasPrice.toString(),(receipt.gasUsed*receipt.effectiveGasPrice).toString(),at,at,ok?null:"receipt_or_event_verification_failed",row.id),
        env.DB.prepare("UPDATE recovery_jobs SET status=?,completed_at=?,updated_at=?,last_error_code=? WHERE id=? AND status IN ('submitted','ready','simulating','blocked')")
          .bind(ok?"confirmed":"failed",at,at,ok?null:"receipt_or_event_verification_failed",row.job_id),
        env.DB.prepare("UPDATE recovery_execution_attempts SET phase=?,updated_at=? WHERE transaction_hash=?")
          .bind(ok?"confirmed":"failed",at,row.transaction_hash)
      ]);
      await audit(env,String(row.job_id),ok?"recovery.transaction.confirmed":"recovery.transaction.reverted",{transactionHash:row.transaction_hash,blockNumber:receipt.blockNumber.toString(),actualFeeRaw:(receipt.gasUsed*receipt.effectiveGasPrice).toString()},at);
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
  const decoded=decodeEventLog({abi:EXECUTOR_ABI,data:log.data,topics:log.topics});
  return decoded.eventName==="TokenRecovered"?[{args:decoded.args as unknown as Record<string,unknown>}]:[];
}

export async function runRecoveryAutomation(env:EngineEnv):Promise<void>{
  // All automation is opt-in. The execution switch remains separate and defaults off.
  if(env.MAINWELL_AUTOMATION_ENABLED==="true")await queueAutomaticJobs(env);
  await trackTransactions(env);
  await processOne(env);
}

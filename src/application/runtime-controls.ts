import { createPublicClient, http, type Chain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
type DBStatement={bind(...v:unknown[]):DBStatement;first<T=Record<string,unknown>>():Promise<T|null>;all<T=Record<string,unknown>>():Promise<{success:boolean;results:T[]}>;run<T=unknown>():Promise<{success:boolean;meta?:{changes?:number}}>};
type DB={prepare(q:string):DBStatement;batch(statements:DBStatement[]):Promise<Array<{success:boolean}>>};
type Env={DB:DB;EVM_RPC_ETHEREUM?:string;EVM_RPC_POLYGON?:string;EVM_RPC_BSC?:string;EVM_RPC_AVALANCHE?:string;EVM_RPC_ARBITRUM?:string;EVM_RPC_OPTIMISM?:string;EVM_RPC_BASE?:string;MAINWELL_EXECUTOR_CODE_HASH_ETHEREUM?:string;MAINWELL_EXECUTOR_CODE_HASH_POLYGON?:string;MAINWELL_EXECUTOR_CODE_HASH_BSC?:string;MAINWELL_EXECUTOR_CODE_HASH_AVALANCHE?:string;MAINWELL_EXECUTOR_CODE_HASH_ARBITRUM?:string;MAINWELL_EXECUTOR_CODE_HASH_OPTIMISM?:string;MAINWELL_EXECUTOR_CODE_HASH_BASE?:string;MAINWELL_ADMIN_OPERATOR?:string;MAINWELL_AUTOMATION_OPERATOR?:string;MAINWELL_ADMIN_PRIVATE_KEY?:string;MAINWELL_AUTOMATION_PRIVATE_KEY?:string};
type Admin={id:string;adminId:string};
const NETWORKS=[
 {id:"ethereum",name:"Ethereum",chainId:1,symbol:"ETH",rpc:"EVM_RPC_ETHEREUM",hash:"MAINWELL_EXECUTOR_CODE_HASH_ETHEREUM"},
 {id:"polygon",name:"Polygon",chainId:137,symbol:"POL",rpc:"EVM_RPC_POLYGON",hash:"MAINWELL_EXECUTOR_CODE_HASH_POLYGON"},
 {id:"bsc",name:"BNB Smart Chain",chainId:56,symbol:"BNB",rpc:"EVM_RPC_BSC",hash:"MAINWELL_EXECUTOR_CODE_HASH_BSC"},
 {id:"avalanche",name:"Avalanche",chainId:43114,symbol:"AVAX",rpc:"EVM_RPC_AVALANCHE",hash:"MAINWELL_EXECUTOR_CODE_HASH_AVALANCHE"},
 {id:"arbitrum",name:"Arbitrum",chainId:42161,symbol:"ETH",rpc:"EVM_RPC_ARBITRUM",hash:"MAINWELL_EXECUTOR_CODE_HASH_ARBITRUM"},
 {id:"optimism",name:"Optimism",chainId:10,symbol:"ETH",rpc:"EVM_RPC_OPTIMISM",hash:"MAINWELL_EXECUTOR_CODE_HASH_OPTIMISM"},
 {id:"base",name:"Base",chainId:8453,symbol:"ETH",rpc:"EVM_RPC_BASE",hash:"MAINWELL_EXECUTOR_CODE_HASH_BASE"}
] as const;
const ADDRESS=/^0x[0-9a-fA-F]{40}$/;
const UINT=/^(0|[1-9][0-9]{0,77})$/;
function json(data:unknown,status=200){return new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff"}})}
async function getSetting(db:DB,key:string):Promise<string|null>{const row=await db.prepare("SELECT setting_value FROM mainwell_runtime_settings WHERE setting_key=?").bind(key).first<{setting_value:string}>();return row?.setting_value??null}
export async function runtimeSettingsResponse(env:Env){const rows=await env.DB.prepare("SELECT setting_key,setting_value,updated_at FROM mainwell_runtime_settings ORDER BY setting_key").all<{setting_key:string;setting_value:string;updated_at:string}>();return rows.success?json({settings:rows.results}):json({error:"Unable to load runtime settings."},503)}
export async function updateRuntimeSetting(request:Request,env:Env,admin:Admin){
 if(request.method!=="PUT")return json({error:"Method not allowed."},405);
 const origin=request.headers.get("origin");if(origin!==new URL(request.url).origin)return json({error:"Origin check failed."},403);
 let body:Record<string,unknown>;try{body=await request.json() as Record<string,unknown>}catch{return json({error:"Invalid JSON body."},400)}
 const now=new Date().toISOString(),actor=admin.adminId;
 const updates:Array<[string,string]>=[],deletes:string[]=[];
 if(typeof body.automationEnabled==="boolean")updates.push(["automation_enabled",String(body.automationEnabled)]);
 if(typeof body.executionEnabled==="boolean")updates.push(["execution_enabled",String(body.executionEnabled)]);
 if(body.feeCapsWei&&typeof body.feeCapsWei==="object"&&!Array.isArray(body.feeCapsWei)){
  for(const [network,value] of Object.entries(body.feeCapsWei as Record<string,unknown>)){
   if(!NETWORKS.some(n=>n.id===network)||typeof value!=="string"||(value!==""&&!UINT.test(value)))return json({error:"Each network fee ceiling must be a non-negative integer in that network's native base units."},400);
   if(value==="")deletes.push("fee_cap_wei:"+network);else updates.push(["fee_cap_wei:"+network,value]);
  }
 }
 if(body.reserveWei&&typeof body.reserveWei==="object"&&!Array.isArray(body.reserveWei)){
  for(const [network,value] of Object.entries(body.reserveWei as Record<string,unknown>)){
   if(!NETWORKS.some(n=>n.id===network)||typeof value!=="string"||(value!==""&&!UINT.test(value)))return json({error:"Each network gas reserve must be a non-negative integer in native base units."},400);
   if(value==="")deletes.push("reserve_wei:"+network);else updates.push(["reserve_wei:"+network,value]);
  }
 }
 if(!updates.length&&!deletes.length)return json({error:"No valid settings supplied."},400);
 const statements:DBStatement[]=[];
 for(const [key,value] of updates)statements.push(env.DB.prepare("INSERT INTO mainwell_runtime_settings(setting_key,setting_value,updated_by,updated_at) VALUES(?,?,?,?) ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value,updated_by=excluded.updated_by,updated_at=excluded.updated_at").bind(key,value,actor,now));
 for(const key of deletes)statements.push(env.DB.prepare("DELETE FROM mainwell_runtime_settings WHERE setting_key=?").bind(key));
 statements.push(env.DB.prepare("INSERT INTO audit_events(id,actor_type,actor_id,action,target_type,target_id,metadata_json,created_at) VALUES(?,'admin',?,'runtime.settings.updated','runtime_settings','mainwell',?,?)").bind(crypto.randomUUID(),actor,JSON.stringify({keys:[...updates.map(x=>x[0]),...deletes]}),now));
 const results=await env.DB.batch(statements);
 if(results.some(result=>!result.success))return json({error:"Runtime settings and audit record could not be committed."},503);
 return json({saved:true,updatedKeys:[...updates.map(x=>x[0]),...deletes]});
}
export async function runtimeReadiness(env:Env){
 const automationEnabled=await getSetting(env.DB,"automation_enabled")==="true",executionEnabled=await getSetting(env.DB,"execution_enabled")==="true";
 const networks=await Promise.all(NETWORKS.map(async n=>{
  const rpc=env[n.rpc],feeCap=await getSetting(env.DB,"fee_cap_wei:"+n.id),reserve=await getSetting(env.DB,"reserve_wei:"+n.id),executorHash=env[n.hash];
  const operatorConfigs=[{mode:"admin" as const,address:env.MAINWELL_ADMIN_OPERATOR,key:env.MAINWELL_ADMIN_PRIVATE_KEY},{mode:"automation" as const,address:env.MAINWELL_AUTOMATION_OPERATOR,key:env.MAINWELL_AUTOMATION_PRIVATE_KEY}];
  const operators=operatorConfigs.map(op=>{let keyMatches=false;if(op.address&&op.key&&ADDRESS.test(op.address)){try{keyMatches=privateKeyToAccount((op.key.startsWith("0x")?op.key:"0x"+op.key) as `0x${string}`).address.toLowerCase()===op.address.toLowerCase()}catch{}}
   return {mode:op.mode,address:op.address,addressConfigured:Boolean(op.address&&ADDRESS.test(op.address)),privateKeyConfigured:Boolean(op.key),keyMatches,balanceWei:null as string|null,gasFunded:false};
  });
  let rpcStatus:"not_configured"|"unreachable"|"chain_mismatch"|"ready"="not_configured",headAgeSeconds:number|null=null,headFresh=false,feeQuoteAvailable=false;
  if(rpc&&/^https:\/\//i.test(rpc)){
   try{
    const chain:Chain={id:n.chainId,name:n.name,nativeCurrency:{name:n.symbol,symbol:n.symbol,decimals:18},rpcUrls:{default:{http:[rpc]}}};
    const client=createPublicClient({chain,transport:http(rpc,{timeout:8000})});
    const [chainId,block,fees]=await Promise.all([client.getChainId(),client.getBlock(),client.estimateFeesPerGas().catch(async()=>({gasPrice:await client.getGasPrice()}))]);
    rpcStatus=chainId===n.chainId?"ready":"chain_mismatch";headAgeSeconds=Math.max(0,Math.floor(Date.now()/1000-Number(block.timestamp)));headFresh=headAgeSeconds<=120;
    feeQuoteAvailable=Boolean(("maxFeePerGas" in fees&&fees.maxFeePerGas!==undefined&&fees.maxFeePerGas>0n)||("gasPrice" in fees&&fees.gasPrice!==undefined&&fees.gasPrice>0n));
    if(rpcStatus==="ready")await Promise.all(operators.map(async op=>{if(op.address&&ADDRESS.test(op.address)){try{const balance=await client.getBalance({address:op.address as `0x${string}`});op.balanceWei=balance.toString();op.gasFunded=balance>0n}catch{}}}));
   }catch{rpcStatus="unreachable"}
  }
  return {network:n.id,name:n.name,chainId:n.chainId,nativeSymbol:n.symbol,rpcStatus,headAgeSeconds,headFresh,feeQuoteAvailable,executorHashConfigured:Boolean(executorHash&&/^0x[0-9a-fA-F]{64}$/.test(executorHash)),feeCapConfigured:feeCap!==null,feeCapWei:feeCap,reserveConfigured:reserve!==null,reserveWei:reserve,operators};
 }));
 return json({automationEnabled,executionEnabled,networks,checkedAt:new Date().toISOString()});
}

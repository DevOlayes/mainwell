import { CURATED_ERC20_ASSETS } from "../domain/curated-assets";
import type { OwnerApiEnv } from "./owner-api";

interface Statement { bind(...values: unknown[]): Statement; first<T = Record<string, unknown>>(): Promise<T | null>; all<T = Record<string, unknown>>(): Promise<{success:boolean;results:T[]}>; run<T = Record<string, unknown>>(): Promise<{success:boolean;meta?:{changes?:number}}> }
interface Database { prepare(sql:string):Statement; batch(statements:Statement[]):Promise<Array<{success:boolean;meta?:{changes?:number}}>> }
interface AdminSession { id:string; adminId:string }
const NETWORK_CHAIN: Record<string,number> = { ethereum:1, polygon:137, bsc:56, avalanche:43114, arbitrum:42161, optimism:10, base:8453 };
const ADDRESS=/^0x[0-9a-fA-F]{40}$/;
async function runtimeExecutionEnabled(env:OwnerApiEnv):Promise<boolean>{const row=await env.DB.prepare("SELECT setting_value FROM mainwell_runtime_settings WHERE setting_key=?").bind("execution_enabled").first<{setting_value:string}>();return row?.setting_value==="true";}
const RPC_BY_NETWORK = {
 ethereum:"EVM_RPC_ETHEREUM", polygon:"EVM_RPC_POLYGON", bsc:"EVM_RPC_BSC",
 avalanche:"EVM_RPC_AVALANCHE", arbitrum:"EVM_RPC_ARBITRUM", optimism:"EVM_RPC_OPTIMISM", base:"EVM_RPC_BASE"
} as const;
async function verifyCuratedAssetWithRetry(env:OwnerApiEnv,asset:(typeof CURATED_ERC20_ASSETS)[number]):Promise<void>{
 const rpcUrl=env[RPC_BY_NETWORK[asset.network]];
 if(!rpcUrl)throw new Error("RPC_NOT_CONFIGURED");
 let lastError:unknown;
 for(let attempt=0;attempt<2;attempt++){
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),8000);
  try{
   const calls=[
    {jsonrpc:"2.0",id:1,method:"eth_chainId",params:[]},
    {jsonrpc:"2.0",id:2,method:"eth_getCode",params:[asset.address,"latest"]},
    {jsonrpc:"2.0",id:3,method:"eth_call",params:[{to:asset.address,data:"0x313ce567"},"latest"]}
   ];
   let res:Response;
   try{res=await fetch(rpcUrl,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(calls),signal:controller.signal});}
   catch{throw new Error("RPC_UNAVAILABLE");}
   if(!res.ok)throw new Error("RPC_UNAVAILABLE");
   let payload:unknown;
   try{payload=await res.json();}catch{throw new Error("RPC_UNAVAILABLE");}
   if(!Array.isArray(payload))throw new Error("RPC_BATCH_UNSUPPORTED");
   const byId=new Map((payload as Array<{id:number;result?:string;error?:{message?:string}}>).map(item=>[item.id,item]));
   const chain=byId.get(1)?.result,code=byId.get(2)?.result,decimalsRaw=byId.get(3)?.result;
   if(byId.size!==3||(payload as Array<{error?:unknown}>).some(item=>item.error))throw new Error("RPC_UNAVAILABLE");
   if(typeof chain!=="string"||BigInt(chain)!==BigInt(NETWORK_CHAIN[asset.network]))throw new Error("RPC_CHAIN_MISMATCH");
   if(typeof code!=="string"||!/^0x[0-9a-fA-F]+$/.test(code)||/^0x0*$/i.test(code))throw new Error("TOKEN_CONTRACT_NOT_FOUND");
   if(typeof decimalsRaw!=="string"||!/^0x[0-9a-fA-F]+$/.test(decimalsRaw)||Number(BigInt(decimalsRaw))!==asset.decimals)throw new Error("TOKEN_DECIMALS_MISMATCH");
   return;
  }catch(error){
   lastError=error;
   const reason=error instanceof Error?error.message:"";
   const transient=reason==="RPC_UNAVAILABLE"||reason==="RPC_BATCH_UNSUPPORTED"||reason==="AbortError";
   if(!transient||attempt===1)throw error;
  }finally{clearTimeout(timeout);}
  await new Promise(resolve=>setTimeout(resolve,350));
 }
 throw lastError instanceof Error?lastError:new Error("RPC_UNAVAILABLE");
}
async function verifyRegisteredToken(env:OwnerApiEnv,network:keyof typeof RPC_BY_NETWORK,address:string,decimals:number):Promise<void>{
 const rpcName=RPC_BY_NETWORK[network],rpcUrl=env[rpcName];
 if(!rpcUrl)throw new Error("RPC_NOT_CONFIGURED");
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),10000);
 try{
  let id=0;
  const rpc=async(method:string,params:unknown[])=>{
   const res=await fetch(rpcUrl,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:++id,method,params}),signal:controller.signal});
   if(!res.ok)throw new Error("RPC_UNAVAILABLE");
   const payload=await res.json() as {id:number;result?:string;error?:{message:string}};
   if(payload.id!==id||payload.error||typeof payload.result!=="string")throw new Error("RPC_UNAVAILABLE");
   return payload.result;
  };
  const chain=await rpc("eth_chainId",[]);
  if(BigInt(chain)!==BigInt(NETWORK_CHAIN[network]))throw new Error("RPC_CHAIN_MISMATCH");
  const code=await rpc("eth_getCode",[address,"latest"]);
  if(!/^0x[0-9a-fA-F]+$/.test(code)||/^0x0*$/i.test(code))throw new Error("TOKEN_CONTRACT_NOT_FOUND");
  const decimalsResult=await rpc("eth_call",[{to:address,data:"0x313ce567"},"latest"]);
  if(!/^0x[0-9a-fA-F]+$/.test(decimalsResult)||Number(BigInt(decimalsResult))!==decimals)throw new Error("TOKEN_DECIMALS_MISMATCH");
 }finally{clearTimeout(timeout);}
}

function response(data:unknown,status=200):Response{return new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff","referrer-policy":"no-referrer"}});}
function originOk(req:Request,url:URL):boolean{return req.headers.get("origin")===url.origin;}
async function body(req:Request):Promise<Record<string,unknown>|null>{try{if(Number(req.headers.get("content-length")??"0")>2048)return null;const raw=await req.text();if(raw.length>2048)return null;const v:unknown=JSON.parse(raw);return v&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:null;}catch{return null;}}
export async function handleAdminDestinationApi(request:Request,env:OwnerApiEnv,admin:AdminSession):Promise<Response|null>{
 const url=new URL(request.url),path=url.pathname,now=new Date().toISOString();

 if(path==="/api/admin/supported-assets/curated"&&request.method==="POST"){
  if(!originOk(request,url))return response({error:"Origin check failed."},403);
  // Retry transient RPC failures once. Keep a bounded worker pool so a flaky
  // endpoint does not fan out an unbounded burst of requests.
  const verified:Array<(typeof CURATED_ERC20_ASSETS)[number]>=[],rejected:Array<{network:string;symbol:string;reason:string}>= [];
  const candidates=[...CURATED_ERC20_ASSETS];
  let cursor=0;
  const workers=Array.from({length:4},async()=>{
   while(true){
    const index=cursor++;
    if(index>=candidates.length)return;
    const asset=candidates[index];
    try{await verifyCuratedAssetWithRetry(env,asset);verified.push(asset);}
    catch(error){rejected.push({network:asset.network,symbol:asset.symbol,reason:error instanceof Error?error.message:"VERIFICATION_FAILED"});}
   }
  });
  await Promise.all(workers);
  const statements:Statement[]=[];
  for(const asset of verified){
   const normalized=asset.address.toLowerCase(),id=asset.network+":erc20:"+normalized;
   statements.push(env.DB.prepare("INSERT INTO recovery_supported_assets(id,network,token_address,symbol,name,decimals,is_active,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,1,?,?,?) ON CONFLICT(network,token_address) DO UPDATE SET symbol=excluded.symbol,name=excluded.name,decimals=excluded.decimals,is_active=1,updated_at=excluded.updated_at")
    .bind(id,asset.network,normalized,asset.symbol,asset.name,asset.decimals,admin.adminId,now,now));
   statements.push(env.DB.prepare("INSERT INTO audit_events(actor_type,actor_id,action,target_type,target_id,metadata_json,created_at) VALUES('admin',?,'recovery.supported_asset.curated_add','recovery_supported_asset',?,?,?)")
    .bind(admin.adminId,id,JSON.stringify({network:asset.network,address:normalized,symbol:asset.symbol,name:asset.name,decimals:asset.decimals,provenance:asset.provenance,verification:"chain-id+bytecode+decimals"}),now));
  }
  if(statements.length){
   const results=await env.DB.batch(statements as unknown as Parameters<typeof env.DB.batch>[0]);
   if(results.some(result=>!result.success))return response({error:"One or more verified assets could not be committed. Review the registry and retry; successful statements are recorded in D1."},503);
  }
  const activeCount=await env.DB.prepare("SELECT COUNT(*) AS total FROM recovery_supported_assets WHERE is_active=1").first<{total:number}>();
  return response({registered:verified.length,verifiedThisRun:verified.length,activeTotal:Number(activeCount?.total??0),catalogTotal:CURATED_ERC20_ASSETS.length,verified:verified.map(asset=>({network:asset.network,symbol:asset.symbol,address:asset.address,decimals:asset.decimals,provenance:asset.provenance})),rejected});
 }
 // Administrator-managed ERC-20 registry. JSON-RPC cannot enumerate arbitrary wallet tokens.
 if(path==="/api/admin/supported-assets"&&request.method==="GET"){
  const network=url.searchParams.get("network");
  if(network&&!(network in NETWORK_CHAIN))return response({error:"Unsupported network."},400);
  const stmt=env.DB.prepare("SELECT id,network,token_address AS tokenAddress,symbol,name,decimals,is_active AS isActive,created_at AS createdAt,updated_at AS updatedAt FROM recovery_supported_assets"+(network?" WHERE network=?":"")+" ORDER BY network,symbol");
  const rows=await (network?stmt.bind(network):stmt).all<Record<string,unknown>>();
  return rows.success?response({assets:rows.results}):response({error:"Unable to load supported assets."},503);
 }
 if(path==="/api/admin/supported-assets"&&request.method==="POST"){
  if(!originOk(request,url))return response({error:"Origin check failed."},403);
  const b=await body(request),network=typeof b?.network==="string"?b.network:"";
  const address=typeof b?.address==="string"?b.address:"";
  const symbol=typeof b?.symbol==="string"?b.symbol.trim():"";
  const name=typeof b?.name==="string"?b.name.trim():"";
  const decimals=Number(b?.decimals);
  if(!(network in NETWORK_CHAIN)||!ADDRESS.test(address)||!/^[A-Za-z0-9._-]{1,16}$/.test(symbol)||
     !name||name.length>64||!Number.isInteger(decimals)||decimals<0||decimals>36){
    return response({error:"Provide a supported network, token contract address, symbol, name and decimals from 0 to 36."},400);
  }
  const normalized=address.toLowerCase(),id=network+":erc20:"+normalized;
  try{await verifyRegisteredToken(env,network as keyof typeof RPC_BY_NETWORK,normalized,decimals);}
  catch(error){
   const reason=error instanceof Error?error.message:"";
   if(reason==="RPC_NOT_CONFIGURED")return response({error:"A trusted RPC endpoint must be configured for this network before registering tokens."},503);
   if(reason==="TOKEN_CONTRACT_NOT_FOUND"||reason==="TOKEN_DECIMALS_MISMATCH"||reason==="RPC_CHAIN_MISMATCH")return response({error:"The token contract, network or decimals could not be verified on-chain."},400);
   return response({error:"Unable to verify token contract with the configured RPC. Try again later."},502);
  }
  const saved=await env.DB.prepare("INSERT INTO recovery_supported_assets(id,network,token_address,symbol,name,decimals,is_active,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,1,?,?,?) ON CONFLICT(network,token_address) DO UPDATE SET symbol=excluded.symbol,name=excluded.name,decimals=excluded.decimals,is_active=1,updated_at=excluded.updated_at").bind(id,network,normalized,symbol,name,decimals,admin.adminId,now,now).run();
  if(!saved.success)return response({error:"Unable to register supported token."},503);
  await env.DB.prepare("INSERT INTO audit_events(actor_type,actor_id,action,target_type,target_id,metadata_json,created_at) VALUES('admin',?,'recovery.supported_asset.add','recovery_supported_asset',?,?,?)").bind(admin.adminId,id,JSON.stringify({network,address:normalized,symbol,name,decimals}),now).run();
  return response({created:true,asset:{id,network,tokenAddress:normalized,symbol,name,decimals,isActive:true,createdAt:now,updatedAt:now}});
 }
 const supportedAssetMatch=path.match(/^\/api\/admin\/supported-assets\/([a-z-]+)\/(0x[0-9a-fA-F]{40})$/);
 if(supportedAssetMatch&&request.method==="DELETE"){
  if(!originOk(request,url))return response({error:"Origin check failed."},403);
  const network=supportedAssetMatch[1],address=supportedAssetMatch[2].toLowerCase();
  if(!(network in NETWORK_CHAIN))return response({error:"Unsupported network."},400);
  const id=network+":erc20:"+address;
  const removed=await env.DB.prepare("UPDATE recovery_supported_assets SET is_active=0,updated_at=? WHERE network=? AND token_address=? AND is_active=1").bind(now,network,address).run();
  if(!removed.success)return response({error:"Unable to deactivate supported asset."},503);
  await env.DB.prepare("INSERT INTO audit_events(actor_type,actor_id,action,target_type,target_id,metadata_json,created_at) VALUES('admin',?,'recovery.supported_asset.deactivate','recovery_supported_asset',?,?,?)").bind(admin.adminId,id,JSON.stringify({network,address}),now).run();
  return response({deactivated:true,id});
 }
 // Admin-managed source wallets: registration alone never makes a wallet recovery-eligible.
 if(path==="/api/admin/recovery-wallets"&&request.method==="GET"){
  const rows=await env.DB.prepare("SELECT id,owner_address AS address,network,chain_id,status,admin_locked AS adminLocked,locked_by AS lockedBy,locked_at AS lockedAt,created_at AS createdAt,updated_at AS updatedAt FROM recovery_wallets ORDER BY admin_locked DESC,updated_at DESC").all<Record<string,unknown>>();
  return rows.success?response({wallets:rows.results}):response({error:"Unable to load configured source wallets."},503);
 }
 if(path==="/api/admin/recovery-wallets"&&request.method==="POST"){
  if(!originOk(request,url))return response({error:"Origin check failed."},403);
  const b=await body(request),network=typeof b?.network==="string"?b.network:"",address=typeof b?.address==="string"?b.address:"";
  if((network!=="all"&&!(network in NETWORK_CHAIN))||!ADDRESS.test(address))return response({error:"Choose a supported EVM network (or all seven) and provide a valid source wallet address."},400);
  const normalized=address.toLowerCase(),targets=network==="all"?Object.keys(NETWORK_CHAIN):[network];
  const existingRows:Array<{network:string;id:string;status:string}>= [];
  for(const target of targets){
   const existing=await env.DB.prepare("SELECT id,status FROM recovery_wallets WHERE owner_address=? AND network=? LIMIT 1").bind(normalized,target).first<{id:string;status:string}>();
   if(existing?.status==="revoked")return response({error:"The source wallet has a revoked registration on "+target+". It cannot be silently reactivated; resolve that record before locking all networks."},409);
   if(existing)existingRows.push({network:target,id:existing.id,status:existing.status});
  }
  const locked=[];
  for(const target of targets){
   const existing=existingRows.find(row=>row.network===target),id=existing?.id??crypto.randomUUID(),at=now;
   const saved=await env.DB.prepare("INSERT INTO recovery_wallets(id,owner_address,network,chain_id,status,first_seen_at,created_at,updated_at,admin_locked,locked_by,locked_at) VALUES(?,?,?,?, 'monitoring',?,?,?,?,?,?) ON CONFLICT(owner_address,network) DO UPDATE SET admin_locked=1,locked_by=excluded.locked_by,locked_at=excluded.locked_at,updated_at=excluded.updated_at WHERE recovery_wallets.status!='revoked'").bind(id,normalized,target,NETWORK_CHAIN[target],at,at,at,1,admin.adminId,at).run();
   if(!saved.success)return response({error:"Unable to lock the source wallet on "+target+". Previously completed network locks remain recorded; refresh and retry after checking the source-wallet list."},503);
   const row=await env.DB.prepare("SELECT id,owner_address AS address,network,chain_id,status,admin_locked AS adminLocked,locked_by AS lockedBy,locked_at AS lockedAt,updated_at AS updatedAt FROM recovery_wallets WHERE owner_address=? AND network=?").bind(normalized,target).first<Record<string,unknown>>();
   if(!row||Number(row.adminLocked)!==1)return response({error:"Source-wallet lock could not be confirmed on "+target+"."},503);
   locked.push(row);
   await env.DB.prepare("INSERT INTO audit_events(actor_type,actor_id,action,target_type,target_id,metadata_json,created_at) VALUES('admin',?,'recovery.source_wallet.lock','recovery_wallet',?,?,?)").bind(admin.adminId,id,JSON.stringify({network:target,address:normalized,locked:true,bulk:network==="all"}),at).run();
  }
  return response({locked:true,networkCount:locked.length,wallets:locked,wallet:locked.length===1?locked[0]:undefined});
 }

 if(path==="/api/admin/recovery-destinations"&&request.method==="POST"){
  if(!originOk(request,url))return response({error:"Origin check failed."},403);
  const b=await body(request),network=typeof b?.network==="string"?b.network:"",address=typeof b?.address==="string"?b.address:"";
  if(!(network in NETWORK_CHAIN)||!ADDRESS.test(address))return response({error:"A supported network and valid EVM destination address are required."},400);
  const normalized=address.toLowerCase(),id=crypto.randomUUID();
  const saved=await env.DB.prepare("INSERT INTO recovery_destinations(id,network,address,locked,is_active,updated_by,updated_at) VALUES(?,?,?,1,1,?,?) ON CONFLICT(network,address) DO UPDATE SET locked=1,is_active=1,updated_by=excluded.updated_by,updated_at=excluded.updated_at").bind(id,network,normalized,admin.adminId,now).run();
  if(!saved.success)return response({error:"Unable to add locked destination."},503);
  const row=await env.DB.prepare("SELECT id,network,address,locked,is_active,updated_at FROM recovery_destinations WHERE network=? AND address=?").bind(network,normalized).first<Record<string,unknown>>();
  await env.DB.prepare("INSERT INTO audit_events(actor_type,actor_id,action,target_type,target_id,metadata_json,created_at) VALUES('admin',?,'recovery.destination.add','recovery_destination',?,?,?)").bind(admin.adminId,String(row?.id??id),JSON.stringify({network,address:normalized,locked:true}),now).run();
  return response({created:true,destination:row});
 }
 const policyMatch=path.match(/^\/api\/admin\/recovery-destination-policies\/([a-z-]+)\/([^/]+)$/);
 if(policyMatch&&request.method==="PUT"){
  if(!originOk(request,url))return response({error:"Origin check failed."},403);
  const network=policyMatch[1],b=await body(request),destinationId=typeof b?.destinationId==="string"?b.destinationId:"";
  let assetId:string;try{assetId=decodeURIComponent(policyMatch[2]);}catch{return response({error:"Invalid asset identifier."},400);}
  const maxAmountRaw=typeof b?.maxAmountRaw==="string"?b.maxAmountRaw:"";
  const automaticPriorityEnabled=b?.automaticPriorityEnabled===true;
  const adminInitiatedEnabled=b?.adminInitiatedEnabled===true;
  const expiresInSeconds=Number(b?.expiresInSeconds);
  if(!(network in NETWORK_CHAIN)||!assetId||assetId.length>160||!destinationId||
     !/^[1-9][0-9]{0,77}$/.test(maxAmountRaw)||(BigInt(maxAmountRaw) > ((1n << 256n) - 1n))||(!automaticPriorityEnabled&&!adminInitiatedEnabled)||
     !Number.isSafeInteger(expiresInSeconds)||expiresInSeconds<3600||expiresInSeconds>31536000){
    return response({error:"Provide a destination, positive asset cap in token base units, at least one execution mode, and expiry from 1 hour to 365 days."},400);
  }
  const asset=await env.DB.prepare("SELECT id,token_address AS tokenAddress FROM recovery_supported_assets WHERE id=? AND network=? AND is_active=1").bind(assetId,network).first<{id:string;tokenAddress:string}>();
  if(!asset)return response({error:"Register and verify this ERC-20 token in the supported asset registry first."},409);
  const dest=await env.DB.prepare("SELECT id,address FROM recovery_destinations WHERE id=? AND network=? AND locked=1 AND is_active=1").bind(destinationId,network).first<{id:string;address:string}>();
  if(!dest)return response({error:"Select an active locked destination on the same network."},409);
  const saved=await env.DB.prepare("INSERT INTO recovery_asset_destination_policies(network,asset_id,destination_id,updated_by,updated_at,max_amount_raw,automatic_priority_enabled,admin_initiated_enabled,expires_in_seconds) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(network,asset_id) DO UPDATE SET destination_id=excluded.destination_id,updated_by=excluded.updated_by,updated_at=excluded.updated_at,max_amount_raw=excluded.max_amount_raw,automatic_priority_enabled=excluded.automatic_priority_enabled,admin_initiated_enabled=excluded.admin_initiated_enabled,expires_in_seconds=excluded.expires_in_seconds").bind(network,assetId,destinationId,admin.adminId,now,maxAmountRaw,automaticPriorityEnabled?1:0,adminInitiatedEnabled?1:0,expiresInSeconds).run();
  if(!saved.success)return response({error:"Unable to save asset authorization policy."},503);
  await env.DB.prepare("INSERT INTO audit_events(actor_type,actor_id,action,target_type,target_id,metadata_json,created_at) VALUES('admin',?,'recovery.asset_authorization_policy.set','recovery_asset_destination_policy',?,?,?)").bind(admin.adminId,network+":"+assetId,JSON.stringify({destinationId,address:dest.address,maxAmountRaw,automaticPriorityEnabled,adminInitiatedEnabled,expiresInSeconds}),now).run();
  return response({updated:true,network,assetId,destinationId,address:dest.address,maxAmountRaw,automaticPriorityEnabled,adminInitiatedEnabled,expiresInSeconds,ownerApprovalRequired:true});
 }
 if(path==="/api/admin/recovery-destination-policies"&&request.method==="GET"){
  const network=url.searchParams.get("network");
  if(network&&!(network in NETWORK_CHAIN))return response({error:"Unsupported network."},400);
  const sql="SELECT p.network,p.asset_id AS assetId,p.destination_id AS destinationId,d.address AS destinationAddress,p.max_amount_raw AS maxAmountRaw,p.automatic_priority_enabled AS automaticPriorityEnabled,p.admin_initiated_enabled AS adminInitiatedEnabled,p.expires_in_seconds AS expiresInSeconds,p.updated_at AS updatedAt FROM recovery_asset_destination_policies p INNER JOIN recovery_destinations d ON d.id=p.destination_id"+(network?" WHERE p.network=?":"")+" ORDER BY p.network,p.asset_id";
  const stmt=env.DB.prepare(sql),rows=await (network?stmt.bind(network):stmt).all<Record<string,unknown>>();
  return rows.success?response({policies:rows.results}):response({error:"Unable to load asset destination policies."},503);
 }
 const clearPolicy=path.match(/^\/api\/admin\/recovery-destination-policies\/([a-z-]+)\/([^/]+)$/);
 if(clearPolicy&&request.method==="DELETE"){
  if(!originOk(request,url))return response({error:"Origin check failed."},403);
  let assetId:string;try{assetId=decodeURIComponent(clearPolicy[2]);}catch{return response({error:"Invalid asset identifier."},400);}
  const removed=await env.DB.prepare("DELETE FROM recovery_asset_destination_policies WHERE network=? AND asset_id=?").bind(clearPolicy[1],assetId).run();
  if(!removed.success)return response({error:"Unable to clear destination policy."},503);
  await env.DB.prepare("INSERT INTO audit_events(actor_type,actor_id,action,target_type,target_id,metadata_json,created_at) VALUES('admin',?,'recovery.asset_destination_policy.clear','recovery_asset_destination_policy',?,'{}',?)").bind(admin.adminId,clearPolicy[1]+":"+assetId,now).run();
  return response({cleared:true});
 }
 if(path==="/api/admin/recovery-destinations"&&request.method==="GET"){
  const rows=await env.DB.prepare("SELECT id,network,address,locked,is_active,updated_by,updated_at FROM recovery_destinations ORDER BY network,is_active DESC,updated_at DESC").all<Record<string,unknown>>();
  return rows.success?response({destinations:rows.results}):response({error:"Unable to load recovery destinations."},503);
 }
 const networkMatch=path.match(/^\/api\/admin\/recovery-destinations\/([a-z-]+)$/);
 if(networkMatch&&request.method==="PUT"){
  if(!originOk(request,url))return response({error:"Origin check failed."},403);
  const network=networkMatch[1],b=await body(request),address=typeof b?.address==="string"?b.address:"";
  if(!(network in NETWORK_CHAIN)||!ADDRESS.test(address))return response({error:"A supported network and valid EVM destination address are required."},400);
  const normalized=address.toLowerCase(),existing=await env.DB.prepare("SELECT id FROM recovery_destinations WHERE network=? AND address=? LIMIT 1").bind(network,normalized).first<{id:string}>();
  const id=existing?.id??crypto.randomUUID();
  const batch=await env.DB.batch([
   env.DB.prepare("INSERT INTO recovery_destinations(id,network,address,locked,is_active,updated_by,updated_at) VALUES(?,?,?,1,1,?,?) ON CONFLICT(network,address) DO UPDATE SET locked=1,is_active=1,updated_by=excluded.updated_by,updated_at=excluded.updated_at").bind(id,network,normalized,admin.adminId,now),
   env.DB.prepare("INSERT INTO audit_events(actor_type,actor_id,action,target_type,target_id,metadata_json,created_at) VALUES('admin',?,'recovery.destination.lock','recovery_destination',?,?,?)").bind(admin.adminId,id,JSON.stringify({network,address:normalized,locked:true}),now)
  ]);
  if(batch.some(x=>!x.success))return response({error:"Destination update was not confirmed."},503);
  return response({updated:true,destination:{id,network,address:normalized,locked:true,isActive:true,updatedAt:now}});
 }
 const overrideMatch=path.match(/^\/api\/admin\/grants\/([A-Za-z0-9_-]{1,128})\/assets\/([^/]+)\/destination$/);
 if(overrideMatch&&request.method==="PUT"){
  if(!originOk(request,url))return response({error:"Origin check failed."},403);
  const b=await body(request),destinationId=typeof b?.destinationId==="string"?b.destinationId:"";
  if(!destinationId)return response({error:"destinationId is required."},400);
  let assetId:string;try{assetId=decodeURIComponent(overrideMatch[2]);}catch{return response({error:"Invalid asset identifier."},400);}
  const grant=await env.DB.prepare("SELECT network FROM recovery_grants WHERE grant_id=? AND verification_status='verified' AND revoked_at IS NULL AND expires_at>?").bind(overrideMatch[1],now).first<{network:string}>();
  if(!grant)return response({error:"Active verified authorization not found."},404);
  const asset=await env.DB.prepare("SELECT asset_id,destination_address FROM recovery_grant_assets WHERE grant_id=? AND asset_id=? AND revoked_at IS NULL").bind(overrideMatch[1],assetId).first<{asset_id:string;destination_address:string}>();
  if(!asset)return response({error:"Active authorized asset not found."},404);
  const destination=await env.DB.prepare("SELECT id,network,address,locked,is_active FROM recovery_destinations WHERE id=?").bind(destinationId).first<{id:string;network:string;address:string;locked:number;is_active:number}>();
  if(!destination||destination.network!==grant.network||destination.locked!==1||destination.is_active!==1)return response({error:"Destination must be active, locked, and on the grant's network."},409);
  // The deployed executor has an immutable destination. A database override cannot change it.
  if(destination.address.toLowerCase()!==asset.destination_address.toLowerCase())return response({error:"This destination differs from the asset's immutable owner-approved on-chain destination. A new owner-approved grant/executor is required."},409);
  const saved=await env.DB.prepare("INSERT INTO recovery_asset_destinations(grant_id,asset_id,destination_id,updated_by,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(grant_id,asset_id) DO UPDATE SET destination_id=excluded.destination_id,updated_by=excluded.updated_by,updated_at=excluded.updated_at").bind(overrideMatch[1],assetId,destinationId,admin.adminId,now).run();
  if(!saved.success)return response({error:"Unable to save the asset destination selection."},503);
  await env.DB.prepare("INSERT INTO audit_events(actor_type,actor_id,action,target_type,target_id,metadata_json,created_at) VALUES('admin',?,'recovery.asset_destination.set','recovery_grant_asset',?,?,?)").bind(admin.adminId,overrideMatch[1]+":"+assetId,JSON.stringify({destinationId,address:destination.address}),now).run();
  return response({updated:true,grantId:overrideMatch[1],assetId,destinationId,address:destination.address});
 }
 if(overrideMatch&&request.method==="DELETE"){
  if(!originOk(request,url))return response({error:"Origin check failed."},403);
  let assetId:string;try{assetId=decodeURIComponent(overrideMatch[2]);}catch{return response({error:"Invalid asset identifier."},400);}
  const removed=await env.DB.prepare("DELETE FROM recovery_asset_destinations WHERE grant_id=? AND asset_id=?").bind(overrideMatch[1],assetId).run();
  if(!removed.success)return response({error:"Unable to clear the asset destination selection."},503);
  await env.DB.prepare("INSERT INTO audit_events(actor_type,actor_id,action,target_type,target_id,metadata_json,created_at) VALUES('admin',?,'recovery.asset_destination.clear','recovery_grant_asset',?,?,?)").bind(admin.adminId,overrideMatch[1]+":"+assetId,"{}",now).run();
  return response({cleared:true});
 }



 const jobAction=path.match(/^\/api\/admin\/recovery-jobs\/([A-Za-z0-9_-]{1,128})\/(retry|cancel)$/);
 if(jobAction&&request.method==="POST"){
  if(!originOk(request,url))return response({error:"Origin check failed."},403);
  const jobId=jobAction[1],action=jobAction[2];
  const activeTx=await env.DB.prepare("SELECT id,status FROM recovery_transactions WHERE job_id=? AND status IN ('prepared','submitted','pending','unknown') LIMIT 1").bind(jobId).first<{id:string;status:string}>();
  if(activeTx)return response({error:"This job has a transaction that may still be on-chain. Reconcile it before retrying or cancelling."},409);
  const now=new Date().toISOString(),eventId=crypto.randomUUID();
  const update=action==="retry"
   ? env.DB.prepare("UPDATE recovery_jobs SET status='queued',next_attempt_at=?,last_error_code=NULL,last_error_at=NULL,completed_at=NULL,cancelled_at=NULL,lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE id=? AND status IN ('blocked','failed','ready')").bind(now,now,jobId)
   : env.DB.prepare("UPDATE recovery_jobs SET status='cancelled',cancelled_at=?,completed_at=?,lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE id=? AND status IN ('queued','ready','blocked')").bind(now,now,now,jobId);
  const actionName=action==="retry"?"recovery.job.requeued":"recovery.job.cancelled";
  const eventName=action==="retry"?"recovery.job.requeued":"recovery.job.cancelled";
  const results=await env.DB.batch([
   update,
   env.DB.prepare("INSERT INTO recovery_job_events(id,job_id,event_type,actor_type,actor_id,details_json,created_at) SELECT ?,?,?,'admin',?,?,? WHERE changes()=1")
    .bind(eventId,jobId,eventName,admin.adminId,JSON.stringify({previousAllowedStates:action==="retry"?["blocked","failed","ready"]:["queued","ready","blocked"]}),now),
   env.DB.prepare("INSERT INTO audit_events(id,actor_type,actor_id,action,target_type,target_id,metadata_json,created_at) SELECT ?,'admin',?,?, 'recovery_job',?,?,? WHERE changes()=1")
    .bind(crypto.randomUUID(),admin.adminId,actionName,jobId,JSON.stringify({action}),now)
  ]);
  if(results.some(result=>!result.success))return response({error:"The recovery job state and audit records could not be committed."},503);
  if((results[0]?.meta?.changes??0)!==1)return response({error:"The job is not in a state that permits this action."},409);
  return response({updated:true,jobId,status:action==="retry"?"queued":"cancelled",executionEnabled:await runtimeExecutionEnabled(env)});
 }

 if(path==="/api/admin/wallet-inventory"&&request.method==="GET"){
  const rows=await env.DB.prepare(`
   SELECT w.id AS walletId,w.owner_address AS address,w.network,w.chain_id AS chainId,
          w.status AS walletStatus,w.admin_locked AS adminLocked,
          w.monitoring_status AS monitoringStatus,w.monitoring_error AS monitoringError,
          w.last_monitor_at AS lastMonitorAt,
          a.asset_ref AS assetId,a.token_address AS tokenAddress,a.symbol,a.name,
          a.amount_raw AS amountRaw,a.decimals,a.estimated_value_usd AS estimatedValueUsd,
          a.observed_at AS observedAt,a.discovery_source AS discoverySource,a.token_verified AS tokenVerified,
          s.id AS supportedAssetId,s.is_active AS supportedAssetActive,
          p.max_amount_raw AS policyMaxAmountRaw,p.automatic_priority_enabled AS automaticPriorityEnabled,
          p.admin_initiated_enabled AS adminInitiatedEnabled,p.expires_in_seconds AS policyExpiresInSeconds,
          d.address AS policyDestinationAddress,d.locked AS policyDestinationLocked,d.is_active AS policyDestinationActive,
          g.grant_id AS grantId,g.verification_status AS grantVerificationStatus,g.expires_at AS grantExpiresAt,
          ga.amount_kind AS authorizedAmountKind,ga.max_amount_raw AS authorizedMaxAmountRaw,
          ga.destination_address AS authorizedDestinationAddress,ga.revoked_at AS assetAuthorizationRevokedAt,
          wp.spender_address AS spenderAddress,wp.allowance_raw AS allowanceRaw,wp.status AS allowanceStatus,
          wp.updated_at AS allowanceObservedAt
   FROM recovery_wallets w
   LEFT JOIN wallet_assets a ON a.wallet_id=w.id AND a.network=w.network AND a.lifecycle_status='active'
   LEFT JOIN recovery_supported_assets s ON s.network=w.network AND lower(s.token_address)=lower(a.token_address)
   LEFT JOIN recovery_asset_destination_policies p ON p.network=w.network AND p.asset_id=a.asset_ref
   LEFT JOIN recovery_destinations d ON d.id=p.destination_id
   LEFT JOIN recovery_grants g ON lower(g.owner_wallet)=lower(w.owner_address) AND g.network=w.network
      AND g.verification_status='verified' AND g.revoked_at IS NULL AND g.expires_at>?
   LEFT JOIN recovery_grant_assets ga ON ga.grant_id=g.grant_id AND ga.asset_id=a.asset_ref AND ga.revoked_at IS NULL
   LEFT JOIN wallet_permissions wp ON wp.wallet_id=w.id AND lower(wp.token_address)=lower(a.token_address)
      AND lower(wp.spender_address)=lower(g.executor_address)
   ORDER BY w.updated_at DESC,w.network,a.symbol,a.asset_ref
  `).bind(now).all<Record<string,unknown>>();
  return rows.success?response({inventory:rows.results,observedAt:now}):response({error:"Unable to load monitored wallet asset inventory."},503);
 }
 if(path==="/api/admin/recovery-grants"&&request.method==="GET"){
  const rows=await env.DB.prepare(`
   SELECT g.grant_id AS grantId,g.owner_wallet AS ownerWallet,g.network,g.execution_modes_json AS executionModesJson,
          g.expires_at AS expiresAt,a.asset_id AS assetId,a.token_address AS tokenAddress,
          a.amount_kind AS amountKind,a.max_amount_raw AS maxAmountRaw,a.destination_address AS destinationAddress,
          a.revoked_at AS assetRevokedAt,s.symbol,s.name,s.decimals,
          w.status AS walletStatus,w.admin_locked AS adminLocked,
          d.locked AS destinationLocked,d.is_active AS destinationActive
   FROM recovery_grants g
   INNER JOIN recovery_grant_assets a ON a.grant_id=g.grant_id
   INNER JOIN recovery_wallets w ON lower(w.owner_address)=lower(g.owner_wallet) AND w.network=g.network
   LEFT JOIN recovery_supported_assets s ON s.id=a.asset_id AND s.network=g.network AND s.is_active=1
   LEFT JOIN recovery_destinations d ON d.network=g.network AND lower(d.address)=lower(a.destination_address)
   WHERE g.verification_status='verified' AND g.revoked_at IS NULL AND g.expires_at>?
     AND a.revoked_at IS NULL AND w.admin_locked=1 AND w.status='monitoring'
   ORDER BY g.expires_at,g.network,a.asset_id
  `).bind(now).all<Record<string,unknown>>();
  if(!rows.success)return response({error:"Unable to load active owner authorizations."},503);
  const grants=rows.results.filter(row=>{
   try{return Array.isArray(JSON.parse(String(row.executionModesJson)))&&
     (JSON.parse(String(row.executionModesJson)) as unknown[]).includes("admin-initiated")&&
     row.amountKind==="capped"&&typeof row.maxAmountRaw==="string"&&
     Number(row.destinationLocked)===1&&Number(row.destinationActive)===1&&Boolean(row.symbol);}
   catch{return false;}
  }).map(row=>({...row,executionModes:JSON.parse(String(row.executionModesJson))}));
  return response({grants,executionEnabled:await runtimeExecutionEnabled(env)});
 }
 // Queue an administrator-initiated recovery for an already verified, owner-authorized ERC-20 grant.
 // Queueing never signs or submits a blockchain transaction.
 if(path==="/api/admin/recovery-jobs"&&request.method==="POST"){
  if(!originOk(request,url))return response({error:"Origin check failed."},403);
  const b=await body(request);
  const grantId=typeof b?.grantId==="string"?b.grantId:"";
  const assetId=typeof b?.assetId==="string"?b.assetId:"";
  const amountRaw=typeof b?.amountRaw==="string"?b.amountRaw:null;
  const sweepAvailable=b?.sweepAvailable===true;
  const idempotencyKey=typeof b?.idempotencyKey==="string"?b.idempotencyKey:"";
  if(!/^[A-Za-z0-9_-]{1,128}$/.test(grantId)||!assetId||assetId.length>160||
     (sweepAvailable?amountRaw!==null:(!amountRaw||!/^[1-9][0-9]{0,77}$/.test(amountRaw)||BigInt(amountRaw)>((1n<<256n)-1n)))||
     !/^[A-Za-z0-9:_-]{16,128}$/.test(idempotencyKey)){
   return response({error:"Provide a verified grant, asset, either a positive token amount or the full-available-balance sweep option, and a unique idempotency key."},400);
  }
  const prior=await env.DB.prepare("SELECT id,grant_id,asset_id,requested_amount_raw,status FROM recovery_jobs WHERE idempotency_key=? LIMIT 1").bind(idempotencyKey).first<Record<string,unknown>>();
  if(prior){
   if(prior.grant_id!==grantId||prior.asset_id!==assetId||prior.requested_amount_raw!==amountRaw)return response({error:"This idempotency key was already used for a different recovery request."},409);
   return response({queued:true,duplicate:true,job:prior,executionEnabled:await runtimeExecutionEnabled(env)},200);
  }
  const scope=await env.DB.prepare(`
   SELECT g.network,g.owner_wallet,g.execution_modes_json,g.expires_at,g.revoked_at,g.verification_status,
          a.token_address,a.amount_kind,a.max_amount_raw,a.revoked_at AS asset_revoked_at,a.destination_address,
          w.id AS wallet_id,w.status AS wallet_status,w.admin_locked,
          d.locked AS destination_locked,d.is_active AS destination_active,s.is_active AS token_active
   FROM recovery_grants g
   INNER JOIN recovery_grant_assets a ON a.grant_id=g.grant_id AND a.asset_id=?
   INNER JOIN recovery_wallets w ON lower(w.owner_address)=lower(g.owner_wallet) AND w.network=g.network
   LEFT JOIN recovery_destinations d ON d.network=g.network AND lower(d.address)=lower(a.destination_address)
   LEFT JOIN recovery_supported_assets s ON s.id=a.asset_id AND s.network=g.network
   WHERE g.grant_id=? LIMIT 1
  `).bind(assetId,grantId).first<Record<string,unknown>>();
  if(!scope||scope.verification_status!=="verified"||scope.revoked_at||String(scope.expires_at)<=now)
   return response({error:"An active, verified owner authorization for this asset was not found."},409);
  if(Number(scope.admin_locked)!==1||scope.wallet_status!=="monitoring")
   return response({error:"The exact source wallet must remain administrator-locked and actively monitored."},409);
  if(scope.asset_revoked_at)return response({error:"The owner has revoked this asset authorization."},409);
  if(Number(scope.token_active)!==1)return response({error:"This token is not currently enabled in the supported asset registry."},409);
  if(!scope.token_address||!ADDRESS.test(String(scope.token_address)))
   return response({error:"This Phase Two queue currently supports verified ERC-20 assets only."},409);
  if(scope.amount_kind!=="capped"||typeof scope.max_amount_raw!=="string"||!/^[1-9][0-9]{0,77}$/.test(scope.max_amount_raw))
   return response({error:"This asset does not have a supported explicit on-chain amount cap."},409);
  if(amountRaw!==null&&BigInt(amountRaw)>BigInt(scope.max_amount_raw))
   return response({error:"Requested amount exceeds the owner-approved asset cap."},409);
  if(Number(scope.destination_locked)!==1||Number(scope.destination_active)!==1)
   return response({error:"The owner-approved destination is no longer active and locked."},409);
  let modes:unknown;
  try{modes=JSON.parse(String(scope.execution_modes_json));}catch{return response({error:"Stored owner authorization modes are invalid."},503);}
  if(!Array.isArray(modes)||!modes.includes("admin-initiated"))
   return response({error:"The owner did not authorize administrator-initiated recovery for this grant."},403);
  const id=crypto.randomUUID(),eventId=crypto.randomUUID();
  const batch=await env.DB.batch([
   env.DB.prepare("INSERT INTO recovery_jobs(id,grant_id,asset_id,execution_mode,status,priority_score,idempotency_key,requested_by,created_at,updated_at,requested_amount_raw,destination_address,next_attempt_at) VALUES(?,?,?,'admin-initiated','queued',0,?,?,?,?,?,?,?) ON CONFLICT(idempotency_key) DO NOTHING")
    .bind(id,grantId,assetId,idempotencyKey,"admin:"+admin.adminId,now,now,amountRaw,String(scope.destination_address),now),
   env.DB.prepare("INSERT INTO recovery_job_events(id,job_id,event_type,actor_type,actor_id,details_json,created_at) SELECT ?,?,'admin_recovery.queued','admin',?,?,? WHERE changes()=1")
    .bind(eventId,id,admin.adminId,JSON.stringify({grantId,assetId,amountRaw,sweepAvailable,network:scope.network}),now),
   env.DB.prepare("INSERT INTO audit_events(actor_type,actor_id,action,target_type,target_id,metadata_json,created_at) SELECT 'admin',?,'recovery.job.queued','recovery_job',?,?,? WHERE changes()=1")
    .bind(admin.adminId,id,JSON.stringify({grantId,assetId,amountRaw,sweepAvailable,network:scope.network,executionEnabled:await runtimeExecutionEnabled(env)}),now)
  ]);
  if(batch.some(result=>!result.success))return response({error:"The recovery request and its audit records could not be committed."},503);
  if((batch[0]?.meta?.changes??0)!==1){
   const raced=await env.DB.prepare("SELECT id,grant_id,asset_id,requested_amount_raw,status FROM recovery_jobs WHERE idempotency_key=? LIMIT 1").bind(idempotencyKey).first<Record<string,unknown>>();
   if(!raced||raced.grant_id!==grantId||raced.asset_id!==assetId||raced.requested_amount_raw!==amountRaw)
    return response({error:"The idempotency key conflicts with another recovery request."},409);
   return response({queued:true,duplicate:true,job:raced,executionEnabled:await runtimeExecutionEnabled(env)},200);
  }
  return response({queued:true,executionEnabled:await runtimeExecutionEnabled(env),job:{id,grantId,assetId,network:scope.network,executionMode:"admin-initiated",status:"queued",amountRaw,sweepAvailable,destinationAddress:scope.destination_address,createdAt:now}});
 }
 return null;
}

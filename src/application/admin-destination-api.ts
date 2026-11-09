import type { OwnerApiEnv } from "./owner-api";

interface Statement { bind(...values: unknown[]): Statement; first<T = Record<string, unknown>>(): Promise<T | null>; all<T = Record<string, unknown>>(): Promise<{success:boolean;results:T[]}>; run<T = Record<string, unknown>>(): Promise<{success:boolean;meta?:{changes?:number}}> }
interface Database { prepare(sql:string):Statement }
interface AdminSession { id:string; adminId:string }
const NETWORK_CHAIN: Record<string,number> = { ethereum:1, polygon:137, bsc:56, avalanche:43114, arbitrum:42161, optimism:10, base:8453 };
const ADDRESS=/^0x[0-9a-fA-F]{40}$/;
function response(data:unknown,status=200):Response{return new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff","referrer-policy":"no-referrer"}});}
function originOk(req:Request,url:URL):boolean{return req.headers.get("origin")===url.origin;}
async function body(req:Request):Promise<Record<string,unknown>|null>{try{if(Number(req.headers.get("content-length")??"0")>2048)return null;const raw=await req.text();if(raw.length>2048)return null;const v:unknown=JSON.parse(raw);return v&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:null;}catch{return null;}}
export async function handleAdminDestinationApi(request:Request,env:OwnerApiEnv,admin:AdminSession):Promise<Response|null>{
 const url=new URL(request.url),path=url.pathname,now=new Date().toISOString();
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
  if(!(network in NETWORK_CHAIN)||!assetId||assetId.length>160||!destinationId)return response({error:"Valid network, asset ID and destination ID are required."},400);
  const dest=await env.DB.prepare("SELECT id,address FROM recovery_destinations WHERE id=? AND network=? AND locked=1 AND is_active=1").bind(destinationId,network).first<{id:string;address:string}>();
  if(!dest)return response({error:"Select an active locked destination on the same network."},409);
  const saved=await env.DB.prepare("INSERT INTO recovery_asset_destination_policies(network,asset_id,destination_id,updated_by,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(network,asset_id) DO UPDATE SET destination_id=excluded.destination_id,updated_by=excluded.updated_by,updated_at=excluded.updated_at").bind(network,assetId,destinationId,admin.adminId,now).run();
  if(!saved.success)return response({error:"Unable to save asset destination policy."},503);
  await env.DB.prepare("INSERT INTO audit_events(actor_type,actor_id,action,target_type,target_id,metadata_json,created_at) VALUES('admin',?,'recovery.asset_destination_policy.set','recovery_asset_destination_policy',?,?,?)").bind(admin.adminId,network+":"+assetId,JSON.stringify({destinationId,address:dest.address}),now).run();
  return response({updated:true,network,assetId,destinationId,address:dest.address,ownerApprovalRequired:true});
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
   env.DB.prepare("UPDATE recovery_destinations SET is_active=0,updated_by=?,updated_at=? WHERE network=? AND is_active=1").bind(admin.adminId,now,network),
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
 return null;
}

import { recoverPersonalSignAddress } from "./adapters/evm-signature";
import { handleOwnerApi, type OwnerApiEnv } from "./application/owner-api";
import { handleAdminDestinationApi } from "./application/admin-destination-api";
interface D1Result<T = Record<string, unknown>> { success: boolean; results: T[]; meta?: { changes?: number } }
interface D1Statement { bind(...values: unknown[]): D1Statement; first<T = Record<string, unknown>>(): Promise<T | null>; all<T = Record<string, unknown>>(): Promise<D1Result<T>>; run<T = Record<string, unknown>>(): Promise<D1Result<T>> }
interface D1Database { prepare(query: string): D1Statement; batch<T = unknown>(statements: D1Statement[]): Promise<D1Result<T>[]> }
interface Env extends OwnerApiEnv {}
const SESSION_SECONDS = 604800, CHALLENGE_SECONDS = 300;
const CHAINS = new Set([1, 137, 56, 43114, 42161, 10, 8453]);
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
function json(data: unknown, status = 200, extra: Record<string,string> = {}): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type":"application/json; charset=utf-8", "cache-control":"no-store", "x-content-type-options":"nosniff", "referrer-policy":"no-referrer", ...extra } });
}
function hex(bytes: Uint8Array): string { return Array.from(bytes,b=>b.toString(16).padStart(2,"0")).join(""); }
function randomHex(n: number): string { const b=new Uint8Array(n); crypto.getRandomValues(b); return hex(b); }
async function hash(s: string): Promise<string> { return hex(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s)))); }
function cookie(req: Request,name="mw_owner_session"): string|null { for (const part of (req.headers.get("cookie")??"").split(";")) { const [k,...v]=part.trim().split("="); if(k===name) return v.join("=")||null; } return null; }
function sameOrigin(req: Request,url: URL): boolean { return req.headers.get("origin")===url.origin; }
async function body(req: Request): Promise<Record<string,unknown>|null> { if(Number(req.headers.get("content-length")??"0")>4096)return null; try { const s=await req.text(); if(s.length>4096)return null; const x=JSON.parse(s); return x&&typeof x==="object"&&!Array.isArray(x)?x:null; } catch{return null;} }
async function session(req: Request,env: Env) {
  const token=cookie(req); if(!token||!/^[0-9a-f]{64}$/.test(token))return null;
  const now=new Date().toISOString(), row=await env.DB.prepare("SELECT id,wallet_address,chain_id FROM wallet_sessions WHERE token_hash=? AND revoked_at IS NULL AND expires_at>?").bind(await hash(token),now).first<{id:string;wallet_address:string;chain_id:number}>();
  if(!row)return null; await env.DB.prepare("UPDATE wallet_sessions SET last_seen_at=? WHERE id=?").bind(now,row.id).run();
  return {wallet:row.wallet_address,chainId:row.chain_id};
}
export default { async fetch(request: Request,env: Env): Promise<Response> {
  const url=new URL(request.url);
  if(request.method==="GET"&&url.pathname==="/health")return json({service:"mainwell",status:"ok",database:"configured",timestamp:new Date().toISOString()});
  if(request.method==="GET"&&url.pathname==="/api/health/db")try{
    const db=await env.DB.prepare("SELECT 1 AS ok").first<{ok:number}>();
    const schema=await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='recovery_grants'").first<{name:string}>();
    const auth=await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='wallet_sessions'").first<{name:string}>();
    return json({service:"mainwell",database:db?.ok===1?"connected":"unavailable",schema:schema?"initialized":"pending",walletAuthSchema:auth?"initialized":"pending",timestamp:new Date().toISOString()},db?.ok===1?200:503);
  }catch{return json({service:"mainwell",database:"unavailable",error:"Database health check failed"},503);}
  if(url.pathname==="/api/auth/challenge"&&request.method==="POST"){
    if(!sameOrigin(request,url))return json({error:"Origin check failed."},403);
    const b=await body(request),address=typeof b?.address==="string"?b.address:"",chainId=Number(b?.chainId);
    if(!ADDRESS.test(address)||!Number.isSafeInteger(chainId)||!CHAINS.has(chainId))return json({error:"Valid EVM address and supported chain ID required."},400);
    const now=Date.now(),issued=new Date(now).toISOString(),expires=new Date(now+CHALLENGE_SECONDS*1000).toISOString(),nonce=randomHex(16);
    const message=[url.hostname+" wants you to sign in with your Ethereum account:",address,"","Sign in to Mainwell. This request will not trigger a blockchain transaction or grant token permissions.","","URI: "+url.origin,"Version: 1","Chain ID: "+chainId,"Nonce: "+nonce,"Issued At: "+issued,"Expiration Time: "+expires].join("\n");
    await env.DB.prepare("INSERT INTO wallet_auth_challenges(nonce,wallet_address,chain_id,message,origin,expires_at,created_at) VALUES(?,?,?,?,?,?,?)").bind(nonce,address.toLowerCase(),chainId,message,url.origin,expires,issued).run();
    await env.DB.prepare("DELETE FROM wallet_auth_challenges WHERE expires_at<=? OR consumed_at IS NOT NULL").bind(issued).run();
    return json({nonce,message,expiresAt:expires});
  }
  if(url.pathname==="/api/auth/verify"&&request.method==="POST"){
    if(!sameOrigin(request,url))return json({error:"Origin check failed."},403);
    const b=await body(request),address=typeof b?.address==="string"?b.address:"",nonce=typeof b?.nonce==="string"?b.nonce:"",signature=typeof b?.signature==="string"?b.signature:"",chainId=Number(b?.chainId);
    if(!ADDRESS.test(address)||!/^[0-9a-f]{32}$/.test(nonce)||!Number.isSafeInteger(chainId)||!CHAINS.has(chainId)||!/^0x[0-9a-fA-F]{130}$/.test(signature))return json({error:"Malformed wallet authentication request."},400);
    const c=await env.DB.prepare("SELECT message,wallet_address,chain_id,origin,expires_at,consumed_at FROM wallet_auth_challenges WHERE nonce=?").bind(nonce).first<{message:string;wallet_address:string;chain_id:number;origin:string;expires_at:string;consumed_at:string|null}>();
    const now=new Date().toISOString();
    if(!c||c.consumed_at||c.expires_at<=now||c.origin!==url.origin||c.wallet_address!==address.toLowerCase()||c.chain_id!==chainId)return json({error:"Challenge invalid, expired, or already used. Request a new one."},401);
    let recovered:string; try{recovered=recoverPersonalSignAddress(c.message,signature);}catch{return json({error:"Wallet signature verification failed."},401);}
    if(recovered!==c.wallet_address)return json({error:"Wallet signature does not match the challenged address."},401);
    const used=await env.DB.prepare("UPDATE wallet_auth_challenges SET consumed_at=? WHERE nonce=? AND consumed_at IS NULL AND expires_at>?").bind(now,nonce,now).run();
    if(!used.success||(used.meta?.changes??0)!==1)return json({error:"Challenge already consumed. Request a new one."},409);
    const token=randomHex(32),id=crypto.randomUUID(),expires=new Date(Date.now()+SESSION_SECONDS*1000).toISOString();
    await env.DB.prepare("INSERT INTO wallet_sessions(id,wallet_address,chain_id,token_hash,expires_at,created_at,last_seen_at) VALUES(?,?,?,?,?,?,?)").bind(id,c.wallet_address,chainId,await hash(token),expires,now,now).run();
    await env.DB.prepare("INSERT INTO audit_events(actor_type,actor_id,action,target_type,target_id,metadata_json,created_at) VALUES('owner',?,'wallet.login','wallet_session',?,?,?)").bind(c.wallet_address,id,JSON.stringify({chainId}),now).run();
    return json({authenticated:true,wallet:c.wallet_address,chainId,expiresAt:expires},200,{"set-cookie":"mw_owner_session="+token+"; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age="+SESSION_SECONDS});
  }
  if(url.pathname==="/api/auth/me"&&request.method==="GET"){const s=await session(request,env);return s?json({authenticated:true,...s}):json({authenticated:false},401);}
  if(url.pathname.startsWith("/api/admin/")){
    const token=cookie(request,"mw_admin_session");
    if(!token||!/^[0-9a-f]{64}$/.test(token))return json({error:"MFA-verified administrator session required."},401);
    const now=new Date().toISOString(),mfaCutoff=new Date(Date.now()-12*60*60*1000).toISOString();
    const admin=await env.DB.prepare("SELECT s.id,s.admin_id FROM admin_sessions s INNER JOIN admin_accounts a ON a.id=s.admin_id WHERE s.token_hash=? AND s.expires_at>? AND s.mfa_verified_at>? AND a.status='active' AND a.mfa_enabled=1 LIMIT 1").bind(await hash(token),now,mfaCutoff).first<{id:string;admin_id:string}>();
    if(!admin)return json({error:"MFA-verified administrator session required."},401);
    await env.DB.prepare("UPDATE admin_sessions SET last_seen_at=? WHERE id=?").bind(now,admin.id).run();
    const response=await handleAdminDestinationApi(request,env,{id:admin.id,adminId:admin.admin_id});
    if(response)return response;
    return json({error:"Not found"},404);
  }
  if(url.pathname.startsWith("/api/owner/")){
    const authenticated = await session(request,env);
    if(!authenticated)return json({error:"Authentication required."},401);
    const response = await handleOwnerApi(request,env,authenticated);
    if(response)return response;
  }
  if(url.pathname==="/api/auth/logout"&&request.method==="POST"){
    if(!sameOrigin(request,url))return json({error:"Origin check failed."},403);
    const token=cookie(request);if(token&&/^[0-9a-f]{64}$/.test(token))await env.DB.prepare("UPDATE wallet_sessions SET revoked_at=? WHERE token_hash=? AND revoked_at IS NULL").bind(new Date().toISOString(),await hash(token)).run();
    return json({authenticated:false},200,{"set-cookie":"mw_owner_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0"});
  }
  return json({error:"Not found"},404);
}};

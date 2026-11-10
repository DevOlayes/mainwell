import { recoverPersonalSignAddress } from "./adapters/evm-signature";
import { handleOwnerApi, type OwnerApiEnv } from "./application/owner-api";
import { handleAdminDestinationApi } from "./application/admin-destination-api";
import { handleAdminAuthApi } from "./application/admin-auth";
import { adminRecoveryPageResponse, handleAdminRecoveryApi } from "./application/admin-recovery";
import { adminDashboardResponse } from "./application/admin-dashboard";
import { ownerDashboardResponse } from "./application/owner-dashboard";
import { ownerAuthorizationResponse } from "./application/owner-authorization";
import { operatorWalletSetupResponse } from "./application/operator-wallet-setup";
import { adminDiagnosticsResponse } from "./application/admin-diagnostics";
import { runRecoveryAutomation } from "./application/recovery-engine";
import { runtimeReadiness, runtimeSettingsResponse, updateRuntimeSetting } from "./application/runtime-controls";
import { runScheduledWalletMonitoring, monitoringDashboardData, monitoringDashboardResponse } from "./application/monitoring-service";
interface D1Result<T = Record<string, unknown>> { success: boolean; results: T[]; meta?: { changes?: number } }
interface D1Statement { bind(...values: unknown[]): D1Statement; first<T = Record<string, unknown>>(): Promise<T | null>; all<T = Record<string, unknown>>(): Promise<D1Result<T>>; run<T = Record<string, unknown>>(): Promise<D1Result<T>> }
interface D1Database { prepare(query: string): D1Statement; batch<T = unknown>(statements: D1Statement[]): Promise<D1Result<T>[]> }
interface Env extends OwnerApiEnv { ALCHEMY_API_KEY?: string; MAINWELL_EVM_ASSETS?: string; ADMIN_MFA_ENCRYPTION_KEY?: string; MAINWELL_ADMIN_BOOTSTRAP_TOKEN?: string; MAINWELL_ADMIN_PRIVATE_KEY?: string; MAINWELL_AUTOMATION_PRIVATE_KEY?: string; MAINWELL_EXECUTION_ENABLED?: string; MAINWELL_AUTOMATION_ENABLED?: string; MAINWELL_MAX_RECOVERY_FEE_WEI?: string; MAINWELL_SPONSOR_RESERVE_WEI?: string }
const SESSION_SECONDS = 604800, CHALLENGE_SECONDS = 300;
const CHAINS = new Set([1, 137, 56, 43114, 42161, 10, 8453]);
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
function json(data: unknown, status = 200, extra: Record<string,string> = {}): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type":"application/json; charset=utf-8", "cache-control":"no-store", "x-content-type-options":"nosniff", "referrer-policy":"no-referrer", ...extra } });
}
function hex(bytes: Uint8Array): string { return Array.from(bytes,b=>b.toString(16).padStart(2,"0")).join(""); }
function randomHex(n: number): string { const b=new Uint8Array(n); crypto.getRandomValues(b); return hex(b); }
async function hash(s: string): Promise<string> { return hex(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s)))); }
async function walletAuthRateLimit(request: Request, env: Env): Promise<boolean> {
  const ip=request.headers.get("cf-connecting-ip")??"unknown";
  const identifierHash=await hash("mainwell-wallet-auth|"+ip);
  const epoch=Math.floor(Date.now()/1000);
  try {
    await env.DB.prepare("INSERT INTO wallet_auth_rate_limits(identifier_hash,attempts,window_started_at,locked_until) VALUES(?,1,?,0) ON CONFLICT(identifier_hash) DO UPDATE SET attempts=CASE WHEN ?-window_started_at>600 THEN 1 ELSE attempts+1 END,window_started_at=CASE WHEN ?-window_started_at>600 THEN ? ELSE window_started_at END,locked_until=CASE WHEN (CASE WHEN ?-window_started_at>600 THEN 1 ELSE attempts+1 END)>=30 THEN ?+600 ELSE locked_until END")
      .bind(identifierHash,epoch,epoch,epoch,epoch,epoch,epoch).run();
    const row=await env.DB.prepare("SELECT locked_until FROM wallet_auth_rate_limits WHERE identifier_hash=?").bind(identifierHash).first<{locked_until:number}>();
    return !!row && row.locked_until<=epoch;
  } catch {
    // Authentication throttling fails closed if its persistence layer is unavailable.
    return false;
  }
}
function cookie(req: Request,name="mw_owner_session"): string|null { for (const part of (req.headers.get("cookie")??"").split(";")) { const [k,...v]=part.trim().split("="); if(k===name) return v.join("=")||null; } return null; }
function sameOrigin(req: Request,url: URL): boolean { return req.headers.get("origin")===url.origin; }
async function body(req: Request): Promise<Record<string,unknown>|null> { if(Number(req.headers.get("content-length")??"0")>4096)return null; try { const s=await req.text(); if(s.length>4096)return null; const x=JSON.parse(s); return x&&typeof x==="object"&&!Array.isArray(x)?x:null; } catch{return null;} }
async function session(req: Request,env: Env) {
  const token=cookie(req); if(!token||!/^[0-9a-f]{64}$/.test(token))return null;
  const now=new Date().toISOString(), row=await env.DB.prepare("SELECT id,wallet_address,chain_id FROM wallet_sessions WHERE token_hash=? AND revoked_at IS NULL AND expires_at>?").bind(await hash(token),now).first<{id:string;wallet_address:string;chain_id:number}>();
  if(!row)return null; await env.DB.prepare("UPDATE wallet_sessions SET last_seen_at=? WHERE id=?").bind(now,row.id).run();
  return {wallet:row.wallet_address,chainId:row.chain_id};
}
export default { async scheduled(_event: {cron:string},env:Env,ctx:{waitUntil(promise:Promise<unknown>):void}):Promise<void> { ctx.waitUntil(Promise.allSettled([runScheduledWalletMonitoring(env), runRecoveryAutomation(env)])); }, async fetch(request: Request,env: Env): Promise<Response> {
  const url=new URL(request.url);
  if(request.method==="GET"&&url.pathname==="/admin")return adminDashboardResponse();
  if(request.method==="GET"&&url.pathname==="/admin/monitoring")return monitoringDashboardResponse();
  if(request.method==="GET"&&url.pathname==="/admin/diagnostics")return adminDiagnosticsResponse();
  if(request.method==="GET"&&url.pathname==="/admin/recover-once")return adminRecoveryPageResponse(env);
  if(request.method==="GET"&&url.pathname==="/admin/operators")return operatorWalletSetupResponse();
  if(request.method==="GET"&&url.pathname==="/")return ownerDashboardResponse();
  if(request.method==="GET"&&url.pathname==="/authorize")return ownerAuthorizationResponse();
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
    if(!(await walletAuthRateLimit(request,env)))return json({error:"Too many wallet authentication requests. Try again in ten minutes."},429,{"retry-after":"600"});
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
    if(!(await walletAuthRateLimit(request,env)))return json({error:"Too many wallet authentication requests. Try again in ten minutes."},429,{"retry-after":"600"});
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
  if(url.pathname==="/api/admin/auth/recover-once"){
    const recoveryResponse=await handleAdminRecoveryApi(request,env);
    if(recoveryResponse)return recoveryResponse;
  }
  if(url.pathname.startsWith("/api/admin/auth/")){
    const authResponse=await handleAdminAuthApi(request,env);
    if(authResponse)return authResponse;
  }
  if(url.pathname.startsWith("/api/admin/")){
    const token=cookie(request,"mw_admin_session");
    if(!token||!/^[0-9a-f]{64}$/.test(token))return json({error:"MFA-verified administrator session required."},401);
    const now=new Date().toISOString(),mfaCutoff=new Date(Date.now()-12*60*60*1000).toISOString();
    const admin=await env.DB.prepare("SELECT s.id,s.admin_id FROM admin_sessions s INNER JOIN admin_accounts a ON a.id=s.admin_id WHERE s.token_hash=? AND s.expires_at>? AND s.mfa_verified_at>? AND a.status='active' AND a.mfa_enabled=1 LIMIT 1").bind(await hash(token),now,mfaCutoff).first<{id:string;admin_id:string}>();
    if(!admin)return json({error:"MFA-verified administrator session required."},401);
    await env.DB.prepare("UPDATE admin_sessions SET last_seen_at=? WHERE id=?").bind(now,admin.id).run();
    const limitValue=Number(url.searchParams.get("limit")??"50"),limit=Number.isInteger(limitValue)?Math.min(100,Math.max(1,limitValue)):50;
    if(request.method==="GET"&&url.pathname==="/api/admin/monitoring")return json(await monitoringDashboardData(env));
    if(request.method==="GET"&&url.pathname==="/api/admin/audit-logs"){
      const rows=await env.DB.prepare("SELECT id,actor_type,actor_id,action,target_type,target_id,metadata_json,created_at FROM audit_events ORDER BY created_at DESC,id DESC LIMIT ?").bind(limit).all<Record<string,unknown>>();
      return rows.success?json({events:rows.results}):json({error:"Unable to load audit events."},503);
    }
    if(request.method==="GET"&&url.pathname==="/api/admin/recovery-jobs"){
      const rows=await env.DB.prepare("SELECT id,grant_id,asset_id,execution_mode,status,priority_score,requested_by,created_at,updated_at,requested_amount_raw,destination_address,attempt_count,last_error_code FROM recovery_jobs ORDER BY created_at DESC,id DESC LIMIT ?").bind(limit).all<Record<string,unknown>>();
      return rows.success?json({jobs:rows.results}):json({error:"Unable to load recovery jobs."},503);
    }
    if(request.method==="GET"&&url.pathname==="/api/admin/transactions"){
      const rows=await env.DB.prepare("SELECT id,job_id,network,transaction_hash,status,asset_id,amount_raw,destination_address,estimated_fee_raw,actual_fee_raw,submitted_at,confirmed_at,created_at,sender_address,nonce,gas_limit_raw,max_fee_per_gas_raw,max_priority_fee_per_gas_raw,block_number,block_hash,gas_used_raw,effective_gas_price_raw,failure_code,destination_balance_before_raw,destination_balance_after_raw,last_checked_at FROM recovery_transactions ORDER BY created_at DESC,id DESC LIMIT ?").bind(limit).all<Record<string,unknown>>();
      return rows.success?json({transactions:rows.results}):json({error:"Unable to load transaction records."},503);
    }
    if(request.method==="GET"&&url.pathname==="/api/admin/runtime-settings")return runtimeSettingsResponse(env);
    if(url.pathname==="/api/admin/runtime-settings"&&request.method==="PUT")return updateRuntimeSetting(request,env,{id:admin.id,adminId:admin.admin_id});
    if(request.method==="GET"&&url.pathname==="/api/admin/runtime-readiness")return runtimeReadiness(env);
    if(request.method==="GET"&&url.pathname==="/api/admin/settings"){
      return json({
        databaseConfigured:Boolean(env.DB),
        adminMfaEncryptionKeyConfigured:Boolean(env.ADMIN_MFA_ENCRYPTION_KEY),
        bootstrapTokenConfigured:Boolean(env.MAINWELL_ADMIN_BOOTSTRAP_TOKEN),
        adminOperatorAddressConfigured:Boolean(env.MAINWELL_ADMIN_OPERATOR),
        automationOperatorAddressConfigured:Boolean(env.MAINWELL_AUTOMATION_OPERATOR),
        adminPrivateKeyConfigured:Boolean(env.MAINWELL_ADMIN_PRIVATE_KEY),
        automationPrivateKeyConfigured:Boolean(env.MAINWELL_AUTOMATION_PRIVATE_KEY),
        rpcNetworks:{ethereum:Boolean(env.EVM_RPC_ETHEREUM),polygon:Boolean(env.EVM_RPC_POLYGON),bsc:Boolean(env.EVM_RPC_BSC),avalanche:Boolean(env.EVM_RPC_AVALANCHE),arbitrum:Boolean(env.EVM_RPC_ARBITRUM),optimism:Boolean(env.EVM_RPC_OPTIMISM),base:Boolean(env.EVM_RPC_BASE)},
        executionEnabled:env.MAINWELL_EXECUTION_ENABLED==="true",
        automationEnabled:env.MAINWELL_AUTOMATION_ENABLED==="true",
        maxRecoveryFeeConfigured:Boolean(env.MAINWELL_MAX_RECOVERY_FEE_WEI),
        sponsorReserveConfigured:Boolean(env.MAINWELL_SPONSOR_RESERVE_WEI)
      });
    }
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

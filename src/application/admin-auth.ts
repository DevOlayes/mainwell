import type { OwnerApiEnv } from "./owner-api";
interface Stmt { bind(...v:unknown[]):Stmt; first<T=Record<string,unknown>>():Promise<T|null>; run<T=Record<string,unknown>>():Promise<{success:boolean;meta?:{changes?:number}}> }
interface DB { prepare(sql:string):Stmt }
interface AdminAuthEnv extends OwnerApiEnv { ADMIN_MFA_ENCRYPTION_KEY?: string }
const SESSION_SECONDS=8*60*60;
function json(data:unknown,status=200,headers:Record<string,string>={}):Response{return new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff","referrer-policy":"no-referrer",...headers}});}
function b64(s:string):Uint8Array{const raw=atob(s);return Uint8Array.from(raw,c=>c.charCodeAt(0));}
function hex(b:Uint8Array):string{return Array.from(b,x=>x.toString(16).padStart(2,"0")).join("");}
function randomHex(n:number):string{const b=new Uint8Array(n);crypto.getRandomValues(b);return hex(b);}
async function sha(s:string):Promise<string>{return hex(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s))));}
function sameOrigin(req:Request,url:URL):boolean{return req.headers.get("origin")===url.origin;}
async function read(req:Request):Promise<Record<string,unknown>|null>{try{if(Number(req.headers.get("content-length")??"0")>4096)return null;const raw=await req.text();if(raw.length>4096)return null;const v:unknown=JSON.parse(raw);return v&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:null;}catch{return null;}}
function cookie(req:Request):string|null{for(const p of (req.headers.get("cookie")??"").split(";")){const [k,...v]=p.trim().split("=");if(k==="mw_admin_session")return v.join("=")||null;}return null;}
function equal(a:Uint8Array,b:Uint8Array):boolean{if(a.length!==b.length)return false;let d=0;for(let i=0;i<a.length;i++)d|=a[i]^b[i];return d===0;}
export async function verifyAdminPassword(stored:string,password:string):Promise<boolean>{
 const p=stored.split("$");if(p.length!==4||p[0]!=="pbkdf2-sha256")return false;
 const iterations=Number(p[1]);if(!Number.isInteger(iterations)||iterations<100000||iterations>600000)return false;
 try{const salt=b64(p[2]),expected=b64(p[3]);if(salt.length<16||expected.length!==32)return false;
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(password),"PBKDF2",false,["deriveBits"]);
  const bits=await crypto.subtle.deriveBits({name:"PBKDF2",hash:"SHA-256",salt,iterations},key,256);
  return equal(new Uint8Array(bits),expected);
 }catch{return false;}
}
function base32(s:string):Uint8Array{
 const alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";let bits=0,value=0;const out:number[]=[];
 for(const ch of s.toUpperCase().replace(/=+$/,"").replace(/\s/g,"")){const n=alphabet.indexOf(ch);if(n<0)throw new Error("Invalid TOTP secret.");value=(value<<5)|n;bits+=5;if(bits>=8){out.push((value>>(bits-8))&255);bits-=8;value&=(1<<bits)-1;}}
 return new Uint8Array(out);
}
async function decryptTotpSecret(ciphertext:string,keyText:string):Promise<Uint8Array>{
 const p=ciphertext.split(":");if(p.length!==3||p[0]!=="v1")throw new Error("Invalid encrypted MFA secret.");
 const keyBytes=b64(keyText);if(keyBytes.length!==32)throw new Error("MFA encryption key must be 32 bytes.");
 const key=await crypto.subtle.importKey("raw",keyBytes,{name:"AES-GCM"},false,["decrypt"]);
 const clear=await crypto.subtle.decrypt({name:"AES-GCM",iv:b64(p[1])},key,b64(p[2]));
 return base32(new TextDecoder().decode(clear));
}
export async function verifyTotp(secret:Uint8Array,code:string,now=Date.now()):Promise<boolean>{
 if(!/^\d{6}$/.test(code))return false;
 const key=await crypto.subtle.importKey("raw",secret,{name:"HMAC",hash:"SHA-1"},false,["sign"]);
 const counter=Math.floor(now/30000);
 for(let offset=-1;offset<=1;offset++){
  const msg=new Uint8Array(8),n=BigInt(counter+offset);for(let i=7;i>=0;i--)msg[i]=Number((n>>BigInt((7-i)*8))&255n);
  const mac=new Uint8Array(await crypto.subtle.sign("HMAC",key,msg)),idx=mac[mac.length-1]&15;
  const bin=((mac[idx]&127)<<24)|(mac[idx+1]<<16)|(mac[idx+2]<<8)|mac[idx+3];
  if(String(bin%1000000).padStart(6,"0")===code)return true;
 }
 return false;
}
export async function handleAdminAuthApi(request:Request,env:AdminAuthEnv):Promise<Response|null>{
 const url=new URL(request.url),now=new Date().toISOString();
 if(url.pathname==="/api/admin/auth/login"&&request.method==="POST"){
  if(!sameOrigin(request,url))return json({error:"Origin check failed."},403);
  const b=await read(request),email=typeof b?.email==="string"?b.email.trim().toLowerCase():"",password=typeof b?.password==="string"?b.password:"",otp=typeof b?.otp==="string"?b.otp:"";
  if(email.length>254||password.length>1024||!/^\S+@\S+\.\S+$/.test(email))return json({error:"Invalid administrator credentials."},401);
  const account=await env.DB.prepare("SELECT id,password_hash,mfa_enabled,mfa_secret_ciphertext,status FROM admin_accounts WHERE email=? COLLATE NOCASE LIMIT 1").bind(email).first<{id:string;password_hash:string;mfa_enabled:number;mfa_secret_ciphertext:string|null;status:string}>();
  if(!account||account.status!=="active"||account.mfa_enabled!==1||!account.mfa_secret_ciphertext||!env.ADMIN_MFA_ENCRYPTION_KEY||!(await verifyAdminPassword(account.password_hash,password)))return json({error:"Invalid administrator credentials or MFA configuration."},401);
  let valid=false;try{const secret=await decryptTotpSecret(account.mfa_secret_ciphertext,env.ADMIN_MFA_ENCRYPTION_KEY);valid=await verifyTotp(secret,otp);}catch{return json({error:"Administrator MFA is not configured correctly."},503);}
  if(!valid)return json({error:"Invalid administrator credentials or MFA code."},401);
  const token=randomHex(32),id=crypto.randomUUID(),expires=new Date(Date.now()+SESSION_SECONDS*1000).toISOString();
  const saved=await env.DB.prepare("INSERT INTO admin_sessions(id,admin_id,token_hash,mfa_verified_at,expires_at,created_at,last_seen_at) VALUES(?,?,?,?,?,?,?)").bind(id,account.id,await sha(token),now,expires,now,now).run();
  if(!saved.success)return json({error:"Unable to create administrator session."},503);
  await env.DB.prepare("INSERT INTO audit_events(actor_type,actor_id,action,target_type,target_id,metadata_json,created_at) VALUES('admin',?,'admin.login','admin_session',?,'{}',?)").bind(account.id,id,now).run();
  return json({authenticated:true,mfaVerified:true,expiresAt:expires},200,{"set-cookie":"mw_admin_session="+token+"; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age="+SESSION_SECONDS});
 }
 if(url.pathname==="/api/admin/auth/logout"&&request.method==="POST"){
  if(!sameOrigin(request,url))return json({error:"Origin check failed."},403);
  const token=cookie(request);if(token&&/^[0-9a-f]{64}$/.test(token))await env.DB.prepare("DELETE FROM admin_sessions WHERE token_hash=?").bind(await sha(token)).run();
  return json({authenticated:false},200,{"set-cookie":"mw_admin_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0"});
 }
 if(url.pathname==="/api/admin/auth/me"&&request.method==="GET"){
  const token=cookie(request);if(!token||!/^[0-9a-f]{64}$/.test(token))return json({authenticated:false},401);
  const cutoff=new Date(Date.now()-12*60*60*1000).toISOString();
  const row=await env.DB.prepare("SELECT a.email,s.expires_at,s.mfa_verified_at FROM admin_sessions s INNER JOIN admin_accounts a ON a.id=s.admin_id WHERE s.token_hash=? AND s.expires_at>? AND s.mfa_verified_at>? AND a.status='active' AND a.mfa_enabled=1 LIMIT 1").bind(await sha(token),now,cutoff).first<{email:string;expires_at:string;mfa_verified_at:string}>();
  return row?json({authenticated:true,email:row.email,mfaVerifiedAt:row.mfa_verified_at,expiresAt:row.expires_at}):json({authenticated:false},401);
 }
 return null;
}

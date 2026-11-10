import type { NetworkId } from "../domain/types";

interface Statement {
  bind(...values: unknown[]): Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{success:boolean;results:T[]}>;
  run(): Promise<{success:boolean;meta?:{changes?:number}}>;
}
interface Database { prepare(sql:string):Statement; }
export interface MonitoringEnv {
  DB: Database;
  MORALIS_API_KEY?: string;
  EVM_RPC_ETHEREUM?:string; EVM_RPC_POLYGON?:string; EVM_RPC_BSC?:string;
  EVM_RPC_AVALANCHE?:string; EVM_RPC_ARBITRUM?:string; EVM_RPC_OPTIMISM?:string; EVM_RPC_BASE?:string;
}
const CHAINS: Record<string,{chainId:number; moralis:string; nativeSymbol:string; nativeName:string; priceId:string; rpc:keyof MonitoringEnv}> = {
  ethereum:{chainId:1,moralis:"0x1",nativeSymbol:"ETH",nativeName:"Ether",priceId:"ethereum",rpc:"EVM_RPC_ETHEREUM"},
  polygon:{chainId:137,moralis:"0x89",nativeSymbol:"POL",nativeName:"Polygon Ecosystem Token",priceId:"polygon-ecosystem-token",rpc:"EVM_RPC_POLYGON"},
  bsc:{chainId:56,moralis:"0x38",nativeSymbol:"BNB",nativeName:"BNB",priceId:"binancecoin",rpc:"EVM_RPC_BSC"},
  avalanche:{chainId:43114,moralis:"0xa86a",nativeSymbol:"AVAX",nativeName:"Avalanche",priceId:"avalanche-2",rpc:"EVM_RPC_AVALANCHE"},
  arbitrum:{chainId:42161,moralis:"0xa4b1",nativeSymbol:"ETH",nativeName:"Ether",priceId:"ethereum",rpc:"EVM_RPC_ARBITRUM"},
  optimism:{chainId:10,moralis:"0xa",nativeSymbol:"ETH",nativeName:"Ether",priceId:"ethereum",rpc:"EVM_RPC_OPTIMISM"},
  base:{chainId:8453,moralis:"0x2105",nativeSymbol:"ETH",nativeName:"Ether",priceId:"ethereum",rpc:"EVM_RPC_BASE"}
};
type Token = {token_address?:string;address?:string;name?:string;symbol?:string;decimals?:string|number;balance?:string;balance_formatted?:string;usd_price?:number;usdPrice?:number;possible_spam?:boolean};
type Approval = {token_address?:string;tokenAddress?:string;spender?:string;spender_address?:string;allowance?:string;value?:string};
function validAddress(v:unknown):v is string { return typeof v==="string" && /^0x[0-9a-fA-F]{40}$/.test(v); }
function safeDecimals(v:unknown):number { const n=Number(v); return Number.isInteger(n)&&n>=0&&n<=36?n:18; }
function amountDisplay(raw:string,decimals:number):string { const n=BigInt(raw),base=10n**BigInt(decimals),whole=n/base,frac=(n%base).toString().padStart(decimals,"0").replace(/0+$/,"");return frac?whole+"."+frac:whole.toString(); }
function usdAmount(raw:string,decimals:number,price:number):number { const n=Number(amountDisplay(raw,decimals))*price;return Number.isFinite(n)&&n>=0?n:0; }
async function timedFetch(url:string,init:RequestInit={},timeoutMs=9000):Promise<Response>{
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{return await fetch(url,{...init,signal:controller.signal});}finally{clearTimeout(timer);}
}
async function moralis<T>(path:string,key:string):Promise<T>{
  const response=await timedFetch("https://deep-index.moralis.io/api/v2.2"+path,{headers:{"X-API-Key":key,"accept":"application/json"}});
  if(!response.ok)throw new Error("MORALIS_HTTP_"+response.status);
  return await response.json() as T;
}
async function nativePriceUsd(id:string):Promise<number|null>{
  try{
    const response=await timedFetch("https://api.coingecko.com/api/v3/simple/price?ids="+encodeURIComponent(id)+"&vs_currencies=usd&include_last_updated_at=true");
    if(!response.ok)return null;
    const data=await response.json() as Record<string,{usd?:number;last_updated_at?:number}>;
    const item=data[id],now=Math.floor(Date.now()/1000);
    return item&&Number.isFinite(item.usd)&&Number(item.usd)>0&&Number.isFinite(item.last_updated_at)&&now-Number(item.last_updated_at)<=300&&now>=Number(item.last_updated_at)-60?Number(item.usd):null;
  }catch{return null;}
}
async function tokenPrice(chain:string,address:string,key:string):Promise<number|null>{
  try{
    const data=await moralis<Record<string,unknown>>("/erc20/"+address+"/price?chain="+chain,key);
    const price=Number(data.usdPrice??data.usd_price??data.usdPriceFormatted);
    return Number.isFinite(price)&&price>0?price:null;
  }catch{return null;}
}
async function rpcNativeBalance(url:string,address:string):Promise<string>{
  const response=await timedFetch(url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"eth_getBalance",params:[address,"latest"]})});
  if(!response.ok)throw new Error("RPC_HTTP_"+response.status);
  const data=await response.json() as {result?:string;error?:{message:string}};
  if(data.error||!data.result||!/^0x[0-9a-fA-F]+$/.test(data.result))throw new Error("RPC_NATIVE_BALANCE_FAILED");
  return BigInt(data.result).toString();
}
async function discoverApprovals(address:string,chain:string,key:string):Promise<Approval[]>{
  const data=await moralis<{result?:Approval[]}|Approval[]>("/wallets/"+address+"/approvals?chain="+chain,key);
  return Array.isArray(data)?data:Array.isArray(data.result)?data.result:[];
}
async function persistPermission(env:MonitoringEnv,wallet:{id:string;network:string},approval:Approval,now:string):Promise<void>{
  const token=approval.token_address??approval.tokenAddress,spender=approval.spender_address??approval.spender;
  if(!validAddress(token)||!validAddress(spender))return;
  const allowance=String(approval.allowance??approval.value??"0");
  if(!/^\d+$/.test(allowance))return;
  const previous=await env.DB.prepare("SELECT allowance_raw,status,first_seen_at FROM wallet_permissions WHERE wallet_id=? AND network=? AND token_address=? AND spender_address=?")
    .bind(wallet.id,wallet.network,token.toLowerCase(),spender.toLowerCase()).first<{allowance_raw:string;status:string;first_seen_at:string}>();
  const status=BigInt(allowance)>0n?"active":"revoked";
  const change=!previous?"discovered":previous.allowance_raw!==allowance?(status==="revoked"?"revoked":"allowance_changed"):previous.status!==status?(status==="revoked"?"revoked":"reapproved"):null;
  await env.DB.prepare(`
    INSERT INTO wallet_permissions(id,wallet_id,network,token_address,spender_address,allowance_raw,status,first_seen_at,last_seen_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(wallet_id,network,token_address,spender_address) DO UPDATE SET
      allowance_raw=excluded.allowance_raw,status=excluded.status,last_seen_at=excluded.last_seen_at,updated_at=excluded.updated_at
  `).bind(crypto.randomUUID(),wallet.id,wallet.network,token.toLowerCase(),spender.toLowerCase(),allowance,status,previous?.first_seen_at??now,now,now).run();
  if(change)await env.DB.prepare("INSERT INTO wallet_permission_history(id,wallet_id,network,token_address,spender_address,allowance_raw,status,change_kind,observed_at) VALUES(?,?,?,?,?,?,?,?,?)")
    .bind(crypto.randomUUID(),wallet.id,wallet.network,token.toLowerCase(),spender.toLowerCase(),allowance,status,change,now).run();
}
async function runWallet(env:MonitoringEnv,wallet:{id:string;address:string;network:string;chain_id:number|null}):Promise<void>{
  const started=new Date().toISOString(),cfg=CHAINS[wallet.network],now=()=>new Date().toISOString();
  if(!cfg||wallet.chain_id!==cfg.chainId)throw new Error("WALLET_NETWORK_CHAIN_MISMATCH");
  const rpc=env[cfg.rpc];if(typeof rpc!=="string"||!rpc.startsWith("https://"))throw new Error("RPC_NOT_CONFIGURED");
  if(!env.MORALIS_API_KEY)throw new Error("MORALIS_API_KEY_NOT_CONFIGURED");
  const key=env.MORALIS_API_KEY;
  const [nativeRaw,tokenPayload,nativeUsd]=await Promise.all([
    rpcNativeBalance(rpc,wallet.address),
    moralis<Token[]|{result?:Token[]}>("/"+wallet.address+"/erc20?chain="+cfg.moralis+"&exclude_spam=true",key),
    nativePriceUsd(cfg.priceId)
  ]);
  const tokens=Array.isArray(tokenPayload)?tokenPayload:(tokenPayload.result??[]);
  if(tokens.length>150)throw new Error("TOKEN_DISCOVERY_RESULT_LIMIT_EXCEEDED");
  const observedAt=now();
  const assets:Array<{ref:string;address:string|null;symbol:string;name:string;raw:string;decimals:number;price:number|null;confidence:number;source:string;verified:number}>=[];
  assets.push({ref:wallet.network+":native",address:null,symbol:cfg.nativeSymbol,name:cfg.nativeName,raw:nativeRaw,decimals:18,price:nativeUsd,confidence:nativeUsd?0.8:0,source:"rpc",verified:1});
  const seen=new Set<string>();
  for(const token of tokens){
    const address=token.token_address??token.address;
    if(!validAddress(address))continue;
    const lower=address.toLowerCase();if(seen.has(lower))continue;seen.add(lower);
    const decimals=safeDecimals(token.decimals),raw=String(token.balance??"");
    if(!/^\d+$/.test(raw))continue;
    const price=Number.isFinite(Number(token.usd_price??token.usdPrice))&&Number(token.usd_price??token.usdPrice)>0?Number(token.usd_price??token.usdPrice):await tokenPrice(cfg.moralis,lower,key);
    const symbol=String(token.symbol??"").slice(0,32)||"UNKNOWN",name=String(token.name??"").slice(0,100)||"Unknown token";
    assets.push({ref:wallet.network+":erc20:"+lower,address:lower,symbol,name,raw,decimals,price,confidence:price?0.8:0,source:"moralis-indexer",verified:0});
  }
  const batchSize=40;
  for(let offset=0;offset<assets.length;offset+=batchSize){
    const batch=assets.slice(offset,offset+batchSize);
    for(const asset of batch){
      const value=asset.price&&asset.price>0?usdAmount(asset.raw,asset.decimals,asset.price):null;
      await env.DB.prepare(`
        INSERT INTO wallet_assets(id,wallet_id,network,asset_ref,token_address,symbol,name,amount_raw,decimals,estimated_value_usd,price_observed_at,valuation_confidence,observed_at,first_seen_at,last_seen_at,lifecycle_status,missing_since,discovery_source,token_verified)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'active',NULL,?,?)
        ON CONFLICT(wallet_id,network,asset_ref) DO UPDATE SET
          token_address=excluded.token_address,symbol=excluded.symbol,name=excluded.name,amount_raw=excluded.amount_raw,
          decimals=excluded.decimals,estimated_value_usd=excluded.estimated_value_usd,
          price_observed_at=excluded.price_observed_at,valuation_confidence=excluded.valuation_confidence,
          observed_at=excluded.observed_at,last_seen_at=excluded.last_seen_at,lifecycle_status='active',missing_since=NULL,
          discovery_source=excluded.discovery_source,token_verified=excluded.token_verified
      `).bind(crypto.randomUUID(),wallet.id,wallet.network,asset.ref,asset.address,asset.symbol,asset.name,asset.raw,asset.decimals,value,asset.price?observedAt:null,asset.confidence||null,observedAt,observedAt,observedAt,asset.source,asset.verified).run();
      await env.DB.prepare("INSERT INTO wallet_asset_history(id,wallet_id,network,asset_ref,token_address,symbol,amount_raw,decimals,estimated_value_usd,price_observed_at,valuation_confidence,lifecycle_status,observed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)")
        .bind(crypto.randomUUID(),wallet.id,wallet.network,asset.ref,asset.address,asset.symbol,asset.raw,asset.decimals,value,asset.price?observedAt:null,asset.confidence||null,"active",observedAt).run();
    }
  }
  const currentRefs=assets.map(a=>a.ref);
  const old=await env.DB.prepare("SELECT asset_ref,token_address,symbol,name,amount_raw,decimals FROM wallet_assets WHERE wallet_id=? AND network=? AND lifecycle_status='active'")
    .bind(wallet.id,wallet.network).all<{asset_ref:string;token_address:string|null;symbol:string;name:string;amount_raw:string;decimals:number}>();
  for(const item of old.results){
    if(currentRefs.includes(item.asset_ref))continue;
    await env.DB.prepare("UPDATE wallet_assets SET lifecycle_status='missing',missing_since=?,last_seen_at=? WHERE wallet_id=? AND network=? AND asset_ref=?")
      .bind(observedAt,observedAt,wallet.id,wallet.network,item.asset_ref).run();
    await env.DB.prepare("INSERT INTO wallet_asset_history(id,wallet_id,network,asset_ref,token_address,symbol,amount_raw,decimals,estimated_value_usd,price_observed_at,valuation_confidence,lifecycle_status,observed_at) SELECT ?,wallet_id,network,asset_ref,token_address,symbol,amount_raw,decimals,estimated_value_usd,price_observed_at,valuation_confidence,'missing',? FROM wallet_assets WHERE wallet_id=? AND network=? AND asset_ref=?")
      .bind(crypto.randomUUID(),observedAt,wallet.id,wallet.network,item.asset_ref).run();
  }
  let permissions:Approval[]=[];
  let permissionPartial=false;
  try{permissions=await discoverApprovals(wallet.address,cfg.moralis,key);for(const approval of permissions)await persistPermission(env,wallet,approval,observedAt);}
  catch{permissionPartial=true;}
  await env.DB.prepare("UPDATE recovery_wallets SET last_monitor_at=?,monitoring_status=?,monitoring_error=? WHERE id=?")
    .bind(observedAt,permissionPartial?"partial":"healthy",permissionPartial?"ALLOWANCE_PROVIDER_UNAVAILABLE":null,wallet.id).run();
  await env.DB.prepare("INSERT INTO wallet_monitoring_runs(id,wallet_id,network,status,discovered_assets,priced_assets,permission_count,error_code,started_at,completed_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
    .bind(crypto.randomUUID(),wallet.id,wallet.network,permissionPartial?"partial":"success",assets.length,assets.filter(a=>a.price!==null).length,permissions.length,permissionPartial?"ALLOWANCE_PROVIDER_UNAVAILABLE":null,started,observedAt).run();
  await env.DB.prepare("INSERT INTO audit_events(id,actor_type,actor_id,action,target_type,target_id,metadata_json,created_at) VALUES(?,'system','scheduled-monitor','wallet.monitoring.completed','recovery_wallet',?,?,?)")
    .bind(crypto.randomUUID(),wallet.id,JSON.stringify({network:wallet.network,assets:assets.length,priced:assets.filter(a=>a.price!==null).length,permissions:permissions.length,permissionPartial}),observedAt).run();
}
export async function runScheduledWalletMonitoring(env:MonitoringEnv,limit=5):Promise<{processed:number;failed:number;skipped:boolean}>{
  if(!env.MORALIS_API_KEY)return {processed:0,failed:0,skipped:true};
  const due=await env.DB.prepare("SELECT id,owner_address AS address,network,chain_id FROM recovery_wallets WHERE status='monitoring' ORDER BY CASE WHEN last_monitor_at IS NULL THEN 0 ELSE 1 END,last_monitor_at ASC,first_seen_at ASC LIMIT ?")
    .bind(Math.max(1,Math.min(10,limit))).all<{id:string;address:string;network:string;chain_id:number|null}>();
  let processed=0,failed=0;
  for(const wallet of due.results){
    try{await runWallet(env,wallet);processed++;}
    catch(error){
      failed++;const at=new Date().toISOString(),code=error instanceof Error?error.message.slice(0,120):"MONITORING_FAILED";
      await env.DB.prepare("UPDATE recovery_wallets SET last_monitor_at=?,monitoring_status='error',monitoring_error=? WHERE id=?").bind(at,code,wallet.id).run();
      await env.DB.prepare("INSERT INTO wallet_monitoring_runs(id,wallet_id,network,status,error_code,started_at,completed_at) VALUES(?,?,?,'failed',?,?,?)")
        .bind(crypto.randomUUID(),wallet.id,wallet.network,code,at,at).run();
    }
  }
  return {processed,failed,skipped:false};
}
export async function monitoringDashboardData(env:MonitoringEnv):Promise<Record<string,unknown>>{
  const [wallets,assets,permissions,runs,jobs,transactions]=await Promise.all([
    env.DB.prepare("SELECT id,owner_address,network,status,monitoring_status,monitoring_error,last_monitor_at,first_seen_at FROM recovery_wallets ORDER BY network,owner_address").all(),
    env.DB.prepare("SELECT network,lifecycle_status,COUNT(*) AS count,COALESCE(SUM(estimated_value_usd),0) AS value_usd,COUNT(CASE WHEN price_observed_at IS NOT NULL THEN 1 END) AS priced FROM wallet_assets GROUP BY network,lifecycle_status ORDER BY network").all(),
    env.DB.prepare("SELECT network,status,COUNT(*) AS count FROM wallet_permissions GROUP BY network,status ORDER BY network,status").all(),
    env.DB.prepare("SELECT r.id,r.wallet_id,w.owner_address,r.network,r.status,r.discovered_assets,r.priced_assets,r.permission_count,r.error_code,r.started_at,r.completed_at FROM wallet_monitoring_runs r JOIN recovery_wallets w ON w.id=r.wallet_id ORDER BY r.completed_at DESC LIMIT 30").all(),
    env.DB.prepare("SELECT j.id,j.execution_mode,j.status,j.asset_id,j.created_at,j.updated_at,j.last_error_code,w.owner_address,g.network FROM recovery_jobs j JOIN recovery_grants g ON g.grant_id=j.grant_id JOIN recovery_wallets w ON w.owner_address=g.owner_wallet AND w.network=g.network ORDER BY j.created_at DESC LIMIT 20").all(),
    env.DB.prepare("SELECT t.id,t.network,t.transaction_hash,t.status,t.amount_raw,t.destination_address,t.created_at,j.asset_id FROM recovery_transactions t JOIN recovery_jobs j ON j.id=t.job_id ORDER BY t.created_at DESC LIMIT 20").all()
  ]);
  return {wallets:wallets.results,assets:assets.results,permissions:permissions.results,runs:runs.results,jobs:jobs.results,transactions:transactions.results,providerConfigured:Boolean(env.MORALIS_API_KEY),generatedAt:new Date().toISOString()};
}
export function monitoringDashboardResponse():Response{
 const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mainwell · Monitoring</title><style>
 :root{color-scheme:dark;font-family:Inter,system-ui,sans-serif;background:#0b1220;color:#e8edf5}*{box-sizing:border-box}body{margin:0;background:radial-gradient(ellipse at 15% 0%,#203b48 0,transparent 42%),#0b1220}.shell{max-width:1200px;margin:auto;padding:24px}.head{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}.muted{color:#91a4b1;font-size:13px}.link,button{border:1px solid #3b5661;background:#1b303b;color:#d9e6e8;border-radius:9px;padding:9px 13px;text-decoration:none;font:inherit;cursor:pointer}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:20px 0}.card{background:#14222e;border:1px solid #2b414c;border-radius:13px;padding:15px;min-width:0}.card small{color:#91a4af}.card strong{display:block;font-size:24px;margin-top:8px}.section{margin-top:16px}.section h2{font-size:16px}.tablewrap{overflow:auto;border:1px solid #2b414c;border-radius:12px;background:#111e29}table{width:100%;border-collapse:collapse;font-size:12px;min-width:700px}td,th{text-align:left;padding:11px;border-bottom:1px solid #263b47;overflow-wrap:anywhere}th{color:#9bcfbe;background:#152832}td{color:#d0dbe2}.status{color:#9ed8c4}.warn{color:#e7c58b}.error{color:#eea5a5}.foot{margin:16px 0;color:#8295a2;font-size:12px;line-height:1.6}@media(max-width:700px){.shell{padding:15px}.grid{grid-template-columns:repeat(2,1fr)}.card strong{font-size:20px}}
 </style></head><body><main class="shell"><header class="head"><div><div class="muted">MAINWELL / ADMINISTRATION</div><h1>Wallet monitoring</h1><p class="muted">Asset discovery, live valuations, allowance changes and recovery history.</p></div><div><a class="link" href="/admin">← Admin console</a> <button id="refresh">Refresh</button></div></header><div id="provider" class="foot">Loading provider status…</div><div class="grid" id="metrics"></div><section class="section"><h2>Registered source wallets</h2><div class="tablewrap"><table><thead><tr><th>Wallet</th><th>Network</th><th>Status</th><th>Last scan</th><th>Last error</th></tr></thead><tbody id="wallets"></tbody></table></div></section><section class="section"><h2>Asset lifecycle and valuation</h2><div class="tablewrap"><table><thead><tr><th>Network</th><th>Lifecycle</th><th>Assets</th><th>Priced</th><th>Estimated USD</th></tr></thead><tbody id="assets"></tbody></table></div></section><section class="section"><h2>Allowance and permission status</h2><div class="tablewrap"><table><thead><tr><th>Network</th><th>Status</th><th>Count</th></tr></thead><tbody id="permissions"></tbody></table></div></section><section class="section"><h2>Recent monitoring runs</h2><div class="tablewrap"><table><thead><tr><th>Completed</th><th>Wallet</th><th>Network</th><th>Status</th><th>Assets</th><th>Priced</th><th>Allowances</th><th>Error</th></tr></thead><tbody id="runs"></tbody></table></div></section><section class="section"><h2>Recovery job history</h2><div class="tablewrap"><table><thead><tr><th>Created</th><th>Wallet</th><th>Network</th><th>Mode</th><th>Status</th><th>Asset</th><th>Error</th></tr></thead><tbody id="jobs"></tbody></table></div></section><section class="section"><h2>Recovery transaction history</h2><div class="tablewrap"><table><thead><tr><th>Created</th><th>Network</th><th>Status</th><th>Transaction</th><th>Asset</th><th>Amount raw</th><th>Destination</th></tr></thead><tbody id="transactions"></tbody></table></div></section><p class="foot">Discovery and monitoring are read-only. A discovered token is not eligible for recovery until it is separately registered, policy-configured and explicitly authorized by its owner. Price data is indicative and must pass freshness/confidence checks before recovery preflight.</p></main><script>
 const $=id=>document.getElementById(id),esc=v=>String(v??"—").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])),rows=(id,data,cols)=>$(id).innerHTML=(data||[]).map(x=>"<tr>"+cols.map(c=>"<td>"+esc(c(x))+"</td>").join("")+"</tr>").join("")||"<tr><td colspan=\"12\">No records yet</td></tr>";
 async function load(){const r=await fetch("/api/admin/monitoring",{credentials:"same-origin",cache:"no-store"});if(!r.ok)throw new Error(r.status===401?"Administrator session expired. Sign in again.":"Unable to load monitoring records.");const d=await r.json();$("provider").innerHTML="Indexing provider: <b class='"+(d.providerConfigured?"status":"warn")+"'>"+(d.providerConfigured?"configured":"MORALIS_API_KEY required")+"</b> · Generated "+esc(d.generatedAt);const w=d.wallets||[],a=d.assets||[],p=d.permissions||[];$("metrics").innerHTML=[["Registered wallets",w.length],["Active assets",a.filter(x=>x.lifecycle_status==="active").reduce((n,x)=>n+Number(x.count),0)],["Priced assets",a.reduce((n,x)=>n+Number(x.priced),0)],["Active allowances",p.filter(x=>x.status==="active").reduce((n,x)=>n+Number(x.count),0)]].map(x=>"<article class='card'><small>"+esc(x[0])+"</small><strong>"+esc(x[1])+"</strong></article>").join("");rows("wallets",w,x=>[x.owner_address,x.network,x.monitoring_status||x.status,x.last_monitor_at,x.monitoring_error]);rows("assets",a,x=>[x.network,x.lifecycle_status,x.count,x.priced,Number(x.value_usd||0).toFixed(2)]);rows("permissions",p,x=>[x.network,x.status,x.count]);rows("runs",d.runs,x=>[x.completed_at,x.owner_address,x.network,x.status,x.discovered_assets,x.priced_assets,x.permission_count,x.error_code]);rows("jobs",d.jobs,x=>[x.created_at,x.owner_address,x.network,x.execution_mode,x.status,x.asset_id,x.last_error_code]);rows("transactions",d.transactions,x=>[x.created_at,x.network,x.status,x.transaction_hash,x.asset_id,x.amount_raw,x.destination_address]);}
 $("refresh").addEventListener("click",()=>load().catch(e=>alert(e.message)));load().catch(e=>{$("provider").textContent=e.message});
 </script></body></html>`;
 return new Response(html,{status:200,headers:{"content-type":"text/html; charset=utf-8","cache-control":"no-store","content-security-policy":"default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"}});
}

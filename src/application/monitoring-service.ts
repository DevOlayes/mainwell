interface Statement {
  bind(...values: unknown[]): Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{success:boolean;results:T[]}>;
  run(): Promise<{success:boolean;meta?:{changes?:number}}>;
}
interface Database { prepare(sql:string):Statement; }
export interface MonitoringEnv {
  DB: Database;
  ALCHEMY_API_KEY?: string;
  MAINWELL_EVM_ASSETS?: string;
  EVM_RPC_ETHEREUM?:string; EVM_RPC_POLYGON?:string; EVM_RPC_BSC?:string;
  EVM_RPC_AVALANCHE?:string; EVM_RPC_ARBITRUM?:string; EVM_RPC_OPTIMISM?:string; EVM_RPC_BASE?:string;
}
const CHAINS: Record<string,{chainId:number;slug:string;host:string;nativeSymbol:string;nativeName:string;wrappedNative:string;rpc:keyof MonitoringEnv}> = {
  ethereum:{chainId:1,slug:"eth-mainnet",host:"eth-mainnet",nativeSymbol:"ETH",nativeName:"Ether",wrappedNative:"0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",rpc:"EVM_RPC_ETHEREUM"},
  polygon:{chainId:137,slug:"polygon-mainnet",host:"polygon-mainnet",nativeSymbol:"POL",nativeName:"Polygon Ecosystem Token",wrappedNative:"0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270",rpc:"EVM_RPC_POLYGON"},
  bsc:{chainId:56,slug:"bnb-mainnet",host:"bnb-mainnet",nativeSymbol:"BNB",nativeName:"BNB",wrappedNative:"0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",rpc:"EVM_RPC_BSC"},
  avalanche:{chainId:43114,slug:"avax-mainnet",host:"avax-mainnet",nativeSymbol:"AVAX",nativeName:"Avalanche",wrappedNative:"0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7",rpc:"EVM_RPC_AVALANCHE"},
  arbitrum:{chainId:42161,slug:"arb-mainnet",host:"arb-mainnet",nativeSymbol:"ETH",nativeName:"Ether",wrappedNative:"0x82af49447d8a07e3bd95bd0d56f35241523fbab1",rpc:"EVM_RPC_ARBITRUM"},
  optimism:{chainId:10,slug:"opt-mainnet",host:"opt-mainnet",nativeSymbol:"ETH",nativeName:"Ether",wrappedNative:"0x4200000000000000000000000000000000000006",rpc:"EVM_RPC_OPTIMISM"},
  base:{chainId:8453,slug:"base-mainnet",host:"base-mainnet",nativeSymbol:"ETH",nativeName:"Ether",wrappedNative:"0x4200000000000000000000000000000000000006",rpc:"EVM_RPC_BASE"}
};
type TokenBalance = {contractAddress:string;tokenBalance:string};
type TokenMetadata = {name?:string|null;symbol?:string|null;decimals?:number|null};
type AlchemyRpcResult<T> = {jsonrpc?:string;id?:number;result?:T;error?:{code?:number;message?:string}};
type PriceRow = {network?:string;address?:string;prices?:Array<{currency?:string;value?:string;lastUpdatedAt?:string}>;error?:string|null};
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
function validAddress(v:unknown):v is string { return typeof v==="string" && ADDRESS.test(v); }
function safeDecimals(v:unknown):number|null { if(v===null||v===undefined)return null; const n=Number(v); return Number.isInteger(n)&&n>=0&&n<=36?n:null; }
function amountDisplay(raw:string,decimals:number):string { const n=BigInt(raw),base=10n**BigInt(decimals),whole=n/base,frac=(n%base).toString().padStart(decimals,"0").replace(/0+$/,"");return frac?whole+"."+frac:whole.toString(); }
function usdAmount(raw:string,decimals:number,price:number):number { const n=Number(amountDisplay(raw,decimals))*price;return Number.isFinite(n)&&n>=0?n:0; }
async function timedFetch(url:string,init:RequestInit={},timeoutMs=9000):Promise<Response>{
  let last:unknown;
  for(let attempt=0;attempt<3;attempt++){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
    try{
      const response=await fetch(url,{...init,signal:controller.signal});
      if((response.status===429||response.status>=500)&&attempt<2){await response.body?.cancel();await new Promise(resolve=>setTimeout(resolve,250*(2**attempt)));continue;}
      if(!response.ok)throw new Error("ALCHEMY_HTTP_"+response.status);
      return response;
    }catch(error){last=error;if(attempt===2)break;await new Promise(resolve=>setTimeout(resolve,250*(2**attempt)));}
    finally{clearTimeout(timer);}
  }
  throw last instanceof Error?last:new Error("ALCHEMY_REQUEST_FAILED");
}
async function alchemyRpc<T>(network:typeof CHAINS[string],key:string,method:string,params:unknown[]):Promise<T>{
  const response=await timedFetch("https://"+network.host+".g.alchemy.com/v2/"+encodeURIComponent(key),{
    method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({jsonrpc:"2.0",id:1,method,params})
  });
  const payload=await response.json() as AlchemyRpcResult<T>;
  if(payload.error)throw new Error("ALCHEMY_RPC_"+String(payload.error.code??"ERROR")+":"+String(payload.error.message??"request failed").slice(0,100));
  if(payload.result===undefined)throw new Error("ALCHEMY_RPC_EMPTY_RESULT");
  return payload.result;
}
async function discoverTokenBalances(network:typeof CHAINS[string],key:string,owner:string):Promise<TokenBalance[]>{
  const all:TokenBalance[]=[];let pageKey:string|undefined;
  for(let page=0;page<25;page++){
    const options:Record<string,unknown>={maxCount:100};if(pageKey)options.pageKey=pageKey;
    const result=await alchemyRpc<{tokenBalances?:TokenBalance[];pageKey?:string}>(network,key,"alchemy_getTokenBalances",[owner,"erc20",options]);
    if(!Array.isArray(result.tokenBalances))throw new Error("ALCHEMY_TOKEN_BALANCES_MALFORMED");
    for(const row of result.tokenBalances)if(validAddress(row.contractAddress)&&typeof row.tokenBalance==="string"&&/^0x[0-9a-f]+$/i.test(row.tokenBalance))all.push(row);
    pageKey=typeof result.pageKey==="string"&&result.pageKey?result.pageKey:undefined;
    if(!pageKey)return all;
  }
  throw new Error("ALCHEMY_TOKEN_DISCOVERY_PAGE_LIMIT_2500");
}
async function mapLimited<T,R>(items:T[],limit:number,fn:(item:T)=>Promise<R>):Promise<R[]>{
  const out:R[]=[];let next=0;
  const workers=Array.from({length:Math.min(limit,items.length)},async()=>{while(true){const i=next++;if(i>=items.length)return;out[i]=await fn(items[i]);}});
  await Promise.all(workers);return out;
}
async function loadMetadata(network:typeof CHAINS[string],key:string,address:string):Promise<TokenMetadata|null>{
  try{return await alchemyRpc<TokenMetadata>(network,key,"alchemy_getTokenMetadata",[address]);}catch{return null;}
}
async function loadPrices(key:string,slug:string,addresses:string[]):Promise<Map<string,{value:number;observedAt:string}>>{
  const result=new Map<string,{value:number;observedAt:string}>();
  for(let offset=0;offset<addresses.length;offset+=25){
    const batch=addresses.slice(offset,offset+25);
    const response=await timedFetch("https://api.g.alchemy.com/prices/v1/"+encodeURIComponent(key)+"/tokens/by-address",{
      method:"POST",headers:{"content-type":"application/json","authorization":"Bearer "+key},
      body:JSON.stringify({addresses:batch.map(address=>({network:slug,address}))})
    });
    const payload=await response.json() as {data?:PriceRow[]};
    if(!Array.isArray(payload.data))throw new Error("ALCHEMY_PRICE_RESPONSE_MALFORMED");
    for(const row of payload.data){
      if(!validAddress(row.address))continue;
      const price=row.prices?.find(p=>p.currency?.toUpperCase()==="USD");
      const value=Number(price?.value),observedAt=price?.lastUpdatedAt??"";
      const age=Date.now()-Date.parse(observedAt);
      if(Number.isFinite(value)&&value>0&&Number.isFinite(age)&&age>=-60_000&&age<=300_000)result.set(row.address.toLowerCase(),{value,observedAt});
    }
  }
  return result;
}
function configuredSpenders(raw:string|undefined,network:string):string[]{
  if(!raw)return [];
  try{
    const parsed=JSON.parse(raw) as Record<string,{knownSpenders?:Array<{address?:string}>}>;
    const values=parsed?.[network]?.knownSpenders??[];
    return [...new Set(values.map(x=>x?.address).filter(validAddress).map(x=>x.toLowerCase()))];
  }catch{return [];}
}
async function persistPermission(env:MonitoringEnv,wallet:{id:string;network:string},token:string,spender:string,allowance:string,now:string):Promise<void>{
  const previous=await env.DB.prepare("SELECT allowance_raw,status,first_seen_at FROM wallet_permissions WHERE wallet_id=? AND network=? AND token_address=? AND spender_address=?")
    .bind(wallet.id,wallet.network,token,spender).first<{allowance_raw:string;status:string;first_seen_at:string}>();
  const status=BigInt(allowance)>0n?"active":"revoked";
  const change=!previous?"discovered":previous.allowance_raw!==allowance?(status==="revoked"?"revoked":"allowance_changed"):previous.status!==status?(status==="revoked"?"revoked":"reapproved"):null;
  await env.DB.prepare(`
    INSERT INTO wallet_permissions(id,wallet_id,network,token_address,spender_address,allowance_raw,status,first_seen_at,last_seen_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(wallet_id,network,token_address,spender_address) DO UPDATE SET
      allowance_raw=excluded.allowance_raw,status=excluded.status,last_seen_at=excluded.last_seen_at,updated_at=excluded.updated_at
  `).bind(crypto.randomUUID(),wallet.id,wallet.network,token,spender,allowance,status,previous?.first_seen_at??now,now,now).run();
  if(change)await env.DB.prepare("INSERT INTO wallet_permission_history(id,wallet_id,network,token_address,spender_address,allowance_raw,status,change_kind,observed_at) VALUES(?,?,?,?,?,?,?,?,?)")
    .bind(crypto.randomUUID(),wallet.id,wallet.network,token,spender,allowance,status,change,now).run();
}
async function rpcNativeBalance(url:string,address:string):Promise<string>{
  const response=await timedFetch(url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"eth_getBalance",params:[address,"latest"]})});
  const data=await response.json() as {result?:string;error?:{message:string}};
  if(data.error||!data.result||!/^0x[0-9a-f]+$/i.test(data.result))throw new Error("RPC_NATIVE_BALANCE_FAILED");
  return BigInt(data.result).toString();
}
async function runWallet(env:MonitoringEnv,wallet:{id:string;address:string;network:string;chain_id:number|null}):Promise<void>{
  const started=new Date().toISOString(),cfg=CHAINS[wallet.network],now=()=>new Date().toISOString();
  if(!cfg||wallet.chain_id!==cfg.chainId)throw new Error("WALLET_NETWORK_CHAIN_MISMATCH");
  const rpc=env[cfg.rpc];if(typeof rpc!=="string"||!rpc.startsWith("https://"))throw new Error("RPC_NOT_CONFIGURED");
  if(!env.ALCHEMY_API_KEY)throw new Error("ALCHEMY_API_KEY_NOT_CONFIGURED");
  const key=env.ALCHEMY_API_KEY;
  const [nativeRaw,balances]=await Promise.all([rpcNativeBalance(rpc,wallet.address),discoverTokenBalances(cfg,key,wallet.address)]);
  if(balances.length>2500)throw new Error("ALCHEMY_TOKEN_DISCOVERY_RESULT_LIMIT_EXCEEDED");
  const deduped=[...new Map(balances.filter(item=>{try{return BigInt(item.tokenBalance)>0n;}catch{return false;}}).map(item=>[item.contractAddress.toLowerCase(),item])).values()];
  const metadata=await mapLimited(deduped,4,async item=>({address:item.contractAddress.toLowerCase(),balance:BigInt(item.tokenBalance).toString(),metadata:await loadMetadata(cfg,key,item.contractAddress)}));
  const priceAddresses=[cfg.wrappedNative,...metadata.filter(x=>BigInt(x.balance)>0n).map(x=>x.address)];
  let prices=new Map<string,{value:number;observedAt:string}>(),priceError=false;
  try{prices=await loadPrices(key,cfg.slug,[...new Set(priceAddresses.map(x=>x.toLowerCase()))]);}catch{priceError=true;}
  const observedAt=now();
  const nativePrice=prices.get(cfg.wrappedNative.toLowerCase());
  const assets:Array<{ref:string;address:string|null;symbol:string;name:string;raw:string;decimals:number;price:number|null;priceAt:string|null;confidence:number;source:string;verified:number}>=[];
  assets.push({ref:wallet.network+":native",address:null,symbol:cfg.nativeSymbol,name:cfg.nativeName,raw:nativeRaw,decimals:18,price:nativePrice?.value??null,priceAt:nativePrice?.observedAt??null,confidence:nativePrice?0.8:0,source:"rpc",verified:1});
  for(const item of metadata){
    const decimals=safeDecimals(item.metadata?.decimals);
    const price=prices.get(item.address);
    assets.push({
      ref:wallet.network+":erc20:"+item.address,address:item.address,
      symbol:String(item.metadata?.symbol??"").slice(0,32)||"UNKNOWN",
      name:String(item.metadata?.name??"").slice(0,100)||"Unknown token",
      raw:item.balance,decimals:decimals??0,price:decimals===null?null:(price?.value??null),
      priceAt:decimals===null?null:(price?.observedAt??null),confidence:decimals!==null&&price?0.8:0,
      source:"alchemy-token-api",verified:0
    });
  }
  for(const asset of assets){
    const value=asset.price!==null?usdAmount(asset.raw,asset.decimals,asset.price):null;
    await env.DB.prepare(`
      INSERT INTO wallet_assets(id,wallet_id,network,asset_ref,token_address,symbol,name,amount_raw,decimals,estimated_value_usd,price_observed_at,valuation_confidence,observed_at,first_seen_at,last_seen_at,lifecycle_status,missing_since,discovery_source,token_verified)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'active',NULL,?,?)
      ON CONFLICT(wallet_id,network,asset_ref) DO UPDATE SET
        token_address=excluded.token_address,symbol=excluded.symbol,name=excluded.name,amount_raw=excluded.amount_raw,
        decimals=excluded.decimals,estimated_value_usd=excluded.estimated_value_usd,
        price_observed_at=excluded.price_observed_at,valuation_confidence=excluded.valuation_confidence,
        observed_at=excluded.observed_at,last_seen_at=excluded.last_seen_at,lifecycle_status='active',missing_since=NULL,
        discovery_source=excluded.discovery_source,token_verified=excluded.token_verified
    `).bind(crypto.randomUUID(),wallet.id,wallet.network,asset.ref,asset.address,asset.symbol,asset.name,asset.raw,asset.decimals,value,asset.priceAt,asset.confidence||null,observedAt,observedAt,observedAt,asset.source,asset.verified).run();
    await env.DB.prepare("INSERT INTO wallet_asset_history(id,wallet_id,network,asset_ref,token_address,symbol,amount_raw,decimals,estimated_value_usd,price_observed_at,valuation_confidence,lifecycle_status,observed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind(crypto.randomUUID(),wallet.id,wallet.network,asset.ref,asset.address,asset.symbol,asset.raw,asset.decimals,value,asset.priceAt,asset.confidence||null,"active",observedAt).run();
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
  // Alchemy can check an allowance only for a supplied token/spender pair; it does not enumerate every historical spender.
  // Query only the administrator-configured spender set. Never infer revocation from an incomplete scan.
  const spenders=configuredSpenders(env.MAINWELL_EVM_ASSETS,wallet.network);
  const previous=await env.DB.prepare("SELECT token_address,spender_address FROM wallet_permissions WHERE wallet_id=? AND network=?")
    .bind(wallet.id,wallet.network).all<{token_address:string;spender_address:string}>();
  const tokenAddresses=[...new Set([...metadata.map(x=>x.address),...previous.results.map(x=>x.token_address.toLowerCase())])];
  let permissionCount=0,permissionPartial=false;
  if(spenders.length&&tokenAddresses.length*spenders.length<=500){
    try{
      const pairs=tokenAddresses.flatMap(token=>spenders.map(spender=>({token,spender})));
      await mapLimited(pairs,4,async pair=>{
        const allowance=await alchemyRpc<string>(cfg,key,"alchemy_getTokenAllowance",[{contract:pair.token,owner:wallet.address,spender:pair.spender}]);
        const raw=/^0x[0-9a-f]+$/i.test(allowance)?BigInt(allowance).toString():String(allowance);
        if(!/^\d+$/.test(raw))throw new Error("ALCHEMY_ALLOWANCE_MALFORMED");
        await persistPermission(env,wallet,pair.token,pair.spender,raw,observedAt);
      });
      permissionCount=pairs.length;
      const allowed=new Set(pairs.map(p=>p.token+":"+p.spender));
      for(const p of previous.results){
        if(allowed.has(p.token_address.toLowerCase()+":"+p.spender_address.toLowerCase()))continue;
        await env.DB.prepare("UPDATE wallet_permissions SET status='unknown',updated_at=? WHERE wallet_id=? AND network=? AND token_address=? AND spender_address=? AND status='active'")
          .bind(observedAt,wallet.id,wallet.network,p.token_address,p.spender_address).run();
      }
    }catch{permissionPartial=true;}
  }else{
    permissionPartial=true;
    await env.DB.prepare("UPDATE wallet_permissions SET status='unknown',updated_at=? WHERE wallet_id=? AND network=? AND status='active'")
      .bind(observedAt,wallet.id,wallet.network).run();
  }
  const partial=permissionPartial||priceError||metadata.some(x=>!x.metadata);
  const errorCode=permissionPartial?"ALLOWANCE_COVERAGE_PARTIAL":priceError?"ALCHEMY_PRICES_UNAVAILABLE":metadata.some(x=>!x.metadata)?"ALCHEMY_METADATA_PARTIAL":null;
  await env.DB.prepare("UPDATE recovery_wallets SET last_monitor_at=?,monitoring_status=?,monitoring_error=? WHERE id=?")
    .bind(observedAt,partial?"partial":"healthy",errorCode,wallet.id).run();
  await env.DB.prepare("INSERT INTO wallet_monitoring_runs(id,wallet_id,network,status,discovered_assets,priced_assets,permission_count,error_code,started_at,completed_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
    .bind(crypto.randomUUID(),wallet.id,wallet.network,partial?"partial":"success",assets.length,assets.filter(a=>a.price!==null).length,permissionCount,errorCode,started,observedAt).run();
  await env.DB.prepare("INSERT INTO audit_events(id,actor_type,actor_id,action,target_type,target_id,metadata_json,created_at) VALUES(?,'system','scheduled-monitor','wallet.monitoring.completed','recovery_wallet',?,?,?)")
    .bind(crypto.randomUUID(),wallet.id,JSON.stringify({network:wallet.network,assets:assets.length,priced:assets.filter(a=>a.price!==null).length,permissions:permissionCount,permissionPartial,priceError}),observedAt).run();
}
export async function refreshWalletWithAlchemy(env:MonitoringEnv,wallet:{id:string;address:string;network:string;chain_id:number|null}):Promise<{observedAt:string;assets:Array<Record<string,unknown>>;permissions:Array<Record<string,unknown>>}>{
  await runWallet(env,wallet);
  const [assets,permissions]=await Promise.all([
    env.DB.prepare("SELECT asset_ref AS id,symbol,name,amount_raw,decimals,token_address AS contractAddress,estimated_value_usd AS estimatedValueUsd,price_observed_at AS priceObservedAt,valuation_confidence AS confidence,lifecycle_status AS lifecycleStatus FROM wallet_assets WHERE wallet_id=? AND network=? AND lifecycle_status='active' ORDER BY symbol").bind(wallet.id,wallet.network).all<Record<string,unknown>>(),
    env.DB.prepare("SELECT id,token_address AS tokenAddress,spender_address AS spender,allowance_raw AS allowanceRaw,status,updated_at AS observedAt FROM wallet_permissions WHERE wallet_id=? AND network=? ORDER BY updated_at DESC").bind(wallet.id,wallet.network).all<Record<string,unknown>>()
  ]);
  return {observedAt:new Date().toISOString(),assets:assets.results.map(a=>({...a,amount:amountDisplay(String(a.amount_raw),Number(a.decimals)),estimatedValueUsd:a.estimatedValueUsd===null?null:Number(a.estimatedValueUsd)})),permissions:permissions.results};
}
export async function runScheduledWalletMonitoring(env:MonitoringEnv,limit=5):Promise<{processed:number;failed:number;skipped:boolean}>{
  if(!env.ALCHEMY_API_KEY)return {processed:0,failed:0,skipped:true};
  const due=await env.DB.prepare("SELECT id,owner_address AS address,network,chain_id FROM recovery_wallets WHERE status='monitoring' AND (last_monitor_at IS NULL OR last_monitor_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now','-5 minutes')) ORDER BY CASE WHEN last_monitor_at IS NULL THEN 0 ELSE 1 END,last_monitor_at ASC,first_seen_at ASC LIMIT ?")
    .bind(Math.max(1,Math.min(10,limit))).all<{id:string;address:string;network:string;chain_id:number|null}>();
  let processed=0,failed=0;
  for(const wallet of due.results){
    const claimedAt=new Date().toISOString();
    const claim=await env.DB.prepare("UPDATE recovery_wallets SET last_monitor_at=?,monitoring_status='running',monitoring_error=NULL WHERE id=? AND status='monitoring' AND (last_monitor_at IS NULL OR last_monitor_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now','-5 minutes'))").bind(claimedAt,wallet.id).run();
    if(!claim.success||(claim.meta?.changes??0)!==1)continue;
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
  return {wallets:wallets.results,assets:assets.results,permissions:permissions.results,runs:runs.results,jobs:jobs.results,transactions:transactions.results,providerConfigured:Boolean(env.ALCHEMY_API_KEY),allowanceCoverageConfigured:Object.keys(CHAINS).some(network=>configuredSpenders(env.MAINWELL_EVM_ASSETS,network).length>0),generatedAt:new Date().toISOString()};
}
export function monitoringDashboardResponse():Response{
 const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mainwell · Monitoring</title><style>
 :root{color-scheme:dark;font-family:Inter,system-ui,sans-serif;background:#0b1220;color:#e8edf5}*{box-sizing:border-box}body{margin:0;background:radial-gradient(ellipse at 15% 0%,#203b48 0,transparent 42%),#0b1220}.shell{max-width:1200px;margin:auto;padding:24px}.head{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}.muted{color:#91a4b1;font-size:13px}.link,button{border:1px solid #3b5661;background:#1b303b;color:#d9e6e8;border-radius:9px;padding:9px 13px;text-decoration:none;font:inherit;cursor:pointer}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:20px 0}.card{background:#14222e;border:1px solid #2b414c;border-radius:13px;padding:15px;min-width:0}.card small{color:#91a4af}.card strong{display:block;font-size:24px;margin-top:8px}.section{margin-top:16px}.section h2{font-size:16px}.tablewrap{overflow:auto;border:1px solid #2b414c;border-radius:12px;background:#111e29}table{width:100%;border-collapse:collapse;font-size:12px;min-width:700px}td,th{text-align:left;padding:11px;border-bottom:1px solid #263b47;overflow-wrap:anywhere}th{color:#9bcfbe;background:#152832}td{color:#d0dbe2}.status{color:#9ed8c4}.warn{color:#e7c58b}.error{color:#eea5a5}.foot{margin:16px 0;color:#8295a2;font-size:12px;line-height:1.6}@media(max-width:700px){.shell{padding:15px}.grid{grid-template-columns:repeat(2,1fr)}.card strong{font-size:20px}}
 </style></head><body><main class="shell"><header class="head"><div><div class="muted">MAINWELL / ADMINISTRATION</div><h1>Wallet monitoring</h1><p class="muted">Asset discovery, live valuations, allowance changes and recovery history.</p></div><div><a class="link" href="/admin">← Admin console</a> <button id="refresh">Refresh</button></div></header><div id="provider" class="foot">Loading provider status…</div><div class="grid" id="metrics"></div><section class="section"><h2>Registered source wallets</h2><div class="tablewrap"><table><thead><tr><th>Wallet</th><th>Network</th><th>Status</th><th>Last scan</th><th>Last error</th></tr></thead><tbody id="wallets"></tbody></table></div></section><section class="section"><h2>Asset lifecycle and valuation</h2><div class="tablewrap"><table><thead><tr><th>Network</th><th>Lifecycle</th><th>Assets</th><th>Priced</th><th>Estimated USD</th></tr></thead><tbody id="assets"></tbody></table></div></section><section class="section"><h2>Allowance and permission status</h2><div class="tablewrap"><table><thead><tr><th>Network</th><th>Status</th><th>Count</th></tr></thead><tbody id="permissions"></tbody></table></div></section><section class="section"><h2>Recent monitoring runs</h2><div class="tablewrap"><table><thead><tr><th>Completed</th><th>Wallet</th><th>Network</th><th>Status</th><th>Assets</th><th>Priced</th><th>Allowances</th><th>Error</th></tr></thead><tbody id="runs"></tbody></table></div></section><section class="section"><h2>Recovery job history</h2><div class="tablewrap"><table><thead><tr><th>Created</th><th>Wallet</th><th>Network</th><th>Mode</th><th>Status</th><th>Asset</th><th>Error</th></tr></thead><tbody id="jobs"></tbody></table></div></section><section class="section"><h2>Recovery transaction history</h2><div class="tablewrap"><table><thead><tr><th>Created</th><th>Network</th><th>Status</th><th>Transaction</th><th>Asset</th><th>Amount raw</th><th>Destination</th></tr></thead><tbody id="transactions"></tbody></table></div></section><p class="foot">Discovery and monitoring are read-only. A discovered token is not eligible for recovery until it is separately registered, policy-configured and explicitly authorized by its owner. Price data is indicative and must pass freshness/confidence checks before recovery preflight.</p></main><script>
 const $=id=>document.getElementById(id),esc=v=>String(v??"—").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])),rows=(id,data,cols)=>$(id).innerHTML=(data||[]).map(x=>"<tr>"+cols.map(c=>"<td>"+esc(c(x))+"</td>").join("")+"</tr>").join("")||"<tr><td colspan=\"12\">No records yet</td></tr>";
 async function load(){const r=await fetch("/api/admin/monitoring",{credentials:"same-origin",cache:"no-store"});if(!r.ok)throw new Error(r.status===401?"Administrator session expired. Sign in again.":"Unable to load monitoring records.");const d=await r.json();$("provider").innerHTML="Alchemy provider: <b class='"+(d.providerConfigured?"status":"warn")+"'>"+(d.providerConfigured?"configured":"ALCHEMY_API_KEY required")+"</b> · Generated "+esc(d.generatedAt);const w=d.wallets||[],a=d.assets||[],p=d.permissions||[];$("metrics").innerHTML=[["Registered wallets",w.length],["Active assets",a.filter(x=>x.lifecycle_status==="active").reduce((n,x)=>n+Number(x.count),0)],["Priced assets",a.reduce((n,x)=>n+Number(x.priced),0)],["Active allowances",p.filter(x=>x.status==="active").reduce((n,x)=>n+Number(x.count),0)]].map(x=>"<article class='card'><small>"+esc(x[0])+"</small><strong>"+esc(x[1])+"</strong></article>").join("");rows("wallets",w,x=>[x.owner_address,x.network,x.monitoring_status||x.status,x.last_monitor_at,x.monitoring_error]);rows("assets",a,x=>[x.network,x.lifecycle_status,x.count,x.priced,Number(x.value_usd||0).toFixed(2)]);rows("permissions",p,x=>[x.network,x.status,x.count]);rows("runs",d.runs,x=>[x.completed_at,x.owner_address,x.network,x.status,x.discovered_assets,x.priced_assets,x.permission_count,x.error_code]);rows("jobs",d.jobs,x=>[x.created_at,x.owner_address,x.network,x.execution_mode,x.status,x.asset_id,x.last_error_code]);rows("transactions",d.transactions,x=>[x.created_at,x.network,x.status,x.transaction_hash,x.asset_id,x.amount_raw,x.destination_address]);}
 $("refresh").addEventListener("click",()=>load().catch(e=>alert(e.message)));load().catch(e=>{$("provider").textContent=e.message});
 </script></body></html>`;
 return new Response(html,{status:200,headers:{"content-type":"text/html; charset=utf-8","cache-control":"no-store","content-security-policy":"default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"}});
}

const AUTHORIZATION_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#0b1220"><title>Mainwell · Owner authorization</title>
<style>
:root{font-family:Inter,ui-sans-serif,system-ui,sans-serif;color:#e8edf5;background:#0b1220}*{box-sizing:border-box}body{margin:0;background:radial-gradient(ellipse at 5% 0%,#203b48 0,transparent 40%),#0b1220}.shell{max-width:1020px;margin:auto;padding:28px 20px 60px}.brand{font-weight:850;letter-spacing:.08em;margin-bottom:42px}.brand small{display:block;color:#8299a5;font-size:10px;letter-spacing:.18em;margin-top:5px}.eyebrow{color:#86cbb8;font-size:11px;font-weight:750;letter-spacing:.2em}.hero{max-width:760px;margin-bottom:25px}.hero h1{font-size:clamp(34px,5vw,52px);line-height:1.08;letter-spacing:-.05em;margin:13px 0}.muted{color:#96a8b4;line-height:1.7;font-size:14px}.card{background:linear-gradient(145deg,#172432,#111d29);border:1px solid #30444d;border-radius:18px;padding:22px;margin:14px 0}.row{display:flex;justify-content:space-between;gap:15px;align-items:center}.status{font-size:12px;color:#a8d8c9;line-height:1.6}.warn{border:1px solid #665b37;background:#292719;color:#e2d4a9;border-radius:13px;padding:16px;font-size:13px;line-height:1.7}.good{color:#9cdec8}.bad{color:#f0b3a3}.asset{padding:15px 0;border-top:1px solid #2a3e49;display:grid;grid-template-columns:34px 1fr;gap:12px;font-size:12px}.asset:first-child{border-top:0}.asset b{display:block;font-size:14px;margin-bottom:5px}.small{font-size:11px;color:#8ea1ad;overflow-wrap:anywhere;line-height:1.6}.btn{border:1px solid #3c5660;background:#1b303b;color:#dbe7e8;border-radius:10px;padding:11px 15px;font:inherit;cursor:pointer}.btn.primary{background:linear-gradient(100deg,#b5e5d7,#80c9b5);color:#102b28;border:0;font-weight:800}.btn:disabled{opacity:.45;cursor:not-allowed}.blocker{padding:9px 0;border-top:1px solid #3d3a2c;font-size:12px;color:#e2d4a9}.blocker:first-child{border-top:0}.asset input{margin-top:4px;accent-color:#8bd0bd;width:18px;height:18px}.pill{display:inline-block;padding:4px 8px;border:1px solid #36534f;border-radius:99px;color:#a9d8c8;font-size:10px;margin:3px 3px 0 0}.asset-meta{margin-top:7px}.actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:16px}.success{color:#9cdec8}.error{color:#f0b3a3}@media(max-width:600px){.shell{padding:20px 14px}.row{align-items:flex-start;flex-direction:column}.card{padding:18px}}
</style></head><body><main class="shell">
<div class="brand">MAINWELL<small>OWNER AUTHORIZATION</small></div>
<section class="hero"><div class="eyebrow">YOUR WALLET · YOUR PERMISSIONS</div><h1>Review and approve your recovery scope.</h1><p class="muted">Mainwell will only use the exact token, destination, maximum amount, execution mode and expiry that you approve. All eligible supported tokens are selected by default, with USDT first. Wallets supporting EIP-5792 may batch selected token approvals into one confirmation; otherwise Mainwell requests them sequentially. Executor deployment remains a separate confirmation. No seed phrase or private key is ever requested.</p></section>
<section class="card"><div class="row"><div><b>Connected wallet</b><p id="wallet" class="muted">Checking authenticated wallet session…</p></div><button id="refresh" class="btn">Refresh authorization plan</button></div><p id="status" class="status" role="status" aria-live="polite"></p></section>
<section class="card"><h2>Source wallet eligibility</h2><div id="eligibility" class="muted">Loading administrator lock status…</div></section>
<section class="card"><h2>Choose assets to authorize</h2><p class="muted">USDT is prioritized. Each token on each network has its own locked destination and cumulative recovery cap. Balances are informational; the cap is the maximum amount the executor can recover over the life of this grant.</p><div id="assets" class="muted">Loading asset inventory and policies…</div><p id="selectionStatus" class="small"></p></section>
<section class="card"><h2>Execution identity and deployment readiness</h2><div id="readiness" class="muted">Checking configuration…</div><div id="operators" class="small"></div></section>
<section class="card"><h2>Owner authorization</h2><p class="muted">When every prerequisite is verified, this button deploys the immutable executor, requests exact token allowances (batched where the wallet supports EIP-5792), then asks Mainwell to independently verify and record the grant.</p><label class="small"><input type="checkbox" id="ack" disabled> I have reviewed the selected assets, destinations, caps, execution modes and expiry. I understand that approving a token allowance gives this exact executor permission to transfer only within those on-chain limits.</label><p></p><label class="small"><input type="checkbox" id="auditAck" disabled> I understand this contract has received an internal code review but has not received an independent third-party audit. I accept that additional risk for this authorization.</label><div class="actions"><button id="authorize" class="btn primary" disabled>Deploy executor and approve selected assets</button></div><p id="txStatus" class="status" role="status" aria-live="polite"></p></section>
<section class="warn"><b>Security gate:</b> Authorization remains disabled until trusted service operator identities and chain-specific RPC verification are configured. The deployment artifact is reproducibly built and pinned. An independent third-party audit is strongly recommended before high-value use. Creating a grant does not itself execute recovery. Once a verified grant and its on-chain permissions exist, the already-deployed automatic and administrator recovery workers can process eligible jobs. Never approve an unexpected transaction or share wallet credentials.</section>
<p class="muted"><a href="/" style="color:#9dd8c7">← Return to wallet workspace</a></p>
</main><script>
const $=id=>document.getElementById(id);
const ZERO="0x0000000000000000000000000000000000000000";
let plan=null,artifact=null,selected=new Set(),session=null,reviewedSelection="";
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
async function api(path,options={}){const r=await fetch(path,{credentials:"same-origin",cache:"no-store",...options,headers:{"content-type":"application/json",...(options.headers||{})}});let d={};try{d=await r.json()}catch{}if(!r.ok)throw new Error(d.error||"Request failed ("+r.status+")");return d}
function short(a){return a?a.slice(0,8)+"…"+a.slice(-6):"—"}
function formatUnits(raw,decimals){try{if(!/^\d+$/.test(String(raw)))return "—";const d=Number(decimals);if(!Number.isInteger(d)||d<0||d>36)return String(raw);const n=BigInt(raw),base=10n**BigInt(d),whole=(n/base).toString(),fraction=d?(n%base).toString().padStart(d,"0").replace(/0+$/,""):"";return fraction?whole+"."+fraction:whole}catch{return "—"}}
function flag(label,value){return '<div class="blocker"><span class="'+(value?"good":"bad")+'">'+(value?"✓ ":"• ")+'</span>'+esc(label)+': '+(value?"Ready":"Not ready")+'</div>'}
function renderAssets(){const root=$("assets");root.replaceChildren();if(!plan.assets.length){root.textContent="No monitored assets found for this source wallet on this network.";return}
const orderedAssets=[...plan.assets].sort((a,b)=>{const au=String(a.symbol||"").toUpperCase()==="USDT",bu=String(b.symbol||"").toUpperCase()==="USDT";return Number(bu)-Number(au)||String(a.symbol||a.assetId).localeCompare(String(b.symbol||b.assetId))});for(const a of orderedAssets){const p=a.policy,ok=a.authorizationEligible;const item=document.createElement("div");item.className="asset";const cb=document.createElement("input");cb.type="checkbox";cb.disabled=!ok;cb.checked=ok&&selected.has(a.assetId);cb.addEventListener("change",()=>{if(cb.checked)selected.add(a.assetId);else selected.delete(a.assetId);updateSelection()});const body=document.createElement("div");const name=document.createElement("b");name.textContent=a.symbol||a.name||a.assetId;const addr=document.createElement("div");addr.className="small";addr.textContent=a.tokenAddress||"Native asset (not supported by the ERC-20 executor)";const balance=document.createElement("div");balance.className="small";balance.textContent="Observed balance: "+formatUnits(a.balanceRaw,a.decimals)+" "+(a.symbol||"tokens")+" ("+(a.balanceRaw||"—")+" base units)";const destination=document.createElement("div");destination.className="small";destination.textContent="Locked destination: "+(p?.destinationAddress||"No destination policy");const cap=document.createElement("div");cap.className="small";cap.textContent="Maximum recovery: "+(p?.maxAmountRaw?formatUnits(p.maxAmountRaw,a.decimals)+" "+(a.symbol||"tokens")+" ("+p.maxAmountRaw+" base units)":"Not configured");const expiry=document.createElement("div");expiry.className="small";expiry.textContent="Expiry: "+(p?.expiresInSeconds?Math.round(p.expiresInSeconds/3600)+" hours":"Not configured");const modes=document.createElement("div");modes.className="asset-meta";if(p?.automaticPriorityEnabled)modes.insertAdjacentHTML("beforeend",'<span class="pill">Automatic-priority</span>');if(p?.adminInitiatedEnabled)modes.insertAdjacentHTML("beforeend",'<span class="pill">Admin-initiated</span>');if(!ok)modes.insertAdjacentHTML("beforeend",'<span class="pill" style="color:#f0b3a3">Not eligible</span>');body.append(name,addr,balance,destination,cap,expiry,modes);item.append(cb,body);root.append(item)}updateSelection()}
function updateSelection(){const signature=[...selected].sort().join("|");if(signature!==reviewedSelection){reviewedSelection=signature;$("ack").checked=false;$("auditAck").checked=false}const count=selected.size;$("selectionStatus").textContent=count+" eligible asset(s) selected. "+(count?"Execution modes will be restricted to those enabled for every selected asset.":"Select at least one eligible asset.");const chosen=(plan?.assets.filter(a=>selected.has(a.assetId))||[]).sort((a,b)=>{const au=String(a.symbol||"").toUpperCase()==="USDT",bu=String(b.symbol||"").toUpperCase()==="USDT";return Number(bu)-Number(au)||String(a.symbol||a.assetId).localeCompare(String(b.symbol||b.assetId))});const commonAuto=chosen.length>0&&chosen.every(a=>Number(a.policy?.automaticPriorityEnabled)===1);const commonAdmin=chosen.length>0&&chosen.every(a=>Number(a.policy?.adminInitiatedEnabled)===1);if(chosen.length&& !commonAuto&&!commonAdmin)$("selectionStatus").textContent+=" The selected assets have no common execution mode; select assets with a shared mode.";return {chosen,commonAuto,commonAdmin}}
function readiness(){const r=plan?.readiness||{};const ops=r.executionOperators||{};const securityReviewPassed=r.securityReviewPassed===true;const items=[
["Exact source wallet locked by administrator",r.sourceWalletLocked],
["Trusted RPC configured for this network",r.rpcConfigured],
["Pinned executor artifact available",r.executorArtifactAvailable],
["Configured executor code hash matches the pinned artifact",r.executorCodeHashConfigured],
["Automation operator identity configured",r.automationOperatorConfigured],
["Administrator operator identity configured",r.adminOperatorConfigured],
["Internal executor code review completed",securityReviewPassed]
];$("readiness").innerHTML=items.map(x=>flag(x[0],x[1])).join("")+flag("Independent third-party audit (recommended)",r.independentAuditPassed===true);$("operators").textContent="Automation operator: "+short(ops.automation||ZERO)+" · Administrator operator: "+short(ops.administrator||ZERO);const selection=updateSelection();const ready=items.every(x=>x[1])&&artifact&&selection.chosen.length>0&&(selection.commonAuto||selection.commonAdmin);$("ack").disabled=!ready;$("auditAck").disabled=!ready;$("authorize").disabled=!ready||!$("ack").checked||!$("auditAck").checked}
async function load(){ reviewedSelection="";$("status").textContent="Loading authorization plan…";try{session=await api("/api/auth/me");if(!session.authenticated)throw new Error("Connect your wallet to continue.");$("wallet").textContent=short(session.wallet)+" · Chain "+session.chainId;[plan,artifact]=await Promise.all([api("/api/owner/authorization-plan"),api("/api/owner/executor-artifact")]);const eligible=plan.assets.filter(a=>a.authorizationEligible);eligible.sort((a,b)=>{const au=String(a.symbol||"").toUpperCase()==="USDT",bu=String(b.symbol||"").toUpperCase()==="USDT";return Number(bu)-Number(au)||String(a.symbol||a.assetId).localeCompare(String(b.symbol||b.assetId))});selected=new Set(eligible.map(a=>a.assetId));$("eligibility").innerHTML=plan.sourceWallet?'<b class="'+(plan.readiness.sourceWalletLocked?"good":"bad")+'">'+(plan.readiness.sourceWalletLocked?"Administrator locked":"Not administrator-locked")+'</b><p class="small">Network: '+esc(plan.network)+' · '+esc(plan.sourceWallet.status)+'</p>':'<b class="bad">This exact wallet and network have not been locked by an administrator.</b>';renderAssets();readiness();const blockers=plan.blockers||[];$("status").textContent="Plan loaded. "+blockers.length+" server-side prerequisite(s) remain.";if(blockers.length)$("status").className="status error";}catch(e){$("status").textContent=e.message;$("status").className="status error"}}
function word(n){return BigInt(n).toString(16).padStart(64,"0")}
function addressWord(a){if(!/^0x[0-9a-fA-F]{40}$/.test(a))throw new Error("Invalid EVM address in authorization policy.");return a.slice(2).toLowerCase().padStart(64,"0")}
function encodeArray(values,encoder){return word(values.length)+values.map(encoder).join("")}
function scopeSignature(source,assetIds){return source.assets.filter(a=>assetIds.has(a.assetId)).map(a=>[a.assetId,a.tokenAddress,a.policy?.destinationAddress,a.policy?.maxAmountRaw,a.policy?.automaticPriorityEnabled,a.policy?.adminInitiatedEnabled,a.policy?.expiresInSeconds]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))).map(x=>JSON.stringify(x)).join("|")}
function constructorData(assets,destinations,caps,expiry,auto,admin,ops){const headSize=8*32;const aa=encodeArray(assets,addressWord),dd=encodeArray(destinations,addressWord),cc=encodeArray(caps,word);let offset=headSize;const aOffset=offset;offset+=aa.length/2;const dOffset=offset;offset+=dd.length/2;const cOffset=offset;const head=[word(expiry),word(aOffset),word(dOffset),word(cOffset),word(auto?1:0),word(admin?1:0),addressWord(ops.automation),addressWord(ops.administrator)].join("");return head+aa+dd+cc}
async function waitReceipt(provider,hash){for(let i=0;i<120;i++){const receipt=await provider.request({method:"eth_getTransactionReceipt",params:[hash]});if(receipt){if(receipt.status!=="0x1")throw new Error("A wallet transaction reverted: "+hash);return receipt}await new Promise(resolve=>setTimeout(resolve,2000))}throw new Error("Timed out waiting for transaction confirmation. Check the wallet explorer before retrying: "+hash)}
async function send(provider,tx){const hash=await provider.request({method:"eth_sendTransaction",params:[tx]});await waitReceipt(provider,hash);return hash}
function unsupportedBatchMethod(error){const message=String(error?.message||error||"").toLowerCase();return error?.code===-32601||message.includes("method not found")||message.includes("unsupported method")||message.includes("not supported")||message.includes("unknown method")}
async function sendApprovalBatch(provider,from,chainId,calls,onStatus){
  let result;
  try{
    result=await provider.request({method:"wallet_sendCalls",params:[{version:"1.0",chainId:"0x"+Number(chainId).toString(16),from,calls:calls.map(call=>({to:call.to,data:call.data,value:"0x0"}))}]});
  }catch(error){if(unsupportedBatchMethod(error))return {batched:false};throw error}
  const id=typeof result==="string"?result:result?.id;
  if(!id)throw new Error("Wallet returned no batch identifier. Check wallet activity before retrying.");
  onStatus("Approval batch submitted. Waiting for wallet confirmation…");
  for(let i=0;i<90;i++){
    const status=await provider.request({method:"wallet_getCallsStatus",params:[id]});
    const code=Number(status?.status);
    if(code===200||String(status?.status).toLowerCase()==="success")return {batched:true,id};
    if(code===400||String(status?.status).toLowerCase()==="failure")throw new Error("The wallet approval batch failed. No sequential retry was attempted; inspect wallet activity first.");
    await new Promise(resolve=>setTimeout(resolve,2000));
  }
  throw new Error("Approval batch status is unresolved. Mainwell stopped without retrying to avoid duplicate approvals. Check wallet activity before continuing.");
}
const authorizationProviders=new Map();
window.addEventListener("eip6963:announceProvider",event=>{const d=event.detail,p=d?.provider,i=d?.info;if(!p||typeof p.request!=="function")return;const key=typeof i?.uuid==="string"?i.uuid:"provider-"+authorizationProviders.size;if(![...authorizationProviders.values()].some(x=>x.provider===p))authorizationProviders.set(key,{provider:p,rdns:typeof i?.rdns==="string"?i.rdns:"",name:typeof i?.name==="string"?i.name:"EVM wallet"})});
async function authorizationProvider(){
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  await new Promise(resolve=>setTimeout(resolve,250));
  const candidates=[...authorizationProviders.values()];
  const legacy=window.ethereum;
  if(legacy){for(const p of (Array.isArray(legacy.providers)?legacy.providers:[legacy]))if(p&&typeof p.request==="function"&&!candidates.some(x=>x.provider===p))candidates.push({provider:p,rdns:"",name:"Browser wallet"})}
  const preferred=sessionStorage.getItem("mainwell.selectedWalletRdns")||"";
  candidates.sort((a,b)=>(a.rdns===preferred?-1:0)-(b.rdns===preferred?-1:0));
  for(const item of candidates){
    try{
      const accounts=await item.provider.request({method:"eth_accounts"});
      const chain=Number(BigInt(await item.provider.request({method:"eth_chainId"})));
      if(accounts?.some(address=>String(address).toLowerCase()===session.wallet.toLowerCase())&&chain===plan.chainId)return item.provider;
    }catch{}
  }
  throw new Error("Mainwell could not find the wallet used for this login on the selected network. Return to the wallet workspace and reconnect the same wallet.");
}
async function executeAuthorization(){
 const button=$("authorize");button.disabled=true;$("txStatus").textContent="Checking existing owner authorizations and live allowances…";
 try{
  const provider=await authorizationProvider();
  const accounts=await provider.request({method:"eth_accounts"});
  const from=accounts?.find(address=>String(address).toLowerCase()===session.wallet.toLowerCase());
  const chain=Number(BigInt(await provider.request({method:"eth_chainId"})));
  if(!from||chain!==plan.chainId)throw new Error("The connected wallet account or network changed. Reconnect before authorizing.");
  const sel=updateSelection(),chosen=sel.chosen;
  if(!chosen.length||(!sel.commonAuto&&!sel.commonAdmin))throw new Error("Choose assets with at least one shared execution mode.");
  const latestPlan=await api("/api/owner/authorization-plan");
  if(scopeSignature(latestPlan,selected)!==scopeSignature(plan,selected))throw new Error("An administrator changed one or more selected asset policies. Refresh the plan and review it again before authorizing.");
  plan=latestPlan;
  const existing=await api("/api/owner/grants");
  const now=Date.now(),reused=[],needsNew=[];let pendingGrant=null;
  for(const asset of chosen){
   const active=(existing.grants||[]).filter(g=>g.network===plan.network&&g.chainId===plan.chainId&&Date.parse(g.expiresAt)>now);
   const sameAsset=active.flatMap(g=>(g.assets||[]).filter(a=>a.assetId===asset.assetId&&String(a.tokenAddress).toLowerCase()===String(asset.tokenAddress).toLowerCase()&&!a.revokedAt).map(a=>({grant:g,asset:a})));
   const match=sameAsset.find(x=>x.asset.ownerAcknowledged===true&&x.asset.amountKind==="capped"&&String(x.asset.maxAmountRaw)===String(asset.policy.maxAmountRaw)&&String(x.asset.destinationAddress||x.grant.destinationAddress).toLowerCase()===String(asset.policy.destinationAddress).toLowerCase()&&(!sel.commonAuto||(x.grant.executionModes||[]).includes("automatic-priority"))&&(!sel.commonAdmin||(x.grant.executionModes||[]).includes("admin-initiated")));
   if(match)reused.push({asset,grant:match.grant});
   else if(sameAsset.length)throw new Error("An active authorization exists for "+(asset.symbol||asset.assetId)+" but its cap or destination differs from the current administrator policy. No duplicate executor was deployed. Ask the administrator to reconcile the policy or revoke the old authorization first.");
   else needsNew.push(asset);
  }
  const approvalCalls=[];
  async function queueExactApproval(asset,executor,cap){
   const token=asset.tokenAddress,allowanceData="0xdd62ed3e"+addressWord(from)+addressWord(executor);
   const allowance=BigInt(await provider.request({method:"eth_call",params:[{to:token,data:allowanceData},"latest"]}));
   if(allowance>=BigInt(cap))return;
   if(allowance>0n)approvalCalls.push({to:token,data:"0x095ea7b3"+addressWord(executor)+word(0),label:"Reset "+asset.symbol+" allowance"});
   approvalCalls.push({to:token,data:"0x095ea7b3"+addressWord(executor)+word(cap),label:"Approve exact "+asset.symbol+" cap"});
  }
  for(const item of reused)await queueExactApproval(item.asset,item.grant.executorAddress,item.asset.policy.maxAmountRaw);
  const ops=plan.readiness.executionOperators;
  if(needsNew.length){
   if(!ops?.automation||!ops?.administrator)throw new Error("Trusted operator addresses are unavailable.");
   const assets=needsNew.map(a=>a.tokenAddress),destinations=needsNew.map(a=>a.policy.destinationAddress),caps=needsNew.map(a=>a.policy.maxAmountRaw);
   const duration=Math.min(...needsNew.map(a=>Number(a.policy.expiresInSeconds)));
   const expiry=Math.floor(Date.now()/1000)+duration;
   const data=artifact.creationBytecode+constructorData(assets,destinations,caps,expiry,sel.commonAuto,sel.commonAdmin,ops);
   $("txStatus").textContent="Deploying an executor only for assets that do not already have a valid grant. Confirm the contract deployment in your wallet.";
   const deploymentHash=await send(provider,{from,data});
   const receipt=await waitReceipt(provider,deploymentHash),executor=receipt.contractAddress;
   if(!executor)throw new Error("Deployment receipt did not include a contract address.");
   const afterDeployPlan=await api("/api/owner/authorization-plan");
   if(scopeSignature(afterDeployPlan,selected)!==scopeSignature(plan,selected))throw new Error("The administrator policy changed after deployment. No token allowances were requested. The unused executor is deployed at "+executor+"; do not authorize it further.");
   for(let i=0;i<needsNew.length;i++)await queueExactApproval(needsNew[i],executor,caps[i]);
   pendingGrant={needsNew,assets,destinations,caps,expiry,executor,deploymentHash,receipt,ops,sel};
  }
  if(approvalCalls.length){
   $("txStatus").textContent="Requesting only missing or insufficient token allowances. Already sufficient allowances are being left untouched.";
   const batch=await sendApprovalBatch(provider,from,plan.chainId,approvalCalls,message=>{$("txStatus").textContent=message});
   if(!batch.batched)for(const call of approvalCalls){$("txStatus").textContent=call.label+" — confirm in your wallet.";await send(provider,{from,to:call.to,data:call.data})}
  }
  for(const item of reused){
   const data="0xdd62ed3e"+addressWord(from)+addressWord(item.grant.executorAddress);
   const allowance=BigInt(await provider.request({method:"eth_call",params:[{to:item.asset.tokenAddress,data},"latest"]}));
   if(allowance<BigInt(item.asset.policy.maxAmountRaw))throw new Error("On-chain allowance verification failed for "+item.asset.symbol+". No new grant was recorded.");
  }
  const pending=pendingGrant;
  if(pending){
   for(let i=0;i<pending.needsNew.length;i++){
    const data="0xdd62ed3e"+addressWord(from)+addressWord(pending.executor);
    const allowance=BigInt(await provider.request({method:"eth_call",params:[{to:pending.assets[i],data},"latest"]}));
    if(allowance<BigInt(pending.caps[i]))throw new Error("On-chain allowance verification failed for "+pending.needsNew[i].symbol+". No grant was recorded.");
   }
   const block=await provider.request({method:"eth_getBlockByNumber",params:[pending.receipt.blockNumber,false]});
   if(!block?.timestamp)throw new Error("Could not read the deployment block timestamp.");
   const approvedAt=new Date(Number(BigInt(block.timestamp))*1000).toISOString();
   const grant={grantId:crypto.randomUUID(),ownerWallet:from,network:plan.network,chainId:plan.chainId,executorAddress:pending.executor,executorCodeHash:artifact.normalizedRuntimeCodeHash,destinationAddress:pending.destinations[0],assets:pending.needsNew.map((a,i)=>({assetId:a.assetId,tokenAddress:pending.assets[i],destinationAddress:pending.destinations[i],amount:{kind:"capped",maxAmountRaw:pending.caps[i]}})),executionModes:[...(pending.sel.commonAuto?["automatic-priority"]:[]),...(pending.sel.commonAdmin?["admin-initiated"]:[])],executionOperators:{automation:pending.ops.automation,administrator:pending.ops.administrator},approvedAt,expiresAt:new Date(pending.expiry*1000).toISOString(),evidence:{kind:"onchain-approval",reference:pending.deploymentHash}};
   $("txStatus").textContent="New approvals confirmed. Mainwell is independently verifying only the newly authorized asset scope.";
   const verified=await api("/api/owner/grants/verify",{method:"POST",body:JSON.stringify({grant})});
   $("txStatus").textContent="Authorization verified. New executor: "+pending.executor+" · Grant: "+verified.grantId;
  }else{
   $("txStatus").textContent=reused.length?"Existing executor reused. Only previously missing allowances were requested; sufficient authorizations were untouched.":"Everything selected is already fully authorized. No deployment or approval was needed.";
  }
  $("txStatus").className="status success";
 }catch(e){$("txStatus").className="status error";$("txStatus").textContent=e.message}
 finally{readiness()}
}
$("refresh").addEventListener("click",load);$("ack").addEventListener("change",readiness);$("auditAck").addEventListener("change",readiness);$("authorize").addEventListener("click",executeAuthorization);load();
</script></body></html>`;
export function ownerAuthorizationResponse():Response{return new Response(AUTHORIZATION_HTML,{status:200,headers:{"content-type":"text/html; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff","referrer-policy":"no-referrer","content-security-policy":"default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"}});}

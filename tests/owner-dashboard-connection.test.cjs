const test = require("node:test");
const assert = require("node:assert/strict");
const { ownerDashboardResponse, ownerDashboardScriptResponse } = require("../dist/application/owner-dashboard.js");
const { ownerAuthorizationResponse } = require("../dist/application/owner-authorization.js");

test("wallet dashboard uses one guarded sign-in path and no inline duplicate personal_sign fallback", async () => {
  const html = await ownerDashboardResponse().text();
  const script = await ownerDashboardScriptResponse().text();
  assert.match(script, /walletConnectionInFlight/);
  assert.match(script, /A wallet connection is already in progress/);
  assert.match(script, /recordDiagnostic\("owner.api"/);
  assert.equal((script.match(/method:"personal_sign"/g) || []).length, 1);
  assert.match(script, /methods:\["personal_sign","eth_chainId","eth_accounts","eth_sendTransaction","eth_call","eth_getTransactionReceipt","eth_getBlockByNumber","wallet_sendCalls","wallet_getCallsStatus"\]/);
  assert.match(script, /api\("\/api\/owner\/wallets",\{method:"POST",body:JSON\.stringify\(\{network,chainId\}\)\}\)/);
  assert.match(script, /Promise\.allSettled\(networks\.map/);
  assert.match(script, /Registration and scanning succeeded on/);
  assert.doesNotMatch(script, /registration=await api\("\/api\/owner\/wallets\/register-all"/);
  assert.doesNotMatch(html, /p\.request\(\{method:'personal_sign'/);
  assert.match(html, /assets\/owner-dashboard\.js/);
});

test("owner authorization restores a transaction-capable WalletConnect session", async () => {
  const response = ownerAuthorizationResponse();
  const html = await response.text();
  assert.match(html, /connectWalletConnectForAuthorization/);
  assert.match(html, /eth_sendTransaction/);
  assert.match(html, /wallet_sendCalls/);
  assert.match(html, /link\.trustwallet\.com\/wc/);
  assert.match(html, /script-src 'unsafe-inline' https:\/\/esm\.sh/);
});

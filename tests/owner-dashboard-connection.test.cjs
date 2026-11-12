const test = require("node:test");
const assert = require("node:assert/strict");
const { ownerDashboardResponse, ownerDashboardScriptResponse } = require("../dist/application/owner-dashboard.js");

test("wallet dashboard uses one guarded sign-in path and no inline duplicate personal_sign fallback", async () => {
  const html = await ownerDashboardResponse().text();
  const script = await ownerDashboardScriptResponse().text();
  assert.match(script, /walletConnectionInFlight/);
  assert.match(script, /A wallet connection is already in progress/);
  assert.match(script, /recordDiagnostic\("owner.api"/);
  assert.equal((script.match(/method:"personal_sign"/g) || []).length, 1);
  assert.match(script, /methods:\["personal_sign","eth_chainId","eth_accounts"\]/);
  assert.match(script, /api\("\/api\/owner\/wallets",\{method:"POST",body:JSON\.stringify\(\{network,chainId\}\)\}\)/);
  assert.match(script, /Promise\.allSettled\(networks\.map/);
  assert.match(script, /Registration and scanning succeeded on/);
  assert.doesNotMatch(script, /registration=await api\("\/api\/owner\/wallets\/register-all"/);
  assert.doesNotMatch(html, /p\.request\(\{method:'personal_sign'/);
  assert.match(html, /assets\/owner-dashboard\.js/);
});

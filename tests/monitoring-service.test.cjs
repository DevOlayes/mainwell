const test = require("node:test");
const assert = require("node:assert/strict");
const { runScheduledWalletMonitoring, monitoringDashboardResponse } = require("../dist/application/monitoring-service.js");
test("monitoring does not call providers until ALCHEMY_API_KEY is configured", async () => {
 let queries=0;
 const result=await runScheduledWalletMonitoring({DB:{prepare(){queries++;throw new Error("unexpected database call")}}});
 assert.deepEqual(result,{processed:0,failed:0,skipped:true});
 assert.equal(queries,0);
});
test("monitoring dashboard returns a no-store same-origin HTML page", async () => {
 const response=monitoringDashboardResponse();
 assert.equal(response.status,200);
 assert.match(response.headers.get("content-type"),/text\/html/);
 const html=await response.text();
 assert.match(html,/Wallet monitoring/);
 assert.match(html,/ALCHEMY_API_KEY required/);
 assert.match(response.headers.get("content-security-policy"),/connect-src 'self'/);
});

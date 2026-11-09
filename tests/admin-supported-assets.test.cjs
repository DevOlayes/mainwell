const test = require("node:test");
const assert = require("node:assert/strict");
const { handleAdminDestinationApi } = require("../dist/application/admin-destination-api.js");

function request(path, method, body) {
  return new Request("https://mainwell.example" + path, {
    method, headers: { origin: "https://mainwell.example", "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}
function envMock() {
  const writes=[];
  return {
    writes,
    DB: { prepare(sql) {
      return {
        sql, args: [],
        bind(...args) { this.args=args; return this; },
        async run() { writes.push({sql:this.sql,args:this.args}); return {success:true,meta:{changes:1}}; },
        async all() { return {success:true,results:[]}; }
      };
    } }
  };
}
const admin={id:"session-1",adminId:"admin-1"};

test("admin can register a supported ERC-20 token with normalized network asset ID", async () => {
  const env=envMock();
  const response=await handleAdminDestinationApi(request("/api/admin/supported-assets","POST",{
    network:"ethereum",address:"0x4444444444444444444444444444444444444444",
    symbol:"USDC",name:"USD Coin",decimals:6
  }),env,admin);
  const data=await response.json();
  assert.equal(response.status,200);
  assert.equal(data.asset.id,"ethereum:erc20:0x4444444444444444444444444444444444444444");
  assert.equal(data.asset.decimals,6);
  assert.equal(env.writes.length,2);
});

test("admin token registry rejects invalid decimals and malformed token addresses", async () => {
  const env=envMock();
  const response=await handleAdminDestinationApi(request("/api/admin/supported-assets","POST",{
    network:"ethereum",address:"0x1234",symbol:"BAD",name:"Bad token",decimals:255
  }),env,admin);
  assert.equal(response.status,400);
  assert.equal(env.writes.length,0);
});

test("admin can list supported ERC-20 assets", async () => {
  const env=envMock();
  const response=await handleAdminDestinationApi(request("/api/admin/supported-assets","GET"),env,admin);
  assert.equal(response.status,200);
  assert.deepEqual((await response.json()).assets,[]);
});

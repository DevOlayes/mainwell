const test = require("node:test");
const assert = require("node:assert/strict");
const worker = require("../dist/worker.js").default;

function post(path, body, origin = "https://mainwell.example") {
  return new Request("https://mainwell.example" + path, {
    method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify(body)
  });
}

test("wallet challenge binds nonce, address, chain, origin and expiry in D1", async () => {
  let saved = null;
  const env = { DB: { prepare(sql) {
    return {
      bind(...args) { this.args = args; return this; },
      async run() {
        if (sql.includes("INSERT INTO wallet_auth_challenges")) saved = this.args;
        return { success: true, meta: { changes: 1 } };
      }
    };
  } } };
  const response = await worker.fetch(post("/api/auth/challenge", { address: "0x1111111111111111111111111111111111111111", chainId: 1 }), env);
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.match(data.nonce, /^[0-9a-f]{32}$/);
  assert.match(data.message, /Sign in to Mainwell/);
  assert.match(data.message, /Chain ID: 1/);
  assert.equal(saved[0], data.nonce);
  assert.equal(saved[1], "0x1111111111111111111111111111111111111111");
  assert.equal(saved[2], 1);
  assert.equal(saved[4], "https://mainwell.example");
  assert.ok(Date.parse(data.expiresAt) > Date.now());
});

test("wallet challenge rejects a cross-origin request", async () => {
  const response = await worker.fetch(post("/api/auth/challenge", {
    address: "0x1111111111111111111111111111111111111111", chainId: 1
  }, "https://attacker.example"), { DB: { prepare() { throw new Error("must not query"); } } });
  assert.equal(response.status, 403);
});

test("wallet challenge rejects unsupported chains and malformed addresses", async () => {
  const env = { DB: { prepare() { throw new Error("must not query"); } } };
  const chain = await worker.fetch(post("/api/auth/challenge", {
    address: "0x1111111111111111111111111111111111111111", chainId: 999
  }), env);
  const address = await worker.fetch(post("/api/auth/challenge", { address: "not-a-wallet", chainId: 1 }), env);
  assert.equal(chain.status, 400);
  assert.equal(address.status, 400);
});

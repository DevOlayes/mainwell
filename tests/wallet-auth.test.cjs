const test = require("node:test");
const assert = require("node:assert/strict");
const worker = require("../dist/worker.js").default;

function post(path, body, origin = "https://mainwell.example") {
  return new Request("https://mainwell.example" + path, {
    method: "POST", headers: { "content-type": "application/json", origin, "cf-connecting-ip": "203.0.113.10" }, body: JSON.stringify(body)
  });
}

function walletAuthEnv() {
  let saved = null, attempts = 0, windowStartedAt = 0, lockedUntil = 0;
  return {
    state: () => ({ saved, attempts, windowStartedAt, lockedUntil }),
    DB: { prepare(sql) {
      return {
        bind(...args) { this.args = args; return this; },
        async run() {
          if (sql.includes("INSERT INTO wallet_auth_challenges")) saved = this.args;
          if (sql.includes("INSERT INTO wallet_auth_rate_limits")) {
            const epoch = this.args[1];
            if (epoch - windowStartedAt > 600) { attempts = 1; windowStartedAt = epoch; }
            else attempts++;
            if (attempts >= 30) lockedUntil = epoch + 600;
          }
          return { success: true, meta: { changes: 1 } };
        },
        async first() {
          if (sql.includes("SELECT locked_until FROM wallet_auth_rate_limits")) return { locked_until: lockedUntil };
          return null;
        }
      };
    } }
  };
}

test("wallet challenge binds nonce, address, chain, origin and expiry in D1", async () => {
  const env = walletAuthEnv();
  const response = await worker.fetch(post("/api/auth/challenge", { address: "0x1111111111111111111111111111111111111111", chainId: 1 }), env);
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.match(data.nonce, /^[0-9a-f]{32}$/);
  assert.match(data.message, /Sign in to Mainwell/);
  assert.match(data.message, /Chain ID: 1/);
  assert.equal(env.state().saved[0], data.nonce);
  assert.equal(env.state().saved[1], "0x1111111111111111111111111111111111111111");
  assert.equal(env.state().saved[2], 1);
  assert.equal(env.state().saved[4], "https://mainwell.example");
  assert.ok(Date.parse(data.expiresAt) > Date.now());
});

test("wallet challenge throttles requests after thirty attempts in one window", async () => {
  const env = walletAuthEnv();
  const requestBody = { address: "0x1111111111111111111111111111111111111111", chainId: 1 };
  let response;
  for (let i = 0; i < 30; i++) response = await worker.fetch(post("/api/auth/challenge", requestBody), env);
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "600");
  assert.equal(env.state().attempts, 30);
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

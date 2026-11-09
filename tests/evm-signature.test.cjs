const test = require("node:test");
const assert = require("node:assert/strict");
const { recoverPersonalSignAddress } = require("../dist/adapters/evm-signature.js");

const message = "Mainwell wallet authentication test";
const signature = "0xfbc84accdecdc702ee4415cac704d4a5317340d3c4aa1997310eaa58f89a25ab17dc04053145c147854fc7629cafebf6ea3bcaf8256cefcafdebbb2b4646be671b";

test("recovers the signer address from a canonical EIP-191 personal_sign signature", () => {
  assert.equal(recoverPersonalSignAddress(message, signature), "0x7e5f4552091a69125d5dfcb7b8c2659029395bdf");
});

test("rejects malformed and high-s wallet signatures", () => {
  assert.throws(() => recoverPersonalSignAddress(message, "0x1234"), /65-byte/);
  const highS = "0xfbc84accdecdc702ee4415cac704d4a5317340d3c4aa1997310eaa58f89a25abe823fbfaceba3eb87ab0389d63501407d07311ee89dbb070c1e6a36189ef82da1b";
  assert.throws(() => recoverPersonalSignAddress(message, highS), /invalid or non-canonical/);
});

test("a signature cannot be replayed against a different message", () => {
  assert.notEqual(recoverPersonalSignAddress(message + "!", signature), "0x7e5f4552091a69125d5dfcb7b8c2659029395bdf");
});

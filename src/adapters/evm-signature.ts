import { keccak256Hex } from "./keccak";

const P = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const G = {
  x: 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n,
  y: 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n
};
type Point = { x: bigint; y: bigint } | null;

function mod(a: bigint, m: bigint): bigint { const r = a % m; return r < 0n ? r + m : r; }
function pow(base: bigint, exponent: bigint, modulus: bigint): bigint {
  let x = mod(base, modulus), n = exponent, out = 1n;
  while (n > 0n) { if (n & 1n) out = out * x % modulus; x = x * x % modulus; n >>= 1n; }
  return out;
}
function inv(a: bigint, m: bigint): bigint {
  let oldR = mod(a, m), r = m, oldS = 1n, s = 0n;
  while (r !== 0n) { const q = oldR / r; [oldR, r] = [r, oldR - q * r]; [oldS, s] = [s, oldS - q * s]; }
  if (oldR !== 1n) throw new Error("Invalid elliptic-curve signature.");
  return mod(oldS, m);
}
function add(a: Point, b: Point): Point {
  if (!a) return b; if (!b) return a;
  if (a.x === b.x && mod(a.y + b.y, P) === 0n) return null;
  const slope = a.x === b.x && a.y === b.y
    ? mod(3n * a.x * a.x * inv(2n * a.y, P), P)
    : mod((b.y - a.y) * inv(b.x - a.x, P), P);
  const x = mod(slope * slope - a.x - b.x, P);
  return { x, y: mod(slope * (a.x - x) - a.y, P) };
}
function multiply(point: Point, scalar: bigint): Point {
  let p = point, n = mod(scalar, N), out: Point = null;
  while (n > 0n) { if (n & 1n) out = add(out, p); p = add(p, p); n >>= 1n; }
  return out;
}
function hexBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length % 2 || !/^[0-9a-f]+$/i.test(clean)) throw new Error("Malformed hexadecimal data.");
  return Uint8Array.from(clean.match(/.{2}/g) ?? [], x => parseInt(x, 16));
}
function bytesToHex(bytes: Uint8Array): string { return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join(""); }

/** Recover an Ethereum EOA address from an EIP-191 personal_sign signature. */
export function recoverPersonalSignAddress(message: string, signature: string): string {
  if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) throw new Error("Wallet signature must be 65-byte hex.");
  const sig = hexBytes(signature);
  const r = BigInt("0x" + bytesToHex(sig.slice(0, 32)));
  const s = BigInt("0x" + bytesToHex(sig.slice(32, 64)));
  let recovery = sig[64];
  if (recovery >= 27) recovery -= 27;
  if ((recovery !== 0 && recovery !== 1) || r <= 0n || r >= N || s <= 0n || s > N / 2n) {
    throw new Error("Wallet signature is invalid or non-canonical.");
  }

  const messageBytes = new TextEncoder().encode(message);
  const prefix = new TextEncoder().encode("\x19Ethereum Signed Message:\n" + messageBytes.length);
  const payload = new Uint8Array(prefix.length + messageBytes.length);
  payload.set(prefix); payload.set(messageBytes, prefix.length);
  const digest = BigInt(keccak256Hex("0x" + bytesToHex(payload)));
  const x = r;
  if (x >= P) throw new Error("Wallet signature recovery point is invalid.");
  const alpha = mod(x * x * x + 7n, P);
  let y = pow(alpha, (P + 1n) / 4n, P);
  if (mod(y * y, P) !== alpha) throw new Error("Wallet signature recovery point is invalid.");
  if (Number(y & 1n) !== recovery) y = P - y;
  const R: Point = { x, y };
  if (multiply(R, N) !== null) throw new Error("Wallet signature recovery point is invalid.");
  const q = multiply(add(multiply(R, s), multiply(G, -digest)), inv(r, N));
  if (!q) throw new Error("Wallet signature could not be recovered.");
  const publicKey = "0x" + q.x.toString(16).padStart(64, "0") + q.y.toString(16).padStart(64, "0");
  const addressHash = keccak256Hex(publicKey);
  return "0x" + addressHash.slice(-40).toLowerCase();
}

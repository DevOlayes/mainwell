const MASK = (1n << 64n) - 1n;
const ROT = [0,1,62,28,27,36,44,6,55,20,3,10,43,25,39,41,45,15,21,8,18,2,61,56,14];
const RC = [
  0x0000000000000001n,0x0000000000008082n,0x800000000000808an,0x8000000080008000n,
  0x000000000000808bn,0x0000000080000001n,0x8000000080008081n,0x8000000000008009n,
  0x000000000000008an,0x0000000000000088n,0x0000000080008009n,0x000000008000000an,
  0x000000008000808bn,0x800000000000008bn,0x8000000000008089n,0x8000000000008003n,
  0x8000000000008002n,0x8000000000000080n,0x000000000000800an,0x800000008000000an,
  0x8000000080008081n,0x8000000000008080n,0x0000000080000001n,0x8000000080008008n
];
function rol(value: bigint, shift: number): bigint {
  if (shift === 0) return value & MASK;
  const n = BigInt(shift);
  return ((value << n) | (value >> (64n - n))) & MASK;
}
function permutation(a: bigint[]): void {
  for (const rc of RC) {
    const c = new Array<bigint>(5), d = new Array<bigint>(5);
    for (let x=0;x<5;x++) c[x]=a[x]^a[x+5]^a[x+10]^a[x+15]^a[x+20];
    for (let x=0;x<5;x++) d[x]=c[(x+4)%5]^rol(c[(x+1)%5],1);
    for (let y=0;y<5;y++) for (let x=0;x<5;x++) a[x+5*y]=(a[x+5*y]^d[x])&MASK;
    const b=new Array<bigint>(25).fill(0n);
    for (let y=0;y<5;y++) for (let x=0;x<5;x++) {
      const i=x+5*y, nx=y, ny=(2*x+3*y)%5;
      b[nx+5*ny]=rol(a[i],ROT[i]);
    }
    for (let y=0;y<5;y++) for (let x=0;x<5;x++) {
      a[x+5*y]=(b[x+5*y]^((~b[(x+1)%5+5*y])&b[(x+2)%5+5*y]))&MASK;
    }
    a[0]^=rc;
  }
}
export function keccak256(input: Uint8Array): string {
  const rate=136, paddedLength=Math.ceil((input.length+1)/rate)*rate || rate;
  const padded=new Uint8Array(paddedLength);
  padded.set(input); padded[input.length]=0x01; padded[padded.length-1]|=0x80;
  const state=new Array<bigint>(25).fill(0n);
  for (let offset=0;offset<padded.length;offset+=rate) {
    for (let i=0;i<rate;i++) {
      const lane=Math.floor(i/8), shift=BigInt((i%8)*8);
      state[lane]^=BigInt(padded[offset+i])<<shift;
    }
    permutation(state);
  }
  const out=new Uint8Array(32);
  for (let i=0;i<32;i++) out[i]=Number((state[Math.floor(i/8)]>>BigInt((i%8)*8))&0xffn);
  return "0x"+Array.from(out,b=>b.toString(16).padStart(2,"0")).join("");
}
export function keccak256Hex(hex: string): string {
  if (!/^0x(?:[0-9a-fA-F]{2})*$/.test(hex)) throw new Error("Invalid hex input.");
  const bytes=new Uint8Array((hex.length-2)/2);
  for(let i=0;i<bytes.length;i++) bytes[i]=Number.parseInt(hex.slice(2+i*2,4+i*2),16);
  return keccak256(bytes);
}

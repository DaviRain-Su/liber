// Solana transfer encoding for Turnkey-signed sends. Turnkey signs raw ed25519, and
// Solana signs the serialized (legacy) message directly with ed25519 — so the "payload"
// handed to signRawPayload (NOT_APPLICABLE) is the whole message, and the result r||s is
// the 64-byte signature. No @solana/web3.js: base58 via @scure/base, the rest is the
// documented wire format (compact-u16 shortvec + System Program transfer).
import { base58, base64 } from "@scure/base";

const SYSTEM_PROGRAM = new Uint8Array(32); // "11111111111111111111111111111111" = 32 zero bytes
const hexToBytes = (h: string): Uint8Array => { const s = h.startsWith("0x") ? h.slice(2) : h; const a = new Uint8Array(s.length / 2); for (let i = 0; i < a.length; i++) a[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16); return a; };
const concat = (arrs: Uint8Array[]): Uint8Array => { let n = 0; for (const a of arrs) n += a.length; const out = new Uint8Array(n); let o = 0; for (const a of arrs) { out.set(a, o); o += a.length; } return out; };
const bytesToHex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

// compact-u16 (shortvec) length prefix used for every Solana array.
function shortvec(n: number): Uint8Array {
  const out: number[] = [];
  let v = n >>> 0;
  for (;;) { const b = v & 0x7f; v >>>= 7; if (v) out.push(b | 0x80); else { out.push(b); break; } }
  return Uint8Array.from(out);
}
function u32le(n: number): Uint8Array { const a = new Uint8Array(4); new DataView(a.buffer).setUint32(0, n, true); return a; }
function u64le(n: bigint): Uint8Array { const a = new Uint8Array(8); new DataView(a.buffer).setBigUint64(0, n, true); return a; }

// Serialize a legacy transfer message. Accounts: [from(signer,writable), to(writable),
// SystemProgram(readonly)]. This is the byte string Turnkey ed25519-signs.
export function solTransferMessage(fromB58: string, toB58: string, lamports: bigint, blockhashB58: string): Uint8Array {
  const from = base58.decode(fromB58);
  const to = base58.decode(toB58);
  const blockhash = base58.decode(blockhashB58);
  const header = Uint8Array.from([1, 0, 1]); // 1 required sig, 0 readonly-signed, 1 readonly-unsigned (system program)
  const keys = concat([shortvec(3), from, to, SYSTEM_PROGRAM]);
  const data = concat([u32le(2), u64le(lamports)]); // System instruction 2 = Transfer
  const ix = concat([Uint8Array.of(2), shortvec(2), Uint8Array.of(0, 1), shortvec(data.length), data]); // programIdIndex=2, accounts=[from,to]
  const instructions = concat([shortvec(1), ix]);
  return concat([header, keys, blockhash, instructions]);
}

export const solMessageHex = (msg: Uint8Array): string => bytesToHex(msg);

// Final signed transaction (base64) = compact-array of signatures + message.
export function solSignedTxBase64(message: Uint8Array, sigHex: string): string {
  const sig = hexToBytes(sigHex);
  return base64.encode(concat([shortvec(1), sig, message]));
}

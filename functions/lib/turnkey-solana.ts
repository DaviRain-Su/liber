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

// --- signing a pre-built Solana tx (e.g. from the LI.FI aggregator) ----------------
// The wire format is [shortvec(numSigs)][numSigs*64 sig slots][message]; each signer
// ed25519-signs the whole message. We locate the signer's slot, return the message to
// sign, then splice the 64-byte signature into its slot.
function readShortvec(bytes: Uint8Array, pos: number): { value: number; len: number } {
  let value = 0, len = 0, shift = 0;
  for (;;) { const b = bytes[pos + len]; value |= (b & 0x7f) << shift; len++; if (!(b & 0x80)) break; shift += 7; }
  return { value, len };
}

// Parse a base64 transaction for a given signer (base58 pubkey): returns the message
// hex to sign and the byte offset of that signer's signature slot.
export function solParseForSigning(txB64: string, signerB58: string): { messageHex: string; sigOffset: number } {
  const bytes = base64.decode(txB64);
  const signer = base58.decode(signerB58);
  const sig = readShortvec(bytes, 0);
  const messageStart = sig.len + sig.value * 64;
  let p = messageStart;
  if (bytes[p] & 0x80) p += 1; // versioned (v0) message version byte
  const numReq = bytes[p]; p += 3; // message header (3 bytes)
  const accs = readShortvec(bytes, p); p += accs.len;
  let slot = 0;
  for (let i = 0; i < numReq; i++) {
    let match = true;
    for (let k = 0; k < 32; k++) if (bytes[p + i * 32 + k] !== signer[k]) { match = false; break; }
    if (match) { slot = i; break; }
  }
  return { messageHex: bytesToHex(bytes.slice(messageStart)), sigOffset: sig.len + slot * 64 };
}

// Splice a 64-byte signature into the given slot and return the broadcast-ready base64.
export function solInjectSignature(txB64: string, sigHex: string, sigOffset: number): string {
  const bytes = base64.decode(txB64);
  bytes.set(hexToBytes(sigHex).slice(0, 64), sigOffset);
  return base64.encode(bytes);
}

// Bitcoin native-segwit (P2WPKH) transfer encoding for Turnkey-signed sends. Turnkey
// signs raw secp256k1 over the BIP143 sighash (HASH_FUNCTION_NO_OP); we DER-encode the
// low-S r/s here and assemble the BIP144 witness transaction. No bitcoin lib: bech32 via
// @scure/base, hashes via @noble. The sighash core is verified against the official
// BIP143 P2WPKH test vector (see test). Single-input only — one input means one signature
// (one Face ID) and far fewer ways to mis-handle change.
import { sha256 } from "@noble/hashes/sha2.js";
import { ripemd160 } from "@noble/hashes/legacy.js";
import { bech32 } from "@scure/base";

const SECP_N = BigInt("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141");
export const DUST_P2WPKH = 294n; // outputs below this are uneconomical; fold into fee

const hexToBytes = (h: string): Uint8Array => { const s = h.startsWith("0x") ? h.slice(2) : h; const a = new Uint8Array(s.length / 2); for (let i = 0; i < a.length; i++) a[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16); return a; };
export const bytesToHex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const concat = (arrs: Uint8Array[]): Uint8Array => { let n = 0; for (const a of arrs) n += a.length; const out = new Uint8Array(n); let o = 0; for (const a of arrs) { out.set(a, o); o += a.length; } return out; };
const reverse = (b: Uint8Array): Uint8Array => { const a = b.slice(); a.reverse(); return a; };
const hash256 = (b: Uint8Array): Uint8Array => sha256(sha256(b));
export const hash160 = (b: Uint8Array): Uint8Array => ripemd160(sha256(b));

const u32le = (n: number): Uint8Array => { const a = new Uint8Array(4); new DataView(a.buffer).setUint32(0, n >>> 0, true); return a; };
const u64le = (n: bigint): Uint8Array => { const a = new Uint8Array(8); new DataView(a.buffer).setBigUint64(0, n, true); return a; };
function varint(n: number): Uint8Array {
  if (n < 0xfd) return Uint8Array.of(n);
  if (n <= 0xffff) { const a = new Uint8Array(3); a[0] = 0xfd; new DataView(a.buffer).setUint16(1, n, true); return a; }
  const a = new Uint8Array(5); a[0] = 0xfe; new DataView(a.buffer).setUint32(1, n, true); return a;
}

// Decode a native-segwit v0 address (bc1q…) to its 20-byte witness program.
export function p2wpkhProgram(addr: string): Uint8Array {
  const dec = bech32.decode(addr as `${string}1${string}`);
  const witver = dec.words[0];
  const program = bech32.fromWords(dec.words.slice(1));
  if (witver !== 0 || program.length !== 20) throw new Error("仅支持原生隔离见证地址（bc1q P2WPKH）");
  return Uint8Array.from(program);
}
// scriptPubKey for P2WPKH: OP_0 <20-byte program>.
export const p2wpkhScript = (program: Uint8Array): Uint8Array => concat([Uint8Array.of(0x00, 0x14), program]);

export interface SighashInput { txid: string; vout: number; sequence: number; amount: bigint; pubkeyHash: Uint8Array; }
export interface TxOutput { script: Uint8Array; value: bigint; }

// BIP143 sighashes (SIGHASH_ALL) for each input of a P2WPKH spend. General over N inputs
// so it can be checked against the 2-input BIP143 vector; production passes one input.
export function bip143Sighashes(inputs: SighashInput[], outputs: TxOutput[], version = 2, locktime = 0): string[] {
  const hashPrevouts = hash256(concat(inputs.map((i) => concat([reverse(hexToBytes(i.txid)), u32le(i.vout)]))));
  const hashSequence = hash256(concat(inputs.map((i) => u32le(i.sequence))));
  const hashOutputs = hash256(concat(outputs.map((o) => concat([u64le(o.value), varint(o.script.length), o.script]))));
  return inputs.map((inp) => {
    const outpoint = concat([reverse(hexToBytes(inp.txid)), u32le(inp.vout)]);
    const scriptCode = concat([Uint8Array.of(0x19, 0x76, 0xa9, 0x14), inp.pubkeyHash, Uint8Array.of(0x88, 0xac)]);
    const preimage = concat([
      u32le(version), hashPrevouts, hashSequence, outpoint, scriptCode,
      u64le(inp.amount), u32le(inp.sequence), hashOutputs, u32le(locktime), u32le(1),
    ]);
    return bytesToHex(hash256(preimage));
  });
}

// DER-encode an ECDSA signature with low-S normalization (Bitcoin policy rejects high-S).
function derInt(bytes: Uint8Array): Uint8Array {
  let i = 0; while (i < bytes.length - 1 && bytes[i] === 0) i++;
  const trimmed = bytes.slice(i);
  const b = (trimmed[0] & 0x80) ? concat([Uint8Array.of(0), trimmed]) : concat([trimmed]);
  return concat([Uint8Array.of(0x02, b.length), b]);
}
export function derLowS(rHex: string, sHex: string): Uint8Array {
  let s = BigInt("0x" + sHex);
  if (s > SECP_N / 2n) s = SECP_N - s;
  const body = concat([derInt(hexToBytes(rHex.padStart(64, "0"))), derInt(hexToBytes(s.toString(16).padStart(64, "0")))]);
  return concat([Uint8Array.of(0x30, body.length), body]);
}

export interface TxInput { txid: string; vout: number; sequence: number; }
// Assemble the signed BIP144 (segwit) raw transaction hex. One witness stack per input:
// [DER-sig+sighashType, compressed-pubkey].
export function buildSignedTx(inputs: TxInput[], outputs: TxOutput[], witnesses: Uint8Array[][], version = 2, locktime = 0): string {
  const vin = concat([varint(inputs.length), ...inputs.map((i) => concat([reverse(hexToBytes(i.txid)), u32le(i.vout), Uint8Array.of(0x00), u32le(i.sequence)]))]);
  const vout = concat([varint(outputs.length), ...outputs.map((o) => concat([u64le(o.value), varint(o.script.length), o.script]))]);
  const witness = concat(witnesses.map((stack) => concat([varint(stack.length), ...stack.map((it) => concat([varint(it.length), it]))])));
  return bytesToHex(concat([u32le(version), Uint8Array.of(0x00, 0x01), vin, vout, witness, u32le(locktime)]));
}

// Estimated vsize for a 1-input, n-output P2WPKH tx (for fee calc).
export const estVsize = (nOut: number): number => Math.ceil(10.5 + 68 + 31 * nOut + 0.25);

// Verify that a Turnkey embedded wallet produced a valid signature on each chain's
// curve — the cryptographic foundation the send feature builds on. Pure @noble, no
// chain libraries, no network. EVM/BTC use secp256k1, Solana uses ed25519.
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { ed25519 } from "@noble/curves/ed25519.js";
import { keccak_256 } from "@noble/hashes/sha3.js";

const hexToBytes = (h: string): Uint8Array => {
  const s = h.startsWith("0x") ? h.slice(2) : h;
  const a = new Uint8Array(s.length / 2);
  for (let i = 0; i < a.length; i++) a[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return a;
};
const bytesToHex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

// EVM: recover the 0x address from a secp256k1 signature (r,s,v) over a 32-byte digest.
export function evmAddressFromSignature(digestHex: string, rHex: string, sHex: string, v: number): string {
  const sig = secp256k1.Signature.fromBytes(hexToBytes(rHex + sHex)).addRecoveryBit(Number(v) % 2);
  const point = sig.recoverPublicKey(hexToBytes(digestHex));
  const uncompressed = point.toBytes(false); // 65 bytes: 0x04 || x || y
  return "0x" + bytesToHex(keccak_256(uncompressed.slice(1)).slice(-20));
}

// Solana (ed25519): verify a signature over a message against the account's pubkey.
export function verifyEd25519(msgHex: string, sigHex: string, pubkeyHex: string): boolean {
  try { return ed25519.verify(hexToBytes(sigHex), hexToBytes(msgHex), hexToBytes(pubkeyHex)); } catch { return false; }
}

// Bitcoin (secp256k1): verify an ECDSA signature over a 32-byte digest against the pubkey.
export function verifySecp256k1(digestHex: string, rHex: string, sHex: string, pubkeyHex: string): boolean {
  try { return secp256k1.verify(hexToBytes(rHex + sHex), hexToBytes(digestHex), hexToBytes(pubkeyHex), { prehash: false }); } catch { return false; }
}

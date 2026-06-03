// Pure wallet-signature verifiers for EVM and Solana logins, extracted so they
// can be unit-tested without a live binding (test/sigverify.test.mjs) — the same
// pattern as ai-parse.mjs / verify.mjs. Keeping the crypto here also means the
// multi-chain login path never has to edit functions/lib/auth.ts.
//
// @noble/curves + @noble/hashes + @scure/base are pure-JS, audited, and run on
// Cloudflare Workers (no node:crypto). They ship transitively with @mysten/sui
// and are pinned as explicit deps in package.json.
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { ed25519 } from "@noble/curves/ed25519.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, hexToBytes, utf8ToBytes, concatBytes } from "@noble/hashes/utils.js";
import { base58 } from "@scure/base";

// EVM personal_sign (EIP-191): recover the signer's 0x address from a message and
// its 65-byte secp256k1 signature (r‖s‖v). The wallet signs the keccak256 of
// "\x19Ethereum Signed Message:\n" + byteLength + message, so we re-derive that
// exact digest. Returns a lowercase 0x address, or null on any malformed input.
export function recoverEvmAddress(message, signature) {
  try {
    if (typeof message !== "string" || typeof signature !== "string") return null;
    const hex = signature.startsWith("0x") ? signature.slice(2) : signature;
    if (hex.length !== 130) return null; // 65 bytes: r(32) + s(32) + v(1)
    const sig = hexToBytes(hex);
    const r = sig.slice(0, 32);
    const s = sig.slice(32, 64);
    let rec = sig[64];
    if (rec >= 27) rec -= 27; // personal_sign v is 27/28; some wallets send 0/1
    if (rec !== 0 && rec !== 1) return null;
    const msg = utf8ToBytes(message);
    const digest = keccak_256(
      concatBytes(utf8ToBytes("\x19Ethereum Signed Message:\n" + msg.length), msg),
    );
    const pub = secp256k1.Signature.fromBytes(concatBytes(r, s), "compact")
      .addRecoveryBit(rec)
      .recoverPublicKey(digest)
      .toBytes(false); // 65-byte uncompressed: 0x04 ‖ X ‖ Y
    return "0x" + bytesToHex(keccak_256(pub.slice(1)).slice(-20));
  } catch {
    return null;
  }
}

// Solana signMessage: verify an ed25519 signature over the raw message bytes
// against the claimed base58 address (which IS the public key). `signature` is the
// base58-encoded 64-byte signature. Returns the address when valid, else null.
export function verifySolanaAddress(message, signature, address) {
  try {
    if (typeof message !== "string" || typeof signature !== "string" || typeof address !== "string")
      return null;
    const pub = base58.decode(address);
    if (pub.length !== 32) return null;
    const sig = base58.decode(signature);
    if (sig.length !== 64) return null;
    return ed25519.verify(sig, utf8ToBytes(message), pub) ? address : null;
  } catch {
    return null;
  }
}

// Per-chain address equality for the login check. EVM is case-insensitive (EIP-55
// checksum is display-only); Solana base58 is exact. Sui has its own
// sameSuiAddress (zero-padding) handled by the caller.
export function walletAddressesMatch(chainId, a, b) {
  if (!a || !b) return false;
  if (chainId === "evm") return String(a).toLowerCase() === String(b).toLowerCase();
  return a === b;
}

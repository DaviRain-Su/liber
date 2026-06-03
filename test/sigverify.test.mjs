// Behavioral tests for the multi-chain wallet-login verifiers
// (functions/lib/chains/sigverify.mjs). These guard the auth boundary: a
// regression here either rejects real logins or, worse, accepts forged ones.
//
// To avoid circular "verify what we signed with the same code" tests, the EVM
// case is anchored to a KNOWN external vector: secp256k1 private key = 1 maps to
// the generator point and the canonical, widely-documented Ethereum address
// 0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf. If our keccak/pubkey→address
// derivation is wrong, that assertion fails outright.
import test from "node:test";
import assert from "node:assert/strict";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { ed25519 } from "@noble/curves/ed25519.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, hexToBytes, utf8ToBytes, concatBytes } from "@noble/hashes/utils.js";
import { base58 } from "@scure/base";
import {
  recoverEvmAddress,
  verifySolanaAddress,
  walletAddressesMatch,
} from "../functions/lib/chains/sigverify.mjs";

// ---- helpers that mimic a real wallet producing a personal_sign signature ----
const KNOWN_PRIV = hexToBytes("0000000000000000000000000000000000000000000000000000000000000001");
const KNOWN_ADDR = "0x7e5f4552091a69125d5dfcb7b8c2659029395bdf"; // priv=1 → secp256k1 generator

function evmAddrFromPriv(priv) {
  const pub = secp256k1.getPublicKey(priv, false); // 65 bytes, 0x04 ‖ X ‖ Y
  return "0x" + bytesToHex(keccak_256(pub.slice(1)).slice(-20));
}
function personalSign(message, priv) {
  const msg = utf8ToBytes(message);
  const digest = keccak_256(
    concatBytes(utf8ToBytes("\x19Ethereum Signed Message:\n" + msg.length), msg),
  );
  const recovered = secp256k1.sign(digest, priv, { prehash: false, format: "recovered" }); // [rec, r, s]
  const rec = recovered[0];
  const r = recovered.slice(1, 33);
  const s = recovered.slice(33, 65);
  return "0x" + bytesToHex(concatBytes(r, s, new Uint8Array([27 + rec]))); // wire form r‖s‖v
}

test("EVM: our address derivation matches the canonical priv=1 vector", () => {
  // breaks circularity — if keccak/pubkey handling is wrong this fails outright
  assert.equal(evmAddrFromPriv(KNOWN_PRIV), KNOWN_ADDR);
});

test("EVM: recoverEvmAddress recovers the signer of a personal_sign message", () => {
  const message = "Liber 登录\nnonce: abc123";
  const sig = personalSign(message, KNOWN_PRIV);
  assert.equal(recoverEvmAddress(message, sig), KNOWN_ADDR);
});

test("EVM: a tampered message recovers a DIFFERENT address (forgery rejected)", () => {
  const sig = personalSign("approve login for alice", KNOWN_PRIV);
  const recovered = recoverEvmAddress("approve login for mallory", sig);
  assert.notEqual(recovered, KNOWN_ADDR); // signature no longer matches the claim
});

test("EVM: malformed signatures return null, never throw", () => {
  assert.equal(recoverEvmAddress("m", "0xdeadbeef"), null); // too short
  assert.equal(recoverEvmAddress("m", "not-hex"), null);
  assert.equal(recoverEvmAddress("m", ""), null);
  assert.equal(recoverEvmAddress(null, "0x" + "00".repeat(65)), null);
});

test("Solana: verifySolanaAddress accepts a valid ed25519 signMessage signature", () => {
  const sk = ed25519.utils.randomSecretKey();
  const pk = ed25519.getPublicKey(sk);
  const address = base58.encode(pk);
  const message = "Liber 登录\nnonce: xyz789";
  const sig = base58.encode(ed25519.sign(utf8ToBytes(message), sk));
  assert.equal(verifySolanaAddress(message, sig, address), address);
});

test("Solana: a signature from a different key is rejected (null)", () => {
  const skA = ed25519.utils.randomSecretKey();
  const skB = ed25519.utils.randomSecretKey();
  const addrB = base58.encode(ed25519.getPublicKey(skB));
  const message = "login";
  const sig = base58.encode(ed25519.sign(utf8ToBytes(message), skA)); // signed by A
  assert.equal(verifySolanaAddress(message, sig, addrB), null); // claims B
});

test("Solana: tampered message and malformed inputs return null", () => {
  const sk = ed25519.utils.randomSecretKey();
  const address = base58.encode(ed25519.getPublicKey(sk));
  const sig = base58.encode(ed25519.sign(utf8ToBytes("real message"), sk));
  assert.equal(verifySolanaAddress("forged message", sig, address), null);
  assert.equal(verifySolanaAddress("m", "!!notbase58!!", address), null);
  assert.equal(verifySolanaAddress("m", sig, "tooShort"), null);
});

test("walletAddressesMatch: EVM is case-insensitive, Solana is exact", () => {
  assert.equal(walletAddressesMatch("evm", KNOWN_ADDR.toUpperCase(), KNOWN_ADDR), true);
  assert.equal(walletAddressesMatch("solana", "Abc", "abc"), false);
  assert.equal(walletAddressesMatch("solana", "Abc", "Abc"), true);
  assert.equal(walletAddressesMatch("evm", "", KNOWN_ADDR), false);
});

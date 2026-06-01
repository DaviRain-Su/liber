// Turnkey × Sui prototype — proves the riskiest piece BEFORE adopting Turnkey:
// that a Turnkey embedded ed25519 wallet can produce a VALID Sui login signature.
//
// Turnkey supports Sui only at the curve level (ed25519 + address derivation); it
// has NO @turnkey/sui signer. So Liber must wrap the signing itself: build the Sui
// personal-message intent, Blake2b-256 it, get a RAW ed25519 signature from
// Turnkey's enclave (signRawPayload, HASH_FUNCTION_NOT_APPLICABLE), then assemble
// Sui's serialized signature. This script simulates the enclave with a LOCAL
// ed25519 key (so it needs no Turnkey account) and proves the wrapper two ways:
//   (1) the assembled signature is BYTE-IDENTICAL to what a real @mysten/sui wallet
//       produces for the same message (ground truth), and
//   (2) Liber's existing verifier (verifyPersonalMessageSignature, the one used by
//       /auth/verify for Sui) accepts it and recovers the right Sui address.
// If both pass, the only remaining step for production is swapping the one local
// ed25519.sign() call for a Turnkey signRawPayload() API call.

import { Ed25519Keypair, Ed25519PublicKey } from "@mysten/sui/keypairs/ed25519";
import { messageWithIntent, toSerializedSignature } from "@mysten/sui/cryptography";
import { verifyPersonalMessageSignature } from "@mysten/sui/verify";
import { bcs } from "@mysten/sui/bcs";
import { blake2b } from "@noble/hashes/blake2.js";
import { ed25519 } from "@noble/curves/ed25519.js";
import { randomBytes } from "node:crypto";

const toHex = (u8) => Buffer.from(u8).toString("hex");
const eq = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;

// --- The exact wrapper Liber would ship around Turnkey -----------------------
// Computes the digest Turnkey must sign for a Sui PERSONAL MESSAGE (login challenge).
function suiPersonalMessageDigest(message) {
  const msgBytes = typeof message === "string" ? new TextEncoder().encode(message) : message;
  const intent = messageWithIntent("PersonalMessage", bcs.vector(bcs.u8()).serialize(msgBytes).toBytes());
  return blake2b(intent, { dkLen: 32 }); // 32-byte payload → Turnkey signRawPayload(..., HASH_FUNCTION_NOT_APPLICABLE)
}
// Assembles Sui's serialized signature from Turnkey's raw 64-byte ed25519 signature + the wallet pubkey.
function assembleSuiSignature(rawSig64, rawPubkey32) {
  return toSerializedSignature({
    signatureScheme: "ED25519",
    signature: rawSig64,
    publicKey: new Ed25519PublicKey(rawPubkey32),
  });
}

// --- Simulate a Turnkey embedded ed25519 wallet (a seed "in the enclave") ----
const seed = new Uint8Array(randomBytes(32));        // Turnkey would generate + hold this in its TEE
const rawPubkey = ed25519.getPublicKey(seed);        // Turnkey returns this 32-byte pubkey + the Sui address
const groundTruthKp = Ed25519Keypair.fromSecretKey(seed); // ground-truth wallet for the same seed

// (0) Address derivation: Turnkey's ed25519 pubkey → Sui address must match @mysten/sui.
const addrFromTurnkeyPubkey = new Ed25519PublicKey(rawPubkey).toSuiAddress();
const addrGroundTruth = groundTruthKp.toSuiAddress();
const pubkeyMatches = eq(rawPubkey, groundTruthKp.getPublicKey().toRawBytes());
const addressMatches = addrFromTurnkeyPubkey === addrGroundTruth;

// (1) A login challenge, signed two ways.
const challenge = `Liber 登录确认\ndomain: liber-99x.pages.dev\nnonce: ${toHex(randomBytes(16))}`;
const msgBytes = new TextEncoder().encode(challenge);

// Ground truth: what a real Sui wallet produces.
const truth = await groundTruthKp.signPersonalMessage(msgBytes);

// Turnkey path: digest → RAW ed25519 sign (== signRawPayload) → assemble.
const digest = suiPersonalMessageDigest(msgBytes);
const rawSigFromEnclave = ed25519.sign(digest, seed);          // <-- the only line Turnkey replaces in prod
const wrapped = assembleSuiSignature(rawSigFromEnclave, rawPubkey);

const matchesGroundTruth = wrapped === truth.signature;

// (2) Liber's existing Sui verifier accepts the wrapped signature.
const recovered = await verifyPersonalMessageSignature(msgBytes, wrapped);
const verifierAccepts = recovered.toSuiAddress() === addrGroundTruth;

// --- Report ------------------------------------------------------------------
const rows = [
  ["pubkey: Turnkey ed25519 == @mysten raw pubkey", pubkeyMatches],
  ["address: Turnkey pubkey → Sui addr == ground truth", addressMatches],
  ["signature: wrapped == real Sui wallet (byte-identical)", matchesGroundTruth],
  ["verify: Liber's verifyPersonalMessageSignature accepts it", verifierAccepts],
];
console.log(`\nSui address: ${addrGroundTruth}`);
console.log(`Challenge:   ${JSON.stringify(challenge)}`);
console.log(`Digest (Turnkey signs this): ${toHex(digest)}`);
console.log(`Wrapped sig (base64): ${wrapped.slice(0, 44)}…\n`);
for (const [label, ok] of rows) console.log(`  ${ok ? "✅ PASS" : "❌ FAIL"}  ${label}`);
const allPass = rows.every(([, ok]) => ok);
console.log(`\n${allPass ? "✅ ALL PASS" : "❌ FAILED"} — Turnkey embedded Sui wallet ${allPass ? "CAN" : "cannot"} produce a valid Liber Sui login signature.`);
console.log(allPass ? "Production: replace the one ed25519.sign(digest, seed) line with Turnkey signRawPayload(digest).\n" : "");
process.exit(allPass ? 0 : 1);

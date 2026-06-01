// Sui signing wrapper for Turnkey. Turnkey has no first-class Sui signer (it only
// signs raw ed25519 digests), so Liber builds the Sui personal-message intent +
// digest, hands that to Turnkey signRawPayload, then assembles Sui's serialized
// signature here. This is the production port of the locally-proven approach in
// spike/turnkey-sui.mjs (where all 4 checks pass byte-for-byte vs a real @mysten
// wallet, and Liber's verifyPersonalMessageSignature accepts the result).
import { messageWithIntent, toSerializedSignature } from "@mysten/sui/cryptography";
import { Ed25519PublicKey } from "@mysten/sui/keypairs/ed25519";
import { bcs } from "@mysten/sui/bcs";
import { blake2b } from "@noble/hashes/blake2.js";

const hexToBytes = (h: string): Uint8Array => {
  const s = h.startsWith("0x") ? h.slice(2) : h;
  const a = new Uint8Array(s.length / 2);
  for (let i = 0; i < a.length; i++) a[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return a;
};
const bytesToHex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

// Sui address for a raw ed25519 public key (hex). Lets us derive/verify the address
// from the pubkey Turnkey returns, independent of Turnkey's own ADDRESS_FORMAT_SUI.
export function suiAddressFromEd25519Pubkey(pubkeyHex: string): string {
  return new Ed25519PublicKey(hexToBytes(pubkeyHex)).toSuiAddress();
}

// The 32-byte digest Turnkey must sign for a Sui PERSONAL MESSAGE (the login
// challenge). Pass this hex to signRawPayload with encoding=HEXADECIMAL,
// hashFunction=NOT_APPLICABLE.
export function suiPersonalMessageDigestHex(message: string): string {
  const msgBytes = new TextEncoder().encode(message);
  const intent = messageWithIntent("PersonalMessage", bcs.vector(bcs.u8()).serialize(msgBytes).toBytes());
  return bytesToHex(blake2b(intent, { dkLen: 32 }));
}

// The 32-byte digest Turnkey must sign for a Sui TRANSACTION (intent scope
// "TransactionData", vs "PersonalMessage" above). Pass the built transaction bytes.
export function suiTransactionDigestHex(txBytes: Uint8Array): string {
  const intent = messageWithIntent("TransactionData", txBytes);
  return bytesToHex(blake2b(intent, { dkLen: 32 }));
}

// Assemble Sui's serialized signature (base64) from Turnkey's raw ed25519 signature.
// Turnkey returns r and s hex; concatenated they ARE the 64-byte ed25519 signature.
export function assembleSuiSignature(rHex: string, sHex: string, pubkeyHex: string): string {
  const r = hexToBytes(rHex);
  const s = hexToBytes(sHex);
  const sig = new Uint8Array(r.length + s.length);
  sig.set(r, 0);
  sig.set(s, r.length);
  return toSerializedSignature({
    signatureScheme: "ED25519",
    signature: sig,
    publicKey: new Ed25519PublicKey(hexToBytes(pubkeyHex)),
  });
}

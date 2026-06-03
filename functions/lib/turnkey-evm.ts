// EVM (Ethereum) transaction encoding for Turnkey-signed transfers. Turnkey signs raw
// secp256k1 digests (no first-class EVM tx signer), so Liber builds a legacy (EIP-155)
// transaction, RLP-encodes it, hands the keccak256 digest to Turnkey signRawPayload
// (hashFunction=NO_OP), then re-encodes with the returned r/s/recovery-id here. Legacy
// txs are universally accepted on mainnet; this needs only @noble (no ethers/viem).
import { keccak_256 } from "@noble/hashes/sha3.js";

const hexToBytes = (h: string): Uint8Array => {
  const s = h.startsWith("0x") ? h.slice(2) : h;
  const p = s.length % 2 ? "0" + s : s;
  const a = new Uint8Array(p.length / 2);
  for (let i = 0; i < a.length; i++) a[i] = parseInt(p.slice(i * 2, i * 2 + 2), 16);
  return a;
};
const bytesToHex = (b: Uint8Array): string =>
  Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const concat = (arrs: Uint8Array[]): Uint8Array => {
  let n = 0;
  for (const a of arrs) n += a.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const a of arrs) {
    out.set(a, o);
    o += a.length;
  }
  return out;
};
// Minimal big-endian bytes for a non-negative integer (RLP integers carry no leading zeros).
const numToBytes = (n: bigint): Uint8Array => {
  if (n <= 0n) return new Uint8Array(0);
  let h = n.toString(16);
  if (h.length % 2) h = "0" + h;
  return hexToBytes(h);
};
const stripZeros = (b: Uint8Array): Uint8Array => {
  let i = 0;
  while (i < b.length && b[i] === 0) i++;
  return b.slice(i);
};

type RlpInput = Uint8Array | RlpInput[];
function encodeLength(len: number, offset: number): Uint8Array {
  if (len < 56) return Uint8Array.of(offset + len);
  const lb = numToBytes(BigInt(len));
  return concat([Uint8Array.of(offset + 55 + lb.length), lb]);
}
function rlp(input: RlpInput): Uint8Array {
  if (Array.isArray(input)) {
    const body = concat(input.map(rlp));
    return concat([encodeLength(body.length, 0xc0), body]);
  }
  const b = input;
  if (b.length === 1 && b[0] < 0x80) return b;
  return concat([encodeLength(b.length, 0x80), b]);
}

// Convert a human decimal amount string ("1.5") to base units (wei / token smallest unit).
export function toBaseUnits(amount: string | number, decimals: number): bigint {
  const [whole, frac = ""] = String(amount).split(".");
  const fracPadded = (frac + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt(fracPadded || "0");
}

// ERC-20 transfer(address,uint256) calldata (e.g. USDC). 0xa9059cbb + 32-byte to + 32-byte amount.
export function erc20TransferData(to: string, amount: bigint): string {
  const addr = (to.startsWith("0x") ? to.slice(2) : to).toLowerCase().padStart(64, "0");
  const amt = amount.toString(16).padStart(64, "0");
  return "0xa9059cbb" + addr + amt;
}

export interface EvmTx {
  nonce: string;
  gasPrice: string;
  gas: string;
  to: string;
  value: string;
  data: string;
  chainId: number;
}
function txFields(tx: EvmTx): Uint8Array[] {
  return [
    numToBytes(BigInt(tx.nonce)),
    numToBytes(BigInt(tx.gasPrice)),
    numToBytes(BigInt(tx.gas)),
    hexToBytes(tx.to),
    numToBytes(BigInt(tx.value)),
    tx.data ? hexToBytes(tx.data) : new Uint8Array(0),
  ];
}

// The keccak256 signing digest (hex, no 0x) for a legacy EIP-155 transaction.
export function evmSigningDigestHex(tx: EvmTx): string {
  const fields = [
    ...txFields(tx),
    numToBytes(BigInt(tx.chainId)),
    new Uint8Array(0),
    new Uint8Array(0),
  ];
  return bytesToHex(keccak_256(rlp(fields)));
}

// Re-encode the signed raw transaction (0x…) from Turnkey's r/s + recovery id.
export function evmSignedRawTx(tx: EvmTx, rHex: string, sHex: string, recid: number): string {
  const v = BigInt(recid) + 35n + BigInt(tx.chainId) * 2n; // EIP-155
  const fields = [
    ...txFields(tx),
    numToBytes(v),
    stripZeros(hexToBytes(rHex)),
    stripZeros(hexToBytes(sHex)),
  ];
  return "0x" + bytesToHex(rlp(fields));
}

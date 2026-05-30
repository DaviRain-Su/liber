// Decentralized-storage abstraction (the "permanence" layer).
//
// PRAGMATIC-FIRST: bytes live in R2 and the returned addresses are content-
// derived but shaped like the real networks (walrus:// / ar:// / sui::). To go
// real Web3 later, only this file changes — swap putBlob/getBlob to push to
// Walrus + Arweave and register the object on Sui. Callers are unaffected.
import type { Env } from "./types";
import { run, now } from "./db";

export interface StoredRef {
  key: string;
  walrus: string;
  arweave: string;
  sui_index: string;
  size: number;
  content_type: string;
}

async function sha256Hex(data: BufferSource): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function addressesFor(hash: string) {
  return {
    walrus: `walrus://0x${hash.slice(0, 4)}…${hash.slice(60, 64)}`,
    arweave: `ar://${hash.slice(8, 14)}…${hash.slice(40, 43)}`,
    sui_index: `sui::registry::Blob#${hash.slice(0, 4)}`,
  };
}

export async function putBlob(
  env: Env,
  key: string,
  data: ArrayBuffer | string,
  contentType = "application/octet-stream",
): Promise<StoredRef> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
  await env.R2.put(key, bytes, { httpMetadata: { contentType } });
  const hash = await sha256Hex(bytes);
  const ref: StoredRef = { key, ...addressesFor(hash), size: bytes.byteLength, content_type: contentType };
  await run(
    env.DB,
    `INSERT OR REPLACE INTO blobs (key, walrus, arweave, sui_index, size, content_type, created_at)
     VALUES (?,?,?,?,?,?,?)`,
    ref.key, ref.walrus, ref.arweave, ref.sui_index, ref.size, ref.content_type, now(),
  );
  return ref;
}

export async function getBlob(env: Env, key: string): Promise<ArrayBuffer | null> {
  const obj = await env.R2.get(key);
  return obj ? await obj.arrayBuffer() : null;
}

// Deterministic content address without storing (e.g. for previews / proofs).
export async function addressOf(text: string): Promise<StoredRef> {
  const bytes = new TextEncoder().encode(text);
  const hash = await sha256Hex(bytes);
  return { key: hash.slice(0, 16), ...addressesFor(hash), size: bytes.byteLength, content_type: "text/plain" };
}

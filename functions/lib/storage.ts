// Decentralized-storage abstraction (the "permanence" layer).
//
// Writes go to Walrus (real blobs) when WALRUS_PUBLISHER is configured; bytes
// are always mirrored to R2 as a fast-read cache / fallback. When no Walrus
// endpoint is set, it degrades to R2 + a content-derived address so local/CI
// and unconfigured deploys still work. Arweave stays a backup-address
// placeholder; sui_index is a registry-style id. Callers use only StoredRef.
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

function pseudoAddresses(hash: string) {
  return {
    walrus: `walrus://0x${hash.slice(0, 4)}…${hash.slice(60, 64)}`,
    arweave: `ar://${hash.slice(8, 14)}…${hash.slice(40, 43)}`,
    sui_index: `sui::registry::Blob#${hash.slice(0, 4)}`,
  };
}

// Publish bytes to a Walrus publisher; returns the real blobId or null on
// failure / when unconfigured (caller then uses the pseudo address).
export async function walrusPublish(
  env: Env,
  bytes: Uint8Array,
  overrideTimeoutMs?: number,
): Promise<string | null> {
  const base = env.WALRUS_PUBLISHER;
  if (!base) return null;
  const timeoutMs = overrideTimeoutMs
    ? Math.max(100, Math.min(60_000, overrideTimeoutMs))
    : Math.max(100, Math.min(10_000, Number(env.WALRUS_PUBLISH_TIMEOUT_MS || 800) || 800));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/v1/blobs`, {
      method: "PUT",
      body: bytes,
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const j: any = await res.json();
    // Walrus returns either a freshly created or already-certified blob object.
    return j?.newlyCreated?.blobObject?.blobId ?? j?.alreadyCertified?.blobId ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function putBlob(
  env: Env,
  key: string,
  data: ArrayBuffer | ArrayBufferView | string,
  contentType = "application/octet-stream",
): Promise<StoredRef> {
  const bytes =
    typeof data === "string"
      ? new TextEncoder().encode(data)
      : data instanceof ArrayBuffer
        ? new Uint8Array(data)
        : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  // mirror to R2 (fast reads + fallback), always
  await env.R2.put(key, bytes, { httpMetadata: { contentType } });

  const hash = await sha256Hex(bytes);
  const blobId = await walrusPublish(env, bytes);
  const addrs = pseudoAddresses(hash);
  const ref: StoredRef = {
    key,
    walrus: blobId ? `walrus://${blobId}` : addrs.walrus,
    arweave: addrs.arweave,
    sui_index: addrs.sui_index,
    size: bytes.byteLength,
    content_type: contentType,
  };
  await run(
    env.DB,
    `INSERT OR REPLACE INTO blobs (key, walrus, arweave, sui_index, size, content_type, created_at)
     VALUES (?,?,?,?,?,?,?)`,
    ref.key,
    ref.walrus,
    ref.arweave,
    ref.sui_index,
    ref.size,
    ref.content_type,
    now(),
  );
  return ref;
}

export async function getBlob(env: Env, key: string): Promise<ArrayBuffer | null> {
  // R2 first (fast); fall back to the Walrus aggregator by stored blobId.
  const obj = await env.R2.get(key);
  if (obj) return obj.arrayBuffer();
  const agg = env.WALRUS_AGGREGATOR;
  if (agg) {
    try {
      const rec: any = await env.DB.prepare(`SELECT walrus FROM blobs WHERE key = ?`)
        .bind(key)
        .first();
      const id = rec?.walrus?.startsWith("walrus://") ? rec.walrus.slice("walrus://".length) : null;
      if (id) {
        const res = await fetch(`${agg.replace(/\/$/, "")}/v1/blobs/${id}`);
        if (res.ok) return res.arrayBuffer();
      }
    } catch {
      /* fall through */
    }
  }
  return null;
}

// Deterministic content address without storing (e.g. previews / proofs).
export async function addressOf(text: string): Promise<StoredRef> {
  const bytes = new TextEncoder().encode(text);
  const hash = await sha256Hex(bytes);
  return {
    key: hash.slice(0, 16),
    ...pseudoAddresses(hash),
    size: bytes.byteLength,
    content_type: "text/plain",
  };
}

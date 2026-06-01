// Minimal Turnkey API client for the embedded-wallet prototype, written to run in a
// Cloudflare Worker isolate (no Node APIs). Turnkey's API is plain REST over HTTPS;
// every request is authenticated by a "stamp": a P-256 ECDSA signature over the
// JSON body, attached as the X-Stamp header. We sign with @noble/curves p256 (DER)
// — the same crypto the official @turnkey/api-key-stamper uses on its pure-JS path.
//
// NOTE (prototype): the activity request/response field names below follow Turnkey's
// documented shapes; the live /api/turnkey/spike route echoes raw responses so any
// field-name drift can be corrected against the real API on first run.
import type { Env } from "./types";
import { p256 } from "@noble/curves/nist.js";
import { sha256 } from "@noble/hashes/sha2.js";

const BASE = "https://api.turnkey.com";

const hexToBytes = (h: string): Uint8Array => {
  const s = h.startsWith("0x") ? h.slice(2) : h;
  const a = new Uint8Array(s.length / 2);
  for (let i = 0; i < a.length; i++) a[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return a;
};
const bytesToHex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
function base64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function turnkeyConfigured(env: Env): boolean {
  return !!(env.TURNKEY_ORG_ID && env.TURNKEY_API_PUBLIC_KEY && env.TURNKEY_API_PRIVATE_KEY);
}

// Build the X-Stamp header value: P-256 ECDSA (DER) over SHA-256(body), wrapped in
// Turnkey's stamp envelope and base64url-encoded.
export function stamp(bodyStr: string, apiPublicKey: string, apiPrivateKey: string): string {
  const msgHash = sha256(new TextEncoder().encode(bodyStr));
  const compact = p256.sign(msgHash, hexToBytes(apiPrivateKey), { prehash: false });
  const der = p256.Signature.fromBytes(compact).toBytes("der");
  const env = { publicKey: apiPublicKey, scheme: "SIGNATURE_SCHEME_TK_API_P256", signature: bytesToHex(der) };
  return base64url(new TextEncoder().encode(JSON.stringify(env)));
}

async function post(env: Env, path: string, body: unknown): Promise<any> {
  const bodyStr = JSON.stringify(body);
  const xstamp = stamp(bodyStr, env.TURNKEY_API_PUBLIC_KEY!, env.TURNKEY_API_PRIVATE_KEY!);
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: { "content-type": "application/json", "X-Stamp": xstamp },
    body: bodyStr,
  });
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`turnkey ${res.status} ${path}: ${JSON.stringify(j).slice(0, 400)}`);
  return j;
}

// Resolve an activity to its result, polling briefly if it comes back PENDING.
async function awaitResult(env: Env, submitJson: any): Promise<any> {
  let activity = submitJson?.activity;
  for (let i = 0; i < 6; i++) {
    const status = activity?.status;
    if (status === "ACTIVITY_STATUS_COMPLETED") return activity.result || {};
    if (status === "ACTIVITY_STATUS_FAILED" || status === "ACTIVITY_STATUS_REJECTED") {
      throw new Error(`turnkey activity ${status}: ${JSON.stringify(activity?.failure || activity).slice(0, 300)}`);
    }
    const q = await post(env, "/public/v1/query/get_activity", {
      organizationId: activity?.organizationId || env.TURNKEY_ORG_ID,
      activityId: activity?.id,
    });
    activity = q?.activity;
  }
  throw new Error("turnkey activity did not complete in time");
}

// Create a per-user sub-organization holding a Sui (ed25519) wallet. For the
// prototype the parent server API key is added as a root-user credential so the
// server can sign (custodial demo); production would seed the user's passkey/OAuth
// instead and stay non-custodial.
export async function createSubOrgWithSuiWallet(env: Env, label: string): Promise<any> {
  const submit = await post(env, "/public/v1/submit/create_sub_organization", {
    type: "ACTIVITY_TYPE_CREATE_SUB_ORGANIZATION_V7",
    timestampMs: String(Date.now()),
    organizationId: env.TURNKEY_ORG_ID,
    parameters: {
      subOrganizationName: label,
      rootQuorumThreshold: 1,
      rootUsers: [
        {
          userName: "liber-server",
          apiKeys: [
            { apiKeyName: "liber-parent", publicKey: env.TURNKEY_API_PUBLIC_KEY, curveType: "API_KEY_CURVE_P256" },
          ],
          authenticators: [],
          oauthProviders: [],
        },
      ],
      wallet: {
        walletName: "Liber Wallet",
        // One HD wallet, multiple chains from the same seed. Order matters: the
        // create result's wallet.addresses[] comes back in this order.
        accounts: [
          { curve: "CURVE_ED25519", pathFormat: "PATH_FORMAT_BIP32", path: "m/44'/784'/0'/0'/0'", addressFormat: "ADDRESS_FORMAT_SUI" },
          { curve: "CURVE_SECP256K1", pathFormat: "PATH_FORMAT_BIP32", path: "m/44'/60'/0'/0/0", addressFormat: "ADDRESS_FORMAT_ETHEREUM" },
          { curve: "CURVE_ED25519", pathFormat: "PATH_FORMAT_BIP32", path: "m/44'/501'/0'/0'", addressFormat: "ADDRESS_FORMAT_SOLANA" },
          { curve: "CURVE_SECP256K1", pathFormat: "PATH_FORMAT_BIP32", path: "m/84'/0'/0'/0/0", addressFormat: "ADDRESS_FORMAT_BITCOIN_MAINNET_P2WPKH" },
        ],
      },
    },
  });
  return { submit, result: await awaitResult(env, submit) };
}

// Create a sub-org with a multi-chain HD wallet (Sui + Ethereum + Solana) and return
// the parsed ids + addresses. addresses[] order matches the accounts order above.
export async function provisionWallets(env: Env, label: string): Promise<{
  subOrgId: string; walletId: string; rootUserId: string | null; addresses: { sui: string | null; ethereum: string | null; solana: string | null; bitcoin: string | null }; raw: any;
}> {
  const { result } = await createSubOrgWithSuiWallet(env, label);
  const r = result?.createSubOrganizationResultV7 || result?.createSubOrganizationResult || result || {};
  const a = r.wallet?.addresses || [];
  return {
    subOrgId: r.subOrganizationId,
    walletId: r.wallet?.walletId,
    rootUserId: (r.rootUserIds || [])[0] ?? null,
    addresses: { sui: a[0] ?? null, ethereum: a[1] ?? null, solana: a[2] ?? null, bitcoin: a[3] ?? null },
    raw: r,
  };
}

// Find the root user id of a sub-org (for users provisioned before we stored it).
export async function getSubOrgRootUserId(env: Env, subOrgId: string): Promise<string | null> {
  const j = await post(env, "/public/v1/query/get_organization", { organizationId: subOrgId });
  const users = j?.organizationData?.users || j?.organization?.users || j?.users || [];
  const root = users.find((u: any) => (u.userName || "").includes("liber") ) || users[0];
  return root?.userId ?? null;
}

// Add a WebAuthn passkey as an authenticator on a sub-org user (so the user — not the
// server — can authorize signing). The attestation is captured client-side.
export async function createPasskeyAuthenticator(
  env: Env, subOrgId: string, userId: string,
  authenticator: { authenticatorName: string; challenge: string; attestation: { credentialId: string; clientDataJson: string; attestationObject: string; transports: string[] } },
): Promise<any> {
  const submit = await post(env, "/public/v1/submit/create_authenticators", {
    type: "ACTIVITY_TYPE_CREATE_AUTHENTICATORS_V2",
    timestampMs: String(Date.now()),
    organizationId: subOrgId,
    parameters: { userId, authenticators: [authenticator] },
  });
  return await awaitResult(env, submit);
}

// Look up a wallet account to get its raw ed25519 public key (needed to assemble the
// Sui signature). get_wallet_account requires organizationId + walletId (+ address).
export async function getWalletAccount(env: Env, subOrgId: string, walletId: string, address: string): Promise<any> {
  return post(env, "/public/v1/query/get_wallet_account", {
    organizationId: subOrgId,
    walletId,
    address,
  });
}

// Sign a pre-computed digest with a sub-org wallet (raw ed25519, no extra hashing).
export async function signRawPayload(
  env: Env, subOrgId: string, signWith: string, payloadHex: string,
  hashFunction: string = "HASH_FUNCTION_NOT_APPLICABLE",
): Promise<any> {
  const submit = await post(env, "/public/v1/submit/sign_raw_payload", {
    type: "ACTIVITY_TYPE_SIGN_RAW_PAYLOAD_V2",
    timestampMs: String(Date.now()),
    organizationId: subOrgId,
    parameters: {
      signWith,
      payload: payloadHex,
      encoding: "PAYLOAD_ENCODING_HEXADECIMAL",
      hashFunction,
    },
  });
  return { submit, result: await awaitResult(env, submit) };
}

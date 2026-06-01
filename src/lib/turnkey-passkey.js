/* Turnkey wallet passkey — client-side WebAuthn. Enrollment creates a passkey and
   formats the attestation for Turnkey's CREATE_AUTHENTICATORS activity (the backend
   /api/turnkey/passkey/enroll adds it to the user's sub-org). The same passkey will
   later authorize transaction signing, so funds are user-controlled, not server-held. */

const b64url = (buf) => {
  const b = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

export function passkeySupported() {
  return typeof window !== "undefined" && !!(window.PublicKeyCredential && navigator.credentials && navigator.credentials.create);
}

// Create a wallet passkey and return { challenge, attestation } for the enroll endpoint.
// rpId defaults to the current hostname (matches Liber's existing passkey login).
export async function createWalletPasskey({ userId, userName }) {
  const rpId = window.location.hostname;
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const userHandle = new TextEncoder().encode(String(userId || "liber-user")).slice(0, 64);
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: { id: rpId, name: "Liber" },
      user: { id: userHandle, name: userName || "Liber 读者", displayName: userName || "Liber 读者" },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
      authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
      timeout: 60000,
      attestation: "none",
    },
  });
  if (!cred) throw new Error("passkey 创建被取消");
  const transports = (cred.response.getTransports ? cred.response.getTransports() : []) || [];
  return {
    challenge: b64url(challenge),
    authenticatorName: "Liber 钱包通行密钥",
    attestation: {
      credentialId: b64url(cred.rawId),
      clientDataJson: b64url(cred.response.clientDataJSON),
      attestationObject: b64url(cred.response.attestationObject),
      transports: transports.map((t) => "AUTHENTICATOR_TRANSPORT_" + String(t).toUpperCase()),
    },
  };
}

/* ---- passkey signing (non-custodial) -----------------------------------------
   Build a Turnkey WebAuthn "stamp" over a request body and POST it STRAIGHT to
   Turnkey from the browser. The user authorizes with Face ID / fingerprint; the
   passkey private key never leaves the device and our server never sees it. The
   server later reads the signed result by activityId and broadcasts.

   Turnkey's challenge convention (must match exactly or Turnkey rejects the stamp):
   the WebAuthn challenge is the UTF-8 bytes of the lowercase hex string of
   SHA-256(requestBody) — NOT the raw 32-byte hash. The X-Stamp-Webauthn header
   value is the stamp JSON itself (not base64url-wrapped, unlike the API-key stamp). */
async function turnkeyWebauthnStamp(payloadStr, rpId) {
  const hashBuf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payloadStr));
  const hex = Array.from(new Uint8Array(hashBuf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  const challenge = new TextEncoder().encode(hex);
  const assertion = await navigator.credentials.get({
    publicKey: { challenge, rpId, userVerification: "preferred", timeout: 60000, allowCredentials: [] },
  });
  if (!assertion) throw new Error("通行密钥签名被取消");
  const r = assertion.response;
  return JSON.stringify({
    authenticatorData: b64url(r.authenticatorData),
    clientDataJson: b64url(r.clientDataJSON),
    credentialId: b64url(assertion.rawId),
    signature: b64url(r.signature),
  });
}

// Sign a precomputed digest (hex) with the user's wallet passkey, directly via
// Turnkey. Returns the Turnkey activityId for the server to read + broadcast.
// hashFunction: ed25519 chains (Sui/Solana) pass NOT_APPLICABLE over the raw digest;
// secp256k1 chains (Ethereum) pass NO_OP over the keccak digest.
export async function passkeySignDigest({ organizationId, signWith, digestHex, hashFunction = "HASH_FUNCTION_NOT_APPLICABLE" }) {
  const rpId = window.location.hostname;
  const activity = {
    type: "ACTIVITY_TYPE_SIGN_RAW_PAYLOAD_V2",
    timestampMs: String(Date.now()),
    organizationId,
    parameters: { signWith, payload: digestHex, encoding: "PAYLOAD_ENCODING_HEXADECIMAL", hashFunction },
  };
  const bodyStr = JSON.stringify(activity);
  const stamp = await turnkeyWebauthnStamp(bodyStr, rpId);
  const res = await fetch("https://api.turnkey.com/public/v1/submit/sign_raw_payload", {
    method: "POST",
    headers: { "content-type": "application/json", "X-Stamp-Webauthn": stamp },
    body: bodyStr,
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error("Turnkey 签名失败：" + (j?.message || res.status));
  const activityId = j?.activity?.id;
  if (!activityId) throw new Error("Turnkey 未返回 activityId");
  return { activityId };
}

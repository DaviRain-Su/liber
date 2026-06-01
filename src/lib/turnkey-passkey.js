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

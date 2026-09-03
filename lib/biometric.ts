const CREDENTIAL_KEY = "claw-bridge:biometric-credential"

function bytes(length = 32) {
  return crypto.getRandomValues(new Uint8Array(length))
}

function encode(value: ArrayBuffer) {
  return btoa(String.fromCharCode(...new Uint8Array(value))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function decode(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/")
  const raw = atob(normalized)
  return Uint8Array.from(raw, (char) => char.charCodeAt(0))
}

export function biometricSupported() {
  return typeof window !== "undefined" && window.isSecureContext && "PublicKeyCredential" in window && !!navigator.credentials
}

export function hasBiometricCredential() {
  return typeof window !== "undefined" && !!localStorage.getItem(CREDENTIAL_KEY)
}

export function clearBiometricCredential() {
  if (typeof window !== "undefined") localStorage.removeItem(CREDENTIAL_KEY)
}

export async function registerBiometric() {
  if (!biometricSupported()) throw new Error("Biometric lock needs HTTPS and a supported browser")
  const credential = await navigator.credentials.create({
    publicKey: {
      challenge: bytes(),
      rp: { name: "CLAW Bridge" },
      user: { id: bytes(16), name: "openclaw-owner", displayName: "OpenClaw owner" },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 },
      ],
      authenticatorSelection: { authenticatorAttachment: "platform", residentKey: "preferred", userVerification: "required" },
      timeout: 60_000,
      attestation: "none",
    },
  })
  if (!(credential instanceof PublicKeyCredential)) throw new Error("Biometric setup was cancelled")
  localStorage.setItem(CREDENTIAL_KEY, encode(credential.rawId))
}

export async function verifyBiometric() {
  if (!biometricSupported()) throw new Error("Biometric unlock needs HTTPS and a supported browser")
  const credentialId = localStorage.getItem(CREDENTIAL_KEY)
  if (!credentialId) throw new Error("Biometric lock is not configured")
  const credential = await navigator.credentials.get({
    publicKey: {
      challenge: bytes(),
      allowCredentials: [{ type: "public-key", id: decode(credentialId), transports: ["internal"] }],
      userVerification: "required",
      timeout: 60_000,
    },
  })
  if (!(credential instanceof PublicKeyCredential)) throw new Error("Unlock was cancelled")
}

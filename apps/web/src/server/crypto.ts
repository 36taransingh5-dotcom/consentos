import "server-only";
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
  type KeyObject,
} from "node:crypto";
import { canonicalize, type PublicKeySet } from "@consentos/shared";
import { getConfig } from "./env";

export function sha256Hex(input: string | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

/** `sha256:<hex>` of the canonical JSON form of `value`. */
export function hashCanonical(value: unknown): string {
  return `sha256:${sha256Hex(canonicalize(value))}`;
}

type PublicJwk = PublicKeySet["keys"][number];

export interface VerificationKey {
  keyId: string;
  publicKey: KeyObject;
  jwk: PublicJwk;
}

export interface SigningKey extends VerificationKey {
  privateKey: KeyObject;
}

export interface KeyRing {
  active: SigningKey;
  /** Every key a receipt may have been signed with, by key id. */
  verification: Map<string, VerificationKey>;
}

function keyIdFor(x: string): string {
  return `cos-ed25519-${sha256Hex(Buffer.from(x, "base64url")).slice(0, 16)}`;
}

function toVerificationKey(publicKey: KeyObject): VerificationKey {
  const exported = publicKey.export({ format: "jwk" }) as { kty: string; crv: string; x: string };
  if (exported.kty !== "OKP" || exported.crv !== "Ed25519") throw new Error("Receipt keys must be Ed25519.");
  const keyId = keyIdFor(exported.x);
  return {
    keyId,
    publicKey,
    jwk: { kty: "OKP", crv: "Ed25519", x: exported.x, kid: keyId, alg: "EdDSA", use: "sig" },
  };
}

export function loadSigningKey(pem: string): SigningKey {
  const privateKey = createPrivateKey(pem);
  if (privateKey.asymmetricKeyType !== "ed25519") {
    throw new Error("CONSENTOS_SIGNING_KEY must be an Ed25519 private key (PKCS#8 PEM).");
  }
  return { ...toVerificationKey(createPublicKey(privateKey)), privateKey };
}

export function buildKeyRing(activePem: string, extraJwksJson?: string): KeyRing {
  const active = loadSigningKey(activePem);
  const verification = new Map<string, VerificationKey>([[active.keyId, active]]);
  if (extraJwksJson) {
    const jwks = JSON.parse(extraJwksJson) as { x: string; crv: string; kty: string }[];
    for (const jwk of jwks) {
      const key = toVerificationKey(createPublicKey({ key: { ...jwk }, format: "jwk" }));
      verification.set(key.keyId, key);
    }
  }
  return { active, verification };
}

let keyRing: KeyRing | undefined;

export function getKeyRing(): KeyRing {
  if (!keyRing) {
    const config = getConfig();
    keyRing = buildKeyRing(config.signingKeyPem, config.verificationKeysJson);
  }
  return keyRing;
}

export function resetKeyRingForTests(): void {
  keyRing = undefined;
}

/** Ed25519 signature (base64url) over the UTF-8 bytes of a canonical string. */
export function signCanonical(key: SigningKey, canonical: string): string {
  return sign(null, Buffer.from(canonical, "utf8"), key.privateKey).toString("base64url");
}

export function verifyCanonical(key: VerificationKey, canonical: string, signature: string): boolean {
  try {
    return verify(null, Buffer.from(canonical, "utf8"), key.publicKey, Buffer.from(signature, "base64url"));
  } catch {
    return false;
  }
}

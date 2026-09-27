import type { PublicKeySet } from "@consentos/shared";
import { getKeyRing } from "@/server/crypto";
import { handle, json, preflight } from "@/server/http";

/**
 * GET /api/v1/keys — the Ed25519 public keys receipts are signed with, as a
 * JWK set. Anyone can verify a receipt offline with these.
 */
export const GET = handle(
  async () => {
    const ring = getKeyRing();
    const body: PublicKeySet = { keys: [...ring.verification.values()].map((k) => k.jwk) };
    return json(body, { headers: { "cache-control": "public, max-age=300" } });
  },
  { cors: true },
);

export const OPTIONS = preflight;

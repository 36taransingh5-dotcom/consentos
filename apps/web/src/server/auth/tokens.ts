import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getConfig } from "../env";

export type TokenScope = "session" | "extension";

export interface TokenClaims {
  sub: string;
  email: string;
  scope: TokenScope;
  iat: number;
  exp: number;
}

const TTL_SECONDS: Record<TokenScope, number> = {
  session: 7 * 24 * 60 * 60,
  extension: 30 * 24 * 60 * 60,
};

function mac(body: string, scope: TokenScope): string {
  // Domain-separate the scopes so a session token can never pass as an extension token.
  return createHmac("sha256", `${getConfig().sessionSecret}:${scope}`).update(body).digest("base64url");
}

/** Compact HMAC-signed token: base64url(claims).base64url(mac). */
export function issueToken(user: { id: string; email: string }, scope: TokenScope, now = Date.now()): string {
  const iat = Math.floor(now / 1000);
  const claims: TokenClaims = { sub: user.id, email: user.email, scope, iat, exp: iat + TTL_SECONDS[scope] };
  const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${body}.${mac(body, scope)}`;
}

export function verifyToken(token: string | undefined | null, scope: TokenScope, now = Date.now()): TokenClaims | null {
  if (!token) return null;
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra !== undefined) return null;

  const expected = Buffer.from(mac(body, scope));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;

  try {
    const claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as TokenClaims;
    if (claims.scope !== scope) return null;
    if (typeof claims.exp !== "number" || claims.exp * 1000 <= now) return null;
    if (typeof claims.sub !== "string" || typeof claims.email !== "string") return null;
    return claims;
  } catch {
    return null;
  }
}

export function tokenTtlSeconds(scope: TokenScope): number {
  return TTL_SECONDS[scope];
}

import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { asService } from "../db";
import { DEMO_USER_EMAIL, getConfig } from "../env";
import { ApiError } from "../errors";
import { ensureDefaultPolicy } from "../policies";
import { hashPassword, verifyPassword } from "./password";
import { issueToken, tokenTtlSeconds, verifyToken } from "./tokens";

export interface SessionUser {
  id: string;
  email: string;
}

export const SESSION_COOKIE = "cos_session";

/* ------------------------------------------------------------------ */
/* Web sessions                                                        */
/* ------------------------------------------------------------------ */

export async function getSessionUser(): Promise<SessionUser | null> {
  const config = getConfig();
  if (config.auth === "supabase") {
    const { getSupabaseUser } = await import("./supabase");
    return getSupabaseUser();
  }
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const claims = verifyToken(token, "session");
  return claims ? { id: claims.sub, email: claims.email } : null;
}

/** For pages: send signed-out visitors to the login screen. */
export async function requireSessionUser(next = "/policy"): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(next)}`);
  return user;
}

async function setLocalSession(user: SessionUser): Promise<void> {
  const config = getConfig();
  (await cookies()).set(SESSION_COOKIE, issueToken(user, "session"), {
    httpOnly: true,
    sameSite: "lax",
    secure: config.secureCookies,
    path: "/",
    maxAge: tokenTtlSeconds("session"),
  });
}

export type AuthResult = { ok: true; user: SessionUser } | { ok: false; error: string };

export async function signInWithPassword(email: string, password: string): Promise<AuthResult> {
  const config = getConfig();
  const normalized = email.trim().toLowerCase();
  if (config.auth === "supabase") {
    const { supabaseSignIn } = await import("./supabase");
    const user = await supabaseSignIn(normalized, password);
    return user ? { ok: true, user } : { ok: false, error: "That email and password don't match." };
  }
  const [row] = await asService((tx) =>
    tx.query<{ id: string; email: string; encrypted_password: string | null }>(
      "select id, email, encrypted_password from auth.users where email = $1",
      [normalized],
    ),
  );
  // Run the hash check even for unknown emails so timing does not reveal which accounts exist.
  const ok = await verifyPassword(password, row?.encrypted_password ?? DUMMY_HASH);
  if (!row || !ok) return { ok: false, error: "That email and password don't match." };
  const user = { id: row.id, email: row.email };
  await setLocalSession(user);
  return { ok: true, user };
}

export async function signUp(email: string, password: string): Promise<AuthResult> {
  const config = getConfig();
  const normalized = email.trim().toLowerCase();
  let user: SessionUser;
  if (config.auth === "supabase") {
    const { supabaseSignUp } = await import("./supabase");
    const result = await supabaseSignUp(normalized, password);
    if ("error" in result) return { ok: false, error: result.error };
    user = result;
  } else {
    const hash = await hashPassword(password);
    const [row] = await asService((tx) =>
      tx.query<{ id: string; email: string }>(
        "insert into auth.users (email, encrypted_password) values ($1, $2) on conflict (email) do nothing returning id, email",
        [normalized, hash],
      ),
    );
    if (!row) return { ok: false, error: "An account with that email already exists." };
    user = row;
    await setLocalSession(user);
  }
  await asService((tx) => ensureDefaultPolicy(tx, user.id));
  return { ok: true, user };
}

export async function signInAsDemo(): Promise<AuthResult> {
  return signInWithPassword(DEMO_USER_EMAIL, getConfig().demoUserPassword);
}

export async function signOut(): Promise<void> {
  const config = getConfig();
  if (config.auth === "supabase") {
    const { supabaseSignOut } = await import("./supabase");
    await supabaseSignOut();
    return;
  }
  (await cookies()).delete(SESSION_COOKIE);
}

/* ------------------------------------------------------------------ */
/* API requests (extension and same-origin fetches)                    */
/* ------------------------------------------------------------------ */

/**
 * Authenticate an end-user API request.
 *
 * - The browser extension sends `Authorization: Bearer <extension token>`.
 * - Same-origin pages may rely on the session cookie; for state-changing
 *   requests the Origin header must match ConsentOS itself (CSRF defence on
 *   top of SameSite=Lax cookies).
 */
export async function authenticateUserRequest(req: Request, options: { mutation?: boolean } = {}): Promise<SessionUser> {
  const authorization = req.headers.get("authorization");
  if (authorization) {
    const token = authorization.match(/^Bearer\s+(\S+)$/i)?.[1];
    const claims = verifyToken(token, "extension");
    if (!claims) throw new ApiError(401, "INVALID_TOKEN", "The extension token is invalid or expired. Reconnect the extension.");
    return { id: claims.sub, email: claims.email };
  }

  if (options.mutation) {
    const origin = req.headers.get("origin");
    if (!origin || origin !== new URL(req.url).origin) {
      throw new ApiError(403, "CSRF_REJECTED", "Cross-origin request rejected.");
    }
  }
  const user = await getSessionUser();
  if (!user) throw new ApiError(401, "UNAUTHENTICATED", "Sign in to ConsentOS first.");
  return user;
}

export function issueExtensionToken(user: SessionUser): { token: string; expiresAt: string } {
  return {
    token: issueToken(user, "extension"),
    expiresAt: new Date(Date.now() + tokenTtlSeconds("extension") * 1000).toISOString(),
  };
}

// A well-formed hash of a random password, used to equalise timing for unknown emails.
const DUMMY_HASH =
  "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$e1d9f0b1Qh3vXk2kq3m9ZyX9aH5yXw8b4oYk2x1Zb0c";

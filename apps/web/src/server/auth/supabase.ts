import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { DEMO_USER_EMAIL, DEMO_USER_ID, getConfig, type ServerConfig } from "../env";
import type { SessionUser } from "./index";

/**
 * Supabase Auth adapter, used when NEXT_PUBLIC_SUPABASE_URL and
 * NEXT_PUBLIC_SUPABASE_ANON_KEY are set. Sessions live in Supabase's cookies;
 * the user id is the auth.users id that row-level security keys on.
 */
async function serverClient() {
  const config = getConfig().supabase!;
  const store = await cookies();
  return createServerClient(config.url, config.anonKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Called from a Server Component, where cookies are read-only.
        }
      },
    },
  });
}

function adminClient(config: ServerConfig) {
  if (!config.supabase?.serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required to create users without email confirmation.");
  }
  return createClient(config.supabase.url, config.supabase.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function getSupabaseUser(): Promise<SessionUser | null> {
  const { data } = await (await serverClient()).auth.getUser();
  return data.user?.email ? { id: data.user.id, email: data.user.email } : null;
}

export async function supabaseSignIn(email: string, password: string): Promise<SessionUser | null> {
  const { data, error } = await (await serverClient()).auth.signInWithPassword({ email, password });
  if (error || !data.user?.email) return null;
  return { id: data.user.id, email: data.user.email };
}

/** Hackathon sign-up: create a pre-confirmed user so no email round-trip is needed. */
export async function supabaseSignUp(email: string, password: string): Promise<SessionUser | { error: string }> {
  const { error } = await adminClient(getConfig()).auth.admin.createUser({ email, password, email_confirm: true });
  if (error) return { error: error.message };
  const user = await supabaseSignIn(email, password);
  return user ?? { error: "Account created, but signing in failed." };
}

export async function supabaseSignOut(): Promise<void> {
  await (await serverClient()).auth.signOut();
}

export async function ensureSupabaseDemoUser(config: ServerConfig): Promise<void> {
  if (!config.supabase?.serviceRoleKey) return;
  const admin = adminClient(config);
  const { data } = await admin.auth.admin.getUserById(DEMO_USER_ID);
  if (data.user) return;
  const { error } = await admin.auth.admin.createUser({
    id: DEMO_USER_ID,
    email: DEMO_USER_EMAIL,
    password: config.demoUserPassword,
    email_confirm: true,
  });
  if (error) throw error;
}

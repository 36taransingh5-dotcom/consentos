import { hashPassword } from "../auth/password";
import { sha256Hex } from "../crypto";
import { DEMO_USER_EMAIL, DEMO_USER_ID, type ServerConfig } from "../env";
import { ensureDefaultPolicy } from "../policies";
import type { Database } from "./index";

/**
 * Idempotent seed, run whenever the database is opened:
 *   - registered services (Pixly), with API key hashes from the environment
 *   - the demo user and their default policy (v1)
 */
export async function seed(db: Database, config: ServerConfig): Promise<void> {
  for (const service of config.services) {
    await db.query(
      `insert into public.services (id, name, domain, api_key_hash, verified)
       values ($1, $2, $3, $4, true)
       on conflict (id) do update
         set name = excluded.name, domain = excluded.domain,
             api_key_hash = excluded.api_key_hash, verified = excluded.verified`,
      [service.id, service.name, service.domain, sha256Hex(service.apiKey)],
    );
  }

  if (config.auth === "local") {
    const [existing] = await db.query("select id from auth.users where id = $1", [DEMO_USER_ID]);
    if (!existing) {
      await db.query(
        "insert into auth.users (id, email, encrypted_password) values ($1, $2, $3) on conflict do nothing",
        [DEMO_USER_ID, DEMO_USER_EMAIL, await hashPassword(config.demoUserPassword)],
      );
    }
  } else {
    const { ensureSupabaseDemoUser } = await import("../auth/supabase");
    await ensureSupabaseDemoUser(config).catch((error: unknown) => {
      console.warn("[consentos] Could not ensure the Supabase demo user:", error);
    });
  }

  const [demo] = await db.query("select id from auth.users where id = $1", [DEMO_USER_ID]);
  if (demo) await db.transaction((tx) => ensureDefaultPolicy(tx, DEMO_USER_ID));
}

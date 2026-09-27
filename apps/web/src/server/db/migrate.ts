import fs from "node:fs";
import path from "node:path";
import type { Queryable } from "./index";

/** Locate the repository's supabase/ directory from wherever the app runs. */
export function findSupabaseDir(start = process.cwd()): string {
  let dir = start;
  for (;;) {
    const candidate = path.join(/*turbopackIgnore: true*/ dir, "supabase", "migrations");
    if (fs.existsSync(candidate)) return path.join(dir, "supabase");
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error(`Could not find supabase/migrations above ${start}`);
    dir = parent;
  }
}

/**
 * Apply supabase/migrations/*.sql in order, once each. Applied migrations are
 * tracked in a private schema that PostgREST does not expose.
 */
export async function migrate(
  db: Queryable & { transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> },
  options: { withSupabaseShim: boolean },
): Promise<string[]> {
  const supabaseDir = findSupabaseDir();
  if (options.withSupabaseShim) {
    await db.exec(fs.readFileSync(path.join(supabaseDir, "local", "00_supabase_shim.sql"), "utf8"));
  }

  await db.exec(`
    create schema if not exists consentos_private;
    create table if not exists consentos_private.schema_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    );
  `);

  const applied = new Set(
    (await db.query<{ name: string }>("select name from consentos_private.schema_migrations")).map((r) => r.name),
  );

  const migrationsDir = path.join(supabaseDir, "migrations");
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const ran: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    const didApply = await db.transaction(async (tx) => {
      // Serverless cold starts can race; one instance migrates, the rest wait and skip.
      await tx.query("select pg_advisory_xact_lock(hashtext('consentos_migrations'))");
      const [done] = await tx.query("select 1 from consentos_private.schema_migrations where name = $1", [file]);
      if (done) return false;
      await tx.exec(sql);
      await tx.query("insert into consentos_private.schema_migrations (name) values ($1)", [file]);
      return true;
    });
    if (didApply) ran.push(file);
  }
  return ran;
}

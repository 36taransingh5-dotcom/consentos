import "server-only";
import { getConfig } from "../env";
import { migrate } from "./migrate";

/**
 * Minimal query interface shared by embedded Postgres (PGlite, local
 * development and tests) and node-postgres (Supabase Postgres in production).
 * Both speak real Postgres, so the same SQL, triggers and RLS policies run
 * everywhere.
 */
export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Run a multi-statement script (migrations). */
  exec(sql: string): Promise<void>;
}

export interface Database extends Queryable {
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

const globalForDb = globalThis as unknown as { __consentosDb?: Promise<Database> };

/** The process-wide database, migrated and seeded on first use. */
export function getDb(): Promise<Database> {
  globalForDb.__consentosDb ??= open().catch((error: unknown) => {
    globalForDb.__consentosDb = undefined;
    throw error;
  });
  return globalForDb.__consentosDb;
}

/** Test hook: close and forget the current database. */
export async function resetDbForTests(): Promise<void> {
  const current = globalForDb.__consentosDb;
  globalForDb.__consentosDb = undefined;
  if (current) await (await current).close();
}

async function open(): Promise<Database> {
  const config = getConfig();
  const db = config.storage === "pglite" ? await openPGlite(config.pgliteDir) : await openPostgres(config.databaseUrl!);
  if (config.storage === "pglite" || process.env.CONSENTOS_AUTO_MIGRATE === "true") {
    await migrate(db, { withSupabaseShim: config.storage === "pglite" });
  }
  // Imported lazily: seeding uses domain modules that themselves import this file.
  const { seed } = await import("./seed");
  await seed(db, config);
  return db;
}

async function openPGlite(dir: string): Promise<Database> {
  const { PGlite } = await import("@electric-sql/pglite");
  if (dir !== "memory://") {
    const fs = await import("node:fs");
    fs.mkdirSync(dir, { recursive: true });
  }
  const pg = new PGlite(dir);
  await pg.waitReady;

  const wrap = (q: Pick<typeof pg, "query" | "exec">): Queryable => ({
    async query<T>(sql: string, params: unknown[] = []) {
      return (await q.query<T>(sql, params)).rows;
    },
    async exec(sql: string) {
      await q.exec(sql);
    },
  });

  return {
    ...wrap(pg),
    transaction: (fn) => pg.transaction((tx) => fn(wrap(tx))),
    close: () => pg.close(),
  };
}

/**
 * node-postgres treats `sslmode=require` in a URL as full certificate
 * verification, which fails against Supabase's pooler certificate chain.
 * Strip it and use an encrypted connection without CA pinning instead.
 */
export function postgresOptions(url: string): { connectionString: string; ssl: false | { rejectUnauthorized: false } } {
  const parsed = new URL(url);
  parsed.searchParams.delete("sslmode");
  const local = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  return { connectionString: parsed.toString(), ssl: local ? false : { rejectUnauthorized: false } };
}

async function openPostgres(url: string): Promise<Database> {
  const { Pool } = await import("pg");
  const pool = new Pool({
    ...postgresOptions(url),
    max: Number(process.env.CONSENTOS_DB_POOL_SIZE ?? 5),
  });

  return {
    async query<T>(sql: string, params: unknown[] = []) {
      return (await pool.query(sql, params)).rows as T[];
    },
    async exec(sql: string) {
      await pool.query(sql);
    },
    async transaction<T>(fn: (tx: Queryable) => Promise<T>) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const result = await fn({
          async query<R>(sql: string, params: unknown[] = []) {
            return (await client.query(sql, params)).rows as R[];
          },
          async exec(sql: string) {
            await client.query(sql);
          },
        });
        await client.query("commit");
        return result;
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

/**
 * Run `fn` as the given end user: inside a transaction, as the dedicated
 * `consentos_user` role with the user's JWT claims set, so row-level security
 * applies to every statement. A missing WHERE clause cannot leak another
 * user's data. (Supabase's own API roles have no access to these tables; see
 * supabase/migrations/20260927000000_consentos_user_role.sql.)
 */
export async function asUser<T>(userId: string, fn: (tx: Queryable) => Promise<T>): Promise<T> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: userId, role: "consentos_user" }),
    ]);
    await tx.query("set local role consentos_user");
    return fn(tx);
  });
}

/** Privileged server access (evaluation, receipt issuance, enforcement). */
export async function asService<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
  const db = await getDb();
  return db.transaction(fn);
}

export function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

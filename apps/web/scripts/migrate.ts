/**
 * Apply supabase/migrations to the database at DATABASE_URL (e.g. your
 * Supabase project's Postgres connection string).
 *
 *   DATABASE_URL=postgres://… pnpm --filter @consentos/web db:migrate
 *
 * Equivalent to `supabase db push`; use one or the other, not both.
 */
import pg from "pg";
import type { Queryable } from "../src/server/db/index.ts";
import { migrate } from "../src/server/db/migrate.ts";

const url = process.env.DATABASE_URL || process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
if (!url) {
  console.error("Set DATABASE_URL to your Supabase (or any Postgres) connection string.");
  process.exit(1);
}

// Same TLS handling as the app: node-postgres reads `sslmode=require` as full
// verification, which Supabase's certificate chain does not pass.
const parsed = new URL(url);
parsed.searchParams.delete("sslmode");
const local = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
const pool = new pg.Pool({
  connectionString: parsed.toString(),
  max: 1,
  ssl: local ? false : { rejectUnauthorized: false },
});

type Db = Queryable & { transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> };

const db: Db = {
  async query<T>(sql: string, params: unknown[] = []) {
    return (await pool.query(sql, params)).rows as T[];
  },
  async exec(sql: string) {
    await pool.query(sql);
  },
  async transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    const tx: Queryable = {
      async query<R>(sql: string, params: unknown[] = []) {
        return (await client.query(sql, params)).rows as R[];
      },
      async exec(sql: string) {
        await client.query(sql);
      },
    };
    try {
      await client.query("begin");
      const result = await fn(tx);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  },
};

try {
  const ran = await migrate(db, { withSupabaseShim: process.env.CONSENTOS_APPLY_SHIM === "true" });
  console.log(ran.length > 0 ? `Applied: ${ran.join(", ")}` : "Database is up to date.");
} finally {
  await pool.end();
}

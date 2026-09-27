import "server-only";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** Fixed id so the Pixly demo can address the demo user without a linking flow. */
export const DEMO_USER_ID = "7e57de30-0000-4000-8000-000000000001";
export const DEMO_USER_EMAIL = "demo@consentos.dev";

/**
 * Local-development defaults. They only apply when ConsentOS runs on embedded
 * Postgres; a deployment backed by DATABASE_URL must configure real values.
 */
const LOCAL_DEFAULTS = {
  pixlyApiKey: "cos_test_pixly_local_only_7c1f3e9a2b",
  demoResetToken: "cos_test_demo_reset_local_only",
  demoUserPassword: "consentos-demo",
};

export type StorageMode = "pglite" | "postgres";
export type AuthMode = "local" | "supabase";

export interface ServiceSeed {
  id: string;
  name: string;
  domain: string;
  apiKey: string;
}

export interface ServerConfig {
  storage: StorageMode;
  databaseUrl: string | undefined;
  /** Directory for embedded Postgres, or "memory://" for an ephemeral database. */
  pgliteDir: string;
  dataDir: string;
  auth: AuthMode;
  supabase: { url: string; anonKey: string; serviceRoleKey: string | undefined } | undefined;
  publicUrl: string;
  demoMode: boolean;
  demoResetToken: string | undefined;
  demoUserPassword: string;
  sessionSecret: string;
  signingKeyPem: string;
  /** Extra public keys (JWK JSON array) accepted when verifying older receipts. */
  verificationKeysJson: string | undefined;
  services: ServiceSeed[];
  secureCookies: boolean;
}

let cached: ServerConfig | undefined;

export function getConfig(): ServerConfig {
  cached ??= loadConfig();
  return cached;
}

/** Test hook: forget the cached configuration so env changes take effect. */
export function resetConfigForTests(): void {
  cached = undefined;
}

function loadConfig(): ServerConfig {
  const env = process.env;
  const databaseUrl = env.DATABASE_URL || undefined;
  const storage: StorageMode = databaseUrl ? "postgres" : "pglite";
  const local = storage === "pglite";
  // Runtime-only location for local data; not part of the traced server bundle.
  const dataDir = path.resolve(/*turbopackIgnore: true*/ env.CONSENTOS_DATA_DIR ?? ".data");

  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const auth: AuthMode = supabaseUrl && supabaseAnonKey ? "supabase" : "local";
  if (auth === "supabase" && local) {
    throw new ConfigError(
      "Supabase Auth is configured but DATABASE_URL is not. Point DATABASE_URL at the same Supabase project's Postgres.",
    );
  }

  // `next build` never serves requests; keep it away from the local database and dev secrets
  // (a running dev server may have them open).
  const building = env.NEXT_PHASE === "phase-production-build";
  const ephemeral = building || env.CONSENTOS_PGLITE_DIR === "memory://";
  const devSecrets = local ? loadOrCreateDevSecrets(dataDir, ephemeral) : undefined;

  const sessionSecret = env.CONSENTOS_SESSION_SECRET ?? devSecrets?.sessionSecret;
  const signingKeyPem = decodePem(env.CONSENTOS_SIGNING_KEY) ?? devSecrets?.signingKeyPem;
  const pixlyApiKey = env.PIXLY_API_KEY ?? (local ? LOCAL_DEFAULTS.pixlyApiKey : undefined);

  const missing: string[] = [];
  if (!sessionSecret) missing.push("CONSENTOS_SESSION_SECRET");
  if (!signingKeyPem) missing.push("CONSENTOS_SIGNING_KEY");
  if (!pixlyApiKey) missing.push("PIXLY_API_KEY");
  if (missing.length > 0) {
    throw new ConfigError(`Missing required environment variables for a DATABASE_URL deployment: ${missing.join(", ")}`);
  }
  if (sessionSecret!.length < 32) throw new ConfigError("CONSENTOS_SESSION_SECRET must be at least 32 characters.");

  const publicUrl = (
    env.CONSENTOS_PUBLIC_URL ??
    (env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000")
  ).replace(/\/+$/, "");

  const demoMode = env.CONSENTOS_DEMO_MODE !== "false";

  return {
    storage,
    databaseUrl,
    pgliteDir: building ? "memory://" : (env.CONSENTOS_PGLITE_DIR ?? path.join(dataDir, "pglite")),
    dataDir,
    auth,
    supabase:
      auth === "supabase"
        ? { url: supabaseUrl!, anonKey: supabaseAnonKey!, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY }
        : undefined,
    publicUrl,
    demoMode,
    demoResetToken: env.CONSENTOS_DEMO_RESET_TOKEN ?? (local ? LOCAL_DEFAULTS.demoResetToken : undefined),
    demoUserPassword: env.CONSENTOS_DEMO_PASSWORD ?? LOCAL_DEFAULTS.demoUserPassword,
    sessionSecret: sessionSecret!,
    signingKeyPem: signingKeyPem!,
    verificationKeysJson: env.CONSENTOS_VERIFICATION_KEYS,
    services: [
      {
        id: "pixly",
        name: "Pixly",
        domain: env.PIXLY_DOMAIN ?? "localhost:3001",
        apiKey: pixlyApiKey!,
      },
    ],
    secureCookies: publicUrl.startsWith("https://"),
  };
}

/** Accepts a PEM, a PEM with escaped newlines (common in hosted env UIs), or base64 of a PEM. */
function decodePem(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (trimmed.startsWith("-----BEGIN")) return trimmed.replace(/\\n/g, "\n");
  return Buffer.from(trimmed, "base64").toString("utf8");
}

interface DevSecrets {
  sessionSecret: string;
  signingKeyPem: string;
}

/**
 * Local development only: generate a session secret and an Ed25519 signing key
 * on first run and keep them under .data so receipts stay verifiable across
 * restarts. Ephemeral (in-memory) databases get ephemeral secrets.
 */
function loadOrCreateDevSecrets(dataDir: string, ephemeral: boolean): DevSecrets {
  const generate = (): DevSecrets => ({
    sessionSecret: randomBytes(32).toString("base64url"),
    signingKeyPem: generateKeyPairSync("ed25519").privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
  });
  if (ephemeral) return generate();

  const file = path.join(dataDir, "dev-secrets.json");
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as DevSecrets;
  } catch {
    const secrets = generate();
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(secrets, null, 2), { mode: 0o600 });
    console.warn(`[consentos] Generated local development secrets in ${file}. Never use these in production.`);
    return secrets;
  }
}

export class ConfigError extends Error {
  override name = "ConfigError";
}

/**
 * Production data path: node-postgres over the wire, as used with Supabase's
 * DATABASE_URL. Supabase itself is not available in CI, so this serves the
 * same migrations and RLS policies from PGlite over the Postgres protocol
 * (pglite-socket) and runs the app in `DATABASE_URL` mode against it.
 */
import { generateKeyPairSync, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const PORT = 55_000 + Math.floor(Math.random() * 5_000);
let pg: PGlite;
let server: PGLiteSocketServer;

beforeAll(async () => {
  pg = await PGlite.create();
  // What Supabase already provides: auth.users, auth.uid(), the API roles.
  await pg.exec(fs.readFileSync(path.resolve(__dirname, "../../../supabase/local/00_supabase_shim.sql"), "utf8"));
  server = new PGLiteSocketServer({ db: pg, port: PORT, host: "127.0.0.1", maxConnections: 4 });
  await server.start();

  Object.assign(process.env, {
    DATABASE_URL: `postgres://postgres:postgres@127.0.0.1:${PORT}/postgres`,
    CONSENTOS_AUTO_MIGRATE: "true",
    CONSENTOS_DB_POOL_SIZE: "1",
    CONSENTOS_SESSION_SECRET: randomBytes(32).toString("base64url"),
    CONSENTOS_SIGNING_KEY: generateKeyPairSync("ed25519").privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    PIXLY_API_KEY: "cos_live_test_key_for_driver_test",
  });
  const { resetConfigForTests } = await import("@/server/env");
  const { resetKeyRingForTests } = await import("@/server/crypto");
  const { resetDbForTests } = await import("@/server/db");
  resetConfigForTests();
  resetKeyRingForTests();
  await resetDbForTests();
  // Local auth creates the demo user in the shimmed auth.users, as Supabase admin would.
  await pg.query("insert into auth.users (id, email) values ('7e57de30-0000-4000-8000-000000000001', 'demo@consentos.dev')");
});

afterAll(async () => {
  const { resetDbForTests } = await import("@/server/db");
  await resetDbForTests();
  await server?.stop();
  await pg?.close();
});

describe("DATABASE_URL mode (node-postgres)", () => {
  it("migrates, seeds, evaluates, enforces and revokes over the wire", async () => {
    const { getConfig } = await import("@/server/env");
    const { getDb, asService } = await import("@/server/db");
    const { ensureDefaultPolicy } = await import("@/server/policies");
    const { getService, authenticateService } = await import("@/server/services");
    const { evaluateConsent, checkGrant, revokeGrant } = await import("@/server/consent");
    const { getReceipt, verifyStoredReceipt } = await import("@/server/receipts");

    expect(getConfig().storage).toBe("postgres");
    await getDb();
    const DEMO = "7e57de30-0000-4000-8000-000000000001";
    await asService((tx) => ensureDefaultPolicy(tx, DEMO));

    // The service key from the environment authenticates.
    const pixly = await authenticateService("Bearer cos_live_test_key_for_driver_test");
    expect(pixly.id).toBe("pixly");
    expect(await asService((tx) => getService(tx, "pixly"))).toMatchObject({ verified: true });

    const allowed = await evaluateConsent(pixly, {
      userId: DEMO,
      serviceId: "pixly",
      dataType: "uploaded_images",
      purpose: "personalization",
      retentionDays: 30,
    });
    expect(allowed.decision).toBe("ALLOW");

    const denied = await evaluateConsent(pixly, {
      userId: DEMO,
      serviceId: "pixly",
      dataType: "uploaded_images",
      purpose: "foundation_model_training",
      retentionDays: 365,
    });
    expect(denied.reasonCode).toBe("PURPOSE_DENIED");

    const record = await asService((tx) => getReceipt(tx, allowed.receiptId!));
    expect(await asService((tx) => verifyStoredReceipt(tx, record!))).toMatchObject({ valid: true });

    expect(
      await checkGrant(pixly, { userId: DEMO, serviceId: "pixly", purpose: "personalization", receiptId: allowed.receiptId! }),
    ).toMatchObject({ authorized: true });

    // Revocation runs as the user, under row-level security, over the pooled connection.
    await revokeGrant(DEMO, allowed.receiptId!);
    expect(
      await checkGrant(pixly, { userId: DEMO, serviceId: "pixly", purpose: "personalization", receiptId: allowed.receiptId! }),
    ).toMatchObject({ authorized: false, code: "CONSENT_REVOKED" });
  });

  it("enforces row-level security on user connections", async () => {
    const { asUser } = await import("@/server/db");
    const stranger = "11111111-1111-4111-8111-111111111111";
    const rows = await asUser(stranger, (tx) => tx.query("select id from public.consent_receipts"));
    expect(rows).toHaveLength(0);
    await expect(asUser(stranger, (tx) => tx.query("select api_key_hash from public.services"))).rejects.toThrow(
      /permission denied/,
    );
  });
});

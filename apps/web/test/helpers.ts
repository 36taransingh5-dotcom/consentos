import { randomUUID } from "node:crypto";
import type { EvaluateRequestBody, ServiceSummary } from "@consentos/shared";
import { sha256Hex } from "@/server/crypto";
import { asService, getDb, resetDbForTests } from "@/server/db";
import { DEMO_USER_ID } from "@/server/env";
import { resetDemo } from "@/server/demo";
import { ensureDefaultPolicy } from "@/server/policies";
import { getService } from "@/server/services";

export const OTHER_SERVICE_KEY = "cos_test_otherapp_key";

export async function freshDatabase(): Promise<void> {
  await resetDbForTests();
  await getDb();
  await asService((tx) =>
    tx.query(
      `insert into public.services (id, name, domain, api_key_hash, verified)
       values ('otherapp', 'Other App', 'localhost:4000', $1, false) on conflict (id) do nothing`,
      [sha256Hex(OTHER_SERVICE_KEY)],
    ),
  );
  await resetDemo();
}

export async function service(id: string): Promise<ServiceSummary> {
  const s = await asService((tx) => getService(tx, id));
  if (!s) throw new Error(`no service ${id}`);
  return s;
}

export async function createUser(email = `user-${randomUUID()}@example.test`): Promise<string> {
  const [row] = await asService((tx) =>
    tx.query<{ id: string }>("insert into auth.users (email) values ($1) returning id", [email]),
  );
  await asService((tx) => ensureDefaultPolicy(tx, row!.id));
  return row!.id;
}

export function body(overrides: Partial<EvaluateRequestBody> = {}): EvaluateRequestBody {
  return {
    userId: DEMO_USER_ID,
    serviceId: "pixly",
    dataType: "uploaded_images",
    purpose: "personalization",
    retentionDays: 30,
    thirdPartySharing: false,
    ...overrides,
  };
}

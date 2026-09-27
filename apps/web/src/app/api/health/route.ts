import { getDb } from "@/server/db";
import { getConfig } from "@/server/env";
import { handle, json } from "@/server/http";

export const GET = handle(async () => {
  const config = getConfig();
  const db = await getDb();
  await db.query("select 1");
  return json({ ok: true, storage: config.storage, auth: config.auth, demoMode: config.demoMode });
});

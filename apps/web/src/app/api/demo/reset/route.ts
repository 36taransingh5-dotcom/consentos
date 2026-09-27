import { timingSafeEqual } from "node:crypto";
import { getSessionUser } from "@/server/auth";
import { resetDemo } from "@/server/demo";
import { DEMO_USER_ID, getConfig } from "@/server/env";
import { ApiError } from "@/server/errors";
import { clientAddress, handle, json } from "@/server/http";
import { rateLimit } from "@/server/rate-limit";

function tokenMatches(given: string | null, expected: string | undefined): boolean {
  if (!given || !expected) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * POST /api/demo/reset — return the demo account to its initial state.
 *
 * Only available when CONSENTOS_DEMO_MODE is not "false", and only to the
 * signed-in demo user (same-origin) or a caller holding the demo reset token
 * (the Pixly demo backend). Never touches any other account.
 */
export const POST = handle(async (req: Request) => {
  const config = getConfig();
  if (!config.demoMode) throw new ApiError(404, "NOT_FOUND", "Not found.");
  rateLimit(`demo-reset:${clientAddress(req)}`, 20, 60_000);

  let allowed = tokenMatches(req.headers.get("x-consentos-demo-token"), config.demoResetToken);
  if (!allowed && req.headers.get("origin") === new URL(req.url).origin) {
    const user = await getSessionUser();
    allowed = user?.id === DEMO_USER_ID;
  }
  if (!allowed) throw new ApiError(403, "FORBIDDEN", "Demo reset requires the demo account or the demo reset token.");

  await resetDemo();
  return json({ ok: true, resetAt: new Date().toISOString() });
});

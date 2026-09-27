import { grantCheckSchema } from "@consentos/shared";
import { checkGrant } from "@/server/consent";
import { handle, json, readJson } from "@/server/http";
import { rateLimit } from "@/server/rate-limit";
import { authenticateService } from "@/server/services";

/**
 * POST /api/v1/grants/check — runtime enforcement.
 *
 * A service's backend calls this before it touches user data. ConsentOS checks
 * that the grant exists, belongs to this user and service, covers this purpose
 * (and data type), is not revoked, and still verifies cryptographically.
 * Always 200: `authorized` carries the answer, `code` is what the service's
 * protected endpoint should return (CONSENT_VIOLATION / CONSENT_REVOKED).
 */
export const POST = handle(async (req: Request) => {
  const service = await authenticateService(req.headers.get("authorization"));
  rateLimit(`check:${service.id}`, 600, 60_000);
  const body = await readJson(req, grantCheckSchema);
  return json(await checkGrant(service, body));
});

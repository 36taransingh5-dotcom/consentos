import { evaluateRequestSchema } from "@consentos/shared";
import { evaluateConsent } from "@/server/consent";
import { handle, json, readJson } from "@/server/http";
import { rateLimit } from "@/server/rate-limit";
import { authenticateService } from "@/server/services";

/**
 * POST /api/v1/consent/evaluate
 *
 * A service asks to use a user's data for a purpose. Authenticated with the
 * service's secret API key. The decision is made by the deterministic policy
 * engine against the user's current policy version; ALLOW and DENY decisions
 * come back with a signed receipt.
 */
export const POST = handle(async (req: Request) => {
  const service = await authenticateService(req.headers.get("authorization"));
  rateLimit(`evaluate:${service.id}`, 120, 60_000);
  const body = await readJson(req, evaluateRequestSchema);
  return json(await evaluateConsent(service, body));
});

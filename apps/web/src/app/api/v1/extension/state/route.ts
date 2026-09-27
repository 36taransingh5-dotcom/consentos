import { serviceIdSchema } from "@consentos/shared";
import { authenticateUserRequest } from "@/server/auth";
import { buildExtensionState } from "@/server/extension-state";
import { handle, json } from "@/server/http";
import { rateLimit } from "@/server/rate-limit";

/**
 * GET /api/v1/extension/state?serviceId=pixly&origin=http://localhost:3001
 *
 * What the extension popup shows. `serviceId` is what the page announced;
 * `origin` is the tab's real origin, checked against the service's domain.
 */
export const GET = handle(async (req: Request) => {
  const user = await authenticateUserRequest(req);
  rateLimit(`state:${user.id}`, 240, 60_000);
  const url = new URL(req.url);
  const serviceId = url.searchParams.get("serviceId");
  const origin = url.searchParams.get("origin");
  return json(
    await buildExtensionState(user, {
      serviceId: serviceId && serviceIdSchema.safeParse(serviceId).success ? serviceId : undefined,
      origin: origin ?? undefined,
    }),
  );
});

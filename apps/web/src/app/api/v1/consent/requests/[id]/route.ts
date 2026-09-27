import { uuidSchema } from "@consentos/shared";
import { getRequestStatus } from "@/server/consent";
import { ApiError } from "@/server/errors";
import { handle, json } from "@/server/http";
import { rateLimit } from "@/server/rate-limit";
import { authenticateService } from "@/server/services";

/** GET /api/v1/consent/requests/:id — a service polls a REQUIRE_USER request until the user answers. */
export const GET = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const service = await authenticateService(req.headers.get("authorization"));
  rateLimit(`status:${service.id}`, 600, 60_000);
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) throw new ApiError(400, "INVALID_ID", "Request ids are UUIDs.");
  return json(await getRequestStatus(service, id));
});

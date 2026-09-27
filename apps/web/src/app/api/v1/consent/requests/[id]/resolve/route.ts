import { resolveRequestSchema, uuidSchema } from "@consentos/shared";
import { authenticateUserRequest } from "@/server/auth";
import { resolvePendingRequest } from "@/server/consent";
import { ApiError } from "@/server/errors";
import { handle, json, readJson } from "@/server/http";

/** POST /api/v1/consent/requests/:id/resolve — the user answers a request their policy escalated. */
export const POST = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await authenticateUserRequest(req, { mutation: true });
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) throw new ApiError(400, "INVALID_ID", "Request ids are UUIDs.");
  const { decision } = await readJson(req, resolveRequestSchema);
  return json(await resolvePendingRequest(user.id, id, decision));
});

import { uuidSchema } from "@consentos/shared";
import { authenticateUserRequest } from "@/server/auth";
import { revokeGrant } from "@/server/consent";
import { ApiError } from "@/server/errors";
import { handle, json } from "@/server/http";

/** POST /api/v1/receipts/:id/revoke — the user withdraws a grant. Enforcement fails from then on. */
export const POST = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await authenticateUserRequest(req, { mutation: true });
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) throw new ApiError(400, "INVALID_ID", "Receipt ids are UUIDs.");
  return json({ receiptId: id, ...(await revokeGrant(user.id, id)) });
});

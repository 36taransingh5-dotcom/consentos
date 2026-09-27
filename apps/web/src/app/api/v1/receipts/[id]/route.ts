import { uuidSchema } from "@consentos/shared";
import { authenticateUserRequest } from "@/server/auth";
import { asService, asUser } from "@/server/db";
import { ApiError } from "@/server/errors";
import { handle, json } from "@/server/http";
import { getReceipt, type ReceiptRecord } from "@/server/receipts";
import { authenticateService } from "@/server/services";

/**
 * GET /api/v1/receipts/:id — the full signed receipt document.
 * Readable by the user it belongs to, or by the service it was issued to.
 */
export const GET = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) throw new ApiError(400, "INVALID_ID", "Receipt ids are UUIDs.");

  const authorization = req.headers.get("authorization") ?? "";
  let record: ReceiptRecord | null;
  if (/^Bearer\s+cos_/i.test(authorization)) {
    const service = await authenticateService(authorization);
    record = await asService((tx) => getReceipt(tx, id));
    if (record && record.serviceId !== service.id) record = null;
  } else {
    const user = await authenticateUserRequest(req);
    record = await asUser(user.id, (tx) => getReceipt(tx, id));
  }
  if (!record) throw new ApiError(404, "RECEIPT_NOT_FOUND", "No receipt with this id.");

  return json({
    receipt: record.receipt,
    status: {
      revoked: record.revokedAt !== null,
      revokedAt: record.revokedAt,
      revocationReason: record.revocationReason,
    },
  });
});

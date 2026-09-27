import { uuidSchema } from "@consentos/shared";
import { asService } from "@/server/db";
import { ApiError } from "@/server/errors";
import { clientAddress, handle, json, preflight } from "@/server/http";
import { rateLimit } from "@/server/rate-limit";
import { getReceipt, verifyStoredReceipt } from "@/server/receipts";

/**
 * GET /api/v1/receipts/:id/verify — public integrity check.
 *
 * Recomputes the payload hash, request hash and policy hash, checks the
 * Ed25519 signature, and confirms the stored row still matches the signed
 * payload. Returns booleans only; no personal data.
 */
export const GET = handle(
  async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
    rateLimit(`verify:${clientAddress(req)}`, 120, 60_000);
    const { id } = await params;
    if (!uuidSchema.safeParse(id).success) throw new ApiError(400, "INVALID_ID", "Receipt ids are UUIDs.");
    const result = await asService(async (tx) => {
      const record = await getReceipt(tx, id);
      return record ? verifyStoredReceipt(tx, record) : null;
    });
    if (!result) throw new ApiError(404, "RECEIPT_NOT_FOUND", "No receipt with this id.");
    return json(result);
  },
  { cors: true },
);

export const OPTIONS = preflight;

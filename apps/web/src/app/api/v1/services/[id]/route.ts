import { serviceIdSchema } from "@consentos/shared";
import { asService } from "@/server/db";
import { ApiError } from "@/server/errors";
import { handle, json, preflight } from "@/server/http";
import { getService } from "@/server/services";

/** GET /api/v1/services/:id — public directory entry for an integrated service. */
export const GET = handle(
  async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    if (!serviceIdSchema.safeParse(id).success) throw new ApiError(400, "INVALID_ID", "Invalid service id.");
    const service = await asService((tx) => getService(tx, id));
    if (!service) throw new ApiError(404, "SERVICE_NOT_FOUND", "No service with this id has integrated ConsentOS.");
    return json(service);
  },
  { cors: true },
);

export const OPTIONS = preflight;

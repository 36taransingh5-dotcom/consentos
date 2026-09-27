import { ConsentOSError } from "@consentos/sdk";
import { consentos, type Exchange } from "@/lib/consentos";
import { isFeatureId } from "@/lib/features";
import { readGrants, writeGrants } from "@/lib/grants";

/**
 * GET /api/consent/status?requestId=…&feature=…
 * Follow a request the user's rules escalated (REQUIRE_USER) until they answer.
 */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const requestId = url.searchParams.get("requestId") ?? "";
  const feature = url.searchParams.get("feature");
  if (!/^[0-9a-f-]{36}$/i.test(requestId) || !isFeatureId(feature)) {
    return Response.json({ error: { code: "INVALID_REQUEST", message: "Unknown request." } }, { status: 400 });
  }
  const exchanges: Exchange[] = [];
  try {
    const status = await consentos(exchanges).getRequest(requestId);
    if (status.status === "resolved" && status.decision === "ALLOW" && status.receiptId) {
      await writeGrants({ ...(await readGrants()), [feature]: status.receiptId });
    }
    return Response.json({ status, exchanges });
  } catch (error) {
    const e = error instanceof ConsentOSError ? error : null;
    return Response.json(
      { error: { code: e?.code ?? "CONSENTOS_UNAVAILABLE", message: e?.message ?? "ConsentOS could not be reached." }, exchanges },
      { status: 502 },
    );
  }
}

import { ConsentOSError, type EvaluateResponse } from "@consentos/sdk";
import { serverConfig } from "@/lib/config";
import { consentos, type Exchange } from "@/lib/consentos";
import { FEATURES, isFeatureId } from "@/lib/features";
import { readGrants, writeGrants } from "@/lib/grants";

export interface ConsentRouteResponse {
  feature: string;
  result?: EvaluateResponse;
  error?: { code: string; message: string };
  exchanges: Exchange[];
}

/**
 * POST /api/consent { feature }
 *
 * Pixly's backend asks ConsentOS for permission to power a feature. The
 * browser never talks to ConsentOS with Pixly's key, and never decides.
 */
export async function POST(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as { feature?: unknown };
  if (!isFeatureId(body.feature)) {
    return Response.json({ error: { code: "UNKNOWN_FEATURE", message: "Unknown feature." } }, { status: 400 });
  }
  const feature = FEATURES[body.feature];
  const exchanges: Exchange[] = [];

  try {
    const result = await consentos(exchanges).request({
      userId: serverConfig.consentosUserId,
      ...feature.ask,
      metadata: { feature: feature.id, surface: "pixly-web" },
    });
    if (result.decision === "ALLOW" && result.receiptId) {
      await writeGrants({ ...(await readGrants()), [feature.id]: result.receiptId });
    }
    return Response.json({ feature: feature.id, result, exchanges } satisfies ConsentRouteResponse);
  } catch (error) {
    const e = error instanceof ConsentOSError ? error : null;
    return Response.json(
      {
        feature: feature.id,
        error: {
          code: e?.code ?? "CONSENTOS_UNAVAILABLE",
          message: e?.message ?? "ConsentOS could not be reached.",
        },
        exchanges,
      } satisfies ConsentRouteResponse,
      { status: 502 },
    );
  }
}

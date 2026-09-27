import { ConsentOSError } from "@consentos/sdk";
import { serverConfig } from "@/lib/config";
import { consentos, encodeExchanges, type Exchange } from "@/lib/consentos";

/**
 * POST /api/train-model { grantId? }
 *
 * Pixly's model-training job. Before it touches a single photo it asks
 * ConsentOS whether this exact use is permitted. It does not trust the
 * browser, its own UI state, or a grant issued for anything else: without a
 * valid, unrevoked foundation-model-training grant for this user, it refuses.
 */
export async function POST(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as { grantId?: unknown };
  const grantId = typeof body.grantId === "string" && /^[0-9a-f-]{36}$/i.test(body.grantId) ? body.grantId : undefined;
  const exchanges: Exchange[] = [];
  const trace = () => ({ "x-pixly-consentos-trace": encodeExchanges(exchanges) });

  let check;
  try {
    check = await consentos(exchanges).checkGrant({
      userId: serverConfig.consentosUserId,
      purpose: "foundation_model_training",
      dataType: "uploaded_images",
      receiptId: grantId,
    });
  } catch (error) {
    // Fail closed: if ConsentOS cannot be asked, the job does not run.
    return Response.json(
      {
        error: "CONSENT_UNVERIFIABLE",
        message: error instanceof ConsentOSError ? error.message : "ConsentOS could not be reached, so training was not started.",
      },
      { status: 503, headers: trace() },
    );
  }

  if (!check.authorized) {
    return Response.json({ error: check.code, message: check.message }, { status: 403, headers: trace() });
  }

  return Response.json(
    {
      status: "training_started",
      jobId: `job_${crypto.randomUUID().slice(0, 8)}`,
      grantId: check.receiptId,
      message: "Training started under a valid ConsentOS grant.",
    },
    { status: 202, headers: trace() },
  );
}

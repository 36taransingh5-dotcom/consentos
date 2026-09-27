import { ConsentOSError } from "@consentos/sdk";
import { serverConfig } from "@/lib/config";
import { consentos, encodeExchanges, type Exchange } from "@/lib/consentos";
import { readGrants } from "@/lib/grants";
import { DISCOVER } from "@/lib/photos";

/**
 * GET /api/recommendations — personalised picks. Protected by the user's
 * personalisation grant; once it is revoked this returns 403 CONSENT_REVOKED.
 */
export async function GET(): Promise<Response> {
  const grants = await readGrants();
  const exchanges: Exchange[] = [];
  const headers = () => ({ "x-pixly-consentos-trace": encodeExchanges(exchanges), "cache-control": "no-store" });

  try {
    const check = await consentos(exchanges).checkGrant({
      userId: serverConfig.consentosUserId,
      purpose: "personalization",
      dataType: "uploaded_images",
      receiptId: grants.recommendations,
    });
    if (!check.authorized) {
      return Response.json({ error: check.code, message: check.message }, { status: 403, headers: headers() });
    }
  } catch (error) {
    return Response.json(
      { error: "CONSENT_UNVERIFIABLE", message: error instanceof ConsentOSError ? error.message : "ConsentOS is unreachable." },
      { status: 503, headers: headers() },
    );
  }

  return Response.json({ items: DISCOVER.slice(0, 4) }, { headers: headers() });
}

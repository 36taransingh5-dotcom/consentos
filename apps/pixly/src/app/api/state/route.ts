import { consentos } from "@/lib/consentos";
import { serverConfig } from "@/lib/config";
import { FEATURES, type FeatureId } from "@/lib/features";
import { readGrants, writeGrants, type GrantMap } from "@/lib/grants";

export type FeatureStatus = "none" | "active" | "revoked";

export interface PixlyState {
  features: Record<FeatureId, { status: FeatureStatus; receiptId: string | null; message: string | null }>;
  consentosReachable: boolean;
}

/**
 * GET /api/state — which features are currently backed by a live ConsentOS
 * grant. Uses `intent: "status"`: this is the UI asking, not a use of data.
 */
export async function GET(): Promise<Response> {
  const grants = await readGrants();
  const client = consentos();
  const features = Object.fromEntries(
    (Object.keys(FEATURES) as FeatureId[]).map((id) => [id, { status: "none", receiptId: null, message: null }]),
  ) as PixlyState["features"];
  const next: GrantMap = { ...grants };
  let consentosReachable = true;

  await Promise.all(
    (Object.entries(grants) as [FeatureId, string][]).map(async ([id, receiptId]) => {
      try {
        const check = await client.checkGrant({
          userId: serverConfig.consentosUserId,
          purpose: FEATURES[id].ask.purpose,
          dataType: FEATURES[id].ask.dataType,
          receiptId,
          intent: "status",
        });
        if (check.authorized) {
          features[id] = { status: "active", receiptId: check.receiptId, message: null };
          if (check.receiptId) next[id] = check.receiptId;
        } else if (check.code === "CONSENT_REVOKED") {
          features[id] = { status: "revoked", receiptId, message: check.message };
        } else {
          // The grant no longer exists (e.g. the demo was reset): forget it.
          delete next[id];
        }
      } catch {
        consentosReachable = false;
      }
    }),
  );

  if (JSON.stringify(next) !== JSON.stringify(grants)) await writeGrants(next);
  return Response.json({ features, consentosReachable } satisfies PixlyState, { headers: { "cache-control": "no-store" } });
}

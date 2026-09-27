import "server-only";
import { PURPOSE_CATALOG, PURPOSES, purposeLabel, summarizePolicy } from "@consentos/policy-engine";
import type { BlockedSummary, ExtensionState, GrantSummary, PendingSummary } from "@consentos/shared";
import type { SessionUser } from "./auth";
import { listActiveGrants, listPendingRequests, type PendingRequest } from "./consent";
import { asUser } from "./db";
import { listEvents } from "./events";
import { currentPolicy } from "./policies";
import { listReceipts } from "./receipts";
import { getService, originMatchesDomain } from "./services";

const toPending = (p: PendingRequest): PendingSummary => ({ ...p, purposeLabel: purposeLabel(p.purpose) });

/**
 * Everything the extension popup shows, read as the user under row-level
 * security. `serviceId` comes from the page's explicit ConsentOS
 * announcement; `origin` is the tab's origin, checked against the service's
 * registered domain.
 */
export async function buildExtensionState(
  user: SessionUser,
  options: { serviceId?: string; origin?: string } = {},
): Promise<ExtensionState> {
  return asUser(user.id, async (tx) => {
    const policy = await currentPolicy(tx, user.id);
    if (!policy) throw new Error("User has no policy");

    const [events, pending] = await Promise.all([
      listEvents(tx, user.id, { limit: 15 }),
      listPendingRequests(tx, user.id),
    ]);

    let site: ExtensionState["site"] = null;
    const service = options.serviceId ? await getService(tx, options.serviceId) : null;
    if (service) {
      const [grantRecords, receipts] = await Promise.all([
        listActiveGrants(tx, user.id, service.id),
        listReceipts(tx, user.id, { serviceId: service.id, limit: 200 }),
      ]);

      const grants: GrantSummary[] = grantRecords.map((g) => ({
        receiptId: g.id,
        purpose: g.purpose,
        purposeLabel: purposeLabel(g.purpose),
        dataType: g.dataType,
        retentionDays: g.receipt.payload.request.retentionDays,
        issuedAt: g.issuedAt,
      }));

      // Most recent refusal per purpose (receipts are newest first).
      const refusals = new Map<string, { receiptId: string; at: string }>();
      for (const r of receipts) {
        if (r.decision === "DENY" && !refusals.has(r.purpose)) refusals.set(r.purpose, { receiptId: r.id, at: r.issuedAt });
      }

      const blocked: BlockedSummary[] = [];
      const grantedPurposes = new Set(grants.map((g) => g.purpose));
      for (const purpose of PURPOSES) {
        const deniedByPolicy = policy.policy[PURPOSE_CATALOG[purpose].ruleKey] === "deny";
        const refusal = refusals.get(purpose);
        if (!deniedByPolicy && (!refusal || grantedPurposes.has(purpose))) continue;
        blocked.push({
          purpose,
          purposeLabel: purposeLabel(purpose),
          source: refusal ? "request" : "policy",
          receiptId: refusal?.receiptId ?? null,
          attemptedAt: refusal?.at ?? null,
        });
        refusals.delete(purpose);
      }
      // Refused requests for purposes outside the catalogue.
      for (const [purpose, refusal] of refusals) {
        if (grantedPurposes.has(purpose)) continue;
        blocked.push({
          purpose,
          purposeLabel: purposeLabel(purpose),
          source: "request",
          receiptId: refusal.receiptId,
          attemptedAt: refusal.at,
        });
      }
      // Things the service actually tried come first, newest first.
      blocked.sort((a, b) => (b.attemptedAt ?? "").localeCompare(a.attemptedAt ?? ""));

      site = {
        service,
        originVerified: options.origin ? originMatchesDomain(options.origin, service.domain) : false,
        grants,
        blocked,
        pending: pending.filter((p) => p.serviceId === service.id).map(toPending),
        latestEvent: events.find((e) => e.serviceId === service.id) ?? null,
        latestReceiptId: receipts[0]?.id ?? null,
      };
    }

    return {
      user,
      policy: {
        version: policy.version,
        hash: policy.policyHash,
        policy: policy.policy,
        rows: summarizePolicy(policy.policy).map((r) => ({ key: r.key, label: r.label, display: r.display })),
        maxRetentionDays: policy.policy.maxRetentionDays,
        updatedAt: policy.createdAt,
      },
      site,
      pending: pending.map(toPending),
      recentEvents: events,
      serverTime: new Date().toISOString(),
    };
  });
}

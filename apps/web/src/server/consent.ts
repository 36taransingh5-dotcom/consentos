import "server-only";
import { randomUUID } from "node:crypto";
import { ENGINE_VERSION, evaluate, isKnownPurpose, PURPOSE_CATALOG } from "@consentos/policy-engine";
import type {
  ConsentRequestStatus,
  EvaluateRequestBody,
  EvaluateResponse,
  GrantCheckBody,
  GrantCheckReason,
  GrantCheckResponse,
  ReceiptReasonCode,
  ServiceSummary,
} from "@consentos/shared";
import { getKeyRing } from "./crypto";
import { asService, asUser, iso, type Queryable } from "./db";
import { getConfig } from "./env";
import { ApiError } from "./errors";
import { recordEvent } from "./events";
import { currentPolicy, policyAtVersion, type PolicyVersion } from "./policies";
import {
  checkIntegrity,
  getReceipt,
  insertReceipt,
  normalizeRequest,
  rowMatchesPayload,
  signReceipt,
  toRecord,
  type ReceiptRecord,
  type ReceiptRow,
} from "./receipts";

export function receiptUrl(receiptId: string): string {
  return `${getConfig().publicUrl}/receipts/${receiptId}`;
}

/** "foundation-model training", "personalisation" — for sentences addressed to services. */
function purposePhrase(purpose: string): string {
  if (!isKnownPurpose(purpose)) return `"${purpose}"`;
  const formal = PURPOSE_CATALOG[purpose].formal;
  return formal.charAt(0).toLowerCase() + formal.slice(1);
}

async function supersedeActiveGrants(
  tx: Queryable,
  g: { userId: string; serviceId: string; purpose: string; dataType: string; at: string },
): Promise<void> {
  await tx.query(
    `update public.consent_receipts
        set revoked_at = $5, revocation_reason = 'superseded'
      where user_id = $1 and service_id = $2 and purpose = $3 and data_type = $4
        and decision = 'ALLOW' and revoked_at is null`,
    [g.userId, g.serviceId, g.purpose, g.dataType, g.at],
  );
}

/* ------------------------------------------------------------------ */
/* Evaluation                                                          */
/* ------------------------------------------------------------------ */

/**
 * Evaluate a service's request against the user's current policy, record it,
 * and issue a signed receipt for any ALLOW or DENY. The decision comes only
 * from the deterministic engine; nothing the service sends can set it.
 */
export async function evaluateConsent(service: ServiceSummary, body: EvaluateRequestBody): Promise<EvaluateResponse> {
  if (body.serviceId !== service.id) {
    throw new ApiError(403, "SERVICE_MISMATCH", "This API key belongs to a different service.");
  }
  const keyRing = getKeyRing();

  return asService(async (tx) => {
    const [user] = await tx.query<{ id: string }>("select id from auth.users where id = $1", [body.userId]);
    if (!user) throw new ApiError(404, "USER_NOT_FOUND", "No ConsentOS user has this id.");

    const policy = await currentPolicy(tx, body.userId);
    if (!policy) throw new ApiError(409, "NO_POLICY", "This user has not set up a privacy policy yet.");

    const request = normalizeRequest(body);
    const result = evaluate(policy.policy, {
      dataType: request.dataType,
      purpose: request.purpose,
      retentionDays: request.retentionDays ?? undefined,
      thirdPartySharing: request.thirdPartySharing,
      anonymized: request.anonymized,
    });
    const evaluatedAt = new Date().toISOString();
    const pending = result.decision === "REQUIRE_USER";

    const [row] = await tx.query<{ id: string }>(
      `insert into public.consent_requests
         (user_id, service_id, data_type, purpose, retention_days, third_party_sharing, request_payload,
          decision, reason_code, reason, evaluation_trace, policy_version, engine_version, status, created_at)
       values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11::jsonb, $12, $13, $14, $15)
       returning id`,
      [
        body.userId,
        service.id,
        request.dataType,
        request.purpose,
        request.retentionDays,
        request.thirdPartySharing,
        JSON.stringify(request),
        result.decision,
        result.reasonCode,
        result.reason,
        JSON.stringify(result.trace),
        policy.version,
        ENGINE_VERSION,
        pending ? "pending" : "decided",
        evaluatedAt,
      ],
    );
    const requestId = row!.id;

    let receiptId: string | null = null;
    if (result.decision !== "REQUIRE_USER") {
      receiptId = randomUUID();
      if (result.decision === "ALLOW") {
        await supersedeActiveGrants(tx, {
          userId: body.userId,
          serviceId: service.id,
          purpose: request.purpose,
          dataType: request.dataType,
          at: evaluatedAt,
        });
      }
      await insertReceipt(
        tx,
        signReceipt(
          {
            receiptId,
            requestId,
            userId: body.userId,
            serviceId: service.id,
            request,
            decision: { decision: result.decision, reasonCode: result.reasonCode, reason: result.reason },
            policyVersion: policy.version,
            policyHash: policy.policyHash,
            issuedAt: evaluatedAt,
          },
          keyRing.active,
        ),
      );
    }

    await recordEvent(tx, {
      userId: body.userId,
      serviceId: service.id,
      type: result.decision === "ALLOW" ? "consent.allowed" : result.decision === "DENY" ? "consent.denied" : "consent.pending",
      metadata: {
        requestId,
        receiptId,
        decision: result.decision,
        reasonCode: result.reasonCode,
        purpose: request.purpose,
        dataType: request.dataType,
        retentionDays: request.retentionDays,
        maxRetentionDays: result.details?.maxRetentionDays,
        rule: result.details?.rule,
        ruleValue: result.details?.ruleValue,
      },
    });

    return {
      requestId,
      decision: result.decision,
      reasonCode: result.reasonCode,
      reason: result.reason,
      ...(result.details ? { details: result.details } : {}),
      evaluatedAt,
      policyVersion: policy.version,
      receiptId,
      receiptUrl: receiptId ? receiptUrl(receiptId) : null,
      engineVersion: ENGINE_VERSION,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Pending requests (REQUIRE_USER)                                      */
/* ------------------------------------------------------------------ */

interface RequestRow {
  id: string;
  user_id: string;
  service_id: string;
  service_name?: string;
  data_type: string;
  purpose: string;
  retention_days: number | null;
  request_payload: ReturnType<typeof normalizeRequest>;
  decision: "ALLOW" | "DENY" | "REQUIRE_USER";
  reason_code: string;
  reason: string;
  status: "decided" | "pending" | "resolved";
  resolved_decision: "ALLOW" | "DENY" | null;
  resolved_at: Date | string | null;
  created_at: Date | string;
}

/** A service polls this after a REQUIRE_USER decision. */
export async function getRequestStatus(service: ServiceSummary, requestId: string): Promise<ConsentRequestStatus> {
  return asService(async (tx) => {
    const [row] = await tx.query<RequestRow & { receipt_id: string | null; receipt_reason_code: string | null; receipt_reason: string | null }>(
      `select q.*, r.id as receipt_id, r.payload->'decision'->>'reasonCode' as receipt_reason_code,
              r.payload->'decision'->>'reason' as receipt_reason
         from public.consent_requests q
         left join public.consent_receipts r on r.consent_request_id = q.id
        where q.id = $1 and q.service_id = $2`,
      [requestId, service.id],
    );
    if (!row) throw new ApiError(404, "REQUEST_NOT_FOUND", "No request with this id for this service.");
    const resolved = row.status === "resolved";
    return {
      requestId: row.id,
      status: row.status,
      decision: resolved ? row.resolved_decision! : row.decision,
      reasonCode: (resolved ? row.receipt_reason_code : row.reason_code) as ReceiptReasonCode,
      reason: (resolved ? row.receipt_reason : row.reason) ?? row.reason,
      receiptId: row.receipt_id,
      resolvedAt: row.resolved_at ? iso(row.resolved_at) : null,
    };
  });
}

export interface PendingRequest {
  requestId: string;
  serviceId: string;
  serviceName: string;
  purpose: string;
  dataType: string;
  retentionDays: number | null;
  reasonCode: string;
  reason: string;
  createdAt: string;
}

export async function listPendingRequests(q: Queryable, userId: string, serviceId?: string): Promise<PendingRequest[]> {
  const params: unknown[] = [userId];
  let where = "q.user_id = $1 and q.status = 'pending'";
  if (serviceId) {
    params.push(serviceId);
    where += ` and q.service_id = $2`;
  }
  const rows = await q.query<RequestRow & { service_name: string }>(
    `select q.*, s.name as service_name from public.consent_requests q
       join public.services s on s.id = q.service_id
      where ${where} order by q.created_at desc limit 20`,
    params,
  );
  return rows.map((r) => ({
    requestId: r.id,
    serviceId: r.service_id,
    serviceName: r.service_name,
    purpose: r.purpose,
    dataType: r.data_type,
    retentionDays: r.retention_days,
    reasonCode: r.reason_code,
    reason: r.reason,
    createdAt: iso(r.created_at),
  }));
}

/**
 * The user answers a REQUIRE_USER request. Ownership and the pending state are
 * enforced by row-level security; the receipt is then signed server-side.
 */
export async function resolvePendingRequest(
  userId: string,
  requestId: string,
  decision: "ALLOW" | "DENY",
): Promise<{ receiptId: string }> {
  const at = new Date().toISOString();
  const [row] = await asUser(userId, (tx) =>
    tx.query<RequestRow>(
      `update public.consent_requests
          set status = 'resolved', resolved_decision = $2, resolved_at = $3
        where id = $1 and status = 'pending'
        returning *`,
      [requestId, decision, at],
    ),
  );
  if (!row) throw new ApiError(404, "REQUEST_NOT_PENDING", "There is no pending request with this id.");

  return asService(async (tx) => {
    const policy = await currentPolicy(tx, userId);
    const receiptId = randomUUID();
    if (decision === "ALLOW") {
      await supersedeActiveGrants(tx, { userId, serviceId: row.service_id, purpose: row.purpose, dataType: row.data_type, at });
    }
    await insertReceipt(
      tx,
      signReceipt(
        {
          receiptId,
          requestId,
          userId,
          serviceId: row.service_id,
          request: row.request_payload,
          decision:
            decision === "ALLOW"
              ? { decision, reasonCode: "USER_APPROVED", reason: "The user approved this request." }
              : { decision, reasonCode: "USER_DECLINED", reason: "The user declined this request." },
          policyVersion: policy!.version,
          policyHash: policy!.policyHash,
          issuedAt: at,
        },
        getKeyRing().active,
      ),
    );
    await recordEvent(tx, {
      userId,
      serviceId: row.service_id,
      type: "consent.resolved",
      metadata: { requestId, receiptId, decision, purpose: row.purpose, dataType: row.data_type },
    });
    return { receiptId };
  });
}

/* ------------------------------------------------------------------ */
/* Grants                                                              */
/* ------------------------------------------------------------------ */

export async function listActiveGrants(q: Queryable, userId: string, serviceId?: string): Promise<ReceiptRecord[]> {
  const params: unknown[] = [userId];
  let where = "r.user_id = $1 and r.decision = 'ALLOW' and r.revoked_at is null";
  if (serviceId) {
    params.push(serviceId);
    where += " and r.service_id = $2";
  }
  const rows = await q.query<ReceiptRow>(
    `select r.*, s.name as service_name from public.consent_receipts r
       join public.services s on s.id = r.service_id
      where ${where} order by r.issued_at desc`,
    params,
  );
  return rows.map(toRecord);
}

/** The user withdraws a grant. Row-level security limits this to their own active grants. */
export async function revokeGrant(userId: string, receiptId: string): Promise<{ revokedAt: string }> {
  const at = new Date().toISOString();
  const outcome = await asUser(userId, async (tx) => {
    const [updated] = await tx.query<ReceiptRow>(
      `update public.consent_receipts set revoked_at = $2, revocation_reason = 'user'
        where id = $1 and decision = 'ALLOW' and revoked_at is null
        returning *`,
      [receiptId, at],
    );
    if (updated) return { updated };
    const [existing] = await tx.query<ReceiptRow>("select * from public.consent_receipts where id = $1", [receiptId]);
    return { existing };
  });

  if (!outcome.updated) {
    if (!outcome.existing) throw new ApiError(404, "RECEIPT_NOT_FOUND", "No receipt with this id.");
    if (outcome.existing.decision !== "ALLOW") {
      throw new ApiError(409, "NOT_A_GRANT", "Only allowed requests can be revoked.");
    }
    throw new ApiError(409, "ALREADY_REVOKED", "This grant has already been revoked.");
  }

  const r = outcome.updated;
  await asService((tx) =>
    recordEvent(tx, {
      userId,
      serviceId: r.service_id,
      type: "grant.revoked",
      metadata: { receiptId, purpose: r.purpose, dataType: r.data_type, revocationReason: "user" },
    }),
  );
  return { revokedAt: at };
}

/** After a policy change, revoke active grants the new rules would deny. */
export async function revokeGrantsInvalidatedByPolicy(
  tx: Queryable,
  userId: string,
  policy: PolicyVersion,
): Promise<string[]> {
  const grants = await listActiveGrants(tx, userId);
  const revoked: string[] = [];
  const at = new Date().toISOString();
  for (const grant of grants) {
    const r = grant.receipt.payload.request;
    const result = evaluate(policy.policy, {
      dataType: r.dataType,
      purpose: r.purpose,
      retentionDays: r.retentionDays ?? undefined,
      thirdPartySharing: r.thirdPartySharing,
      anonymized: r.anonymized,
    });
    if (result.decision !== "DENY") continue;
    await tx.query(
      `update public.consent_receipts set revoked_at = $2, revocation_reason = 'policy_change'
        where id = $1 and revoked_at is null`,
      [grant.id, at],
    );
    await recordEvent(tx, {
      userId,
      serviceId: grant.serviceId,
      type: "grant.revoked",
      metadata: {
        receiptId: grant.id,
        purpose: grant.purpose,
        dataType: grant.dataType,
        revocationReason: "policy_change",
        reasonCode: result.reasonCode,
        version: policy.version,
      },
    });
    revoked.push(grant.id);
  }
  return revoked;
}

/* ------------------------------------------------------------------ */
/* Runtime enforcement                                                 */
/* ------------------------------------------------------------------ */

/**
 * Is this service allowed, right now, to use this user's data for this
 * purpose? Called by a service's backend before doing the work. Independent of
 * anything the service's own frontend claims.
 */
export async function checkGrant(service: ServiceSummary, body: GrantCheckBody): Promise<GrantCheckResponse> {
  if (body.serviceId !== service.id) {
    throw new ApiError(403, "SERVICE_MISMATCH", "This API key belongs to a different service.");
  }

  return asService(async (tx) => {
    const checkedAt = new Date().toISOString();
    const phrase = purposePhrase(body.purpose);

    const deny = async (
      reason: GrantCheckReason,
      message: string,
      receiptId: string | null,
    ): Promise<GrantCheckResponse> => {
      const revoked = reason === "REVOKED";
      const [user] =
        body.intent === "status"
          ? []
          : await tx.query<{ id: string }>("select id from auth.users where id = $1", [body.userId]);
      if (user) {
        await recordEvent(tx, {
          userId: body.userId,
          serviceId: service.id,
          type: "enforcement.blocked",
          metadata: { purpose: body.purpose, dataType: body.dataType, reason, receiptId },
        });
      }
      return {
        authorized: false,
        code: revoked ? "CONSENT_REVOKED" : "CONSENT_VIOLATION",
        reason,
        message,
        receiptId,
        checkedAt,
      };
    };

    const noPermission = `The user has not granted permission for ${phrase}.`;
    let grant: ReceiptRecord | null;

    if (body.receiptId) {
      grant = await getReceipt(tx, body.receiptId);
      if (!grant) return deny("GRANT_NOT_FOUND", `${noPermission} The presented grant does not exist.`, body.receiptId);
      if (grant.userId !== body.userId) {
        return deny("USER_MISMATCH", `${noPermission} The presented grant belongs to a different user.`, grant.id);
      }
      if (grant.serviceId !== service.id) {
        return deny("SERVICE_MISMATCH", `${noPermission} The presented grant was issued to a different service.`, grant.id);
      }
      if (grant.purpose !== body.purpose) {
        return deny(
          "PURPOSE_MISMATCH",
          `${noPermission} The presented grant covers ${purposePhrase(grant.purpose)}, not ${phrase}.`,
          grant.id,
        );
      }
      if (body.dataType && grant.dataType !== body.dataType) {
        return deny("DATA_TYPE_MISMATCH", `${noPermission} The presented grant covers different data.`, grant.id);
      }
      if (grant.decision !== "ALLOW") {
        return deny("DECISION_NOT_ALLOW", `${noPermission} The presented receipt records a refusal.`, grant.id);
      }
    } else {
      const params: unknown[] = [body.userId, service.id, body.purpose];
      let where = "r.user_id = $1 and r.service_id = $2 and r.purpose = $3 and r.decision = 'ALLOW'";
      if (body.dataType) {
        params.push(body.dataType);
        where += " and r.data_type = $4";
      }
      const [row] = await tx.query<ReceiptRow>(
        `select r.*, s.name as service_name from public.consent_receipts r
           join public.services s on s.id = r.service_id
          where ${where}
          order by (r.revoked_at is null) desc, r.issued_at desc limit 1`,
        params,
      );
      grant = row ? toRecord(row) : null;
      if (!grant) return deny("NO_GRANT", noPermission, null);
    }

    // A grant replaced by a newer one for the same use hands over to its successor,
    // so a service holding the older receipt id keeps working until the user revokes.
    let replaced: string | null = null;
    if (grant.revocationReason === "superseded") {
      const [row] = await tx.query<ReceiptRow>(
        `select r.*, s.name as service_name from public.consent_receipts r
           join public.services s on s.id = r.service_id
          where r.user_id = $1 and r.service_id = $2 and r.purpose = $3 and r.data_type = $4
            and r.decision = 'ALLOW' and r.revoked_at is null
          order by r.issued_at desc limit 1`,
        [grant.userId, grant.serviceId, grant.purpose, grant.dataType],
      );
      if (row) {
        replaced = grant.id;
        grant = toRecord(row);
      }
    }

    if (grant.revokedAt) {
      const when = new Date(grant.revokedAt).toUTCString().slice(5, 16);
      const why =
        grant.revocationReason === "policy_change"
          ? "The user's updated privacy policy withdrew it"
          : grant.revocationReason === "superseded"
            ? "It was replaced by a newer grant"
            : "The user revoked it";
      return deny("REVOKED", `Permission for ${phrase} is no longer in effect. ${why} on ${when}.`, grant.id);
    }

    const policy = await policyAtVersion(tx, grant.userId, grant.receipt.payload.policyVersion);
    const integrity = checkIntegrity(grant.receipt, policy?.policyHash ?? null);
    if (!integrity.valid || !rowMatchesPayload(grant)) {
      return deny("INTEGRITY_FAILURE", `${noPermission} The grant failed cryptographic verification.`, grant.id);
    }

    return {
      authorized: true,
      code: "GRANTED",
      reason: "GRANT_ACTIVE",
      message: `The user permits ${phrase} under grant ${grant.id}${replaced ? `, which replaced ${replaced}` : ""}.`,
      receiptId: grant.id,
      checkedAt,
    };
  });
}

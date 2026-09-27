import "server-only";
import {
  dataTypeNoun,
  describeDecision,
  isKnownPurpose,
  PURPOSE_CATALOG,
  type Decision,
} from "@consentos/policy-engine";
import type { EventSummary } from "@consentos/shared";
import { iso, type Queryable } from "./db";

export type EventType =
  | "consent.allowed"
  | "consent.denied"
  | "consent.pending"
  | "consent.resolved"
  | "grant.revoked"
  | "enforcement.blocked"
  | "policy.updated";

export interface EventMetadata {
  requestId?: string;
  receiptId?: string | null;
  decision?: Decision;
  reasonCode?: string;
  purpose?: string;
  dataType?: string;
  reason?: string;
  revocationReason?: string;
  version?: number;
  retentionDays?: number | null;
  maxRetentionDays?: number;
  [key: string]: unknown;
}

export async function recordEvent(
  q: Queryable,
  event: { userId: string; serviceId: string | null; type: EventType; metadata: EventMetadata },
): Promise<void> {
  await q.query(
    "insert into public.audit_events (user_id, service_id, event_type, metadata) values ($1, $2, $3, $4::jsonb)",
    [event.userId, event.serviceId, event.type, JSON.stringify(event.metadata)],
  );
}

interface EventRow {
  id: string;
  seq: number | string;
  service_id: string | null;
  service_name: string | null;
  event_type: EventType;
  metadata: EventMetadata;
  created_at: Date | string;
}

export interface StoredEvent extends EventSummary {
  seq: number;
}

export async function listEvents(
  q: Queryable,
  userId: string,
  options: { limit?: number; afterSeq?: number; serviceId?: string } = {},
): Promise<StoredEvent[]> {
  const params: unknown[] = [userId];
  let where = "e.user_id = $1";
  if (options.afterSeq !== undefined) {
    params.push(options.afterSeq);
    where += ` and e.seq > $${params.length}`;
  }
  if (options.serviceId) {
    params.push(options.serviceId);
    where += ` and e.service_id = $${params.length}`;
  }
  params.push(Math.min(options.limit ?? 20, 100));
  const rows = await q.query<EventRow>(
    `select e.id, e.seq, e.service_id, s.name as service_name, e.event_type, e.metadata, e.created_at
       from public.audit_events e
       left join public.services s on s.id = e.service_id
      where ${where}
      order by e.seq desc
      limit $${params.length}`,
    params,
  );
  return rows.map(toSummary);
}

function toSummary(row: EventRow): StoredEvent {
  const m = row.metadata ?? {};
  const decision = (m.decision as Decision | undefined) ?? null;
  return {
    id: row.id,
    seq: Number(row.seq),
    type: row.event_type,
    serviceId: row.service_id,
    serviceName: row.service_name,
    decision,
    purpose: m.purpose ?? null,
    dataType: m.dataType ?? null,
    receiptId: m.receiptId ?? null,
    requestId: m.requestId ?? null,
    message: describeEvent(row.event_type, row.service_name ?? "A service", m),
    createdAt: iso(row.created_at),
  };
}

function activity(purpose: string | undefined): string {
  if (!purpose) return "an unstated purpose";
  return isKnownPurpose(purpose) ? PURPOSE_CATALOG[purpose].activity : purpose.replace(/_/g, " ");
}

export function describeEvent(type: EventType, serviceName: string, m: EventMetadata): string {
  const data = m.dataType ? dataTypeNoun(m.dataType) : "data";
  switch (type) {
    case "consent.denied":
      if (m.reasonCode === "RETENTION_EXCEEDS_LIMIT" && typeof m.retentionDays === "number") {
        return `${serviceName} asked to keep your ${data} for ${m.retentionDays} days${
          typeof m.maxRetentionDays === "number" ? ` — over your ${m.maxRetentionDays}-day limit` : ""
        }.`;
      }
      return describeDecision({
        serviceName,
        dataType: m.dataType ?? "data",
        purpose: m.purpose ?? "unknown",
        decision: "DENY",
      });
    case "consent.allowed":
    case "consent.pending":
      return describeDecision({
        serviceName,
        dataType: m.dataType ?? "data",
        purpose: m.purpose ?? "unknown",
        decision: m.decision ?? (type === "consent.allowed" ? "ALLOW" : "REQUIRE_USER"),
      });
    case "consent.resolved":
      return m.decision === "ALLOW"
        ? `You allowed ${serviceName} to use your ${data} for ${activity(m.purpose)}.`
        : `You declined ${serviceName}'s request to use your ${data} for ${activity(m.purpose)}.`;
    case "grant.revoked":
      return m.revocationReason === "policy_change"
        ? `Your updated rules revoked ${serviceName}'s access to your ${data} for ${activity(m.purpose)}.`
        : `You revoked ${serviceName}'s access to your ${data} for ${activity(m.purpose)}.`;
    case "enforcement.blocked":
      return `${serviceName}'s server tried to use your ${data} for ${activity(m.purpose)} without permission. ConsentOS refused.`;
    case "policy.updated":
      return `You updated your privacy rules${m.version ? ` (v${m.version})` : ""}.`;
  }
}

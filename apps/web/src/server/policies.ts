import "server-only";
import { DEFAULT_POLICY, normalizePolicy, type PrivacyPolicy } from "@consentos/policy-engine";
import { hashCanonical } from "./crypto";
import { asService, asUser, iso, type Queryable } from "./db";
import { recordEvent } from "./events";

export interface PolicyVersion {
  id: string;
  userId: string;
  version: number;
  policy: PrivacyPolicy;
  policyHash: string;
  createdAt: string;
}

interface PolicyRow {
  id: string;
  user_id: string;
  version: number;
  policy_json: PrivacyPolicy;
  policy_hash: string;
  created_at: Date | string;
}

const COLUMNS = "id, user_id, version, policy_json, policy_hash, created_at";

const toVersion = (row: PolicyRow): PolicyVersion => ({
  id: row.id,
  userId: row.user_id,
  version: row.version,
  policy: row.policy_json,
  policyHash: row.policy_hash,
  createdAt: iso(row.created_at),
});

/** The hash a receipt commits to: SHA-256 of the canonical policy JSON. */
export function hashPolicy(policy: PrivacyPolicy): string {
  return hashCanonical(normalizePolicy(policy));
}

export async function currentPolicy(q: Queryable, userId: string): Promise<PolicyVersion | null> {
  const [row] = await q.query<PolicyRow>(
    `select ${COLUMNS} from public.privacy_policies where user_id = $1 order by version desc limit 1`,
    [userId],
  );
  return row ? toVersion(row) : null;
}

export async function policyAtVersion(q: Queryable, userId: string, version: number): Promise<PolicyVersion | null> {
  const [row] = await q.query<PolicyRow>(
    `select ${COLUMNS} from public.privacy_policies where user_id = $1 and version = $2`,
    [userId, version],
  );
  return row ? toVersion(row) : null;
}

export async function policyHistory(q: Queryable, userId: string, limit = 50): Promise<PolicyVersion[]> {
  const rows = await q.query<PolicyRow>(
    `select ${COLUMNS} from public.privacy_policies where user_id = $1 order by version desc limit $2`,
    [userId, limit],
  );
  return rows.map(toVersion);
}

/** Append a new immutable version. The version number is assigned in SQL. */
export async function insertPolicyVersion(q: Queryable, userId: string, policy: PrivacyPolicy): Promise<PolicyVersion> {
  const normalized = normalizePolicy(policy);
  const [row] = await q.query<PolicyRow>(
    `insert into public.privacy_policies (user_id, version, policy_json, policy_hash)
     values (
       $1,
       coalesce((select max(version) from public.privacy_policies where user_id = $1), 0) + 1,
       $2::jsonb,
       $3
     )
     returning ${COLUMNS}`,
    [userId, JSON.stringify(normalized), hashPolicy(normalized)],
  );
  return toVersion(row!);
}

export async function ensureDefaultPolicy(q: Queryable, userId: string): Promise<PolicyVersion> {
  return (await currentPolicy(q, userId)) ?? insertPolicyVersion(q, userId, DEFAULT_POLICY);
}

export interface PolicyUpdateResult {
  version: PolicyVersion;
  changed: boolean;
  /** Grants the new rules no longer permit, revoked as part of the update. */
  revokedReceiptIds: string[];
}

/**
 * Save a new policy version for the signed-in user, then revoke any active
 * grant the new rules would now deny. Saving an identical policy is a no-op.
 */
export async function updatePolicy(userId: string, policy: PrivacyPolicy): Promise<PolicyUpdateResult> {
  const saved = await asUser(userId, async (tx) => {
    const current = await currentPolicy(tx, userId);
    if (current && current.policyHash === hashPolicy(policy)) return { version: current, changed: false };
    return { version: await insertPolicyVersion(tx, userId, policy), changed: true };
  });
  if (!saved.changed) return { ...saved, revokedReceiptIds: [] };

  const { revokeGrantsInvalidatedByPolicy } = await import("./consent");
  const revokedReceiptIds = await asService(async (tx) => {
    const revoked = await revokeGrantsInvalidatedByPolicy(tx, userId, saved.version);
    await recordEvent(tx, {
      userId,
      serviceId: null,
      type: "policy.updated",
      metadata: { version: saved.version.version, policyHash: saved.version.policyHash, revokedGrants: revoked.length },
    });
    return revoked;
  });
  return { ...saved, revokedReceiptIds };
}

import "server-only";
import { ENGINE_VERSION } from "@consentos/policy-engine";
import {
  canonicalize,
  RECEIPT_FORMAT,
  SIGNATURE_ALGORITHM,
  type EvaluateRequestBody,
  type NormalizedConsentRequest,
  type ReceiptPayload,
  type ReceiptVerification,
  type SignedReceipt,
} from "@consentos/shared";
import { getKeyRing, hashCanonical, sha256Hex, signCanonical, verifyCanonical, type KeyRing, type SigningKey } from "./crypto";
import { iso, type Queryable } from "./db";
import { policyAtVersion } from "./policies";

/** Make every optional field explicit: the receipt records exactly what was declared. */
export function normalizeRequest(
  body: Pick<EvaluateRequestBody, "dataType" | "purpose" | "retentionDays" | "thirdPartySharing" | "anonymized" | "metadata">,
): NormalizedConsentRequest {
  return {
    dataType: body.dataType,
    purpose: body.purpose,
    retentionDays: body.retentionDays ?? null,
    thirdPartySharing: body.thirdPartySharing ?? false,
    anonymized: body.anonymized ?? false,
    metadata: (body.metadata as Record<string, unknown> | undefined) ?? {},
  };
}

export type ReceiptFields = Omit<ReceiptPayload, "format" | "requestHash" | "engineVersion" | "keyId">;

/**
 * Build and sign a receipt:
 *   requestHash = SHA-256(canonical(request))
 *   payloadHash = SHA-256(canonical(payload))
 *   signature   = Ed25519(canonical(payload))
 */
export function signReceipt(fields: ReceiptFields, key: SigningKey): SignedReceipt {
  const payload: ReceiptPayload = {
    format: RECEIPT_FORMAT,
    ...fields,
    requestHash: hashCanonical(fields.request),
    engineVersion: ENGINE_VERSION,
    keyId: key.keyId,
  };
  const canonical = canonicalize(payload);
  return {
    payload,
    payloadHash: `sha256:${sha256Hex(canonical)}`,
    signature: signCanonical(key, canonical),
    algorithm: SIGNATURE_ALGORITHM,
  };
}

export interface ReceiptRecord {
  id: string;
  requestId: string;
  userId: string;
  serviceId: string;
  serviceName: string | null;
  purpose: string;
  dataType: string;
  decision: "ALLOW" | "DENY";
  issuedAt: string;
  revokedAt: string | null;
  revocationReason: "user" | "policy_change" | "superseded" | null;
  receipt: SignedReceipt;
  /** Stored columns as-is, used to detect edits that bypass the payload. */
  row: ReceiptRow;
}

export interface ReceiptRow {
  id: string;
  consent_request_id: string;
  user_id: string;
  service_id: string;
  service_name?: string | null;
  purpose: string;
  data_type: string;
  decision: "ALLOW" | "DENY";
  payload: ReceiptPayload;
  payload_hash: string;
  signature: string;
  key_id: string;
  issued_at: Date | string;
  revoked_at: Date | string | null;
  revocation_reason: "user" | "policy_change" | "superseded" | null;
}

const COLUMNS = `r.id, r.consent_request_id, r.user_id, r.service_id, s.name as service_name, r.purpose, r.data_type,
  r.decision, r.payload, r.payload_hash, r.signature, r.key_id, r.issued_at, r.revoked_at, r.revocation_reason`;

export function toRecord(row: ReceiptRow): ReceiptRecord {
  return {
    id: row.id,
    requestId: row.consent_request_id,
    userId: row.user_id,
    serviceId: row.service_id,
    serviceName: row.service_name ?? null,
    purpose: row.purpose,
    dataType: row.data_type,
    decision: row.decision,
    issuedAt: iso(row.issued_at),
    revokedAt: row.revoked_at ? iso(row.revoked_at) : null,
    revocationReason: row.revocation_reason,
    receipt: {
      payload: row.payload,
      payloadHash: row.payload_hash,
      signature: row.signature,
      algorithm: SIGNATURE_ALGORITHM,
    },
    row,
  };
}

export async function insertReceipt(q: Queryable, signed: SignedReceipt): Promise<void> {
  const p = signed.payload;
  await q.query(
    `insert into public.consent_receipts
       (id, consent_request_id, user_id, service_id, purpose, data_type, decision, payload, payload_hash, signature, key_id, issued_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12)`,
    [
      p.receiptId,
      p.requestId,
      p.userId,
      p.serviceId,
      p.request.purpose,
      p.request.dataType,
      p.decision.decision,
      JSON.stringify(p),
      signed.payloadHash,
      signed.signature,
      p.keyId,
      p.issuedAt,
    ],
  );
}

export async function getReceipt(q: Queryable, id: string): Promise<ReceiptRecord | null> {
  const [row] = await q.query<ReceiptRow>(
    `select ${COLUMNS} from public.consent_receipts r join public.services s on s.id = r.service_id where r.id = $1`,
    [id],
  );
  return row ? toRecord(row) : null;
}

export async function listReceipts(
  q: Queryable,
  userId: string,
  options: { serviceId?: string; limit?: number } = {},
): Promise<ReceiptRecord[]> {
  const params: unknown[] = [userId];
  let where = "r.user_id = $1";
  if (options.serviceId) {
    params.push(options.serviceId);
    where += ` and r.service_id = $${params.length}`;
  }
  params.push(Math.min(options.limit ?? 100, 500));
  const rows = await q.query<ReceiptRow>(
    `select ${COLUMNS} from public.consent_receipts r join public.services s on s.id = r.service_id
      where ${where} order by r.issued_at desc, r.id limit $${params.length}`,
    params,
  );
  return rows.map(toRecord);
}

export interface IntegrityReport {
  payloadIntact: boolean;
  signatureValid: boolean;
  requestHashValid: boolean;
  policyHashValid: boolean;
  keyKnown: boolean;
  valid: boolean;
}

/**
 * Check a receipt document on its own terms. `expectedPolicyHash` is the hash
 * of the policy version the receipt claims; null if that version is unknown.
 */
export function checkIntegrity(
  receipt: SignedReceipt,
  expectedPolicyHash: string | null,
  keyRing: KeyRing = getKeyRing(),
): IntegrityReport {
  let canonical: string;
  try {
    canonical = canonicalize(receipt.payload);
  } catch {
    return {
      payloadIntact: false,
      signatureValid: false,
      requestHashValid: false,
      policyHashValid: false,
      keyKnown: false,
      valid: false,
    };
  }

  const payloadIntact = `sha256:${sha256Hex(canonical)}` === receipt.payloadHash;
  const key = keyRing.verification.get(receipt.payload?.keyId);
  const signatureValid = key ? verifyCanonical(key, canonical, receipt.signature) : false;

  let requestHashValid = false;
  try {
    requestHashValid = hashCanonical(receipt.payload.request) === receipt.payload.requestHash;
  } catch {
    requestHashValid = false;
  }

  const policyHashValid = expectedPolicyHash !== null && expectedPolicyHash === receipt.payload.policyHash;

  return {
    payloadIntact,
    signatureValid,
    requestHashValid,
    policyHashValid,
    keyKnown: Boolean(key),
    valid: payloadIntact && signatureValid && requestHashValid && policyHashValid,
  };
}

/**
 * The indexed columns that enforcement queries use must agree with the signed
 * payload; otherwise someone edited the row around the signature.
 */
export function rowMatchesPayload(record: ReceiptRecord): boolean {
  const p = record.receipt.payload;
  const row = record.row;
  return (
    row.id === p.receiptId &&
    row.consent_request_id === p.requestId &&
    row.user_id === p.userId &&
    row.service_id === p.serviceId &&
    row.purpose === p.request?.purpose &&
    row.data_type === p.request?.dataType &&
    row.decision === p.decision?.decision &&
    row.key_id === p.keyId &&
    new Date(row.issued_at).getTime() === new Date(p.issuedAt).getTime()
  );
}

async function expectedPolicyHashFor(q: Queryable, payload: ReceiptPayload): Promise<string | null> {
  if (typeof payload?.userId !== "string" || !Number.isInteger(payload?.policyVersion)) return null;
  const policy = await policyAtVersion(q, payload.userId, payload.policyVersion);
  return policy?.policyHash ?? null;
}

/** Verify a stored receipt: signature, hashes, and that the row was not edited. */
export async function verifyStoredReceipt(q: Queryable, record: ReceiptRecord): Promise<ReceiptVerification> {
  const integrity = checkIntegrity(record.receipt, await expectedPolicyHashFor(q, record.receipt.payload));
  const payloadIntact = integrity.payloadIntact && rowMatchesPayload(record);
  return {
    receiptId: record.id,
    valid: integrity.valid && payloadIntact,
    payloadIntact,
    signatureValid: integrity.signatureValid,
    requestHashValid: integrity.requestHashValid,
    policyHashValid: integrity.policyHashValid,
    keyId: record.receipt.payload.keyId,
    algorithm: SIGNATURE_ALGORITHM,
    decision: record.decision,
    issuedAt: record.issuedAt,
    revoked: record.revokedAt !== null,
    revokedAt: record.revokedAt,
    revocationReason: record.revocationReason,
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Verify a receipt document supplied by a caller (e.g. one a service kept, or
 * one edited on purpose to show tamper detection). Nothing is trusted except
 * the signature key and the stored policy history.
 */
export async function verifyReceiptDocument(
  q: Queryable,
  receipt: SignedReceipt,
): Promise<ReceiptVerification & { knownToConsentOS: boolean }> {
  const integrity = checkIntegrity(receipt, await expectedPolicyHashFor(q, receipt.payload));
  const stored = typeof receipt.payload?.receiptId === "string" ? await getReceipt(q, receipt.payload.receiptId) : null;
  return {
    receiptId: String(receipt.payload?.receiptId ?? ""),
    valid: integrity.valid,
    payloadIntact: integrity.payloadIntact,
    signatureValid: integrity.signatureValid,
    requestHashValid: integrity.requestHashValid,
    policyHashValid: integrity.policyHashValid,
    keyId: String(receipt.payload?.keyId ?? ""),
    algorithm: SIGNATURE_ALGORITHM,
    decision: receipt.payload?.decision?.decision ?? "DENY",
    issuedAt: String(receipt.payload?.issuedAt ?? ""),
    revoked: stored?.revokedAt != null,
    revokedAt: stored?.revokedAt ?? null,
    revocationReason: stored?.revocationReason ?? null,
    checkedAt: new Date().toISOString(),
    knownToConsentOS: stored !== null,
  };
}

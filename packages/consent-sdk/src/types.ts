/**
 * Public wire types of the ConsentOS API. The SDK declares them itself so it
 * ships with zero dependencies; `types.compat.ts` fails the typecheck if they
 * ever drift from the server's definitions.
 */

export type Purpose =
  | "essential"
  | "analytics"
  | "personalization"
  | "advertising"
  | "foundation_model_training"
  | "third_party_sharing"
  | "precise_location";

export type Decision = "ALLOW" | "DENY" | "REQUIRE_USER";

export type ReasonCode =
  | "POLICY_ALLOWS"
  | "ANONYMIZED_ANALYTICS_ALLOWED"
  | "PURPOSE_DENIED"
  | "PURPOSE_REQUIRES_CONFIRMATION"
  | "ANONYMIZATION_REQUIRED"
  | "RETENTION_EXCEEDS_LIMIT"
  | "RETENTION_UNSPECIFIED"
  | "INVALID_RETENTION"
  | "THIRD_PARTY_SHARING_DENIED"
  | "THIRD_PARTY_SHARING_REQUIRES_CONFIRMATION"
  | "PRECISE_LOCATION_DENIED"
  | "PRECISE_LOCATION_REQUIRES_CONFIRMATION"
  | "UNKNOWN_PURPOSE"
  | "UNKNOWN_DATA_TYPE"
  | "MALFORMED_REQUEST"
  | "INVALID_POLICY";

/** Engine reason codes plus the outcomes of a user answering a REQUIRE_USER request. */
export type ReceiptReasonCode = ReasonCode | "USER_APPROVED" | "USER_DECLINED";

export interface EvaluateResponse {
  requestId: string;
  decision: Decision;
  reasonCode: ReasonCode;
  /** Human-readable explanation, safe to show to the user. */
  reason: string;
  details?: {
    requestedRetentionDays?: number;
    maxRetentionDays?: number;
    rule?: string;
  };
  evaluatedAt: string;
  policyVersion: number;
  /** Signed receipt for ALLOW and DENY; an ALLOW receipt is your grant. Null while REQUIRE_USER is pending. */
  receiptId: string | null;
  receiptUrl: string | null;
  engineVersion: string;
}

export type GrantCheckReason =
  | "GRANT_ACTIVE"
  | "NO_GRANT"
  | "GRANT_NOT_FOUND"
  | "USER_MISMATCH"
  | "SERVICE_MISMATCH"
  | "PURPOSE_MISMATCH"
  | "DATA_TYPE_MISMATCH"
  | "DECISION_NOT_ALLOW"
  | "REVOKED"
  | "INTEGRITY_FAILURE";

export interface GrantCheckResponse {
  authorized: boolean;
  /** What your protected endpoint should return: CONSENT_VIOLATION or CONSENT_REVOKED on refusal. */
  code: "GRANTED" | "CONSENT_VIOLATION" | "CONSENT_REVOKED";
  reason: GrantCheckReason;
  message: string;
  receiptId: string | null;
  checkedAt: string;
}

export interface ConsentRequestStatus {
  requestId: string;
  status: "decided" | "pending" | "resolved";
  decision: Decision;
  reasonCode: ReceiptReasonCode;
  reason: string;
  receiptId: string | null;
  resolvedAt: string | null;
}

export interface NormalizedConsentRequest {
  dataType: string;
  purpose: string;
  retentionDays: number | null;
  thirdPartySharing: boolean;
  anonymized: boolean;
  metadata: Record<string, unknown>;
}

export interface ReceiptPayload {
  format: "consentos.receipt/v1";
  receiptId: string;
  requestId: string;
  userId: string;
  serviceId: string;
  request: NormalizedConsentRequest;
  decision: { decision: "ALLOW" | "DENY"; reasonCode: ReceiptReasonCode; reason: string };
  policyVersion: number;
  policyHash: string;
  requestHash: string;
  engineVersion: string;
  issuedAt: string;
  keyId: string;
}

export interface SignedReceipt {
  payload: ReceiptPayload;
  payloadHash: string;
  signature: string;
  algorithm: "Ed25519";
}

export interface ReceiptVerification {
  receiptId: string;
  valid: boolean;
  payloadIntact: boolean;
  signatureValid: boolean;
  requestHashValid: boolean;
  policyHashValid: boolean;
  keyId: string;
  algorithm: "Ed25519";
  decision: Decision;
  issuedAt: string;
  revoked: boolean;
  revokedAt: string | null;
  revocationReason: "user" | "policy_change" | "superseded" | null;
  checkedAt: string;
}

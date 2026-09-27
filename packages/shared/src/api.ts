import type { ConsentDecision, Decision, PrivacyPolicy, ReasonCode, RuleDisplay } from "@consentos/policy-engine";

/* ------------------------------------------------------------------ */
/* Receipts                                                            */
/* ------------------------------------------------------------------ */

export const RECEIPT_FORMAT = "consentos.receipt/v1" as const;
export const SIGNATURE_ALGORITHM = "Ed25519" as const;

/**
 * The request exactly as it was authorised. Optional fields are made explicit
 * (`thirdPartySharing: false`, `retentionDays: null`) because the receipt binds
 * the service to what it declared.
 */
export interface NormalizedConsentRequest {
  dataType: string;
  purpose: string;
  retentionDays: number | null;
  thirdPartySharing: boolean;
  anonymized: boolean;
  metadata: Record<string, unknown>;
}

/** Engine reason codes, plus the two outcomes of a user answering a REQUIRE_USER request. */
export type ReceiptReasonCode = ReasonCode | "USER_APPROVED" | "USER_DECLINED";

/** The signed body of a consent receipt. Canonicalised, hashed, then signed. */
export interface ReceiptPayload {
  format: typeof RECEIPT_FORMAT;
  receiptId: string;
  requestId: string;
  userId: string;
  serviceId: string;
  request: NormalizedConsentRequest;
  decision: {
    decision: "ALLOW" | "DENY";
    reasonCode: ReceiptReasonCode;
    reason: string;
  };
  policyVersion: number;
  /** `sha256:<hex>` of the canonical policy at `policyVersion`. */
  policyHash: string;
  /** `sha256:<hex>` of the canonical normalised request. */
  requestHash: string;
  engineVersion: string;
  issuedAt: string;
  keyId: string;
}

export interface SignedReceipt {
  payload: ReceiptPayload;
  /** `sha256:<hex>` of the canonical payload. */
  payloadHash: string;
  /** base64url Ed25519 signature over the canonical payload bytes. */
  signature: string;
  algorithm: typeof SIGNATURE_ALGORITHM;
}

/* ------------------------------------------------------------------ */
/* Evaluate                                                            */
/* ------------------------------------------------------------------ */

export interface EvaluateResponse {
  requestId: string;
  decision: Decision;
  reasonCode: ReasonCode;
  reason: string;
  details?: ConsentDecision["details"];
  evaluatedAt: string;
  policyVersion: number;
  /**
   * Every ALLOW or DENY is receipted; an ALLOW receipt doubles as the grant.
   * REQUIRE_USER requests have no receipt until the user answers.
   */
  receiptId: string | null;
  receiptUrl: string | null;
  engineVersion: string;
}

/* ------------------------------------------------------------------ */
/* Verification                                                        */
/* ------------------------------------------------------------------ */

export interface ReceiptVerification {
  receiptId: string;
  /** All integrity checks passed. Revocation does not affect validity. */
  valid: boolean;
  payloadIntact: boolean;
  signatureValid: boolean;
  requestHashValid: boolean;
  policyHashValid: boolean;
  keyId: string;
  algorithm: typeof SIGNATURE_ALGORITHM;
  decision: Decision;
  issuedAt: string;
  revoked: boolean;
  revokedAt: string | null;
  revocationReason: "user" | "policy_change" | "superseded" | null;
  checkedAt: string;
}

/* ------------------------------------------------------------------ */
/* Runtime enforcement                                                 */
/* ------------------------------------------------------------------ */

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
  /** What a protected endpoint should return to its own caller. */
  code: "GRANTED" | "CONSENT_VIOLATION" | "CONSENT_REVOKED";
  reason: GrantCheckReason;
  message: string;
  receiptId: string | null;
  checkedAt: string;
}

/* ------------------------------------------------------------------ */
/* Pending (REQUIRE_USER) requests                                     */
/* ------------------------------------------------------------------ */

export interface ConsentRequestStatus {
  requestId: string;
  status: "decided" | "pending" | "resolved";
  /** The effective decision: the engine's, or the user's answer once resolved. */
  decision: Decision;
  reasonCode: ReceiptReasonCode;
  reason: string;
  receiptId: string | null;
  resolvedAt: string | null;
}

/* ------------------------------------------------------------------ */
/* Keys                                                                */
/* ------------------------------------------------------------------ */

export interface PublicKeySet {
  keys: {
    kty: "OKP";
    crv: "Ed25519";
    x: string;
    kid: string;
    alg: "EdDSA";
    use: "sig";
  }[];
}

/* ------------------------------------------------------------------ */
/* Extension                                                           */
/* ------------------------------------------------------------------ */

export interface ServiceSummary {
  id: string;
  name: string;
  domain: string;
  verified: boolean;
}

export interface GrantSummary {
  receiptId: string;
  purpose: string;
  purposeLabel: string;
  dataType: string;
  retentionDays: number | null;
  issuedAt: string;
}

export interface BlockedSummary {
  purpose: string;
  purposeLabel: string;
  /** "policy": blocked by the user's rules before the service ever asked. */
  source: "policy" | "request";
  /** Set when the service actually asked and was refused. */
  receiptId: string | null;
  attemptedAt: string | null;
}

export interface EventSummary {
  id: string;
  type: string;
  serviceId: string | null;
  serviceName: string | null;
  decision: Decision | null;
  purpose: string | null;
  dataType: string | null;
  receiptId: string | null;
  requestId: string | null;
  /** The policy rule that decided, e.g. "policy.foundationModelTraining", and its value then. */
  rule: string | null;
  ruleValue: string | number | null;
  message: string;
  createdAt: string;
}

export interface PendingSummary {
  requestId: string;
  serviceId: string;
  serviceName: string;
  purpose: string;
  purposeLabel: string;
  dataType: string;
  retentionDays: number | null;
  reasonCode: string;
  reason: string;
  createdAt: string;
}

export interface PolicyRowSummary {
  key: string;
  label: string;
  display: RuleDisplay;
}

export interface ExtensionState {
  user: { id: string; email: string };
  policy: {
    version: number;
    hash: string;
    policy: PrivacyPolicy;
    rows: PolicyRowSummary[];
    maxRetentionDays: number;
    updatedAt: string;
  };
  site:
    | null
    | {
        service: ServiceSummary;
        /** The tab's origin matches the domain the service registered. */
        originVerified: boolean;
        grants: GrantSummary[];
        blocked: BlockedSummary[];
        pending: PendingSummary[];
        latestEvent: EventSummary | null;
        latestReceiptId: string | null;
      };
  pending: PendingSummary[];
  recentEvents: EventSummary[];
  serverTime: string;
}

/** Errors returned by every ConsentOS endpoint. */
export interface ApiErrorBody {
  error: string;
  message: string;
  issues?: { path: string; message: string }[];
}

/**
 * Core ConsentOS domain model.
 *
 * Everything here is plain data so that a decision can be reproduced from the
 * exact policy version and request that were recorded in a consent receipt.
 */

export const PURPOSES = [
  "essential",
  "analytics",
  "personalization",
  "advertising",
  "foundation_model_training",
  "third_party_sharing",
  "precise_location",
] as const;

export type Purpose = (typeof PURPOSES)[number];

/** A rule the user sets for one kind of processing. */
export type Rule = "allow" | "deny" | "ask";

/** Analytics additionally supports "only if the data is anonymised". */
export type AnalyticsRule = Rule | "allow_anonymized_only";

export interface PrivacyPolicy {
  essential: Rule;
  analytics: AnalyticsRule;
  personalization: Rule;
  advertising: Rule;
  thirdPartySharing: Rule;
  foundationModelTraining: Rule;
  preciseLocation: Rule;
  /** Upper bound for how long any non-essential use may retain data. */
  maxRetentionDays: number;
}

export type PolicyRuleKey = Exclude<keyof PrivacyPolicy, "maxRetentionDays">;

/**
 * A service's request to use a user's data.
 *
 * `purpose` and `dataType` are deliberately typed as strings: a request for
 * something the protocol does not recognise is a normal, expected input and
 * must produce a decision (REQUIRE_USER), never a crash.
 */
export interface ConsentRequest {
  dataType: string;
  purpose: string;
  retentionDays?: number;
  thirdPartySharing?: boolean;
  /** Set by the service when the data is anonymised before processing. */
  anonymized?: boolean;
}

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

export type CheckName =
  | "policy"
  | "request"
  | "purpose"
  | "data_type"
  | "precise_location"
  | "third_party_sharing"
  | "retention";

export type CheckOutcome = "pass" | "deny" | "ask" | "skip";

/** One step of the evaluation, recorded so every decision is explainable. */
export interface RuleCheck {
  check: CheckName;
  outcome: CheckOutcome;
  /** The policy field consulted, e.g. `policy.foundationModelTraining`. */
  rule?: string;
  /** The value of that policy field at evaluation time. */
  value?: string | number;
  reasonCode?: ReasonCode;
  detail: string;
}

export interface ConsentDecision {
  decision: Decision;
  reasonCode: ReasonCode;
  reason: string;
  /**
   * The policy rule that decided (for ALLOW, the purpose rule that permitted
   * it) and its value, so a decision can be shown as
   * "purpose requested → your rule → decision" without any interpretation.
   */
  details?: {
    rule?: string;
    ruleValue?: string | number;
    requestedRetentionDays?: number;
    maxRetentionDays?: number;
  };
  /** Every check that ran, in evaluation order. */
  trace: RuleCheck[];
}

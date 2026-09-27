import { DATA_TYPE_CATALOG, isKnownDataType, isKnownPurpose, PURPOSE_CATALOG } from "./catalog";
import { MAX_REQUEST_RETENTION_DAYS, validatePolicy } from "./policy";
import type { ConsentDecision, ConsentRequest, PrivacyPolicy, RuleCheck } from "./types";

/**
 * Bumped whenever evaluation semantics change, and recorded next to every
 * decision so an old receipt can always be re-evaluated under the rules that
 * produced it.
 */
export const ENGINE_VERSION = "1.0.0";

/**
 * Evaluate a consent request against a user's privacy policy.
 *
 * The engine is a pure function: no I/O, no clock, no randomness, no LLM.
 * The same policy and request always produce the same decision.
 *
 * Checks run in a fixed order and every one is recorded in `trace`. They are
 * combined with a deny-overrides strategy:
 *
 *   1. any check that denies        → DENY (the first denying check explains why)
 *   2. otherwise, any check that asks → REQUIRE_USER
 *   3. otherwise                    → ALLOW
 *
 * An invalid policy or a malformed request short-circuits to DENY: the engine
 * fails closed rather than guessing.
 */
export function evaluate(policy: PrivacyPolicy, request: ConsentRequest): ConsentDecision {
  const trace: RuleCheck[] = [];

  // 0a. The policy itself must be well-formed.
  const policyErrors = validatePolicy(policy);
  if (policyErrors.length > 0) {
    trace.push({
      check: "policy",
      outcome: "deny",
      reasonCode: "INVALID_POLICY",
      detail: `The user's policy could not be read (${policyErrors.join("; ")}), so nothing is allowed.`,
    });
    return combine(trace, request);
  }
  trace.push({ check: "policy", outcome: "pass", detail: "The user's policy is well-formed." });

  // 0b. The request must be well-formed.
  const malformed = findMalformation(request);
  if (malformed) {
    trace.push(malformed);
    return combine(trace, request);
  }
  trace.push({ check: "request", outcome: "pass", detail: "The request is well-formed." });

  const { purpose, dataType } = request;
  const retentionDays = request.retentionDays ?? undefined;

  // 1. Purpose.
  if (!isKnownPurpose(purpose)) {
    trace.push({
      check: "purpose",
      outcome: "ask",
      reasonCode: "UNKNOWN_PURPOSE",
      detail: `"${purpose}" is not a recognised purpose, so the user has to decide.`,
    });
  } else {
    const info = PURPOSE_CATALOG[purpose];
    const rule = `policy.${info.ruleKey}`;
    const value = policy[info.ruleKey];
    if (value === "deny") {
      trace.push({
        check: "purpose",
        outcome: "deny",
        rule,
        value,
        reasonCode: "PURPOSE_DENIED",
        detail: `${info.formal} is blocked by the user's privacy policy.`,
      });
    } else if (value === "ask") {
      trace.push({
        check: "purpose",
        outcome: "ask",
        rule,
        value,
        reasonCode: "PURPOSE_REQUIRES_CONFIRMATION",
        detail: `The user's policy asks to confirm ${info.activity} case by case.`,
      });
    } else if (value === "allow_anonymized_only") {
      if (request.anonymized === true) {
        trace.push({
          check: "purpose",
          outcome: "pass",
          rule,
          value,
          detail: `${info.formal} is allowed on anonymised data, and this request is anonymised.`,
        });
      } else {
        trace.push({
          check: "purpose",
          outcome: "deny",
          rule,
          value,
          reasonCode: "ANONYMIZATION_REQUIRED",
          detail: `${info.formal} is only allowed on anonymised data, and this request is not anonymised.`,
        });
      }
    } else {
      trace.push({
        check: "purpose",
        outcome: "pass",
        rule,
        value,
        detail: `${info.formal} is allowed by the user's privacy policy.`,
      });
    }
  }

  // 2. Data type.
  if (!isKnownDataType(dataType)) {
    trace.push({
      check: "data_type",
      outcome: "ask",
      reasonCode: "UNKNOWN_DATA_TYPE",
      detail: `"${dataType}" is not a recognised data type, so the user has to decide.`,
    });
  } else {
    trace.push({
      check: "data_type",
      outcome: "pass",
      detail: `"${dataType}" is a recognised data type.`,
    });
  }

  // 3. Precise location — applies to precise-location *data*, whatever the purpose.
  const locationData = isKnownDataType(dataType) && DATA_TYPE_CATALOG[dataType]!.preciseLocation === true;
  if (purpose === "precise_location") {
    trace.push({ check: "precise_location", outcome: "skip", detail: "Covered by the purpose rule." });
  } else if (!locationData) {
    trace.push({ check: "precise_location", outcome: "pass", detail: "The request does not involve precise location." });
  } else {
    const value = policy.preciseLocation;
    trace.push(
      value === "deny"
        ? {
            check: "precise_location",
            outcome: "deny",
            rule: "policy.preciseLocation",
            value,
            reasonCode: "PRECISE_LOCATION_DENIED",
            detail: "Use of precise location data is blocked by the user's privacy policy.",
          }
        : value === "ask"
          ? {
              check: "precise_location",
              outcome: "ask",
              rule: "policy.preciseLocation",
              value,
              reasonCode: "PRECISE_LOCATION_REQUIRES_CONFIRMATION",
              detail: "The user's policy asks to confirm any use of precise location.",
            }
          : {
              check: "precise_location",
              outcome: "pass",
              rule: "policy.preciseLocation",
              value,
              detail: "Precise location is allowed by the user's privacy policy.",
            },
    );
  }

  // 4. Third-party sharing — a flag on any request, not just the sharing purpose.
  if (purpose === "third_party_sharing") {
    trace.push({ check: "third_party_sharing", outcome: "skip", detail: "Covered by the purpose rule." });
  } else if (request.thirdPartySharing !== true) {
    trace.push({ check: "third_party_sharing", outcome: "pass", detail: "No third-party sharing is requested." });
  } else {
    const value = policy.thirdPartySharing;
    trace.push(
      value === "deny"
        ? {
            check: "third_party_sharing",
            outcome: "deny",
            rule: "policy.thirdPartySharing",
            value,
            reasonCode: "THIRD_PARTY_SHARING_DENIED",
            detail: "Sharing data with third parties is blocked by the user's privacy policy.",
          }
        : value === "ask"
          ? {
              check: "third_party_sharing",
              outcome: "ask",
              rule: "policy.thirdPartySharing",
              value,
              reasonCode: "THIRD_PARTY_SHARING_REQUIRES_CONFIRMATION",
              detail: "The user's policy asks to confirm any sharing with third parties.",
            }
          : {
              check: "third_party_sharing",
              outcome: "pass",
              rule: "policy.thirdPartySharing",
              value,
              detail: "Third-party sharing is allowed by the user's privacy policy.",
            },
    );
  }

  // 5. Retention.
  if (purpose === "essential") {
    trace.push({
      check: "retention",
      outcome: "skip",
      detail: "Essential processing lasts for the life of the account and is not subject to the retention limit.",
    });
  } else if (retentionDays === undefined) {
    trace.push({
      check: "retention",
      outcome: "ask",
      rule: "policy.maxRetentionDays",
      value: policy.maxRetentionDays,
      reasonCode: "RETENTION_UNSPECIFIED",
      detail: "The request does not say how long the data will be kept, so the user has to decide.",
    });
  } else if (retentionDays > policy.maxRetentionDays) {
    trace.push({
      check: "retention",
      outcome: "deny",
      rule: "policy.maxRetentionDays",
      value: policy.maxRetentionDays,
      reasonCode: "RETENTION_EXCEEDS_LIMIT",
      detail: `Requested retention of ${days(retentionDays)} exceeds the user's limit of ${days(policy.maxRetentionDays)}.`,
    });
  } else {
    trace.push({
      check: "retention",
      outcome: "pass",
      rule: "policy.maxRetentionDays",
      value: policy.maxRetentionDays,
      detail: `Requested retention of ${days(retentionDays)} is within the user's limit of ${days(policy.maxRetentionDays)}.`,
    });
  }

  return combine(trace, request, policy);
}

function combine(trace: RuleCheck[], request: ConsentRequest, policy?: PrivacyPolicy): ConsentDecision {
  const retention = typeof request.retentionDays === "number" ? request.retentionDays : undefined;
  const deciding = trace.find((c) => c.outcome === "deny") ?? trace.find((c) => c.outcome === "ask");

  if (deciding) {
    const details: ConsentDecision["details"] = {};
    if (deciding.rule) details.rule = deciding.rule;
    if (deciding.value !== undefined) details.ruleValue = deciding.value;
    if (deciding.check === "retention" && policy) {
      if (retention !== undefined) details.requestedRetentionDays = retention;
      details.maxRetentionDays = policy.maxRetentionDays;
    }
    return {
      decision: deciding.outcome === "deny" ? "DENY" : "REQUIRE_USER",
      reasonCode: deciding.reasonCode!,
      reason: deciding.detail,
      ...(Object.keys(details).length > 0 ? { details } : {}),
      trace,
    };
  }

  // Every check passed or was skipped. Only reachable with a known purpose.
  const info = PURPOSE_CATALOG[request.purpose as keyof typeof PURPOSE_CATALOG];
  const anonymizedAnalytics = policy?.analytics === "allow_anonymized_only" && request.purpose === "analytics";
  let reason = `${info.formal} is permitted by the user's privacy policy.`;
  if (retention !== undefined && policy && request.purpose !== "essential") {
    reason += ` Retention of ${days(retention)} is within the ${policy.maxRetentionDays}-day limit.`;
  }
  // The purpose rule is what permitted it; report it the same way a denial reports its rule.
  const purposeCheck = trace.find((c) => c.check === "purpose");
  return {
    decision: "ALLOW",
    reasonCode: anonymizedAnalytics ? "ANONYMIZED_ANALYTICS_ALLOWED" : "POLICY_ALLOWS",
    reason: anonymizedAnalytics ? "Anonymised analytics is permitted by the user's privacy policy." : reason,
    ...(purposeCheck?.rule && purposeCheck.value !== undefined
      ? { details: { rule: purposeCheck.rule, ruleValue: purposeCheck.value } }
      : {}),
    trace,
  };
}

function findMalformation(request: ConsentRequest): RuleCheck | null {
  const malformed = (detail: string, reasonCode: RuleCheck["reasonCode"] = "MALFORMED_REQUEST"): RuleCheck => ({
    check: "request",
    outcome: "deny",
    reasonCode,
    detail,
  });

  if (typeof request !== "object" || request === null) return malformed("The request must be an object.");
  if (typeof request.purpose !== "string" || request.purpose.length === 0) {
    return malformed("The request must name a purpose.");
  }
  if (typeof request.dataType !== "string" || request.dataType.length === 0) {
    return malformed("The request must name a data type.");
  }
  if (request.thirdPartySharing != null && typeof request.thirdPartySharing !== "boolean") {
    return malformed("thirdPartySharing must be true or false.");
  }
  if (request.anonymized != null && typeof request.anonymized !== "boolean") {
    return malformed("anonymized must be true or false.");
  }
  const retention = request.retentionDays;
  if (
    retention != null &&
    (typeof retention !== "number" ||
      !Number.isInteger(retention) ||
      retention < 0 ||
      retention > MAX_REQUEST_RETENTION_DAYS)
  ) {
    return malformed(
      `Retention must be a whole number of days between 0 and ${MAX_REQUEST_RETENTION_DAYS}.`,
      "INVALID_RETENTION",
    );
  }
  return null;
}

function days(n: number): string {
  return n === 1 ? "1 day" : `${n} days`;
}

import { RULE_CATALOG } from "./catalog";
import type { PolicyRuleKey, PrivacyPolicy } from "./types";

export const DEFAULT_POLICY: Readonly<PrivacyPolicy> = Object.freeze({
  essential: "allow",
  analytics: "allow_anonymized_only",
  advertising: "deny",
  thirdPartySharing: "deny",
  foundationModelTraining: "deny",
  personalization: "allow",
  preciseLocation: "deny",
  maxRetentionDays: 90,
});

export const RULE_KEYS: readonly PolicyRuleKey[] = [
  "essential",
  "analytics",
  "personalization",
  "advertising",
  "thirdPartySharing",
  "foundationModelTraining",
  "preciseLocation",
];

export const MIN_RETENTION_DAYS = 1;
export const MAX_RETENTION_DAYS = 3650;
/** Upper bound accepted for a request's retention (100 years). */
export const MAX_REQUEST_RETENTION_DAYS = 36500;

const BASIC_RULES = new Set(["allow", "deny", "ask"]);
const ANALYTICS_RULES = new Set(["allow", "deny", "ask", "allow_anonymized_only"]);

/**
 * Structural validation that does not depend on any schema library, so the
 * engine can fail closed on its own even if a caller skips validation.
 */
export function validatePolicy(policy: unknown): string[] {
  if (typeof policy !== "object" || policy === null || Array.isArray(policy)) {
    return ["policy must be an object"];
  }
  const p = policy as Record<string, unknown>;
  const errors: string[] = [];
  for (const key of RULE_KEYS) {
    const allowed = key === "analytics" ? ANALYTICS_RULES : BASIC_RULES;
    if (typeof p[key] !== "string" || !allowed.has(p[key] as string)) {
      errors.push(`${key} must be one of ${[...allowed].join(", ")}`);
    }
  }
  const max = p.maxRetentionDays;
  if (
    typeof max !== "number" ||
    !Number.isInteger(max) ||
    max < MIN_RETENTION_DAYS ||
    max > MAX_RETENTION_DAYS
  ) {
    errors.push(`maxRetentionDays must be an integer between ${MIN_RETENTION_DAYS} and ${MAX_RETENTION_DAYS}`);
  }
  return errors;
}

export function isValidPolicy(policy: unknown): policy is PrivacyPolicy {
  return validatePolicy(policy).length === 0;
}

/** Returns a copy containing exactly the policy fields, in a stable order. */
export function normalizePolicy(policy: PrivacyPolicy): PrivacyPolicy {
  return {
    essential: policy.essential,
    analytics: policy.analytics,
    personalization: policy.personalization,
    advertising: policy.advertising,
    thirdPartySharing: policy.thirdPartySharing,
    foundationModelTraining: policy.foundationModelTraining,
    preciseLocation: policy.preciseLocation,
    maxRetentionDays: policy.maxRetentionDays,
  };
}

export type RuleDisplay = "ALLOW" | "BLOCK" | "ASK" | "ANONYMOUS ONLY";

export function ruleDisplay(value: PrivacyPolicy[PolicyRuleKey]): RuleDisplay {
  switch (value) {
    case "allow":
      return "ALLOW";
    case "deny":
      return "BLOCK";
    case "ask":
      return "ASK";
    case "allow_anonymized_only":
      return "ANONYMOUS ONLY";
  }
}

export interface PolicySummaryRow {
  key: PolicyRuleKey;
  label: string;
  description: string;
  value: PrivacyPolicy[PolicyRuleKey];
  display: RuleDisplay;
}

/** The policy as a list of human-readable rows, in editor order. */
export function summarizePolicy(policy: PrivacyPolicy): PolicySummaryRow[] {
  return RULE_CATALOG.map((rule) => ({
    key: rule.key,
    label: rule.label,
    description: rule.description,
    value: policy[rule.key],
    display: ruleDisplay(policy[rule.key]),
  }));
}

/** Which rule keys changed between two policy versions. */
export function diffPolicies(before: PrivacyPolicy, after: PrivacyPolicy): (keyof PrivacyPolicy)[] {
  const keys: (keyof PrivacyPolicy)[] = [...RULE_KEYS, "maxRetentionDays"];
  return keys.filter((key) => before[key] !== after[key]);
}

export interface RuleExplanation {
  /** "AI model training", "Retention limit". */
  label: string;
  /** "BLOCK", "ALLOW", "ASK", "ANONYMOUS ONLY", "90 days". */
  display: string;
}

/**
 * Human form of the rule that decided a request (`details.rule` / `details.ruleValue`),
 * e.g. `policy.foundationModelTraining` + `deny` → { "AI model training", "BLOCK" }.
 */
export function explainRule(rule: string | undefined | null, value: string | number | undefined | null): RuleExplanation | null {
  if (!rule || value === undefined || value === null) return null;
  const key = rule.replace(/^policy\./, "");
  if (key === "maxRetentionDays") return { label: "Retention limit", display: `${value} days` };
  const info = RULE_CATALOG.find((r) => r.key === key);
  if (!info || typeof value !== "string") return null;
  const known = ["allow", "deny", "ask", "allow_anonymized_only"];
  if (!known.includes(value)) return null;
  return { label: info.label, display: ruleDisplay(value as PrivacyPolicy[PolicyRuleKey]) };
}

import { z } from "zod";
import { MAX_REQUEST_RETENTION_DAYS, MAX_RETENTION_DAYS, MIN_RETENTION_DAYS } from "@consentos/policy-engine";

/** Lower snake-case identifier used for purposes and data types. */
export const identifierSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,63}$/, "must be a lower_snake_case identifier (max 64 characters)");

export const serviceIdSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{1,62}$/, "must be a lowercase service id (letters, digits, hyphens)");

export const uuidSchema = z.uuid();

export const ruleSchema = z.enum(["allow", "deny", "ask"]);
export const analyticsRuleSchema = z.enum(["allow", "deny", "ask", "allow_anonymized_only"]);

export const privacyPolicySchema = z.strictObject({
  essential: ruleSchema,
  analytics: analyticsRuleSchema,
  personalization: ruleSchema,
  advertising: ruleSchema,
  thirdPartySharing: ruleSchema,
  foundationModelTraining: ruleSchema,
  preciseLocation: ruleSchema,
  maxRetentionDays: z.int().min(MIN_RETENTION_DAYS).max(MAX_RETENTION_DAYS),
});

const MAX_METADATA_BYTES = 2048;

/**
 * Free-form, service-supplied context. It is bounded, JSON-only, and hashed
 * into the receipt, but it never influences the decision.
 */
export const metadataSchema = z
  .record(z.string().max(64), z.json())
  .refine((value) => JSON.stringify(value).length <= MAX_METADATA_BYTES, {
    message: `metadata must serialise to at most ${MAX_METADATA_BYTES} bytes`,
  });

/**
 * POST /api/v1/consent/evaluate
 *
 * Strict: unknown fields are rejected, so a service cannot smuggle in its own
 * `decision` or `policyVersion`. `purpose` and `dataType` accept any
 * identifier because unrecognised values are a valid request with a defined
 * outcome (REQUIRE_USER).
 */
export const evaluateRequestSchema = z.strictObject({
  userId: uuidSchema,
  serviceId: serviceIdSchema,
  dataType: identifierSchema,
  purpose: identifierSchema,
  retentionDays: z.int().min(0).max(MAX_REQUEST_RETENTION_DAYS).optional(),
  thirdPartySharing: z.boolean().optional(),
  anonymized: z.boolean().optional(),
  metadata: metadataSchema.optional(),
});
export type EvaluateRequestBody = z.infer<typeof evaluateRequestSchema>;

/** POST /api/v1/grants/check — used by services to enforce consent at runtime. */
export const grantCheckSchema = z.strictObject({
  userId: uuidSchema,
  serviceId: serviceIdSchema,
  purpose: identifierSchema,
  dataType: identifierSchema.optional(),
  receiptId: uuidSchema.optional(),
  /**
   * "use" (default): the caller is about to touch the data; refusals are
   * logged to the user's activity. "status": a UI asking whether a grant is
   * still live; nothing is logged.
   */
  intent: z.enum(["use", "status"]).optional(),
});
export type GrantCheckBody = z.infer<typeof grantCheckSchema>;

/** POST /api/v1/consent/requests/:id/resolve — the user answers a REQUIRE_USER request. */
export const resolveRequestSchema = z.strictObject({
  decision: z.enum(["ALLOW", "DENY"]),
});

export const updatePolicySchema = z.strictObject({
  policy: privacyPolicySchema,
});

/** Format zod issues into a compact, client-safe list. */
export function formatIssues(error: z.ZodError): { path: string; message: string }[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join(".") || "(root)",
    message: issue.message,
  }));
}

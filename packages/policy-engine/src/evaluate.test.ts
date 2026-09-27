import { describe, expect, it } from "vitest";
import {
  DEFAULT_POLICY,
  ENGINE_VERSION,
  evaluate,
  PURPOSE_CATALOG,
  PURPOSES,
  type ConsentRequest,
  type PrivacyPolicy,
  type Purpose,
  type Rule,
} from "./index";

const policy = (overrides: Partial<PrivacyPolicy> = {}): PrivacyPolicy => ({ ...DEFAULT_POLICY, ...overrides });

const request = (overrides: Partial<ConsentRequest> = {}): ConsentRequest => ({
  dataType: "uploaded_images",
  purpose: "personalization",
  retentionDays: 30,
  thirdPartySharing: false,
  ...overrides,
});

describe("spec scenarios (default policy)", () => {
  it("denies an explicitly denied purpose", () => {
    const result = evaluate(
      policy(),
      request({ purpose: "foundation_model_training", retentionDays: 365, thirdPartySharing: false }),
    );
    expect(result.decision).toBe("DENY");
    expect(result.reasonCode).toBe("PURPOSE_DENIED");
    expect(result.reason).toBe("Foundation-model training is blocked by the user's privacy policy.");
    expect(result.details).toEqual({ rule: "policy.foundationModelTraining", ruleValue: "deny" });
  });

  it("allows personalisation within the retention limit", () => {
    const result = evaluate(policy(), request({ purpose: "personalization", retentionDays: 30 }));
    expect(result.decision).toBe("ALLOW");
    expect(result.reasonCode).toBe("POLICY_ALLOWS");
    expect(result.reason).toBe(
      "Personalisation is permitted by the user's privacy policy. Retention of 30 days is within the 90-day limit.",
    );
    expect(result.details).toEqual({ rule: "policy.personalization", ruleValue: "allow" });
  });

  it("denies retention beyond the user's maximum and reports both numbers", () => {
    const result = evaluate(policy(), request({ purpose: "personalization", retentionDays: 730 }));
    expect(result.decision).toBe("DENY");
    expect(result.reasonCode).toBe("RETENTION_EXCEEDS_LIMIT");
    expect(result.details).toEqual({
      rule: "policy.maxRetentionDays",
      ruleValue: 90,
      requestedRetentionDays: 730,
      maxRetentionDays: 90,
    });
    expect(result.reason).toBe("Requested retention of 730 days exceeds the user's limit of 90 days.");
  });

  it("denies third-party sharing when the policy blocks it", () => {
    const result = evaluate(policy(), request({ purpose: "personalization", thirdPartySharing: true }));
    expect(result.decision).toBe("DENY");
    expect(result.reasonCode).toBe("THIRD_PARTY_SHARING_DENIED");
  });

  it("requires the user for an ambiguous purpose", () => {
    const result = evaluate(policy(), request({ purpose: "emotion_detection" }));
    expect(result.decision).toBe("REQUIRE_USER");
    expect(result.reasonCode).toBe("UNKNOWN_PURPOSE");
  });

  it("allows anonymised analytics under allow_anonymized_only", () => {
    const result = evaluate(policy(), request({ purpose: "analytics", dataType: "usage_events", anonymized: true }));
    expect(result.decision).toBe("ALLOW");
    expect(result.reasonCode).toBe("ANONYMIZED_ANALYTICS_ALLOWED");
  });

  it("denies identifiable analytics under allow_anonymized_only", () => {
    for (const anonymized of [false, undefined]) {
      const result = evaluate(policy(), request({ purpose: "analytics", dataType: "usage_events", anonymized }));
      expect(result.decision).toBe("DENY");
      expect(result.reasonCode).toBe("ANONYMIZATION_REQUIRED");
    }
  });

  it("allows essential processing", () => {
    const result = evaluate(policy(), request({ purpose: "essential", dataType: "account", retentionDays: undefined }));
    expect(result.decision).toBe("ALLOW");
  });

  it.each(["advertising", "third_party_sharing", "precise_location"] as const)(
    "denies %s under the default policy",
    (purpose) => {
      const result = evaluate(policy(), request({ purpose }));
      expect(result.decision).toBe("DENY");
      expect(result.reasonCode).toBe("PURPOSE_DENIED");
    },
  );
});

describe("purpose × rule matrix", () => {
  const benign = (purpose: Purpose): ConsentRequest =>
    request({ purpose, dataType: purpose === "analytics" ? "usage_events" : "uploaded_images", anonymized: true });

  const expected: Record<Rule, string> = { allow: "ALLOW", deny: "DENY", ask: "REQUIRE_USER" };
  const expectedCode: Record<Rule, string> = {
    allow: "POLICY_ALLOWS",
    deny: "PURPOSE_DENIED",
    ask: "PURPOSE_REQUIRES_CONFIRMATION",
  };

  for (const purpose of PURPOSES) {
    const key = PURPOSE_CATALOG[purpose].ruleKey;
    for (const rule of ["allow", "deny", "ask"] as const) {
      it(`${purpose} with ${key}=${rule} → ${expected[rule]}`, () => {
        // Make every *other* rule permissive so only the purpose rule can decide.
        const permissive = policy({
          essential: "allow",
          analytics: "allow",
          personalization: "allow",
          advertising: "allow",
          thirdPartySharing: "allow",
          foundationModelTraining: "allow",
          preciseLocation: "allow",
          [key]: rule,
        });
        const result = evaluate(permissive, benign(purpose));
        expect(result.decision).toBe(expected[rule]);
        expect(result.reasonCode).toBe(expectedCode[rule]);
        const purposeCheck = result.trace.find((c) => c.check === "purpose");
        expect(purposeCheck?.rule).toBe(`policy.${key}`);
        expect(purposeCheck?.value).toBe(rule);
      });
    }
  }
});

describe("retention", () => {
  it.each([
    [0, "ALLOW"],
    [1, "ALLOW"],
    [89, "ALLOW"],
    [90, "ALLOW"],
    [91, "DENY"],
    [365, "DENY"],
    [36500, "DENY"],
  ])("retention %i days against a 90-day limit → %s", (retentionDays, decision) => {
    expect(evaluate(policy(), request({ retentionDays })).decision).toBe(decision);
  });

  it("uses the policy's own limit", () => {
    expect(evaluate(policy({ maxRetentionDays: 30 }), request({ retentionDays: 31 })).decision).toBe("DENY");
    expect(evaluate(policy({ maxRetentionDays: 365 }), request({ retentionDays: 365 })).decision).toBe("ALLOW");
  });

  it("requires the user when retention is not stated", () => {
    for (const retentionDays of [undefined, null as unknown as number]) {
      const result = evaluate(policy(), request({ retentionDays }));
      expect(result.decision).toBe("REQUIRE_USER");
      expect(result.reasonCode).toBe("RETENTION_UNSPECIFIED");
    }
  });

  it("exempts essential processing from the retention limit", () => {
    const result = evaluate(policy(), request({ purpose: "essential", retentionDays: 5000 }));
    expect(result.decision).toBe("ALLOW");
    expect(result.trace.find((c) => c.check === "retention")?.outcome).toBe("skip");
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 36501])(
    "rejects invalid retention %s as malformed",
    (retentionDays) => {
      const result = evaluate(policy(), request({ retentionDays }));
      expect(result.decision).toBe("DENY");
      expect(result.reasonCode).toBe("INVALID_RETENTION");
    },
  );

  it("rejects non-numeric retention even for essential processing", () => {
    const result = evaluate(policy(), request({ purpose: "essential", retentionDays: "30" as unknown as number }));
    expect(result.decision).toBe("DENY");
    expect(result.reasonCode).toBe("INVALID_RETENTION");
  });
});

describe("third-party sharing", () => {
  it("allows the flag when the policy allows sharing", () => {
    const result = evaluate(policy({ thirdPartySharing: "allow" }), request({ thirdPartySharing: true }));
    expect(result.decision).toBe("ALLOW");
  });

  it("asks when the policy asks about sharing", () => {
    const result = evaluate(policy({ thirdPartySharing: "ask" }), request({ thirdPartySharing: true }));
    expect(result.decision).toBe("REQUIRE_USER");
    expect(result.reasonCode).toBe("THIRD_PARTY_SHARING_REQUIRES_CONFIRMATION");
  });

  it("applies the sharing rule on top of an allowed purpose", () => {
    const result = evaluate(policy({ personalization: "allow" }), request({ thirdPartySharing: true }));
    expect(result.reasonCode).toBe("THIRD_PARTY_SHARING_DENIED");
  });

  it("denies the sharing purpose even if the flag claims no sharing", () => {
    const result = evaluate(policy(), request({ purpose: "third_party_sharing", thirdPartySharing: false }));
    expect(result.decision).toBe("DENY");
    expect(result.reasonCode).toBe("PURPOSE_DENIED");
    expect(result.trace.find((c) => c.check === "third_party_sharing")?.outcome).toBe("skip");
  });

  it("applies to essential processing too", () => {
    const result = evaluate(policy(), request({ purpose: "essential", thirdPartySharing: true }));
    expect(result.decision).toBe("DENY");
    expect(result.reasonCode).toBe("THIRD_PARTY_SHARING_DENIED");
  });
});

describe("precise location", () => {
  it("governs precise-location data whatever the purpose", () => {
    const result = evaluate(policy(), request({ purpose: "personalization", dataType: "precise_location" }));
    expect(result.decision).toBe("DENY");
    expect(result.reasonCode).toBe("PRECISE_LOCATION_DENIED");
  });

  it("allows precise-location data when the policy allows it", () => {
    const result = evaluate(
      policy({ preciseLocation: "allow" }),
      request({ purpose: "personalization", dataType: "precise_location" }),
    );
    expect(result.decision).toBe("ALLOW");
  });

  it("asks for precise-location data when the policy asks", () => {
    const result = evaluate(
      policy({ preciseLocation: "ask" }),
      request({ purpose: "personalization", dataType: "precise_location" }),
    );
    expect(result.reasonCode).toBe("PRECISE_LOCATION_REQUIRES_CONFIRMATION");
  });

  it("does not affect approximate location", () => {
    const result = evaluate(policy(), request({ purpose: "personalization", dataType: "coarse_location" }));
    expect(result.decision).toBe("ALLOW");
  });

  it("does not double-count the precise-location purpose", () => {
    const result = evaluate(policy(), request({ purpose: "precise_location", dataType: "precise_location" }));
    expect(result.reasonCode).toBe("PURPOSE_DENIED");
    expect(result.trace.find((c) => c.check === "precise_location")?.outcome).toBe("skip");
  });
});

describe("unsupported and ambiguous requests", () => {
  it("requires the user for an unknown data type", () => {
    const result = evaluate(policy(), request({ dataType: "biometric_faceprint" }));
    expect(result.decision).toBe("REQUIRE_USER");
    expect(result.reasonCode).toBe("UNKNOWN_DATA_TYPE");
  });

  it("reports the unknown purpose first when both are unknown", () => {
    const result = evaluate(policy(), request({ purpose: "mood_scoring", dataType: "biometric_faceprint" }));
    expect(result.reasonCode).toBe("UNKNOWN_PURPOSE");
  });

  it.each(["__proto__", "constructor", "toString", "hasOwnProperty"])(
    "does not resolve inherited property %s as a purpose or data type",
    (name) => {
      expect(evaluate(policy(), request({ purpose: name })).reasonCode).toBe("UNKNOWN_PURPOSE");
      expect(evaluate(policy(), request({ dataType: name })).reasonCode).toBe("UNKNOWN_DATA_TYPE");
    },
  );

  it("never allows an unknown purpose, even under a fully permissive policy", () => {
    const permissive = policy({
      advertising: "allow",
      thirdPartySharing: "allow",
      foundationModelTraining: "allow",
      preciseLocation: "allow",
      maxRetentionDays: 3650,
    });
    expect(evaluate(permissive, request({ purpose: "resale" })).decision).toBe("REQUIRE_USER");
  });
});

describe("deny overrides ask", () => {
  it("denies when the purpose asks but retention is too long", () => {
    const result = evaluate(policy({ personalization: "ask" }), request({ retentionDays: 400 }));
    expect(result.decision).toBe("DENY");
    expect(result.reasonCode).toBe("RETENTION_EXCEEDS_LIMIT");
  });

  it("denies an unknown purpose that also asks to share", () => {
    const result = evaluate(policy(), request({ purpose: "resale", thirdPartySharing: true }));
    expect(result.decision).toBe("DENY");
    expect(result.reasonCode).toBe("THIRD_PARTY_SHARING_DENIED");
  });

  it("reports the first denying check when several deny", () => {
    const result = evaluate(
      policy(),
      request({ purpose: "foundation_model_training", retentionDays: 365, thirdPartySharing: true }),
    );
    expect(result.reasonCode).toBe("PURPOSE_DENIED");
    const denied = result.trace.filter((c) => c.outcome === "deny").map((c) => c.reasonCode);
    expect(denied).toEqual(["PURPOSE_DENIED", "THIRD_PARTY_SHARING_DENIED", "RETENTION_EXCEEDS_LIMIT"]);
  });
});

describe("malformed input fails closed", () => {
  it.each([
    ["missing purpose", { dataType: "uploaded_images", retentionDays: 30 }],
    ["empty purpose", { purpose: "", dataType: "uploaded_images", retentionDays: 30 }],
    ["missing data type", { purpose: "personalization", retentionDays: 30 }],
    ["non-boolean sharing", { purpose: "personalization", dataType: "uploaded_images", thirdPartySharing: "no" }],
    ["non-boolean anonymized", { purpose: "analytics", dataType: "usage_events", anonymized: 1 }],
  ])("%s → DENY MALFORMED_REQUEST", (_name, bad) => {
    const result = evaluate(policy(), bad as unknown as ConsentRequest);
    expect(result.decision).toBe("DENY");
    expect(result.reasonCode).toBe("MALFORMED_REQUEST");
  });

  it.each([
    ["missing rule", { ...DEFAULT_POLICY, advertising: undefined }],
    ["unknown rule value", { ...DEFAULT_POLICY, advertising: "maybe" }],
    ["anonymised-only outside analytics", { ...DEFAULT_POLICY, advertising: "allow_anonymized_only" }],
    ["zero retention limit", { ...DEFAULT_POLICY, maxRetentionDays: 0 }],
    ["fractional retention limit", { ...DEFAULT_POLICY, maxRetentionDays: 1.5 }],
    ["huge retention limit", { ...DEFAULT_POLICY, maxRetentionDays: 3651 }],
    ["null policy", null],
  ])("invalid policy (%s) → DENY INVALID_POLICY", (_name, bad) => {
    const result = evaluate(bad as unknown as PrivacyPolicy, request());
    expect(result.decision).toBe("DENY");
    expect(result.reasonCode).toBe("INVALID_POLICY");
  });
});

describe("determinism and auditability", () => {
  it("returns identical results for identical inputs", () => {
    const a = evaluate(policy(), request({ retentionDays: 730 }));
    const b = evaluate(policy(), request({ retentionDays: 730 }));
    expect(b).toEqual(a);
  });

  it("does not depend on key order", () => {
    const shuffledPolicy = Object.fromEntries(Object.entries(policy()).reverse()) as unknown as PrivacyPolicy;
    const shuffledRequest = Object.fromEntries(Object.entries(request()).reverse()) as unknown as ConsentRequest;
    expect(evaluate(shuffledPolicy, shuffledRequest)).toEqual(evaluate(policy(), request()));
  });

  it("does not mutate its inputs", () => {
    const p = Object.freeze(policy());
    const r = Object.freeze(request({ retentionDays: 730 }));
    expect(() => evaluate(p, r)).not.toThrow();
  });

  it("records every check, in order", () => {
    const result = evaluate(policy(), request());
    expect(result.trace.map((c) => c.check)).toEqual([
      "policy",
      "request",
      "purpose",
      "data_type",
      "precise_location",
      "third_party_sharing",
      "retention",
    ]);
  });

  it("explains a decision with the check that decided it", () => {
    for (const r of [
      request({ purpose: "advertising" }),
      request({ retentionDays: 900 }),
      request({ purpose: "unknown_purpose" }),
    ]) {
      const result = evaluate(policy(), r);
      const deciding = result.trace.find((c) => c.reasonCode === result.reasonCode);
      expect(deciding?.detail).toBe(result.reason);
    }
  });

  it("exposes an engine version", () => {
    expect(ENGINE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

/**
 * Exhaustive invariant sweep: every combination of rule values, a spread of
 * retention values, both sharing flags and every purpose (plus unknown ones).
 */
describe("invariants over the full input space", () => {
  const rules = ["allow", "deny", "ask"] as const;
  const analyticsRules = ["allow", "deny", "ask", "allow_anonymized_only"] as const;
  const purposes = [...PURPOSES, "unknown_purpose"];
  const dataTypes = ["uploaded_images", "precise_location", "unknown_type"];
  const retentions = [undefined, 0, 90, 91];

  const cases: { p: PrivacyPolicy; r: ConsentRequest }[] = [];
  // Vary each purpose's governing rule plus sharing/location, keep the sweep tractable.
  for (const purposeRule of rules) {
    for (const analytics of analyticsRules) {
      for (const sharingRule of rules) {
        for (const locationRule of rules) {
          const p = policy({
            essential: purposeRule,
            personalization: purposeRule,
            advertising: purposeRule,
            foundationModelTraining: purposeRule,
            analytics,
            thirdPartySharing: sharingRule,
            preciseLocation: locationRule,
          });
          for (const purpose of purposes) {
            for (const dataType of dataTypes) {
              for (const retentionDays of retentions) {
                for (const thirdPartySharing of [false, true]) {
                  for (const anonymized of [false, true]) {
                    cases.push({ p, r: { purpose, dataType, retentionDays, thirdPartySharing, anonymized } });
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  it(`holds for ${cases.length} generated cases`, () => {
    expect(cases.length).toBeGreaterThan(10_000);
    for (const { p, r } of cases) {
      const result = evaluate(p, r);
      const known = (PURPOSES as readonly string[]).includes(r.purpose);
      const ruleValue = known ? p[PURPOSE_CATALOG[r.purpose as Purpose].ruleKey] : undefined;
      const ctx = JSON.stringify({ p, r, result: result.decision, code: result.reasonCode });

      // ALLOW only when nothing denied or asked.
      if (result.decision === "ALLOW") {
        expect(result.trace.every((c) => c.outcome === "pass" || c.outcome === "skip"), ctx).toBe(true);
      }
      // An explicitly denied purpose is never allowed.
      if (ruleValue === "deny") expect(result.decision, ctx).toBe("DENY");
      // Unknown purposes and data types are never allowed.
      if (!known || r.dataType === "unknown_type") expect(result.decision, ctx).not.toBe("ALLOW");
      // Over-long retention is always denied for non-essential purposes.
      if (r.purpose !== "essential" && typeof r.retentionDays === "number" && r.retentionDays > p.maxRetentionDays) {
        expect(result.decision, ctx).toBe("DENY");
      }
      // Blocked sharing is always denied.
      if ((r.thirdPartySharing || r.purpose === "third_party_sharing") && p.thirdPartySharing === "deny") {
        expect(result.decision, ctx).toBe("DENY");
      }
      // Blocked precise location is always denied.
      if ((r.dataType === "precise_location" || r.purpose === "precise_location") && p.preciseLocation === "deny") {
        expect(result.decision, ctx).toBe("DENY");
      }
      // Anonymised-only analytics never allows identifiable data.
      if (r.purpose === "analytics" && p.analytics === "allow_anonymized_only" && !r.anonymized) {
        expect(result.decision, ctx).toBe("DENY");
      }
      // A deny anywhere wins over an ask anywhere.
      if (result.trace.some((c) => c.outcome === "deny")) expect(result.decision, ctx).toBe("DENY");
      // Every non-ALLOW decision is explained by a check in the trace.
      if (result.decision !== "ALLOW") {
        expect(result.trace.some((c) => c.reasonCode === result.reasonCode), ctx).toBe(true);
      }
    }
  });
});

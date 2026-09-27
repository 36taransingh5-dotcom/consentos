import { describe, expect, it } from "vitest";
import {
  DEFAULT_POLICY,
  describeDecision,
  diffPolicies,
  isValidPolicy,
  normalizePolicy,
  purposeLabel,
  summarizePolicy,
  validatePolicy,
} from "./index";

describe("default policy", () => {
  it("matches the ConsentOS default", () => {
    expect(DEFAULT_POLICY).toEqual({
      essential: "allow",
      analytics: "allow_anonymized_only",
      advertising: "deny",
      thirdPartySharing: "deny",
      foundationModelTraining: "deny",
      personalization: "allow",
      preciseLocation: "deny",
      maxRetentionDays: 90,
    });
    expect(isValidPolicy(DEFAULT_POLICY)).toBe(true);
  });

  it("is frozen", () => {
    expect(Object.isFrozen(DEFAULT_POLICY)).toBe(true);
  });
});

describe("validatePolicy", () => {
  it("reports each problem", () => {
    const errors = validatePolicy({ ...DEFAULT_POLICY, advertising: "sometimes", maxRetentionDays: -5 });
    expect(errors).toHaveLength(2);
  });

  it("rejects arrays and primitives", () => {
    expect(validatePolicy([])).not.toHaveLength(0);
    expect(validatePolicy("allow")).not.toHaveLength(0);
  });
});

describe("normalizePolicy", () => {
  it("drops unknown fields", () => {
    const withExtra = { ...DEFAULT_POLICY, sneaky: "allow" } as typeof DEFAULT_POLICY;
    expect(normalizePolicy(withExtra)).toEqual(DEFAULT_POLICY);
  });
});

describe("summarizePolicy", () => {
  it("renders human rows in editor order", () => {
    const rows = summarizePolicy(DEFAULT_POLICY);
    expect(rows.map((r) => [r.label, r.display])).toEqual([
      ["Essential processing", "ALLOW"],
      ["Anonymous analytics", "ANONYMOUS ONLY"],
      ["Personalised recommendations", "ALLOW"],
      ["Targeted advertising", "BLOCK"],
      ["AI model training", "BLOCK"],
      ["Third-party data sharing", "BLOCK"],
      ["Precise location", "BLOCK"],
    ]);
  });
});

describe("diffPolicies", () => {
  it("lists changed keys", () => {
    expect(
      diffPolicies(DEFAULT_POLICY, { ...DEFAULT_POLICY, advertising: "allow", maxRetentionDays: 30 }),
    ).toEqual(["advertising", "maxRetentionDays"]);
  });
});

describe("describeDecision", () => {
  it("describes blocked attempts", () => {
    expect(
      describeDecision({
        serviceName: "Pixly",
        dataType: "uploaded_images",
        purpose: "foundation_model_training",
        decision: "DENY",
      }),
    ).toBe("Pixly tried to use your uploaded images for AI model training.");
  });

  it("describes grants", () => {
    expect(
      describeDecision({ serviceName: "Pixly", dataType: "uploaded_images", purpose: "personalization", decision: "ALLOW" }),
    ).toBe("Pixly can use your uploaded images for personalised recommendations.");
  });

  it("handles unknown ids readably", () => {
    expect(
      describeDecision({ serviceName: "Pixly", dataType: "face_prints", purpose: "mood_scoring", decision: "REQUIRE_USER" }),
    ).toBe("Pixly is asking to use your face prints for mood scoring.");
    expect(purposeLabel("mood_scoring")).toBe("Mood scoring");
  });
});

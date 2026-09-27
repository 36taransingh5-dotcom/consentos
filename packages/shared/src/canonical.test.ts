import { describe, expect, it } from "vitest";
import { canonicalize, CanonicalizationError } from "./canonical";
import { evaluateRequestSchema, privacyPolicySchema } from "./schemas";
import { DEFAULT_POLICY } from "@consentos/policy-engine";

describe("canonicalize", () => {
  it("sorts keys recursively and strips whitespace", () => {
    expect(canonicalize({ b: 1, a: { d: [3, { z: true, y: null }], c: "x" } })).toBe(
      '{"a":{"c":"x","d":[3,{"y":null,"z":true}]},"b":1}',
    );
  });

  it("is independent of insertion order", () => {
    const a = { purpose: "personalization", retentionDays: 30, dataType: "uploaded_images" };
    const b = { dataType: "uploaded_images", retentionDays: 30, purpose: "personalization" };
    expect(canonicalize(a)).toBe(canonicalize(b));
  });

  it("omits undefined object members like JSON.stringify", () => {
    expect(canonicalize({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it("sorts by UTF-16 code units", () => {
    expect(canonicalize({ "é": 1, z: 2, A: 3 })).toBe('{"A":3,"z":2,"é":1}');
  });

  it("uses shortest number forms", () => {
    expect(canonicalize([1.0, 0.1, -0, 1e21, 365])).toBe("[1,0.1,0,1e+21,365]");
  });

  it("escapes strings as JSON", () => {
    expect(canonicalize('he said "hi"\n')).toBe('"he said \\"hi\\"\\n"');
  });

  it.each([
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["bigint", BigInt(1)],
    ["function", () => 1],
    ["symbol", Symbol("x")],
    ["Date", new Date(0)],
    ["Map", new Map()],
    ["undefined in array", [1, undefined]],
    ["top-level undefined", undefined],
  ])("rejects %s", (_name, value) => {
    expect(() => canonicalize(value)).toThrow(CanonicalizationError);
  });

  it("rejects circular structures", () => {
    const a: Record<string, unknown> = {};
    a.self = a;
    expect(() => canonicalize(a)).toThrow(CanonicalizationError);
  });

  it("allows the same object twice when not circular", () => {
    const shared = { x: 1 };
    expect(canonicalize({ a: shared, b: shared })).toBe('{"a":{"x":1},"b":{"x":1}}');
  });

  it("round-trips through JSON without changing", () => {
    const value = { request: { purpose: "personalization", retentionDays: 30, metadata: { note: "é ✓" } } };
    expect(canonicalize(JSON.parse(canonicalize(value)))).toBe(canonicalize(value));
  });
});

describe("schemas", () => {
  const valid = {
    userId: "7e57de30-0000-4000-8000-000000000001",
    serviceId: "pixly",
    dataType: "uploaded_images",
    purpose: "foundation_model_training",
    retentionDays: 365,
    thirdPartySharing: false,
    metadata: {},
  };

  it("accepts the documented evaluate request", () => {
    expect(evaluateRequestSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects a client-supplied decision", () => {
    expect(evaluateRequestSchema.safeParse({ ...valid, decision: "ALLOW" }).success).toBe(false);
  });

  it("rejects bad identifiers, negative retention and oversized metadata", () => {
    expect(evaluateRequestSchema.safeParse({ ...valid, purpose: "DROP TABLE" }).success).toBe(false);
    expect(evaluateRequestSchema.safeParse({ ...valid, retentionDays: -1 }).success).toBe(false);
    expect(evaluateRequestSchema.safeParse({ ...valid, retentionDays: 1.5 }).success).toBe(false);
    expect(evaluateRequestSchema.safeParse({ ...valid, userId: "not-a-uuid" }).success).toBe(false);
    expect(evaluateRequestSchema.safeParse({ ...valid, metadata: { blob: "x".repeat(5000) } }).success).toBe(false);
  });

  it("accepts unknown purposes so they can be escalated to the user", () => {
    expect(evaluateRequestSchema.safeParse({ ...valid, purpose: "emotion_detection" }).success).toBe(true);
  });

  it("validates policies strictly", () => {
    expect(privacyPolicySchema.safeParse(DEFAULT_POLICY).success).toBe(true);
    expect(privacyPolicySchema.safeParse({ ...DEFAULT_POLICY, extra: "x" }).success).toBe(false);
    expect(privacyPolicySchema.safeParse({ ...DEFAULT_POLICY, advertising: "allow_anonymized_only" }).success).toBe(
      false,
    );
    expect(privacyPolicySchema.safeParse({ ...DEFAULT_POLICY, maxRetentionDays: 0 }).success).toBe(false);
  });
});

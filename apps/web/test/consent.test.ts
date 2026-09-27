import { DEFAULT_POLICY } from "@consentos/policy-engine";
import type { SignedReceipt } from "@consentos/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  checkGrant,
  evaluateConsent,
  getRequestStatus,
  listActiveGrants,
  resolvePendingRequest,
  revokeGrant,
} from "@/server/consent";
import { asService, asUser, resetDbForTests } from "@/server/db";
import { DEMO_USER_ID } from "@/server/env";
import { currentPolicy, hashPolicy, policyHistory, updatePolicy } from "@/server/policies";
import { checkIntegrity, getReceipt, verifyReceiptDocument, verifyStoredReceipt } from "@/server/receipts";
import { body, freshDatabase, service } from "./helpers";

beforeEach(async () => {
  await freshDatabase();
});

afterAll(async () => {
  await resetDbForTests();
});

describe("POST /consent/evaluate semantics", () => {
  it("allows personalisation and issues a signed grant", async () => {
    const pixly = await service("pixly");
    const res = await evaluateConsent(pixly, body());
    expect(res.decision).toBe("ALLOW");
    expect(res.policyVersion).toBe(1);
    expect(res.receiptId).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.receiptUrl).toContain(`/receipts/${res.receiptId}`);

    const receipt = await asService((tx) => getReceipt(tx, res.receiptId!));
    expect(receipt?.decision).toBe("ALLOW");
    expect(receipt?.receipt.payload.request).toEqual({
      dataType: "uploaded_images",
      purpose: "personalization",
      retentionDays: 30,
      thirdPartySharing: false,
      anonymized: false,
      metadata: {},
    });
  });

  it("blocks AI training and still receipts the refusal", async () => {
    const res = await evaluateConsent(
      await service("pixly"),
      body({ purpose: "foundation_model_training", retentionDays: 365 }),
    );
    expect(res).toMatchObject({ decision: "DENY", reasonCode: "PURPOSE_DENIED" });
    const receipt = await asService((tx) => getReceipt(tx, res.receiptId!));
    expect(receipt?.decision).toBe("DENY");
  });

  it("blocks excessive retention with both numbers", async () => {
    const res = await evaluateConsent(await service("pixly"), body({ retentionDays: 730 }));
    expect(res).toMatchObject({
      decision: "DENY",
      reasonCode: "RETENTION_EXCEEDS_LIMIT",
      details: { requestedRetentionDays: 730, maxRetentionDays: 90 },
    });
  });

  it("rejects a key used for another service's id", async () => {
    await expect(evaluateConsent(await service("pixly"), body({ serviceId: "otherapp" }))).rejects.toMatchObject({
      status: 403,
      code: "SERVICE_MISMATCH",
    });
  });

  it("rejects unknown users", async () => {
    await expect(
      evaluateConsent(await service("pixly"), body({ userId: "00000000-0000-4000-8000-000000000000" })),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("records an audit event for every decision", async () => {
    const pixly = await service("pixly");
    await evaluateConsent(pixly, body());
    await evaluateConsent(pixly, body({ purpose: "advertising" }));
    const events = await asService((tx) =>
      tx.query<{ event_type: string }>("select event_type from public.audit_events where user_id = $1 order by seq", [
        DEMO_USER_ID,
      ]),
    );
    expect(events.map((e) => e.event_type)).toEqual(["consent.allowed", "consent.denied"]);
  });

  it("supersedes an older grant for the same purpose and data", async () => {
    const pixly = await service("pixly");
    const first = await evaluateConsent(pixly, body({ retentionDays: 30 }));
    const second = await evaluateConsent(pixly, body({ retentionDays: 60 }));
    const active = await asService((tx) => listActiveGrants(tx, DEMO_USER_ID, "pixly"));
    expect(active.map((g) => g.id)).toEqual([second.receiptId]);
    const old = await asService((tx) => getReceipt(tx, first.receiptId!));
    expect(old?.revocationReason).toBe("superseded");

    // A service still holding the older receipt is handed over to the newer grant…
    const followed = await checkGrant(pixly, {
      userId: DEMO_USER_ID,
      serviceId: "pixly",
      purpose: "personalization",
      receiptId: first.receiptId!,
    });
    expect(followed).toMatchObject({ authorized: true, receiptId: second.receiptId });
    // …until the user revokes the newer one.
    await revokeGrant(DEMO_USER_ID, second.receiptId!);
    const afterRevoke = await checkGrant(pixly, {
      userId: DEMO_USER_ID,
      serviceId: "pixly",
      purpose: "personalization",
      receiptId: first.receiptId!,
    });
    expect(afterRevoke).toMatchObject({ authorized: false, code: "CONSENT_REVOKED" });
  });
});

describe("REQUIRE_USER flow", () => {
  it("parks ambiguous requests until the user answers", async () => {
    const pixly = await service("pixly");
    const res = await evaluateConsent(pixly, body({ purpose: "emotion_detection" }));
    expect(res).toMatchObject({ decision: "REQUIRE_USER", reasonCode: "UNKNOWN_PURPOSE", receiptId: null });
    expect(await getRequestStatus(pixly, res.requestId)).toMatchObject({ status: "pending", receiptId: null });

    const { receiptId } = await resolvePendingRequest(DEMO_USER_ID, res.requestId, "ALLOW");
    const status = await getRequestStatus(pixly, res.requestId);
    expect(status).toMatchObject({ status: "resolved", decision: "ALLOW", reasonCode: "USER_APPROVED", receiptId });

    const grant = await checkGrant(pixly, { userId: DEMO_USER_ID, serviceId: "pixly", purpose: "emotion_detection", receiptId });
    expect(grant.authorized).toBe(true);
  });

  it("cannot be resolved twice or by another service", async () => {
    const pixly = await service("pixly");
    const res = await evaluateConsent(pixly, body({ purpose: "emotion_detection" }));
    await resolvePendingRequest(DEMO_USER_ID, res.requestId, "DENY");
    await expect(resolvePendingRequest(DEMO_USER_ID, res.requestId, "ALLOW")).rejects.toMatchObject({ status: 404 });
    await expect(getRequestStatus(await service("otherapp"), res.requestId)).rejects.toMatchObject({ status: 404 });
  });
});

describe("receipt verification (spec tests 6 & 7)", () => {
  async function grant() {
    const res = await evaluateConsent(await service("pixly"), body());
    const record = await asService((tx) => getReceipt(tx, res.receiptId!));
    return record!;
  }

  it("6. verifies an untouched receipt", async () => {
    const record = await grant();
    const result = await asService((tx) => verifyStoredReceipt(tx, record));
    expect(result).toMatchObject({
      valid: true,
      payloadIntact: true,
      signatureValid: true,
      requestHashValid: true,
      policyHashValid: true,
      revoked: false,
    });
  });

  it("7a. detects an edited payload", async () => {
    const record = await grant();
    const forged: SignedReceipt = structuredClone(record.receipt);
    forged.payload.request.retentionDays = 3650;
    const result = await asService((tx) => verifyReceiptDocument(tx, forged));
    expect(result).toMatchObject({ valid: false, payloadIntact: false, signatureValid: false, requestHashValid: false });
  });

  it("7b. detects an edit even when the attacker recomputes every hash", async () => {
    const { hashCanonical, sha256Hex } = await import("@/server/crypto");
    const { canonicalize } = await import("@consentos/shared");
    const record = await grant();
    const forged: SignedReceipt = structuredClone(record.receipt);
    forged.payload.request.purpose = "foundation_model_training";
    forged.payload.requestHash = hashCanonical(forged.payload.request);
    forged.payloadHash = `sha256:${sha256Hex(canonicalize(forged.payload))}`;
    const result = await asService((tx) => verifyReceiptDocument(tx, forged));
    expect(result).toMatchObject({ valid: false, payloadIntact: true, requestHashValid: true, signatureValid: false });
  });

  it("7c. detects a swapped policy hash", async () => {
    const record = await grant();
    const forged: SignedReceipt = structuredClone(record.receipt);
    forged.payload.policyHash = hashPolicy({ ...DEFAULT_POLICY, foundationModelTraining: "allow" });
    const result = checkIntegrity(forged, record.receipt.payload.policyHash);
    expect(result.policyHashValid).toBe(false);
    expect(result.valid).toBe(false);
  });

  it("7d. the database refuses to rewrite a receipt", async () => {
    const record = await grant();
    await expect(
      asService((tx) =>
        tx.query("update public.consent_receipts set payload = jsonb_set(payload, '{request,retentionDays}', '3650') where id = $1", [
          record.id,
        ]),
      ),
    ).rejects.toThrow(/immutable/);
  });

  it("7e. detects a row rewritten around the triggers, and enforcement refuses it", async () => {
    const pixly = await service("pixly");
    const record = await grant();
    // Simulate an attacker with raw database access: bypass triggers and repoint the grant.
    await asService(async (tx) => {
      await tx.query("set local session_replication_role = replica");
      await tx.query("update public.consent_receipts set purpose = 'foundation_model_training' where id = $1", [record.id]);
    });
    const tampered = await asService((tx) => getReceipt(tx, record.id));
    const verification = await asService((tx) => verifyStoredReceipt(tx, tampered!));
    expect(verification).toMatchObject({ valid: false, payloadIntact: false, signatureValid: true });

    const check = await checkGrant(pixly, {
      userId: DEMO_USER_ID,
      serviceId: "pixly",
      purpose: "foundation_model_training",
      receiptId: record.id,
    });
    expect(check).toMatchObject({ authorized: false, code: "CONSENT_VIOLATION", reason: "INTEGRITY_FAILURE" });
  });
});

describe("runtime enforcement (spec tests 8–10)", () => {
  it("grants access with a valid, matching grant", async () => {
    const pixly = await service("pixly");
    const res = await evaluateConsent(pixly, body());
    const check = await checkGrant(pixly, {
      userId: DEMO_USER_ID,
      serviceId: "pixly",
      purpose: "personalization",
      dataType: "uploaded_images",
      receiptId: res.receiptId!,
    });
    expect(check).toMatchObject({ authorized: true, code: "GRANTED", receiptId: res.receiptId });
  });

  it("refuses when there is no grant at all", async () => {
    const check = await checkGrant(await service("pixly"), {
      userId: DEMO_USER_ID,
      serviceId: "pixly",
      purpose: "foundation_model_training",
    });
    expect(check).toMatchObject({
      authorized: false,
      code: "CONSENT_VIOLATION",
      reason: "NO_GRANT",
      message: "The user has not granted permission for foundation-model training.",
    });
  });

  it("refuses a receipt that records a refusal", async () => {
    const pixly = await service("pixly");
    const denied = await evaluateConsent(pixly, body({ purpose: "foundation_model_training", retentionDays: 365 }));
    const check = await checkGrant(pixly, {
      userId: DEMO_USER_ID,
      serviceId: "pixly",
      purpose: "foundation_model_training",
      receiptId: denied.receiptId!,
    });
    expect(check).toMatchObject({ authorized: false, reason: "DECISION_NOT_ALLOW" });
  });

  it("8. a revoked grant fails enforcement with CONSENT_REVOKED", async () => {
    const pixly = await service("pixly");
    const res = await evaluateConsent(pixly, body());
    await revokeGrant(DEMO_USER_ID, res.receiptId!);
    for (const receiptId of [res.receiptId!, undefined]) {
      const check = await checkGrant(pixly, { userId: DEMO_USER_ID, serviceId: "pixly", purpose: "personalization", receiptId });
      expect(check).toMatchObject({ authorized: false, code: "CONSENT_REVOKED", reason: "REVOKED" });
    }
    // Revocation is a status, not tampering: the receipt still verifies.
    const record = await asService((tx) => getReceipt(tx, res.receiptId!));
    const verification = await asService((tx) => verifyStoredReceipt(tx, record!));
    expect(verification).toMatchObject({ valid: true, revoked: true, revocationReason: "user" });
  });

  it("9. another service cannot reuse the grant", async () => {
    const res = await evaluateConsent(await service("pixly"), body());
    const check = await checkGrant(await service("otherapp"), {
      userId: DEMO_USER_ID,
      serviceId: "otherapp",
      purpose: "personalization",
      receiptId: res.receiptId!,
    });
    expect(check).toMatchObject({ authorized: false, code: "CONSENT_VIOLATION", reason: "SERVICE_MISMATCH" });
  });

  it("10. the grant cannot be reused for another purpose", async () => {
    const pixly = await service("pixly");
    const res = await evaluateConsent(pixly, body());
    const check = await checkGrant(pixly, {
      userId: DEMO_USER_ID,
      serviceId: "pixly",
      purpose: "foundation_model_training",
      receiptId: res.receiptId!,
    });
    expect(check).toMatchObject({ authorized: false, code: "CONSENT_VIOLATION", reason: "PURPOSE_MISMATCH" });
  });

  it("the grant cannot be reused for another user or data type", async () => {
    const pixly = await service("pixly");
    const res = await evaluateConsent(pixly, body());
    const { createUser } = await import("./helpers");
    const other = await createUser();
    expect(
      await checkGrant(pixly, { userId: other, serviceId: "pixly", purpose: "personalization", receiptId: res.receiptId! }),
    ).toMatchObject({ authorized: false, reason: "USER_MISMATCH" });
    expect(
      await checkGrant(pixly, {
        userId: DEMO_USER_ID,
        serviceId: "pixly",
        purpose: "personalization",
        dataType: "messages",
        receiptId: res.receiptId!,
      }),
    ).toMatchObject({ authorized: false, reason: "DATA_TYPE_MISMATCH" });
  });

  it("records blocked enforcement attempts for the user", async () => {
    await checkGrant(await service("pixly"), { userId: DEMO_USER_ID, serviceId: "pixly", purpose: "foundation_model_training" });
    const [event] = await asService((tx) =>
      tx.query<{ event_type: string }>("select event_type from public.audit_events where user_id = $1", [DEMO_USER_ID]),
    );
    expect(event?.event_type).toBe("enforcement.blocked");
  });
});

describe("policy versioning", () => {
  it("appends a new version with a new hash and keeps old versions", async () => {
    const before = await asService((tx) => currentPolicy(tx, DEMO_USER_ID));
    const result = await updatePolicy(DEMO_USER_ID, { ...DEFAULT_POLICY, maxRetentionDays: 30 });
    expect(result.changed).toBe(true);
    expect(result.version.version).toBe(2);
    expect(result.version.policyHash).not.toBe(before!.policyHash);
    const history = await asService((tx) => policyHistory(tx, DEMO_USER_ID));
    expect(history.map((v) => v.version)).toEqual([2, 1]);
    expect(history[1]!.policyHash).toBe(before!.policyHash);
  });

  it("does not create a version when nothing changed", async () => {
    const result = await updatePolicy(DEMO_USER_ID, { ...DEFAULT_POLICY });
    expect(result).toMatchObject({ changed: false, version: { version: 1 } });
  });

  it("refuses to edit a stored version", async () => {
    await expect(
      asService((tx) =>
        tx.query("update public.privacy_policies set policy_json = '{}'::jsonb where user_id = $1", [DEMO_USER_ID]),
      ),
    ).rejects.toThrow(/immutable/);
  });

  it("receipts reference the exact version used", async () => {
    const pixly = await service("pixly");
    await updatePolicy(DEMO_USER_ID, { ...DEFAULT_POLICY, maxRetentionDays: 60 });
    const res = await evaluateConsent(pixly, body());
    const record = await asService((tx) => getReceipt(tx, res.receiptId!));
    const current = await asService((tx) => currentPolicy(tx, DEMO_USER_ID));
    expect(record!.receipt.payload.policyVersion).toBe(2);
    expect(record!.receipt.payload.policyHash).toBe(current!.policyHash);
  });

  it("revokes grants the new policy would deny", async () => {
    const pixly = await service("pixly");
    const res = await evaluateConsent(pixly, body({ retentionDays: 60 }));
    const update = await updatePolicy(DEMO_USER_ID, { ...DEFAULT_POLICY, maxRetentionDays: 30 });
    expect(update.revokedReceiptIds).toEqual([res.receiptId]);
    const check = await checkGrant(pixly, { userId: DEMO_USER_ID, serviceId: "pixly", purpose: "personalization" });
    expect(check).toMatchObject({ authorized: false, code: "CONSENT_REVOKED" });
    expect(check.message).toContain("updated privacy policy");
  });

  it("keeps grants the new policy still allows", async () => {
    const pixly = await service("pixly");
    const res = await evaluateConsent(pixly, body({ retentionDays: 30 }));
    const update = await updatePolicy(DEMO_USER_ID, { ...DEFAULT_POLICY, advertising: "ask" });
    expect(update.revokedReceiptIds).toEqual([]);
    const check = await checkGrant(pixly, { userId: DEMO_USER_ID, serviceId: "pixly", purpose: "personalization" });
    expect(check).toMatchObject({ authorized: true, receiptId: res.receiptId });
  });
});

describe("row-level security", () => {
  it("users see only their own policies, receipts and events", async () => {
    const { createUser } = await import("./helpers");
    const pixly = await service("pixly");
    await evaluateConsent(pixly, body());
    const other = await createUser();

    const visible = await asUser(other, async (tx) => ({
      policies: await tx.query<{ user_id: string }>("select user_id from public.privacy_policies"),
      receipts: await tx.query("select id from public.consent_receipts"),
      requests: await tx.query("select id from public.consent_requests"),
      events: await tx.query("select id from public.audit_events"),
    }));
    expect(visible.policies.every((p) => p.user_id === other)).toBe(true);
    expect(visible.receipts).toHaveLength(0);
    expect(visible.requests).toHaveLength(0);
    expect(visible.events).toHaveLength(0);

    const mine = await asUser(DEMO_USER_ID, (tx) => tx.query("select id from public.consent_receipts"));
    expect(mine).toHaveLength(1);
  });

  it("a user cannot revoke someone else's grant", async () => {
    const { createUser } = await import("./helpers");
    const res = await evaluateConsent(await service("pixly"), body());
    const other = await createUser();
    await expect(revokeGrant(other, res.receiptId!)).rejects.toMatchObject({ status: 404 });
  });

  it("a user cannot mint receipts or write policies for others", async () => {
    const { createUser } = await import("./helpers");
    const other = await createUser();
    await expect(
      asUser(other, (tx) =>
        tx.query("insert into public.privacy_policies (user_id, version, policy_json, policy_hash) values ($1, 99, '{}'::jsonb, $2)", [
          DEMO_USER_ID,
          `sha256:${"0".repeat(64)}`,
        ]),
      ),
    ).rejects.toThrow(/row-level security/);
    await expect(
      asUser(other, (tx) => tx.query("delete from public.consent_receipts")),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asUser(other, (tx) =>
        tx.query(
          `insert into public.consent_receipts (id, consent_request_id, user_id, service_id, purpose, data_type, decision, payload, payload_hash, signature, key_id, issued_at)
           values (gen_random_uuid(), gen_random_uuid(), $1, 'pixly', 'x', 'y', 'ALLOW', '{}', $2, 'sig', 'k', now())`,
          [other, `sha256:${"0".repeat(64)}`],
        ),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("service API key hashes are not readable by users", async () => {
    await expect(
      asUser(DEMO_USER_ID, (tx) => tx.query("select api_key_hash from public.services")),
    ).rejects.toThrow(/permission denied/);
    const rows = await asUser(DEMO_USER_ID, (tx) => tx.query<{ id: string }>("select id, name from public.services"));
    expect(rows.map((r) => r.id)).toContain("pixly");
  });

  it("Supabase's API roles (anon, authenticated) cannot reach ConsentOS tables at all", async () => {
    await evaluateConsent(await service("pixly"), body());
    for (const role of ["anon", "authenticated"]) {
      for (const table of ["privacy_policies", "consent_requests", "consent_receipts", "audit_events", "services"]) {
        await expect(
          asService(async (tx) => {
            await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: DEMO_USER_ID })]);
            await tx.query(`set local role ${role}`);
            return tx.query(`select * from public.${table} limit 1`);
          }),
        ).rejects.toThrow(/permission denied/);
      }
      await expect(
        asService(async (tx) => {
          await tx.query(`set local role ${role}`);
          return tx.query(
            "insert into public.privacy_policies (user_id, version, policy_json, policy_hash) values ($1, 99, '{}'::jsonb, $2)",
            [DEMO_USER_ID, `sha256:${"0".repeat(64)}`],
          );
        }),
      ).rejects.toThrow(/permission denied/);
    }
  });

  it("users cannot un-revoke a grant", async () => {
    const res = await evaluateConsent(await service("pixly"), body());
    await revokeGrant(DEMO_USER_ID, res.receiptId!);
    await expect(
      asUser(DEMO_USER_ID, (tx) =>
        tx.query("update public.consent_receipts set revoked_at = null, revocation_reason = null where id = $1", [res.receiptId]),
      ),
    ).resolves.toHaveLength(0); // RLS hides revoked grants from the update policy entirely
    await expect(revokeGrant(DEMO_USER_ID, res.receiptId!)).rejects.toMatchObject({ code: "ALREADY_REVOKED" });
  });
});

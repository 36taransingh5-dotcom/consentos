import "server-only";
import { DEFAULT_POLICY } from "@consentos/policy-engine";
import { asService } from "./db";
import { DEMO_USER_ID } from "./env";
import { insertPolicyVersion } from "./policies";

/**
 * Return the demo account to its starting state: default policy (v1), no
 * requests, no receipts, no events. Only ever touches the demo user.
 */
export async function resetDemo(): Promise<void> {
  await asService(async (tx) => {
    for (const table of ["audit_events", "consent_receipts", "consent_requests", "privacy_policies"]) {
      await tx.query(`delete from public.${table} where user_id = $1`, [DEMO_USER_ID]);
    }
    await insertPolicyVersion(tx, DEMO_USER_ID, DEFAULT_POLICY);
  });
}

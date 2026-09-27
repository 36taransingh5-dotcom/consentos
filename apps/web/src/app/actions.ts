"use server";

import { privacyPolicySchema, resolveRequestSchema, uuidSchema } from "@consentos/shared";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireSessionUser, signInAsDemo, signInWithPassword, signOut, signUp } from "@/server/auth";
import { resolvePendingRequest, revokeGrant } from "@/server/consent";
import { resetDemo } from "@/server/demo";
import { DEMO_USER_ID, getConfig } from "@/server/env";
import { ApiError } from "@/server/errors";
import { updatePolicy } from "@/server/policies";

/** Only allow same-site relative redirects after sign-in. */
function safeNext(value: FormDataEntryValue | null): string {
  const next = typeof value === "string" ? value : "";
  return next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/policy";
}

export interface FormState {
  error?: string;
}

const credentialsSchema = z.object({
  email: z.email("Enter a valid email address.").max(254),
  password: z.string().min(8, "Use at least 8 characters.").max(200),
});

export async function signInAction(_prev: FormState, form: FormData): Promise<FormState> {
  const parsed = credentialsSchema.safeParse({ email: form.get("email"), password: form.get("password") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check your details." };
  const result = await signInWithPassword(parsed.data.email, parsed.data.password);
  if (!result.ok) return { error: result.error };
  redirect(safeNext(form.get("next")));
}

export async function signUpAction(_prev: FormState, form: FormData): Promise<FormState> {
  const parsed = credentialsSchema.safeParse({ email: form.get("email"), password: form.get("password") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check your details." };
  const result = await signUp(parsed.data.email, parsed.data.password);
  if (!result.ok) return { error: result.error };
  redirect(safeNext(form.get("next")));
}

/** One form, two modes: `mode=signup` creates an account, anything else signs in. */
export async function authAction(prev: FormState, form: FormData): Promise<FormState> {
  return form.get("mode") === "signup" ? signUpAction(prev, form) : signInAction(prev, form);
}

export async function demoSignInAction(_prev: FormState, form: FormData): Promise<FormState> {
  const result = await signInAsDemo();
  if (!result.ok) return { error: "The demo account is not available right now." };
  redirect(safeNext(form.get("next")));
}

export async function signOutAction(): Promise<void> {
  await signOut();
  redirect("/");
}

export type ActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export async function savePolicyAction(
  input: unknown,
): Promise<ActionResult<{ version: number; changed: boolean; revokedCount: number }>> {
  const user = await requireSessionUser("/policy");
  const parsed = privacyPolicySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That policy is not valid." };
  try {
    const result = await updatePolicy(user.id, parsed.data);
    revalidatePath("/policy");
    revalidatePath("/receipts");
    return {
      ok: true,
      version: result.version.version,
      changed: result.changed,
      revokedCount: result.revokedReceiptIds.length,
    };
  } catch (error) {
    console.error("[consentos] savePolicyAction", error);
    return { ok: false, error: "Could not save your rules. Try again." };
  }
}

export async function revokeGrantAction(receiptId: string): Promise<ActionResult> {
  const user = await requireSessionUser("/receipts");
  if (!uuidSchema.safeParse(receiptId).success) return { ok: false, error: "Unknown grant." };
  try {
    await revokeGrant(user.id, receiptId);
    revalidatePath("/receipts");
    revalidatePath(`/receipts/${receiptId}`);
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiError) return { ok: false, error: error.message };
    console.error("[consentos] revokeGrantAction", error);
    return { ok: false, error: "Could not revoke this grant. Try again." };
  }
}

export async function resolveRequestAction(
  requestId: string,
  decision: "ALLOW" | "DENY",
): Promise<ActionResult<{ receiptId: string }>> {
  const user = await requireSessionUser("/receipts");
  if (!uuidSchema.safeParse(requestId).success || !resolveRequestSchema.safeParse({ decision }).success) {
    return { ok: false, error: "Unknown request." };
  }
  try {
    const { receiptId } = await resolvePendingRequest(user.id, requestId, decision);
    revalidatePath("/receipts");
    return { ok: true, receiptId };
  } catch (error) {
    if (error instanceof ApiError) return { ok: false, error: error.message };
    console.error("[consentos] resolveRequestAction", error);
    return { ok: false, error: "Could not record your answer. Try again." };
  }
}

export async function resetDemoAction(): Promise<ActionResult> {
  const user = await requireSessionUser("/policy");
  if (!getConfig().demoMode || user.id !== DEMO_USER_ID) return { ok: false, error: "Only the demo account can be reset." };
  await resetDemo();
  revalidatePath("/", "layout");
  return { ok: true };
}

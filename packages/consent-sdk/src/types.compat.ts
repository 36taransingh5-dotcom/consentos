/**
 * Compile-time guard: the SDK's self-contained wire types must stay
 * interchangeable with the server's. Checked by `pnpm typecheck`; never
 * bundled (it is not imported by any entry point).
 */
import type * as Engine from "@consentos/policy-engine";
import type * as Shared from "@consentos/shared";
import type * as Sdk from "./types";

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;

export type Checks = [
  Assert<Same<Sdk.Purpose, Engine.Purpose>>,
  Assert<Same<Sdk.Decision, Engine.Decision>>,
  Assert<Same<Sdk.ReasonCode, Engine.ReasonCode>>,
  Assert<Same<Sdk.ReceiptReasonCode, Shared.ReceiptReasonCode>>,
  Assert<Same<Sdk.EvaluateResponse, Shared.EvaluateResponse>>,
  Assert<Same<Sdk.GrantCheckReason, Shared.GrantCheckReason>>,
  Assert<Same<Sdk.GrantCheckResponse, Shared.GrantCheckResponse>>,
  Assert<Same<Sdk.ConsentRequestStatus, Shared.ConsentRequestStatus>>,
  Assert<Same<Sdk.ReceiptPayload, Shared.ReceiptPayload>>,
  Assert<Same<Sdk.SignedReceipt, Shared.SignedReceipt>>,
  Assert<Same<Sdk.ReceiptVerification, Shared.ReceiptVerification>>,
];

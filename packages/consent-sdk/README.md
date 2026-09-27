# @consentos/sdk

Ask a user's ConsentOS policy for permission, enforce the grant where you use the data, and verify signed consent receipts. No dependencies; works in Node 18+, edge runtimes and browsers.

```bash
pnpm add @consentos/sdk
```

## 1. Create a client (server-side)

```ts
import { ConsentOS } from "@consentos/sdk";

export const consent = new ConsentOS({
  serviceId: "pixly",
  apiUrl: "https://consentos.example",
  apiKey: process.env.CONSENTOS_API_KEY, // secret: keep it on your server
});
```

## 2. Request permission

```ts
const result = await consent.request({
  userId,
  dataType: "uploaded_images",
  purpose: "personalization", // or any identifier; unknown ones escalate to the user
  retentionDays: 30,
  thirdPartySharing: false, // default false, and the receipt records it
  metadata: { feature: "recommendations" },
});

if (result.decision === "ALLOW") {
  await db.grants.save({ userId, feature: "recommendations", receiptId: result.receiptId });
} else if (result.decision === "DENY") {
  // result.reasonCode e.g. "PURPOSE_DENIED" | "RETENTION_EXCEEDS_LIMIT"
  // result.details   e.g. { requestedRetentionDays: 730, maxRetentionDays: 90 }
  showBlocked(result.reason);
} else {
  // REQUIRE_USER: the user's rules say "ask me"
  const answer = await consent.waitForDecision(result.requestId, { timeoutMs: 120_000 });
}
```

The decision is made by ConsentOS's deterministic engine against the user's current policy version. Nothing you send can influence it except the facts of the request.

## 3. Enforce before you use the data

```ts
export async function POST(req: Request) {
  const { grantId } = await req.json();
  const check = await consent.checkGrant({
    userId,
    purpose: "foundation_model_training",
    dataType: "uploaded_images",
    receiptId: grantId, // optional: omit to use the latest grant
  });
  if (!check.authorized) {
    return Response.json({ error: check.code, message: check.message }, { status: 403 });
  }
  // … do the work
}
```

`check.code` is `CONSENT_VIOLATION` (no grant, wrong purpose, wrong service, wrong user or data, a refusal receipt, or a failed signature) or `CONSENT_REVOKED`. Prefer exceptions? Use `consent.enforce(...)`, which throws `ConsentViolationError`.

Pass `intent: "status"` when a UI only wants to know whether a grant is still live. Refusals on `"use"` (the default) appear in the user's activity.

## 4. Tell the extension about your pages (browser)

```ts
import { announceService, notifyDecision } from "@consentos/sdk/browser";

announceService({ serviceId: "pixly", name: "Pixly" }); // once, on load
notifyDecision({ requestId }); // after your backend receives a decision
```

Or add `<meta name="consentos-service" content="pixly">` to your HTML. The extension checks your page's origin against your registered domain, and treats messages as refresh hints only.

## 5. Verify receipts

```ts
const v = await consent.verifyReceipt(receiptId);
// { valid, payloadIntact, signatureValid, requestHashValid, policyHashValid, revoked, … }

const archived = await consent.getReceipt(receiptId); // full signed document (issued to you)
await consent.verifyReceiptDocument(archived.receipt); // verify the copy you hold
```

Receipts are SHA-256 over canonical JSON, signed with Ed25519. Public keys are at `GET {apiUrl}/api/v1/keys`. See [docs/PROTOCOL.md](../../docs/PROTOCOL.md).

## Errors

API failures throw `ConsentOSError` with `status`, `code` (e.g. `INVALID_API_KEY`, `RATE_LIMITED`, `NETWORK_ERROR`, `TIMEOUT`) and the parsed `body`. On a protected path, treat any error as **not authorised**.

## Options

| Option | Default | |
| --- | --- | --- |
| `serviceId` | — | Your registered service id |
| `apiUrl` | — | ConsentOS base URL |
| `apiKey` | — | Required for `request`, `checkGrant`, `enforce`, `getRequest`, `waitForDecision`, `getReceipt` |
| `fetch` | `globalThis.fetch` | Inject for tracing or tests |
| `timeoutMs` | `10000` | Per request |

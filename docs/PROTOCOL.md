# ConsentOS protocol — draft v1

This is the wire contract between a **service** (a site or app that wants to use personal data), a **ConsentOS server** (holds the user's policy, decides and signs) and a **user agent** (the extension). It is written so another implementation could interoperate.

## Actors and credentials

| Actor | Credential | Can |
| --- | --- | --- |
| Service backend | `Authorization: Bearer <service API key>` | evaluate, check grants, poll pending requests, read its own receipts |
| User (web / extension) | session cookie / `Bearer <extension token>` | read own state, change policy, revoke grants, answer pending requests |
| Anyone | — | verify receipts, fetch public keys and the service directory |

## Vocabulary

**Purposes:** `essential`, `analytics`, `personalization`, `advertising`, `foundation_model_training`, `third_party_sharing`, `precise_location`.

**Data types:** `uploaded_images`, `profile`, `account`, `email_address`, `usage_events`, `device_info`, `contacts`, `messages`, `coarse_location`, `precise_location`.

Other identifiers matching `^[a-z][a-z0-9_]{0,63}$` are valid to send. They are escalated to the user (`REQUIRE_USER`), never guessed at.

## Policy

```json
{
  "essential": "allow",
  "analytics": "allow_anonymized_only",
  "personalization": "allow",
  "advertising": "deny",
  "thirdPartySharing": "deny",
  "foundationModelTraining": "deny",
  "preciseLocation": "deny",
  "maxRetentionDays": 90
}
```

- Rules are `allow | deny | ask`; `analytics` also accepts `allow_anonymized_only`.
- `maxRetentionDays` is an integer from 1 to 3650.
- Every change creates a new immutable version `n` with `policyHash = "sha256:" + hex(SHA-256(canonical(policy)))`.

## 1. Evaluate

`POST /api/v1/consent/evaluate`, with the service key.

```json
{
  "userId": "7e57de30-0000-4000-8000-000000000001",
  "serviceId": "pixly",
  "dataType": "uploaded_images",
  "purpose": "personalization",
  "retentionDays": 30,
  "thirdPartySharing": false,
  "anonymized": false,
  "metadata": { "feature": "recommendations" }
}
```

- The schema is strict: unknown fields are rejected, and `serviceId` must match the key.
- Omitting `retentionDays` is only meaningful for `essential`; on any other purpose it escalates to the user.
- `metadata` is at most 2 KB of JSON. It is hashed into the receipt but never affects the decision.

Response `200`:

```json
{
  "requestId": "uuid",
  "decision": "ALLOW | DENY | REQUIRE_USER",
  "reasonCode": "POLICY_ALLOWS",
  "reason": "Personalisation is permitted by the user's privacy policy. …",
  "details": { "rule": "policy.maxRetentionDays", "requestedRetentionDays": 730, "maxRetentionDays": 90 },
  "evaluatedAt": "ISO-8601",
  "policyVersion": 3,
  "receiptId": "uuid | null",
  "receiptUrl": "https://…/receipts/uuid | null",
  "engineVersion": "1.0.0"
}
```

**Evaluation order** (deny-overrides; the first denying check explains the decision, otherwise the first asking check):

1. Policy well-formed, else DENY `INVALID_POLICY`. Request well-formed, else DENY `MALFORMED_REQUEST` / `INVALID_RETENTION`.
2. Purpose rule: `PURPOSE_DENIED` · `PURPOSE_REQUIRES_CONFIRMATION` · `ANONYMIZATION_REQUIRED` · `UNKNOWN_PURPOSE`.
3. Data type recognised: `UNKNOWN_DATA_TYPE`.
4. Precise-location data under `preciseLocation`: `PRECISE_LOCATION_DENIED` · `PRECISE_LOCATION_REQUIRES_CONFIRMATION`.
5. `thirdPartySharing: true` under `thirdPartySharing`: `THIRD_PARTY_SHARING_DENIED` · `…_REQUIRES_CONFIRMATION`.
6. Retention for non-essential purposes: `RETENTION_UNSPECIFIED` · `RETENTION_EXCEEDS_LIMIT`.
7. Otherwise ALLOW: `POLICY_ALLOWS` or `ANONYMIZED_ANALYTICS_ALLOWED`.

A new ALLOW for the same (user, service, purpose, data type) **supersedes** the previous grant. A service still holding the old receipt id is handed over to the newest active grant.

## 2. Pending requests

- `GET /api/v1/consent/requests/:id` (service key) returns `{ requestId, status: "decided|pending|resolved", decision, reasonCode, reason, receiptId, resolvedAt }`.
- `POST /api/v1/consent/requests/:id/resolve` (user) takes `{ "decision": "ALLOW" | "DENY" }`. It signs a receipt with reason code `USER_APPROVED` / `USER_DECLINED`.

## 3. Runtime enforcement

`POST /api/v1/grants/check`, with the service key.

```json
{
  "userId": "uuid",
  "serviceId": "pixly",
  "purpose": "foundation_model_training",
  "dataType": "uploaded_images",
  "receiptId": "uuid (optional)",
  "intent": "use"
}
```

Always responds `200`:

```json
{ "authorized": false, "code": "CONSENT_VIOLATION", "reason": "NO_GRANT",
  "message": "The user has not granted permission for foundation-model training.",
  "receiptId": null, "checkedAt": "ISO-8601" }
```

- `code` is `GRANTED`, `CONSENT_VIOLATION` or `CONSENT_REVOKED`.
- `reason` is one of `GRANT_ACTIVE`, `NO_GRANT`, `GRANT_NOT_FOUND`, `USER_MISMATCH`, `SERVICE_MISMATCH`, `PURPOSE_MISMATCH`, `DATA_TYPE_MISMATCH`, `DECISION_NOT_ALLOW`, `REVOKED`, `INTEGRITY_FAILURE`.
- With `intent: "use"` (the default), refusals are logged to the user's activity. Use `"status"` for UI checks that won't touch data.
- A conforming service **must** call this on the code path that uses the data, and **must** refuse (e.g. `403 { error: code, message }`) unless `authorized` is `true`. If the check can't be completed, it must fail closed.

## 4. Receipts

```json
{
  "payload": {
    "format": "consentos.receipt/v1",
    "receiptId": "uuid",
    "requestId": "uuid",
    "userId": "uuid",
    "serviceId": "pixly",
    "request": { "dataType": "uploaded_images", "purpose": "personalization", "retentionDays": 30,
                 "thirdPartySharing": false, "anonymized": false, "metadata": {} },
    "decision": { "decision": "ALLOW", "reasonCode": "POLICY_ALLOWS", "reason": "…" },
    "policyVersion": 1,
    "policyHash": "sha256:…",
    "requestHash": "sha256:…",
    "engineVersion": "1.0.0",
    "issuedAt": "ISO-8601",
    "keyId": "cos-ed25519-…"
  },
  "payloadHash": "sha256:…",
  "signature": "base64url",
  "algorithm": "Ed25519"
}
```

**Canonical JSON:**

- UTF-8, objects with keys sorted by UTF-16 code unit, no insignificant whitespace.
- Numbers in ECMAScript shortest round-trip form; strings escaped as in `JSON.stringify`.
- `undefined` object members are omitted.
- These are rejected: non-finite numbers, `undefined` array elements, non-plain objects, cycles.

The following must all hold:

```text
requestHash == "sha256:" + hex(SHA-256(canonical(payload.request)))
policyHash  == hash of the user's stored policy at payload.policyVersion
payloadHash == "sha256:" + hex(SHA-256(canonical(payload)))
Ed25519.verify(publicKey[payload.keyId], canonical(payload), base64url-decode(signature))
```

- `GET /api/v1/receipts/:id/verify` (public) returns `{ valid, payloadIntact, signatureValid, requestHashValid, policyHashValid, keyId, decision, issuedAt, revoked, revokedAt, revocationReason, checkedAt }`.
- `POST /api/v1/receipts/verify` (public) verifies a receipt document supplied in the body.
- `GET /api/v1/keys` (public) returns a JWK set (`kty: OKP`, `crv: Ed25519`, `kid`).
- Revocation (`user`, `policy_change`, `superseded`) is status: it never changes the signed payload.

## 5. User agent integration

A page belonging to a service declares itself explicitly:

```html
<meta name="consentos-service" content="pixly">
```

It may also post hints on its own origin. These are hints only; the user agent always re-fetches state from the ConsentOS server:

```js
window.postMessage({ source: "consentos-sdk", type: "announce", serviceId: "pixly", name: "Pixly" }, location.origin)
window.postMessage({ source: "consentos-sdk", type: "decision", requestId }, location.origin)
```

The user agent must compare the page's browser-reported origin with the service's registered `domain` (`GET /api/v1/services/:id`) before showing it as that service.

## Errors

Every non-2xx response has the shape `{ "error": "CODE", "message": "…", "issues"?: [{ "path", "message" }] }`. Codes include:

- `INVALID_REQUEST`, `INVALID_JSON`, `PAYLOAD_TOO_LARGE`
- `UNAUTHENTICATED`, `INVALID_API_KEY`, `INVALID_TOKEN`
- `SERVICE_MISMATCH`, `USER_NOT_FOUND`, `NO_POLICY`
- `RATE_LIMITED` (with `Retry-After`), `INTERNAL_ERROR`

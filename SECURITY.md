# Security model

ConsentOS decides what software may do with personal data, so it has to be harder to fool than the thing it protects. This is the threat model for the hackathon build, what it defends against, and what it doesn't.

## Assets

| Asset | Why it matters |
| --- | --- |
| A user's privacy policy (all versions) | Defines every automatic decision. |
| Consent receipts / grants | Authorise real data use; their integrity is the product. |
| The Ed25519 signing key | Anyone holding it can mint grants. |
| Service API keys | Let a service ask on a user's behalf and pass enforcement checks. |
| Extension tokens, web sessions | Let a user read their data and revoke grants. |

## Trust boundaries

```text
 Browser (untrusted pages)          Service backend (semi-trusted)        ConsentOS server (trusted)
 ├─ Pixly page JS                   ├─ holds its own API key             ├─ policy engine
 ├─ ConsentOS extension (trusted)   └─ calls evaluate / grants/check     ├─ signing key
 └─ ConsentOS web app                                                    └─ Postgres (RLS, triggers)
```

## Threats and mitigations

### A service (or its frontend) tries to grant itself permission

- The decision is computed only by the deterministic engine on the server, against the user's stored policy.
- `evaluate` uses a strict Zod schema. Unknown fields such as `decision` or `policyVersion` are rejected with `400`.
- Every enforcement check is server-to-server (`grants/check` with the service key), independent of anything the service's frontend reports. Pixly's protected endpoints ignore UI state and ask ConsentOS every time.
- A grant is bound to user, service, purpose and data type. Reusing it for another purpose (`PURPOSE_MISMATCH`), another service (`SERVICE_MISMATCH`), another user (`USER_MISMATCH`) or other data (`DATA_TYPE_MISMATCH`) fails. A DENY receipt can never authorise (`DECISION_NOT_ALLOW`).

### A service impersonates another service

- API keys are random secrets, stored only as SHA-256 hashes and looked up by hash. The key's service must equal the `serviceId` in the body (`SERVICE_MISMATCH`, `403`).
- In the browser, a page announcing `pixly` is checked by the extension against Pixly's registered domain, using the origin **the browser** reports (`sender.origin`), not anything the page says. A mismatch shows "Unverified claim" and hides Pixly's data.

### Someone edits a receipt or a policy after the fact

- Receipts are canonical JSON, hashed with SHA-256 and signed with Ed25519. Any change breaks the signature, even if the attacker recomputes the hashes.
- Receipts commit to `policyHash` for the exact policy version. Verification recomputes it from the stored, immutable version.
- Database triggers make policy versions append-only and receipts immutable, apart from a one-way revocation stamp. These apply to every role, including the server's.
- Verification also checks that the indexed columns enforcement queries use (`purpose`, `service_id`, …) match the signed payload. An attacker with raw database access who bypasses the triggers and repoints a grant is caught (`INTEGRITY_FAILURE`); a test covers this.

### One user reads or changes another user's data

- Row-level security on every table (`user_id = auth.uid()`). Users can read only their own rows and append only their own policy versions. They can update only a pending request of their own (to resolve it) or an active grant of their own (to revoke it, with `revocation_reason = 'user'`). They can never insert receipts.
- The server's own user-facing queries run as `authenticated` with the user's claims (`set local role`), so RLS guards against bugs in our SQL too.
- Column grants hide `services.api_key_hash` from `anon`/`authenticated`.
- Tests assert cross-user isolation, blocked receipt minting, blocked policy writes for others, blocked un-revocation, and hidden key hashes, on both embedded Postgres and over the wire.

### Stolen or forged user credentials

- Local passwords are hashed with scrypt, with a dummy-hash comparison for unknown emails so response timing doesn't reveal which accounts exist. Supabase mode uses Supabase Auth.
- Web sessions are HMAC-signed `httpOnly`, `SameSite=Lax` cookies (`Secure` over HTTPS) with a 7-day expiry.
- Extension tokens are HMAC-signed with a **domain-separated key**, so a session token can't be used as an extension token or vice versa. They expire after 30 days.
- CSRF: Next.js server actions check origin, cookie-authenticated API mutations require a same-origin `Origin` header, and the extension uses bearer tokens.
- The extension token is only handed over on the configured ConsentOS origin. The content script checks the page origin, and the background worker checks `sender.origin` again. It's stored in `chrome.storage.local`, which web pages can't read.

### Abuse and malformed input

- Zod validation on every API input, a 16 KB body cap, and 2 KB of bounded, JSON-only metadata.
- Rate limits: evaluate 120/min per service, checks 600/min per service, public verification 60–120/min per IP, demo reset 20/min.
- The engine fails closed. An invalid policy, malformed request or unknown vocabulary never yields ALLOW; purpose and data-type lookups use own-property checks, so names like `__proto__` can't resolve.
- `500` responses never include internals.
- Security headers: `nosniff`, `X-Frame-Options: DENY`, a strict referrer policy, and a restrictive `Permissions-Policy`.

### The demo reset endpoint

- `POST /api/demo/reset` returns `404` unless `CONSENTOS_DEMO_MODE` is enabled. It requires either the signed-in demo user (same origin) or the `x-consentos-demo-token` secret, compared in constant time. It only ever touches the demo account.

## Secrets

| Secret | Where it lives |
| --- | --- |
| `CONSENTOS_SIGNING_KEY` | Server env only. Locally a dev key is generated in `apps/web/.data/` (git-ignored). A `DATABASE_URL` deployment refuses to start without it. |
| `CONSENTOS_SESSION_SECRET` | Server env only (≥ 32 chars). Rotating it signs everyone out and invalidates extension tokens. |
| Service API keys (`PIXLY_API_KEY` / `CONSENTOS_API_KEY`) | Server env of ConsentOS (hashed at seed) and of Pixly. Never sent to a browser. Local test keys are used only against a local ConsentOS. |
| `SUPABASE_SERVICE_ROLE_KEY` | ConsentOS server env only; used to create pre-confirmed users. |

The browser never holds a secret that can authorise data use.

## Known gaps

- **Services must call enforcement.** ConsentOS can't observe data use that bypasses it. Receipts make dishonest use provable, not impossible.
- Rate limiting is in memory per instance. Use a shared store (Redis or Postgres) behind multiple instances.
- Extension tokens have no per-token revocation list; they expire, and rotating the session secret revokes all of them.
- No key-management service: the signing key is an environment variable. `CONSENTOS_VERIFICATION_KEYS` supports rotation (old public keys keep verifying) but there's no rotation UI.
- The content script matches all http(s) pages so it can detect integrations. It reads one meta tag and listens for SDK messages; it doesn't read page content.
- Account linking between a service's user and a ConsentOS user is configuration-based in the demo.

## Reporting

This is a hackathon project. Please open an issue for anything you find.

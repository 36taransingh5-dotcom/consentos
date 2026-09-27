import { DATA_TYPE_CATALOG, PURPOSE_CATALOG, PURPOSES } from "@consentos/policy-engine";
import type { Metadata } from "next";
import { CodeBlock } from "@/components/code-block";
import { Card, Eyebrow } from "@/components/ui";
import { getConfig } from "@/server/env";

export const metadata: Metadata = { title: "Developer integration" };

const endpoints: { method: string; path: string; auth: string; what: string }[] = [
  { method: "POST", path: "/api/v1/consent/evaluate", auth: "Service key", what: "Ask to use data for a purpose. Returns ALLOW, DENY or REQUIRE_USER." },
  { method: "POST", path: "/api/v1/grants/check", auth: "Service key", what: "Runtime enforcement: is this use permitted right now?" },
  { method: "GET", path: "/api/v1/consent/requests/:id", auth: "Service key", what: "Poll a REQUIRE_USER request until the user answers." },
  { method: "GET", path: "/api/v1/receipts/:id", auth: "Service key or user", what: "The full signed receipt document." },
  { method: "GET", path: "/api/v1/receipts/:id/verify", auth: "Public", what: "Recompute hashes and check the signature." },
  { method: "POST", path: "/api/v1/receipts/verify", auth: "Public", what: "Verify a receipt document you hold." },
  { method: "GET", path: "/api/v1/keys", auth: "Public", what: "Ed25519 signing keys as a JWK set." },
  { method: "GET", path: "/api/v1/services/:id", auth: "Public", what: "Directory entry for an integrated service." },
];

const reasonCodes: [string, string][] = [
  ["POLICY_ALLOWS", "Every check passed."],
  ["ANONYMIZED_ANALYTICS_ALLOWED", "Analytics on data marked anonymised, under an anonymous-only rule."],
  ["PURPOSE_DENIED", "The user blocks this purpose."],
  ["RETENTION_EXCEEDS_LIMIT", "retentionDays is above the user's maximum. details carries both numbers."],
  ["THIRD_PARTY_SHARING_DENIED", "thirdPartySharing is true and the user blocks sharing."],
  ["PRECISE_LOCATION_DENIED", "Precise-location data, which the user blocks whatever the purpose."],
  ["ANONYMIZATION_REQUIRED", "Analytics without anonymized: true under an anonymous-only rule."],
  ["PURPOSE_REQUIRES_CONFIRMATION", "The user set this purpose to Ask me. → REQUIRE_USER"],
  ["RETENTION_UNSPECIFIED", "No retentionDays on a non-essential request. → REQUIRE_USER"],
  ["UNKNOWN_PURPOSE / UNKNOWN_DATA_TYPE", "Not in the catalogue, so the user decides. → REQUIRE_USER"],
];

export default function DevelopersPage() {
  const apiUrl = getConfig().publicUrl;

  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 sm:py-16">
      <Eyebrow>Developer integration</Eyebrow>
      <h1 className="mt-3 text-4xl font-semibold tracking-tight text-ink sm:text-5xl">Ask before you use data.</h1>
      <p className="mt-4 max-w-2xl text-[15.5px] leading-relaxed text-ink-2">
        Integrating ConsentOS takes four calls: announce your service, request permission, enforce the grant before
        doing the work, and verify receipts when you need proof. The <code className="font-mono text-[14px]">@consentos/sdk</code>{" "}
        package wraps them with no dependencies.
      </p>

      <ol className="mt-14 space-y-16">
        <li>
          <h2 className="text-xl font-semibold tracking-tight text-ink">1. Create a client — on your server</h2>
          <p className="mt-2 text-[15px] leading-relaxed text-muted">
            Your API key identifies your service and never leaves your backend. In this build Pixly is seeded as a
            verified service; a full deployment would issue keys from a developer console.
          </p>
          <CodeBlock
            className="mt-5"
            title="consent.ts"
            code={`
import { ConsentOS } from "@consentos/sdk"

export const consent = new ConsentOS({
  serviceId: "pixly",
  apiUrl: "${apiUrl}",
  apiKey: process.env.CONSENTOS_API_KEY, // server-side only
})
`}
          />
        </li>

        <li>
          <h2 className="text-xl font-semibold tracking-tight text-ink">2. Request permission</h2>
          <p className="mt-2 text-[15px] leading-relaxed text-muted">
            Say exactly what you want: the data, the purpose, how long you keep it, whether it leaves your company. The
            user&apos;s rules decide deterministically. You get a decision, a machine-readable reason and — for ALLOW
            and DENY — a signed receipt. An ALLOW receipt is your grant.
          </p>
          <CodeBlock
            className="mt-5"
            title="enable-recommendations.ts"
            code={`
const result = await consent.request({
  userId,
  dataType: "uploaded_images",
  purpose: "personalization",
  retentionDays: 30,
  thirdPartySharing: false,
})

switch (result.decision) {
  case "ALLOW":
    await saveGrant(userId, "personalization", result.receiptId)
    break
  case "DENY":
    showBlocked(result.reason) // e.g. RETENTION_EXCEEDS_LIMIT
    break
  case "REQUIRE_USER":
    // the user's rules want to be asked; they answer in ConsentOS
    const answer = await consent.waitForDecision(result.requestId)
    break
}
`}
          />
          <CodeBlock
            className="mt-4"
            lang="json"
            title="POST /api/v1/consent/evaluate → 200"
            code={`
{
  "requestId": "0f6c1d0e-…",
  "decision": "DENY",
  "reasonCode": "PURPOSE_DENIED",
  "reason": "Foundation-model training is blocked by the user's privacy policy.",
  "details": { "rule": "policy.foundationModelTraining" },
  "evaluatedAt": "2026-09-26T14:32:08.114Z",
  "policyVersion": 3,
  "receiptId": "a1d4…",
  "receiptUrl": "${apiUrl}/receipts/a1d4…",
  "engineVersion": "1.0.0"
}
`}
          />
        </li>

        <li>
          <h2 className="text-xl font-semibold tracking-tight text-ink">3. Enforce before you do the work</h2>
          <p className="mt-2 text-[15px] leading-relaxed text-muted">
            This is the part that makes consent real. Your protected endpoint asks ConsentOS whether the grant exists,
            belongs to this user and service, covers this purpose and data, is not revoked, and still verifies. If not,
            refuse. Do not trust a decision your own frontend reports.
          </p>
          <CodeBlock
            className="mt-5"
            title="app/api/train-model/route.ts"
            code={`
export async function POST(req: Request) {
  const { grantId } = await req.json()
  const check = await consent.checkGrant({
    userId,
    purpose: "foundation_model_training",
    dataType: "uploaded_images",
    receiptId: grantId,
  })

  if (!check.authorized) {
    return Response.json(
      { error: check.code, message: check.message }, // CONSENT_VIOLATION | CONSENT_REVOKED
      { status: 403 },
    )
  }

  return startTraining()
}
`}
          />
        </li>

        <li>
          <h2 className="text-xl font-semibold tracking-tight text-ink">4. Announce your service to the extension</h2>
          <p className="mt-2 text-[15px] leading-relaxed text-muted">
            One line in the browser lets the ConsentOS extension recognise your site, show the user what you are
            allowed to do, and refresh the moment a decision lands. The extension checks your page&apos;s origin against
            your registered domain, so another site cannot claim to be you.
          </p>
          <CodeBlock
            className="mt-5"
            title="app/layout.tsx (client)"
            code={`
import { announceService, notifyDecision } from "@consentos/sdk/browser"

announceService({ serviceId: "pixly", name: "Pixly" })

// after your backend receives a decision:
notifyDecision({ requestId })
`}
          />
        </li>

        <li>
          <h2 className="text-xl font-semibold tracking-tight text-ink">5. Verify receipts</h2>
          <p className="mt-2 text-[15px] leading-relaxed text-muted">
            Receipts are SHA-256 over canonical JSON (sorted keys, no whitespace), signed with Ed25519. Anyone can check
            them against the public keys; no ConsentOS account needed.
          </p>
          <CodeBlock
            className="mt-5"
            title="audit.ts"
            code={`
const result = await consent.verifyReceipt(receiptId)
// { valid: true, payloadIntact: true, signatureValid: true,
//   requestHashValid: true, policyHashValid: true, revoked: false, … }
`}
          />
        </li>
      </ol>

      <section aria-labelledby="endpoints" className="mt-20">
        <h2 id="endpoints" className="text-xl font-semibold tracking-tight text-ink">
          Endpoints
        </h2>
        <Card className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-[13.5px]">
            <thead className="border-b border-line text-[12px] text-muted">
              <tr>
                <th scope="col" className="px-5 py-3 font-medium">Endpoint</th>
                <th scope="col" className="px-5 py-3 font-medium">Auth</th>
                <th scope="col" className="px-5 py-3 font-medium">Purpose</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {endpoints.map((e) => (
                <tr key={e.method + e.path}>
                  <td className="px-5 py-3 align-top whitespace-nowrap">
                    <span className="mr-2 font-mono text-[11.5px] font-semibold text-accent">{e.method}</span>
                    <span className="font-mono text-[12.5px] text-ink">{e.path}</span>
                  </td>
                  <td className="px-5 py-3 align-top whitespace-nowrap text-muted">{e.auth}</td>
                  <td className="px-5 py-3 align-top text-ink-2">{e.what}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </section>

      <section aria-labelledby="vocabulary" className="mt-16 grid gap-6 md:grid-cols-2">
        <Card className="p-6">
          <h2 id="vocabulary" className="text-sm font-semibold text-ink">
            Purposes
          </h2>
          <ul className="mt-4 space-y-3">
            {PURPOSES.map((p) => (
              <li key={p}>
                <p className="font-mono text-[12.5px] text-ink">{p}</p>
                <p className="text-[13px] text-muted">{PURPOSE_CATALOG[p].description}</p>
              </li>
            ))}
          </ul>
        </Card>
        <Card className="p-6">
          <h2 className="text-sm font-semibold text-ink">Data types</h2>
          <ul className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {Object.values(DATA_TYPE_CATALOG).map((d) => (
              <li key={d.dataType} className="font-mono text-[12.5px] text-ink">
                {d.dataType}
              </li>
            ))}
          </ul>
          <p className="mt-4 text-[13px] leading-relaxed text-muted">
            Anything outside these lists is valid to send, and is escalated to the user rather than guessed at.
          </p>
        </Card>
      </section>

      <section aria-labelledby="reasons" className="mt-16">
        <h2 id="reasons" className="text-xl font-semibold tracking-tight text-ink">
          Reason codes
        </h2>
        <p className="mt-2 text-[14.5px] text-muted">
          Checks run in a fixed order and combine deny-overrides: any deny wins, then any ask, otherwise allow.
        </p>
        <Card className="mt-5 divide-y divide-line">
          {reasonCodes.map(([code, meaning]) => (
            <div key={code} className="grid gap-1 px-5 py-3 sm:grid-cols-[300px_1fr] sm:gap-4">
              <span className="font-mono text-[12.5px] text-ink">{code}</span>
              <span className="text-[13.5px] text-ink-2">{meaning}</span>
            </div>
          ))}
        </Card>
      </section>
    </div>
  );
}

import { DEFAULT_POLICY, evaluate, explainRule } from "@consentos/policy-engine";
import Link from "next/link";
import { LogoMark } from "@/components/logo";
import { CodeBlock } from "@/components/code-block";
import { ArrowIcon, ButtonLink, Card, CheckIcon, CrossIcon, Eyebrow, StatusPill } from "@/components/ui";
import { shortHash } from "@/lib/format";
import { hashCanonical } from "@/server/crypto";
import { hashPolicy } from "@/server/policies";

const PIXLY_URL = process.env.NEXT_PUBLIC_PIXLY_URL ?? "http://localhost:3001";

/** Three requests Pixly really makes, decided here by the real engine against the default rules. */
const heroRequests = [
  { label: "Smart recommendations", request: { dataType: "uploaded_images", purpose: "personalization", retentionDays: 30 } },
  { label: "Help train Pixly AI", request: { dataType: "uploaded_images", purpose: "foundation_model_training", retentionDays: 365 } },
  { label: "Pixly Memories", request: { dataType: "uploaded_images", purpose: "personalization", retentionDays: 730 } },
] as const;

function ExtensionPreview() {
  const rows = heroRequests.map((row) => ({ ...row, result: evaluate(DEFAULT_POLICY, row.request) }));
  return (
    <figure className="animate-fade-up" aria-label="The ConsentOS extension on Pixly, with decisions from the real engine">
      <Card className="overflow-hidden">
        <div className="flex items-center gap-2.5 border-b border-line px-5 py-3.5">
          <LogoMark className="size-5 text-ink" />
          <span className="text-[14px] font-semibold tracking-tight text-ink">ConsentOS</span>
          <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-allow-line bg-allow-bg px-2.5 py-0.5 text-[11px] font-semibold tracking-[0.06em] text-allow uppercase">
            <CheckIcon className="size-3" /> Protected on Pixly
          </span>
        </div>
        <ul className="divide-y divide-line">
          {rows.map(({ label, request, result }) => {
            const allowed = result.decision === "ALLOW";
            const rule = explainRule(result.details?.rule, result.details?.ruleValue);
            return (
              <li key={label} className="flex items-start gap-4 px-5 py-4">
                <span
                  className={
                    allowed
                      ? "mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-allow-bg text-allow"
                      : "mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-block-bg text-block"
                  }
                  aria-hidden="true"
                >
                  {allowed ? <CheckIcon /> : <CrossIcon />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-medium text-ink">{label}</p>
                  <p className="mt-0.5 truncate font-mono text-[11.5px] text-muted">
                    {request.purpose} · {request.retentionDays} days
                  </p>
                  {rule && (
                    <p className="mt-1 text-[12px] text-muted">
                      Your rule: <span className="text-ink-2">{rule.label}</span>{" "}
                      <span className={allowed ? "font-semibold text-allow" : "font-semibold text-block"}>
                        {rule.display}
                      </span>
                    </p>
                  )}
                </div>
                <StatusPill status={allowed ? "allow" : "block"}>{allowed ? "Allowed" : "Blocked"}</StatusPill>
              </li>
            );
          })}
        </ul>
      </Card>
      <figcaption className="mt-3 text-center text-[12px] text-muted">
        Decided by the real policy engine against the default rules as this page rendered.
      </figcaption>
    </figure>
  );
}

const steps = [
  {
    n: "1",
    title: "Set your rules once",
    body: "Allow personalisation, block AI training, cap retention at 90 days. Plain choices, saved as a versioned, hashed policy.",
  },
  {
    n: "2",
    title: "Websites request permission",
    body: "Integrated services call ConsentOS with exactly what they want: which data, for what purpose, for how long, shared with whom.",
  },
  {
    n: "3",
    title: "ConsentOS enforces your decision",
    body: "A deterministic engine answers in milliseconds, signs a receipt, and the service's own backend refuses to run without a valid grant.",
  },
];

const sdkSnippet = `
import { ConsentOS } from "@consentos/sdk"

const consent = new ConsentOS({
  serviceId: "pixly",
  apiUrl: "https://consentos.dev",
  apiKey: process.env.CONSENTOS_API_KEY,
})

const result = await consent.request({
  userId,
  dataType: "uploaded_images",
  purpose: "foundation_model_training",
  retentionDays: 365,
})

if (result.decision === "ALLOW") {
  // continue — result.receiptId is your signed grant
}
`;

const enforcementSnippet = `
POST /api/train-model

HTTP/1.1 403 Forbidden
{
  "error": "CONSENT_VIOLATION",
  "message": "The user has not granted permission for foundation-model training."
}
`;

export default function Home() {
  // Real hashes for the default policy and the demo's personalisation request.
  const policyHash = shortHash(hashPolicy(DEFAULT_POLICY), 4);
  const requestHash = shortHash(
    hashCanonical({
      dataType: "uploaded_images",
      purpose: "personalization",
      retentionDays: 30,
      thirdPartySharing: false,
      anonymized: false,
      metadata: {},
    }),
    4,
  );
  return (
    <>
      <section className="mx-auto grid max-w-6xl items-center gap-14 px-4 pt-16 pb-20 sm:px-6 sm:pt-24 lg:grid-cols-[1.05fr_1fr] lg:pb-28 [&>*]:min-w-0">
        <div>
          <Eyebrow>A permission layer for personal data</Eyebrow>
          <h1 className="mt-5 text-[44px] leading-[1.02] font-semibold tracking-[-0.035em] text-ink sm:text-6xl lg:text-[72px]">
            Your data.
            <br />
            Your rules.
            <br />
            <span className="text-muted">Everywhere.</span>
          </h1>
          <p className="mt-7 max-w-xl text-lg leading-relaxed text-ink-2">
            ConsentOS lets websites ask for data permission programmatically while your privacy rules decide what is
            allowed.
          </p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <ButtonLink href="/policy" size="lg">
              Set my privacy rules <ArrowIcon />
            </ButtonLink>
            <ButtonLink href="/developers" variant="secondary" size="lg">
              See developer integration
            </ButtonLink>
          </div>
          <p className="mt-6 text-[13px] text-muted">
            No banners, no LLM guesswork. Deterministic decisions, signed receipts, enforced at runtime.{" "}
            <Link href="/extension/connect" className="font-medium text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink">
              Get the browser extension
            </Link>
          </p>
        </div>
        <ExtensionPreview />
      </section>

      <section aria-labelledby="how" className="border-y border-line bg-surface">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <Eyebrow>How it works</Eyebrow>
          <h2 id="how" className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
            Decide once. Every integrated service has to ask — and has to listen.
          </h2>
          <ol className="mt-12 grid gap-4 md:grid-cols-3">
            {steps.map((step) => (
              <li key={step.n} className="rounded-2xl border border-line bg-bg p-6">
                <span className="grid size-8 place-items-center rounded-full border border-line-strong font-mono text-[13px] text-ink">
                  {step.n}
                </span>
                <h3 className="mt-5 text-lg font-semibold tracking-tight text-ink">{step.title}</h3>
                <p className="mt-2 text-[14.5px] leading-relaxed text-muted">{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section aria-labelledby="proof" className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <div className="grid gap-12 lg:grid-cols-2 lg:items-center [&>*]:min-w-0">
          <div>
            <Eyebrow>Proof, not promises</Eyebrow>
            <h2 id="proof" className="mt-3 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
              Unauthorised software operations actually fail.
            </h2>
            <p className="mt-5 text-[15.5px] leading-relaxed text-ink-2">
              A preference that nothing checks is a suggestion. ConsentOS grants are checked by the service&apos;s own
              backend before the work runs. No grant, wrong purpose, wrong service or a revoked grant: the call returns
              403.
            </p>
            <ul className="mt-7 space-y-3 text-[14.5px] text-ink-2">
              {[
                "Every decision is receipted: SHA-256 over canonical JSON, signed with Ed25519.",
                "Receipts commit to the exact policy version and request that produced them.",
                "Revoking a grant stops the next call — the receipt still proves what was once allowed.",
              ].map((item) => (
                <li key={item} className="flex gap-3">
                  <CheckIcon className="mt-0.5 text-allow" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="space-y-4">
            <CodeBlock title="pixly — runtime enforcement" lang="http" code={enforcementSnippet} />
            <Card className="p-5">
              <div className="flex items-center justify-between">
                <Eyebrow>What a receipt binds</Eyebrow>
                <StatusPill status="allow">Allowed</StatusPill>
              </div>
              <p className="mt-3 text-[15px] font-medium text-ink">Pixly · Personalised recommendations</p>
              <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-[13px]">
                <dt className="text-muted">Policy</dt>
                <dd className="font-mono text-ink-2">v1 · {policyHash}</dd>
                <dt className="text-muted">Request</dt>
                <dd className="font-mono text-ink-2">{requestHash}</dd>
                <dt className="text-muted">Conditions</dt>
                <dd className="text-ink-2">uploaded images · 30 days · not shared</dd>
                <dt className="text-muted">Signature</dt>
                <dd className="text-ink-2">Ed25519 over canonical JSON, checked by anyone at /verify</dd>
              </dl>
            </Card>
          </div>
        </div>
      </section>

      <section aria-labelledby="developers" className="border-y border-line bg-surface">
        <div className="mx-auto grid max-w-6xl gap-12 px-4 py-20 sm:px-6 lg:grid-cols-[1fr_1.1fr] lg:items-center [&>*]:min-w-0">
          <div>
            <Eyebrow>For developers</Eyebrow>
            <h2 id="developers" className="mt-3 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
              As small as adding payments or sign-in.
            </h2>
            <p className="mt-5 text-[15.5px] leading-relaxed text-ink-2">
              One request before you use data. One check before you run the job. The SDK is a few hundred lines with no
              dependencies, and every endpoint is plain JSON over HTTPS.
            </p>
            <ButtonLink href="/developers" variant="secondary" className="mt-8">
              Read the integration guide <ArrowIcon />
            </ButtonLink>
          </div>
          <CodeBlock title="server.ts" code={sdkSnippet} />
        </div>
      </section>

      <section aria-labelledby="honest" className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <div className="grid gap-8 md:grid-cols-2 [&>*]:min-w-0">
          <div>
            <Eyebrow>What ConsentOS is — and isn&apos;t</Eyebrow>
            <h2 id="honest" className="mt-3 text-2xl font-semibold tracking-tight text-ink">
              A proposed interoperable protocol, not magic.
            </h2>
            <p className="mt-4 text-[15px] leading-relaxed text-ink-2">
              ConsentOS does not control websites that have not integrated it. Services adopt the SDK and API the way
              they adopt authentication or payment infrastructure. Pixly is the reference integration you can try
              today.
            </p>
          </div>
          <Card className="flex flex-col justify-between p-6">
            <div>
              <p className="text-[15px] font-medium text-ink">Try it end to end</p>
              <p className="mt-2 text-[14px] leading-relaxed text-muted">
                Open Pixly, enable recommendations, then ask it to train on your photos. Watch your rules answer, the
                extension update, and the training endpoint refuse to run.
              </p>
            </div>
            <div className="mt-6 flex flex-wrap gap-3">
              <a href={PIXLY_URL} className="inline-flex h-10 items-center gap-2 rounded-full bg-ink px-5 text-sm font-medium text-bg hover:bg-ink-2">
                Open Pixly demo <ArrowIcon />
              </a>
              <ButtonLink href="/extension/connect" variant="secondary">
                Connect the extension
              </ButtonLink>
            </div>
          </Card>
        </div>
      </section>

      <section className="border-t border-line bg-ink text-bg">
        <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
          <p className="max-w-4xl text-3xl leading-tight font-semibold tracking-tight sm:text-5xl">
            Privacy shouldn&apos;t be a popup you click.{" "}
            <span className="opacity-60">It should be infrastructure software has to obey.</span>
          </p>
        </div>
      </section>
    </>
  );
}

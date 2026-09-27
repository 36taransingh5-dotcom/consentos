import { dataTypeLabel, dataTypeNoun, PURPOSE_CATALOG, isKnownPurpose, purposeLabel, type RuleCheck } from "@consentos/policy-engine";
import { uuidSchema } from "@consentos/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ServiceAvatar } from "@/components/service-avatar";
import { Card, CheckIcon, CrossIcon, Eyebrow, Mono, QuestionIcon, StatusPill } from "@/components/ui";
import { formatDateTime, formatRetention, shortHash } from "@/lib/format";
import { requireSessionUser } from "@/server/auth";
import { asUser } from "@/server/db";
import { buildExtensionState } from "@/server/extension-state";
import { getReceipt } from "@/server/receipts";
import { RevokeButton } from "../receipt-actions";
import { DownloadReceipt, VerifyPanel } from "./verify-panel";

export const metadata: Metadata = { title: "Consent receipt" };

function activity(purpose: string) {
  return isKnownPurpose(purpose) ? PURPOSE_CATALOG[purpose].activity : purpose.replace(/_/g, " ");
}

const CHECK_LABEL: Record<RuleCheck["check"], string> = {
  policy: "Policy",
  request: "Request",
  purpose: "Purpose",
  data_type: "Data type",
  precise_location: "Precise location",
  third_party_sharing: "Third-party sharing",
  retention: "Retention",
};

function TraceIcon({ outcome }: { outcome: RuleCheck["outcome"] }) {
  if (outcome === "pass") return <CheckIcon className="text-allow" />;
  if (outcome === "deny") return <CrossIcon className="text-block" />;
  if (outcome === "ask") return <QuestionIcon className="text-ask" />;
  return <span className="grid size-4 place-items-center text-faint" aria-hidden="true">–</span>;
}

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireSessionUser(`/receipts/${id}`);
  if (!uuidSchema.safeParse(id).success) notFound();

  const data = await asUser(user.id, async (tx) => {
    const record = await getReceipt(tx, id);
    if (!record) return null;
    const [request] = await tx.query<{ evaluation_trace: RuleCheck[]; engine_version: string }>(
      "select evaluation_trace, engine_version from public.consent_requests where id = $1",
      [record.requestId],
    );
    const [service] = await tx.query<{ domain: string }>("select domain from public.services where id = $1", [record.serviceId]);
    return { record, trace: request?.evaluation_trace ?? [], domain: service?.domain ?? "" };
  });
  if (!data) notFound();

  const { record, trace, domain } = data;
  const p = record.receipt.payload;
  const r = p.request;
  const allowed = record.decision === "ALLOW";
  const serviceName = record.serviceName ?? record.serviceId;
  const standing = (await buildExtensionState(user, { serviceId: record.serviceId })).site;

  const statement = allowed
    ? `On ${formatDateTime(record.issuedAt)}, ${p.decision.reasonCode === "USER_APPROVED" ? "you" : "your privacy rules"} allowed ${serviceName} to use your ${dataTypeNoun(r.dataType)} for ${activity(r.purpose)}${r.retentionDays !== null && r.purpose !== "essential" ? `, kept for up to ${formatRetention(r.retentionDays).toLowerCase()}` : ""}, ${r.thirdPartySharing ? "shared with third parties" : "without sharing them with third parties"}.`
    : `On ${formatDateTime(record.issuedAt)}, ${serviceName} asked to use your ${dataTypeNoun(r.dataType)} for ${activity(r.purpose)}. ${p.decision.reasonCode === "USER_DECLINED" ? "You declined." : "Your privacy rules refused."}`;

  let statusTitle: string;
  let statusBody: string;
  if (!allowed) {
    statusTitle = "Refusal on record";
    statusBody = `This receipt proves ${serviceName} asked and was refused. If its servers use this data anyway, runtime enforcement returns 403.`;
  } else if (!record.revokedAt) {
    statusTitle = "Active grant";
    statusBody = `${serviceName} may use this data as described until you revoke it. Its servers check this grant before every use.`;
  } else if (record.revocationReason === "superseded") {
    statusTitle = "Replaced";
    statusBody = `${serviceName} was issued a newer grant for the same use on ${formatDateTime(record.revokedAt)}. This one is no longer in effect.`;
  } else if (record.revocationReason === "policy_change") {
    statusTitle = "Revoked by your updated rules";
    statusBody = `On ${formatDateTime(record.revokedAt)} you changed your policy, and this grant no longer fitted it. Enforcement now returns CONSENT_REVOKED.`;
  } else {
    statusTitle = "Revoked";
    statusBody = `You revoked this grant on ${formatDateTime(record.revokedAt)}. Enforcement now returns CONSENT_REVOKED.`;
  }

  const details: [string, React.ReactNode][] = [
    ["Receipt ID", <Mono key="id">{record.id}</Mono>],
    ["Request ID", <Mono key="rid">{record.requestId}</Mono>],
    ["Issued", formatDateTime(record.issuedAt)],
    ["Policy version", `v${p.policyVersion}`],
    ["Policy hash", <Mono key="ph">{p.policyHash}</Mono>],
    ["Request hash", <Mono key="rh">{p.requestHash}</Mono>],
    ["Payload hash", <Mono key="pl">{record.receipt.payloadHash}</Mono>],
    ["Signature", <Mono key="sig">{shortHash(record.receipt.signature, 16)}</Mono>],
    ["Signing key", <Mono key="kid">{p.keyId}</Mono>],
    ["Algorithm", "Ed25519 over RFC 8785-style canonical JSON"],
    ["Engine", `policy-engine ${p.engineVersion}`],
  ];

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
      <Link href="/receipts" className="text-[13px] text-muted hover:text-ink">
        ← All receipts
      </Link>

      <header className="mt-8 flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex items-center gap-4">
          <ServiceAvatar id={record.serviceId} name={serviceName} className="size-12 rounded-2xl text-lg" />
          <div>
            <Eyebrow>Consent receipt</Eyebrow>
            <h1 className="mt-1.5 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
              {serviceName} · {purposeLabel(r.purpose)}
            </h1>
          </div>
        </div>
        <StatusPill
          status={allowed ? (record.revokedAt ? "revoked" : "allow") : "block"}
          className="h-8 self-start px-3.5 text-[12px] sm:self-auto"
        >
          {allowed ? <CheckIcon className="size-3.5" /> : <CrossIcon className="size-3.5" />}
          {allowed ? "Allowed" : "Blocked"}
        </StatusPill>
      </header>

      <p className="mt-6 max-w-3xl text-[17px] leading-relaxed text-ink-2">{statement}</p>

      <div className="mt-10 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <Card className="p-6">
            <h2 className="text-sm font-semibold text-ink">What was requested</h2>
            <dl className="mt-4 grid grid-cols-1 gap-x-8 gap-y-4 text-[14px] sm:grid-cols-2">
              <div>
                <dt className="text-[12px] text-muted">Service</dt>
                <dd className="mt-0.5 text-ink">
                  {serviceName} <span className="font-mono text-[12px] text-muted">{domain}</span>
                </dd>
              </div>
              <div>
                <dt className="text-[12px] text-muted">Data</dt>
                <dd className="mt-0.5 text-ink">
                  {dataTypeLabel(r.dataType)} <span className="font-mono text-[12px] text-muted">{r.dataType}</span>
                </dd>
              </div>
              <div>
                <dt className="text-[12px] text-muted">Purpose</dt>
                <dd className="mt-0.5 text-ink">
                  {purposeLabel(r.purpose)} <span className="font-mono text-[12px] text-muted">{r.purpose}</span>
                </dd>
              </div>
              <div>
                <dt className="text-[12px] text-muted">Retention</dt>
                <dd className="mt-0.5 text-ink tabular">
                  {r.purpose === "essential" && r.retentionDays === null
                    ? "For the life of your account"
                    : formatRetention(r.retentionDays)}
                </dd>
              </div>
              <div>
                <dt className="text-[12px] text-muted">Third-party sharing</dt>
                <dd className="mt-0.5 text-ink">{r.thirdPartySharing ? "Yes" : "No"}</dd>
              </div>
              <div>
                <dt className="text-[12px] text-muted">Anonymised</dt>
                <dd className="mt-0.5 text-ink">{r.anonymized ? "Yes" : "No"}</dd>
              </div>
            </dl>
          </Card>

          <Card className="p-6">
            <h2 className="text-sm font-semibold text-ink">How the decision was made</h2>
            <p className="mt-1 text-[13px] text-muted">
              Deterministic evaluation against policy v{p.policyVersion}. No model, no heuristics — the same inputs
              always give the same answer.
            </p>
            {trace.length > 0 && (
              <ol className="mt-5 space-y-3">
                {trace.map((step, i) => (
                  <li key={i} className="flex gap-3 text-[14px]">
                    <span className="mt-0.5">
                      <TraceIcon outcome={step.outcome} />
                    </span>
                    <div className="min-w-0">
                      <p className="text-ink-2">
                        <span className="font-medium text-ink">{CHECK_LABEL[step.check]}.</span> {step.detail}
                      </p>
                      {step.rule && (
                        <p className="mt-0.5 font-mono text-[11.5px] text-muted">
                          {step.rule} = {String(step.value)}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            )}
            <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line pt-4 text-[13px]">
              <span className="text-muted">Outcome</span>
              <span className="font-mono text-ink">{p.decision.decision}</span>
              <span className="font-mono text-muted">{p.decision.reasonCode}</span>
              <span className="w-full text-ink-2">{p.decision.reason}</span>
            </div>
          </Card>

          <Card className="p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-ink">Cryptographic details</h2>
              <div className="flex gap-2">
                <DownloadReceipt receipt={record.receipt} />
                <a
                  href="/api/v1/keys"
                  className="inline-flex h-8 items-center rounded-full border border-line-strong px-3.5 text-[13px] font-medium text-ink hover:bg-surface-2"
                >
                  Public keys
                </a>
              </div>
            </div>
            <dl className="mt-4 divide-y divide-line text-[13.5px]">
              {details.map(([label, value]) => (
                <div key={label} className="grid gap-1 py-2.5 sm:grid-cols-[150px_1fr] sm:gap-4">
                  <dt className="text-muted">{label}</dt>
                  <dd className="min-w-0 text-ink-2">{value}</dd>
                </div>
              ))}
            </dl>
          </Card>

          <Card className="bg-surface-2 p-6">
            <h2 className="text-sm font-semibold text-ink">What this receipt proves</h2>
            <p className="mt-2 text-[14px] leading-relaxed text-ink-2">
              It proves what was authorised at that point in time — which service, which data, which purpose, for how
              long, under exactly which version of your rules. The payload is serialised canonically, hashed with
              SHA-256 and signed with ConsentOS&apos;s Ed25519 key. Changing any field, even one character, breaks the
              signature. Revoking a grant never rewrites the receipt; it stops future use, and enforcement checks for
              that separately.
            </p>
          </Card>
        </div>

        <div className="space-y-6">
          <VerifyPanel receiptId={record.id} receipt={record.receipt} />

          <Card className="p-6">
            <h2 className="text-sm font-semibold text-ink">{statusTitle}</h2>
            <p className="mt-2 text-[13.5px] leading-relaxed text-muted">{statusBody}</p>
            {allowed && !record.revokedAt && (
              <div className="mt-4">
                <RevokeButton receiptId={record.id} label={purposeLabel(r.purpose)} size="md" />
              </div>
            )}
          </Card>

          {standing && (
            <Card className="p-6">
              <h2 className="text-sm font-semibold text-ink">{serviceName} — where things stand now</h2>
              <p className="mt-1 text-[12.5px] text-muted">Live, under your current rules.</p>
              <p className="mt-5 text-[11px] font-semibold tracking-[0.12em] text-allow uppercase">Allowed</p>
              {standing.grants.length > 0 ? (
                <ul className="mt-2 space-y-2">
                  {standing.grants.map((g) => (
                    <li key={g.receiptId} className="flex items-center gap-2 text-[14px] text-ink-2">
                      <CheckIcon className="text-allow" />
                      <Link href={`/receipts/${g.receiptId}`} className="hover:text-ink hover:underline">
                        {g.purposeLabel}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-[13px] text-muted">Nothing is currently granted.</p>
              )}
              <p className="mt-5 text-[11px] font-semibold tracking-[0.12em] text-block uppercase">Blocked</p>
              <ul className="mt-2 space-y-2">
                {standing.blocked.map((b) => (
                  <li key={b.purpose} className="flex items-center gap-2 text-[14px] text-ink-2">
                    <CrossIcon className="text-block" />
                    {b.receiptId ? (
                      <Link href={`/receipts/${b.receiptId}`} className="hover:text-ink hover:underline">
                        {b.purposeLabel}
                      </Link>
                    ) : (
                      b.purposeLabel
                    )}
                    {b.source === "request" && <span className="text-[11.5px] text-muted">· attempted</span>}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

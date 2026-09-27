import { dataTypeNoun, purposeActivity, purposeLabel } from "@consentos/policy-engine";
import type { Metadata } from "next";
import Link from "next/link";
import { ServiceAvatar } from "@/components/service-avatar";
import { Card, Eyebrow, StatusPill, type Status } from "@/components/ui";
import { formatDate, formatDateTime, formatRetention } from "@/lib/format";
import { requireSessionUser } from "@/server/auth";
import { listPendingRequests } from "@/server/consent";
import { asUser } from "@/server/db";
import { listReceipts, type ReceiptRecord } from "@/server/receipts";
import { ResolveButtons, RevokeButton } from "./receipt-actions";

export const metadata: Metadata = { title: "Receipts" };

const PIXLY_URL = process.env.NEXT_PUBLIC_PIXLY_URL ?? "http://localhost:3001";

function receiptStatus(r: ReceiptRecord): { status: Status; label: string } {
  if (r.decision === "DENY") return { status: "block", label: "Blocked" };
  if (r.revocationReason === "superseded") return { status: "neutral", label: "Replaced" };
  if (r.revokedAt) return { status: "revoked", label: "Revoked" };
  return { status: "allow", label: "Allowed" };
}

function ReceiptRow({ r, action }: { r: ReceiptRecord; action?: React.ReactNode }) {
  const { status, label } = receiptStatus(r);
  const retention = r.receipt.payload.request.retentionDays;
  return (
    <li className="group relative flex items-center gap-4 px-5 py-4 transition-colors hover:bg-surface-2 sm:px-6">
      <ServiceAvatar id={r.serviceId} name={r.serviceName ?? r.serviceId} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14.5px] font-medium text-ink">
          <Link href={`/receipts/${r.id}`} className="after:absolute after:inset-0 focus:outline-none">
            {r.serviceName} <span className="text-muted">·</span> {purposeLabel(r.purpose)}
          </Link>
        </p>
        <p className="mt-0.5 truncate text-[12.5px] text-muted">
          {dataTypeNoun(r.dataType)}
          {r.purpose !== "essential" && <> · {formatRetention(retention)}</>}
          {r.receipt.payload.request.thirdPartySharing && <> · shared with third parties</>}
        </p>
      </div>
      <div className="hidden text-right sm:block">
        <time dateTime={r.issuedAt} className="text-[12.5px] text-muted tabular" title={formatDateTime(r.issuedAt)}>
          {formatDate(r.issuedAt)}
        </time>
      </div>
      <StatusPill status={status}>{label}</StatusPill>
      {action && <div className="relative z-10">{action}</div>}
    </li>
  );
}

export default async function ReceiptsPage() {
  const user = await requireSessionUser("/receipts");
  const { receipts, pending } = await asUser(user.id, async (tx) => ({
    receipts: await listReceipts(tx, user.id, { limit: 200 }),
    pending: await listPendingRequests(tx, user.id),
  }));
  const active = receipts.filter((r) => r.decision === "ALLOW" && !r.revokedAt);

  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 sm:py-16">
      <Eyebrow>Consent receipts</Eyebrow>
      <h1 className="mt-3 text-4xl font-semibold tracking-tight text-ink sm:text-5xl">Receipts</h1>
      <p className="mt-4 max-w-2xl text-[15.5px] leading-relaxed text-ink-2">
        Every decision ConsentOS made for you, signed at the moment it was made. Allowed requests are live grants you
        can revoke at any time.
      </p>

      {pending.length > 0 && (
        <section aria-labelledby="pending" className="mt-12">
          <h2 id="pending" className="text-sm font-semibold text-ink">
            Needs your answer
          </h2>
          <p className="mt-1 text-[13px] text-muted">Your rules asked to check these with you first.</p>
          <Card className="mt-4 divide-y divide-line border-ask-line">
            {pending.map((p) => (
              <div key={p.requestId} className="flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:px-6">
                <ServiceAvatar id={p.serviceId} name={p.serviceName} />
                <div className="min-w-0 flex-1">
                  <p className="text-[14.5px] font-medium text-ink">
                    {p.serviceName} wants to use your {dataTypeNoun(p.dataType)} for {purposeActivity(p.purpose)}
                  </p>
                  <p className="mt-0.5 text-[12.5px] text-muted">
                    {formatRetention(p.retentionDays)} · {p.reason}
                  </p>
                </div>
                <ResolveButtons requestId={p.requestId} />
              </div>
            ))}
          </Card>
        </section>
      )}

      <section aria-labelledby="active" className="mt-12">
        <div className="flex items-baseline justify-between">
          <h2 id="active" className="text-sm font-semibold text-ink">
            Active grants
          </h2>
          <span className="text-[12.5px] text-muted tabular">{active.length}</span>
        </div>
        {active.length > 0 ? (
          <Card className="mt-4 overflow-hidden">
            <ul className="divide-y divide-line">
              {active.map((r) => (
                <ReceiptRow key={r.id} r={r} action={<RevokeButton receiptId={r.id} label={purposeLabel(r.purpose)} />} />
              ))}
            </ul>
          </Card>
        ) : (
          <p className="mt-4 rounded-2xl border border-dashed border-line-strong px-6 py-8 text-center text-[14px] text-muted">
            No service currently holds a grant to your data.
          </p>
        )}
      </section>

      <section aria-labelledby="history" className="mt-12">
        <div className="flex items-baseline justify-between">
          <h2 id="history" className="text-sm font-semibold text-ink">
            All decisions
          </h2>
          <span className="text-[12.5px] text-muted tabular">{receipts.length}</span>
        </div>
        {receipts.length > 0 ? (
          <Card className="mt-4 overflow-hidden">
            <ul className="divide-y divide-line">
              {receipts.map((r) => (
                <ReceiptRow key={r.id} r={r} />
              ))}
            </ul>
          </Card>
        ) : (
          <div className="mt-4 rounded-2xl border border-dashed border-line-strong px-6 py-12 text-center">
            <p className="text-[15px] font-medium text-ink">No receipts yet</p>
            <p className="mx-auto mt-2 max-w-sm text-[14px] leading-relaxed text-muted">
              When a service asks for permission, the decision and its signed receipt appear here.
            </p>
            <a
              href={PIXLY_URL}
              className="mt-5 inline-flex h-10 items-center rounded-full border border-line-strong bg-surface px-5 text-sm font-medium text-ink hover:bg-surface-2"
            >
              Try it with Pixly
            </a>
          </div>
        )}
      </section>
    </div>
  );
}

"use client";

import type { ReceiptVerification, SignedReceipt } from "@consentos/shared";
import clsx from "clsx";
import { useCallback, useEffect, useState } from "react";
import { Button, Card, CheckIcon, CrossIcon } from "@/components/ui";

type Result = { status: "loading" } | { status: "done"; result: ReceiptVerification } | { status: "error"; message: string };

const CHECKS: { key: keyof ReceiptVerification; ok: string; fail: string }[] = [
  { key: "signatureValid", ok: "Signature verified", fail: "Signature invalid" },
  { key: "policyHashValid", ok: "Policy hash verified", fail: "Policy hash mismatch" },
  { key: "requestHashValid", ok: "Request hash verified", fail: "Request hash mismatch" },
  { key: "payloadIntact", ok: "Payload unchanged", fail: "Payload was modified" },
];

function Checks({ result }: { result: Result }) {
  if (result.status === "loading") {
    return (
      <ul className="space-y-3" aria-busy="true" aria-label="Verifying">
        {CHECKS.map((c) => (
          <li key={c.key} className="flex items-center gap-3">
            <span className="skeleton size-5 rounded-full" />
            <span className="skeleton h-3.5 w-40" />
          </li>
        ))}
      </ul>
    );
  }
  if (result.status === "error") {
    return (
      <p role="alert" className="text-[13.5px] text-block">
        {result.message}
      </p>
    );
  }
  return (
    <ul className="space-y-2.5">
      {CHECKS.map((c) => {
        const ok = result.result[c.key] === true;
        return (
          <li key={c.key} className="flex items-center gap-3 text-[14px]">
            <span
              className={clsx(
                "grid size-5 place-items-center rounded-full",
                ok ? "bg-allow-bg text-allow" : "bg-block-bg text-block",
              )}
            >
              {ok ? <CheckIcon className="size-3.5" /> : <CrossIcon className="size-3.5" />}
            </span>
            <span className={ok ? "text-ink" : "text-block"}>{ok ? c.ok : c.fail}</span>
          </li>
        );
      })}
    </ul>
  );
}

type Tamper = { id: string; label: string; describe: (r: SignedReceipt) => string; apply: (r: SignedReceipt) => void };

const TAMPERS: Tamper[] = [
  {
    id: "retention",
    label: "Stretch retention to 10 years",
    describe: (r) => `request.retentionDays: ${r.payload.request.retentionDays} → 3650`,
    apply: (r) => {
      r.payload.request.retentionDays = 3650;
    },
  },
  {
    id: "purpose",
    label: "Relabel it as AI training",
    describe: (r) => `request.purpose: ${r.payload.request.purpose} → foundation_model_training`,
    apply: (r) => {
      r.payload.request.purpose = "foundation_model_training";
    },
  },
  {
    id: "decision",
    label: "Flip the decision",
    describe: (r) => `decision: ${r.payload.decision.decision} → ${r.payload.decision.decision === "ALLOW" ? "DENY" : "ALLOW"}`,
    apply: (r) => {
      r.payload.decision.decision = r.payload.decision.decision === "ALLOW" ? "DENY" : "ALLOW";
    },
  },
];

export function VerifyPanel({ receiptId, receipt }: { receiptId: string; receipt: SignedReceipt }) {
  const [result, setResult] = useState<Result>({ status: "loading" });
  const [tamper, setTamper] = useState<{ tamper: Tamper; result: Result } | null>(null);

  const verify = useCallback(async (): Promise<Result> => {
    try {
      const res = await fetch(`/api/v1/receipts/${receiptId}/verify`, { cache: "no-store" });
      if (!res.ok) throw new Error(`Verification service returned ${res.status}`);
      return { status: "done", result: (await res.json()) as ReceiptVerification };
    } catch {
      return { status: "error", message: "Could not reach the verification endpoint. Try again." };
    }
  }, [receiptId]);

  useEffect(() => {
    let cancelled = false;
    void verify().then((next) => {
      if (!cancelled) setResult(next);
    });
    return () => {
      cancelled = true;
    };
  }, [verify]);

  const tryTamper = async (t: Tamper) => {
    setTamper({ tamper: t, result: { status: "loading" } });
    const forged = structuredClone(receipt);
    t.apply(forged);
    try {
      const res = await fetch("/api/v1/receipts/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(forged),
      });
      if (!res.ok) throw new Error();
      setTamper({ tamper: t, result: { status: "done", result: (await res.json()) as ReceiptVerification } });
    } catch {
      setTamper({ tamper: t, result: { status: "error", message: "Could not run the tamper check." } });
    }
  };

  const valid = result.status === "done" && result.result.valid;

  return (
    <Card className="overflow-hidden">
      <div className="p-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-ink">Integrity</h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setResult({ status: "loading" });
              void verify().then(setResult);
            }}
            disabled={result.status === "loading"}
          >
            Re-verify
          </Button>
        </div>
        <p
          className={clsx(
            "mt-3 text-2xl font-semibold tracking-tight",
            result.status === "loading" ? "text-muted" : valid ? "text-allow" : "text-block",
          )}
          aria-live="polite"
        >
          {result.status === "loading" ? "Verifying…" : valid ? "Verified" : "Verification failed"}
        </p>
        <div className="mt-4">
          <Checks result={result} />
        </div>
        {result.status === "done" && (
          <p className="mt-4 text-[12px] text-muted">
            Checked live against <span className="font-mono">GET /api/v1/receipts/…/verify</span>
            {result.result.revoked && " · the grant is revoked, but the record itself is intact"}
          </p>
        )}
      </div>

      <div className="border-t border-line bg-surface-2 p-6">
        <h3 className="text-[13px] font-semibold text-ink">See tamper detection</h3>
        <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
          Edit a copy of this receipt the way a dishonest service might, then verify the copy.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {TAMPERS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => void tryTamper(t)}
              className={clsx(
                "rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition-colors",
                tamper?.tamper.id === t.id
                  ? "border-block-line bg-block-bg text-block"
                  : "border-line-strong bg-surface text-ink-2 hover:text-ink",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        {tamper && (
          <div className="mt-4 rounded-xl border border-line bg-surface p-4" aria-live="polite">
            <p className="font-mono text-[11.5px] text-muted">{tamper.tamper.describe(receipt)}</p>
            <div className="mt-3">
              <Checks result={tamper.result} />
            </div>
            {tamper.result.status === "done" && !tamper.result.result.valid && (
              <p className="mt-3 text-[12.5px] text-ink-2">
                One changed field and the copy no longer verifies. Even if the forger recomputes the hashes, they
                cannot produce ConsentOS&apos;s signature.
              </p>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

export function DownloadReceipt({ receipt }: { receipt: SignedReceipt }) {
  return (
    <button
      type="button"
      onClick={() => {
        const blob = new Blob([JSON.stringify(receipt, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `consent-receipt-${receipt.payload.receiptId}.json`;
        a.click();
        URL.revokeObjectURL(url);
      }}
      className="inline-flex h-8 items-center rounded-full border border-line-strong px-3.5 text-[13px] font-medium text-ink hover:bg-surface-2"
    >
      Download JSON
    </button>
  );
}

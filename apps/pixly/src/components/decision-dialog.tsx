"use client";

import type { EvaluateResponse } from "@consentos/sdk";
import { useEffect, useRef } from "react";
import { FEATURES, type FeatureId } from "@/lib/features";
import { BlockedShieldIcon, ClockIcon, ShieldIcon } from "./icons";

const RULE_WORD: Record<string, string> = { allow: "ALLOW", deny: "BLOCK", ask: "ASK", allow_anonymized_only: "ANONYMOUS ONLY" };

/**
 * The decision spelled out from ConsentOS's own response: which purpose was
 * requested, what the user's rule says, and the resulting decision.
 */
function Explanation({ result, purpose }: { result: EvaluateResponse; purpose: string }) {
  const value = result.details?.ruleValue;
  const rule = typeof value === "number" ? `${value}-day limit` : value !== undefined ? (RULE_WORD[value] ?? value) : null;
  return (
    <dl className="mt-5 divide-y divide-line overflow-hidden rounded-2xl border border-line text-[14px]">
      <div className="flex items-center justify-between gap-4 px-4 py-2.5">
        <dt className="text-muted">Purpose requested</dt>
        <dd className="text-right font-medium">{purpose}</dd>
      </div>
      {rule && (
        <div className="flex items-center justify-between gap-4 px-4 py-2.5">
          <dt className="text-muted">Your ConsentOS rule</dt>
          <dd className="font-semibold tracking-wide text-block">{rule}</dd>
        </div>
      )}
      <div className="flex items-center justify-between gap-4 bg-block-bg/60 px-4 py-2.5">
        <dt className="text-muted">Decision</dt>
        <dd className="font-semibold tracking-wide text-block">{result.decision}</dd>
      </div>
    </dl>
  );
}

export type DialogState =
  | { kind: "blocked"; feature: FeatureId; result: EvaluateResponse }
  | { kind: "waiting"; feature: FeatureId; result: EvaluateResponse };

export interface Attempt {
  status: "running" | "done";
  httpStatus?: number;
  body?: { error?: string; message?: string };
}

export function DecisionDialog({
  state,
  onClose,
  consentosUrl,
  attempt,
  onTryAnyway,
}: {
  state: DialogState | null;
  onClose: () => void;
  consentosUrl: string;
  /** The server-side attempt to run the blocked job anyway, if the user asked for one. */
  attempt: Attempt | null;
  onTryAnyway?: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (state && !dialog.open) dialog.showModal();
    if (!state && dialog.open) dialog.close();
  }, [state]);

  const feature = state ? FEATURES[state.feature] : null;
  const result = state?.result;
  const retention = result?.reasonCode === "RETENTION_EXCEEDS_LIMIT" ? result.details : undefined;

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      aria-labelledby="decision-title"
      className="m-auto w-[min(440px,calc(100vw-32px))] rounded-3xl border border-line bg-surface p-0 text-ink shadow-2xl backdrop:bg-transparent open:animate-pop"
    >
      {state?.kind === "blocked" && feature && result && (
        <div className="p-7">
          <BlockedShieldIcon className="size-12 text-block" />
          <p className="mt-5 text-[12px] font-semibold tracking-[0.12em] text-block uppercase">Blocked by ConsentOS</p>
          <h2 id="decision-title" className="mt-2 text-2xl font-semibold tracking-tight">
            ConsentOS blocked this action.
          </h2>
          <p className="mt-3 text-[15px] leading-relaxed text-ink-2">{feature.blocked}</p>

          {retention?.requestedRetentionDays !== undefined && retention.maxRetentionDays !== undefined ? (
            <dl className="mt-5 grid grid-cols-2 overflow-hidden rounded-2xl border border-line text-center">
              <div className="border-r border-line bg-block-bg/60 px-4 py-3">
                <dt className="text-[12px] text-muted">Requested retention</dt>
                <dd className="mt-0.5 text-xl font-semibold text-block tabular-nums">{retention.requestedRetentionDays} days</dd>
              </div>
              <div className="px-4 py-3">
                <dt className="text-[12px] text-muted">Your limit</dt>
                <dd className="mt-0.5 text-xl font-semibold tabular-nums">{retention.maxRetentionDays} days</dd>
              </div>
            </dl>
          ) : (
            <Explanation result={result} purpose={feature.purposeLabel} />
          )}

          {onTryAnyway && state.feature === "training" ? (
            <div className="mt-5 rounded-2xl border border-line bg-bg p-4" aria-live="polite">
              {!attempt ? (
                <>
                  <p className="text-[13px] leading-relaxed text-ink-2">
                    What if Pixly&apos;s server ignores this and starts training anyway?
                  </p>
                  <button
                    type="button"
                    onClick={onTryAnyway}
                    className="mt-3 inline-flex h-9 items-center rounded-full border border-line-strong bg-surface px-4 text-[13px] font-medium hover:border-ink"
                  >
                    Run the training job anyway
                  </button>
                </>
              ) : attempt.status === "running" ? (
                <p className="flex items-center gap-2 text-[13px] text-muted">
                  <span className="spinner" aria-hidden="true" /> POST /api/train-model…
                </p>
              ) : (
                <>
                  <p className="font-mono text-[12px] text-muted">POST /api/train-model</p>
                  <p className="mt-1 font-mono text-[15px] font-semibold text-block">
                    HTTP {attempt.httpStatus} {attempt.httpStatus === 403 ? "Forbidden" : ""}
                  </p>
                  <p className="mt-1 font-mono text-[12.5px] text-ink">{attempt.body?.error}</p>
                  <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{attempt.body?.message}</p>
                  <p className="mt-2 text-[12px] text-muted">
                    Pixly&apos;s training pipeline asked ConsentOS for a grant before touching a photo. There is none, so it
                    refused to run.
                  </p>
                </>
              )}
            </div>
          ) : (
            <p className="mt-5 text-[12.5px] leading-relaxed text-muted">
              Pixly didn&apos;t make this call — your ConsentOS rules did, and Pixly&apos;s servers are bound by them. The
              decision is recorded in a signed receipt.
            </p>
          )}

          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span className="font-mono text-[11.5px] text-muted">{result.reasonCode}</span>
            <div className="flex gap-2">
              {result.receiptUrl && (
                <a
                  href={result.receiptUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-10 items-center rounded-full border border-line-strong px-4 text-[14px] font-medium hover:bg-bg"
                >
                  View receipt
                </a>
              )}
              <button
                type="button"
                onClick={onClose}
                autoFocus
                className="inline-flex h-10 items-center rounded-full bg-ink px-5 text-[14px] font-medium text-white hover:bg-ink-2"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {state?.kind === "waiting" && feature && result && (
        <div className="p-7">
          <span className="grid size-12 place-items-center rounded-2xl bg-ask-bg text-ask">
            <ClockIcon className="size-6" />
          </span>
          <p className="mt-5 text-[12px] font-semibold tracking-[0.12em] text-ask uppercase">Needs your answer</p>
          <h2 id="decision-title" className="mt-2 text-2xl font-semibold tracking-tight">
            Your rules want to check with you.
          </h2>
          <p className="mt-3 text-[15px] leading-relaxed text-ink-2">
            Pixly asked to use your photos for {feature.activity}. {result.reason}
          </p>
          <p className="mt-4 flex items-center gap-2.5 rounded-2xl bg-bg px-4 py-3 text-[13.5px] text-ink-2" role="status">
            <span className="spinner text-ask" aria-hidden="true" />
            Waiting for your answer in the ConsentOS extension or on your receipts page…
          </p>
          <div className="mt-6 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-10 items-center rounded-full px-4 text-[14px] font-medium text-muted hover:text-ink"
            >
              Not now
            </button>
            <a
              href={`${consentosUrl}/receipts`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-10 items-center gap-2 rounded-full bg-ink px-5 text-[14px] font-medium text-white hover:bg-ink-2"
            >
              <ShieldIcon /> Answer in ConsentOS
            </a>
          </div>
        </div>
      )}
    </dialog>
  );
}

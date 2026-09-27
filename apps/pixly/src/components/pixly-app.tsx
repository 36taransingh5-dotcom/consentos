"use client";

import type { ConsentRequestStatus, EvaluateResponse } from "@consentos/sdk";
import { announceService, notifyDecision } from "@consentos/sdk/browser";
import clsx from "clsx";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ConsentRouteResponse } from "@/app/api/consent/route";
import type { PixlyState } from "@/app/api/state/route";
import type { Exchange } from "@/lib/consentos";
import { FEATURES, OPTIONAL_FEATURES, type FeatureId } from "@/lib/features";
import { DISCOVER, LIBRARY, type Photo } from "@/lib/photos";
import { DecisionDialog, type Attempt, type DialogState } from "./decision-dialog";
import { CheckIcon, ClockIcon, CpuIcon, CrossIcon, HeartIcon, PixlyMark, ShieldIcon, SparkIcon, UploadIcon } from "./icons";
import { Inspector } from "./inspector";
import { Scene } from "./scene";
import type { HttpResult, LogEntry } from "./types";

type Toast = { tone: "success" | "error" | "info"; title: string; body?: string; receiptUrl?: string | null };
type Recs =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; items: Photo[] }
  | { status: "blocked"; code: string; message: string };

const FEATURE_ICON: Record<FeatureId, typeof SparkIcon> = {
  essential: ShieldIcon,
  recommendations: SparkIcon,
  memories: ClockIcon,
  training: CpuIcon,
};

function decodeTrace(header: string | null): Exchange[] {
  if (!header) return [];
  try {
    const json = atob(header.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(json, (c) => c.charCodeAt(0)))) as Exchange[];
  } catch {
    return [];
  }
}

export function PixlyApp({ consentosUrl }: { consentosUrl: string }) {
  const [state, setState] = useState<PixlyState | null>(null);
  const [stateError, setStateError] = useState(false);
  const [decisions, setDecisions] = useState<Partial<Record<FeatureId, EvaluateResponse>>>({});
  const [busy, setBusy] = useState<FeatureId | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [recs, setRecs] = useState<Recs>({ status: "idle" });
  const [uploads, setUploads] = useState<Photo[]>([]);
  const [liked, setLiked] = useState<Set<string>>(() => new Set());
  const [enforcement, setEnforcement] = useState<{ label: string; result: HttpResult } | null>(null);
  const [enforcing, setEnforcing] = useState(false);
  const [resetting, setResetting] = useState(false);
  const essentialRequested = useRef(false);
  const askRef = useRef<((feature: FeatureId, silent?: boolean) => Promise<void>) | null>(null);
  const waitingFor = useRef<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const addLog = useCallback((exchanges: Exchange[], label: string, hop: LogEntry["hop"] = "pixly → consentos") => {
    if (exchanges.length === 0) return;
    setLog((current) => [...exchanges.map((e) => ({ ...e, label, hop })).reverse(), ...current].slice(0, 60));
  }, []);

  const loadState = useCallback(async (): Promise<PixlyState | null> => {
    try {
      const res = await fetch("/api/state", { cache: "no-store" });
      if (!res.ok) throw new Error();
      return (await res.json()) as PixlyState;
    } catch {
      return null;
    }
  }, []);

  const refreshState = useCallback(async () => {
    const next = await loadState();
    setStateError(next === null || !next.consentosReachable);
    if (next) setState(next);
    return next;
  }, [loadState]);

  // Declare Pixly to the ConsentOS extension, then keep feature state in sync with ConsentOS.
  useEffect(() => {
    announceService({ serviceId: "pixly", name: "Pixly" });
    let cancelled = false;
    const tick = () =>
      void loadState().then((next) => {
        if (cancelled) return;
        setStateError(next === null || !next.consentosReachable);
        if (next) setState(next);
        // Pixly needs essential account storage before anything else — ask once.
        if (next?.consentosReachable && !essentialRequested.current) {
          essentialRequested.current = true;
          if (next.features.essential.status === "none") void askRef.current?.("essential", true);
        }
      });
    tick();
    const interval = window.setInterval(tick, 4000);
    window.addEventListener("focus", tick);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", tick);
    };
  }, [loadState]);

  // Auto-dismiss toasts.
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 6000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const recsStatus = state?.features.recommendations.status;
  const recsGrant = state?.features.recommendations.receiptId ?? null;

  // Recommendations are served by a consent-protected endpoint.
  useEffect(() => {
    if (recsStatus !== "active") return;
    let cancelled = false;
    void fetch("/api/recommendations", { cache: "no-store" }).then(async (res) => {
      const body = (await res.json().catch(() => ({}))) as { items?: Photo[]; error?: string; message?: string };
      if (cancelled) return;
      setRecs(
        res.ok && body.items
          ? { status: "ready", items: body.items }
          : { status: "blocked", code: body.error ?? `HTTP_${res.status}`, message: body.message ?? "Recommendations are unavailable." },
      );
      addLog(decodeTrace(res.headers.get("x-pixly-consentos-trace")), "Load recommendations");
    });
    return () => {
      cancelled = true;
    };
  }, [recsStatus, recsGrant, addLog]);

  const callTraining = useCallback(
    async (grantId: string | null, label: string): Promise<HttpResult> => {
      const started = performance.now();
      const body = grantId ? { grantId } : {};
      const res = await fetch("/api/train-model", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => null)) as unknown;
      const trace = decodeTrace(res.headers.get("x-pixly-consentos-trace"));
      addLog(trace, label);
      addLog(
        [
          {
            id: crypto.randomUUID(),
            at: new Date().toISOString(),
            method: "POST",
            path: "/api/train-model",
            status: res.status,
            durationMs: Math.round(performance.now() - started),
            request: body,
            response: json,
          },
        ],
        label,
        "browser → pixly",
      );
      return { status: res.status, statusText: res.statusText || (res.status === 403 ? "Forbidden" : ""), body: json };
    },
    [addLog],
  );

  const handleOutcome = useCallback(
    async (feature: FeatureId, decision: "ALLOW" | "DENY", result: EvaluateResponse, silent = false) => {
      if (decision === "ALLOW") {
        setDialog(null);
        if (feature === "training") {
          const run = await callTraining(result.receiptId, "Start training");
          setToast({
            tone: run.status < 300 ? "success" : "error",
            title: run.status < 300 ? "ConsentOS approved this request" : "Training refused",
            body: run.status < 300 ? FEATURES.training.allowed : String((run.body as { message?: string })?.message ?? ""),
            receiptUrl: result.receiptUrl,
          });
        } else if (!silent) {
          setToast({ tone: "success", title: "ConsentOS approved this request", body: FEATURES[feature].allowed, receiptUrl: result.receiptUrl });
        }
      } else {
        setAttempt(null);
        setDialog({ kind: "blocked", feature, result });
      }
      await refreshState();
    },
    [callTraining, refreshState],
  );

  const waitForAnswer = useCallback(
    async (feature: FeatureId, result: EvaluateResponse) => {
      waitingFor.current = result.requestId;
      const deadline = Date.now() + 3 * 60_000;
      while (waitingFor.current === result.requestId && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 2000));
        if (waitingFor.current !== result.requestId) return;
        const res = await fetch(`/api/consent/status?requestId=${result.requestId}&feature=${feature}`, { cache: "no-store" });
        const body = (await res.json().catch(() => ({}))) as { status?: ConsentRequestStatus; exchanges?: Exchange[] };
        const status = body.status;
        if (!status || status.status === "pending") continue;
        addLog(body.exchanges ?? [], `${FEATURES[feature].title} · your answer`);
        waitingFor.current = null;
        const resolved: EvaluateResponse = {
          ...result,
          decision: status.decision,
          reasonCode: status.reasonCode as EvaluateResponse["reasonCode"],
          reason: status.reason,
          receiptId: status.receiptId,
          receiptUrl: status.receiptId ? `${consentosUrl}/receipts/${status.receiptId}` : null,
        };
        setDecisions((d) => ({ ...d, [feature]: resolved }));
        await handleOutcome(feature, status.decision === "ALLOW" ? "ALLOW" : "DENY", resolved);
        return;
      }
    },
    [addLog, consentosUrl, handleOutcome],
  );

  const ask = useCallback(
    async (feature: FeatureId, silent = false) => {
      setBusy(feature);
      try {
        const res = await fetch("/api/consent", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ feature }),
        });
        const data = (await res.json()) as ConsentRouteResponse;
        addLog(data.exchanges ?? [], FEATURES[feature].cta);
        if (!data.result) {
          setToast({ tone: "error", title: "Couldn't reach ConsentOS", body: data.error?.message ?? "Try again in a moment." });
          return;
        }
        const result = data.result;
        notifyDecision({ requestId: result.requestId });
        setDecisions((d) => ({ ...d, [feature]: result }));
        if (result.decision === "REQUIRE_USER") {
          setDialog({ kind: "waiting", feature, result });
          void waitForAnswer(feature, result);
          await refreshState();
        } else {
          await handleOutcome(feature, result.decision, result, silent);
        }
      } catch {
        setToast({ tone: "error", title: "Something went wrong", body: "Pixly couldn't complete that request." });
      } finally {
        setBusy(null);
      }
    },
    [addLog, handleOutcome, refreshState, waitForAnswer],
  );

  useEffect(() => {
    askRef.current = ask;
  }, [ask]);

  const enforce = async (mode: "held" | "none" | "borrowed") => {
    setEnforcing(true);
    try {
      const grant =
        mode === "borrowed" ? recsGrant : mode === "held" ? (state?.features.training.receiptId ?? null) : null;
      const label =
        mode === "borrowed"
          ? "Train with the recommendations grant"
          : grant
            ? "Train with Pixly's AI-training grant"
            : "Train without a grant";
      setEnforcement({ label, result: await callTraining(grant, label) });
    } finally {
      setEnforcing(false);
    }
  };

  const reset = async () => {
    if (!window.confirm("Reset the demo? This restores the default ConsentOS rules and clears every grant and receipt.")) return;
    setResetting(true);
    try {
      const res = await fetch("/api/demo/reset", { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        setToast({ tone: "error", title: "Reset failed", body: body.message });
        return;
      }
      waitingFor.current = null;
      setDecisions({});
      setLog([]);
      setRecs({ status: "idle" });
      setEnforcement(null);
      setDialog(null);
      essentialRequested.current = false;
      await refreshState();
      setToast({ tone: "info", title: "Demo reset", body: "Default rules restored. Pixly holds no grants." });
    } finally {
      setResetting(false);
    }
  };

  const onUpload = (files: FileList | null) => {
    if (!files) return;
    const added: Photo[] = [...files]
      .filter((f) => f.type.startsWith("image/"))
      .slice(0, 6)
      .map((f, i) => ({
        id: `u-${Date.now()}-${i}`,
        seed: 0,
        caption: f.name.replace(/\.[^.]+$/, ""),
        place: "Uploaded just now",
        likes: 0,
        src: URL.createObjectURL(f),
      }));
    if (added.length > 0) setUploads((u) => [...added, ...u]);
  };

  const photos = [...uploads, ...LIBRARY];
  const features = state?.features;

  return (
    <div className="pb-24">
      <header className="sticky top-0 z-20 border-b border-line bg-bg/90 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2 rounded-lg" aria-label="Pixly home">
            <PixlyMark className="size-8" />
            <span className="text-[19px] font-bold tracking-tight">Pixly</span>
          </Link>
          <a
            href={consentosUrl}
            target="_blank"
            rel="noreferrer"
            className="ml-auto hidden items-center gap-1.5 rounded-full border border-allow-line bg-allow-bg px-3 py-1.5 text-[12.5px] font-medium text-allow sm:inline-flex"
          >
            <ShieldIcon /> Protected by ConsentOS
          </a>
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            className="ml-auto inline-flex h-9 items-center gap-2 rounded-full bg-coral px-4 text-[14px] font-semibold text-white hover:bg-coral-ink sm:ml-0"
          >
            <UploadIcon /> Upload
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            multiple
            className="sr-only"
            aria-label="Upload photos"
            onChange={(e) => {
              onUpload(e.target.files);
              e.target.value = "";
            }}
          />
          <span
            className="grid size-9 place-items-center rounded-full bg-[#2f2b3a] text-[13px] font-semibold text-white"
            title="Signed in as Alex Morgan"
          >
            AM
          </span>
        </div>
      </header>

      {stateError && (
        <div role="alert" className="border-b border-block-line bg-block-bg px-4 py-2.5 text-center text-[13px] text-block">
          Pixly can&apos;t reach ConsentOS right now. Features that need your data stay off until it&apos;s back.
        </div>
      )}

      <main className="mx-auto grid max-w-6xl gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:py-10">
        <div className="order-2 min-w-0 lg:order-1">
          <div>
            <p className="text-[13px] font-medium text-coral">Welcome back</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight sm:text-4xl">Good to see you, Alex.</h1>
            <p className="mt-2 text-[15px] text-muted">
              {photos.length} photos in your library{uploads.length > 0 ? " · uploaded just now" : ""}
            </p>
          </div>

          {recsStatus === "active" && (
            <section aria-labelledby="picked" className="mt-8">
              <div className="flex items-baseline justify-between">
                <h2 id="picked" className="flex items-center gap-2 text-[17px] font-semibold">
                  <SparkIcon className="text-coral" /> Picked for you
                </h2>
                <span className="text-[12.5px] text-muted">Based on your uploads</span>
              </div>
              {recs.status === "ready" ? (
                <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {recs.items.map((p) => (
                    <li key={p.id} className="overflow-hidden rounded-2xl border border-line bg-surface">
                      <Scene seed={p.seed} className="aspect-[4/5] w-full" label={p.caption} />
                      <div className="px-3 py-2">
                        <p className="line-clamp-2 text-[13px] leading-snug font-medium">{p.caption}</p>
                        <p className="truncate text-[12px] text-muted">{p.author}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : recs.status === "blocked" ? (
                <p className="mt-4 rounded-2xl border border-block-line bg-block-bg px-4 py-3 text-[13.5px] text-block">
                  {recs.message}
                </p>
              ) : (
                <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4" aria-busy="true" aria-label="Loading recommendations">
                  {DISCOVER.map((p) => (
                    <li key={p.id} className="aspect-[4/5] animate-pulse rounded-2xl bg-line" />
                  ))}
                </ul>
              )}
            </section>
          )}

          {recsStatus === "revoked" && (
            <section className="mt-8 rounded-2xl border border-line bg-surface p-5">
              <h2 className="flex items-center gap-2 text-[15px] font-semibold">
                <CrossIcon className="text-block" /> Recommendations paused
              </h2>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted">
                You withdrew Pixly&apos;s permission in ConsentOS, so our servers can no longer personalise your feed.
                <span className="mt-1 block font-mono text-[11.5px] text-block">grant status: CONSENT_REVOKED</span>
              </p>
            </section>
          )}

          <section aria-labelledby="library" className="mt-10">
            <h2 id="library" className="text-[17px] font-semibold">
              Your photos
            </h2>
            <ul className="mt-4 grid grid-cols-2 gap-4 xl:grid-cols-3">
              {photos.map((p) => {
                const isLiked = liked.has(p.id);
                return (
                  <li key={p.id} className="group overflow-hidden rounded-2xl border border-line bg-surface">
                    {p.src ? (
                      // eslint-disable-next-line @next/next/no-img-element -- local object URL from the file picker
                      <img src={p.src} alt={p.caption} className="aspect-square w-full object-cover" />
                    ) : (
                      <Scene seed={p.seed} className="aspect-square w-full" label={p.caption} />
                    )}
                    <div className="flex items-start gap-2 px-3.5 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="line-clamp-2 text-[14px] leading-snug font-medium">{p.caption}</p>
                        <p className="truncate text-[12.5px] text-muted">{p.place}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setLiked((s) => {
                            const next = new Set(s);
                            if (next.has(p.id)) next.delete(p.id);
                            else next.add(p.id);
                            return next;
                          })
                        }
                        aria-pressed={isLiked}
                        aria-label={`${isLiked ? "Unlike" : "Like"} ${p.caption}`}
                        className={clsx(
                          "inline-flex items-center gap-1 rounded-full px-2 py-1 text-[12.5px] tabular-nums transition-colors",
                          isLiked ? "text-coral" : "text-muted hover:text-ink",
                        )}
                      >
                        <HeartIcon filled={isLiked} />
                        {p.likes + (isLiked ? 1 : 0)}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>

        <aside className="order-1 space-y-5 lg:order-2" aria-label="Pixly features">
          <div className="rounded-3xl border border-line bg-surface p-5">
            <p className="text-[12px] font-semibold tracking-[0.12em] text-coral uppercase">Pixly Labs</p>
            <h2 className="mt-1 text-[19px] font-semibold tracking-tight">Make Pixly smarter</h2>
            <p className="mt-1 text-[13px] leading-relaxed text-muted">
              Each feature asks your ConsentOS rules before it touches your photos.
            </p>
            <ul className="mt-5 space-y-3">
              {OPTIONAL_FEATURES.map((id) => {
                const feature = FEATURES[id];
                const Icon = FEATURE_ICON[id];
                const status = features?.[id].status ?? "none";
                const last = decisions[id];
                const blocked = status === "none" && last?.decision === "DENY";
                const waiting = status === "none" && last?.decision === "REQUIRE_USER";
                const isBusy = busy === id;
                return (
                  <li key={id} className="rounded-2xl border border-line p-4">
                    <div className="flex items-start gap-3">
                      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-coral-soft text-coral">
                        <Icon />
                      </span>
                      <div className="min-w-0">
                        <h3 className="text-[14.5px] font-semibold">{feature.title}</h3>
                        <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{feature.blurb}</p>
                      </div>
                    </div>

                    <div className="mt-3.5 flex flex-wrap items-center gap-2">
                      {status === "active" ? (
                        <>
                          <span className="inline-flex items-center gap-1.5 rounded-full border border-allow-line bg-allow-bg px-2.5 py-1 text-[12px] font-semibold text-allow">
                            <CheckIcon className="size-3.5" /> On · approved by ConsentOS
                          </span>
                          {features?.[id].receiptId && (
                            <a
                              href={`${consentosUrl}/receipts/${features[id].receiptId}`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-[12.5px] font-medium text-muted underline decoration-line-strong underline-offset-4 hover:text-ink"
                            >
                              Receipt
                            </a>
                          )}
                        </>
                      ) : status === "revoked" ? (
                        <>
                          <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-bg px-2.5 py-1 text-[12px] font-semibold text-muted">
                            Permission revoked
                          </span>
                          <button
                            type="button"
                            onClick={() => void ask(id)}
                            disabled={isBusy}
                            className="text-[12.5px] font-medium text-ink underline decoration-line-strong underline-offset-4"
                          >
                            Ask again
                          </button>
                        </>
                      ) : blocked ? (
                        <>
                          <span className="inline-flex items-center gap-1.5 rounded-full border border-block-line bg-block-bg px-2.5 py-1 text-[12px] font-semibold text-block">
                            <CrossIcon className="size-3.5" /> Blocked by ConsentOS
                          </span>
                          <button
                            type="button"
                            onClick={() => void ask(id)}
                            disabled={isBusy}
                            className="text-[12.5px] font-medium text-muted underline decoration-line-strong underline-offset-4 hover:text-ink disabled:opacity-50"
                          >
                            {isBusy ? "Asking…" : "Ask again"}
                          </button>
                        </>
                      ) : waiting ? (
                        <span className="inline-flex items-center gap-2 rounded-full border border-ask-line bg-ask-bg px-2.5 py-1 text-[12px] font-semibold text-ask">
                          <span className="spinner" aria-hidden="true" /> Waiting for your answer
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void ask(id)}
                          disabled={isBusy || !state}
                          className="inline-flex h-9 items-center gap-2 rounded-full bg-ink px-4 text-[13.5px] font-medium text-white hover:bg-ink-2 disabled:opacity-60"
                        >
                          {isBusy && <span className="spinner" aria-hidden="true" />}
                          {isBusy ? "Asking ConsentOS…" : feature.cta}
                        </button>
                      )}
                    </div>
                    {blocked && last && <p className="mt-2 text-[12px] leading-relaxed text-muted">{last.reason}</p>}
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="rounded-3xl border border-line bg-surface p-5">
            <h2 className="flex items-center gap-2 text-[14.5px] font-semibold">
              <ShieldIcon className="text-allow" /> Your privacy on Pixly
            </h2>
            <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
              Pixly never decides what it may do with your data. It asks your ConsentOS rules, and its servers refuse to
              run anything you haven&apos;t allowed.
            </p>
            <p className="mt-3 text-[12.5px] text-muted">
              Account storage:{" "}
              <span className={features?.essential.status === "active" ? "font-medium text-allow" : "text-muted"}>
                {features?.essential.status === "active" ? "allowed" : state ? "not yet granted" : "checking…"}
              </span>
            </p>
            <a
              href={`${consentosUrl}/policy`}
              target="_blank"
              rel="noreferrer"
              className="mt-4 inline-flex h-9 items-center rounded-full border border-line-strong px-4 text-[13px] font-medium hover:bg-bg"
            >
              Manage my rules in ConsentOS
            </a>
          </div>
        </aside>
      </main>

      {toast && (
        <div
          role="status"
          className="fixed bottom-16 left-4 z-40 w-[min(380px,calc(100vw-32px))] animate-pop rounded-2xl border border-line bg-surface p-4 shadow-xl sm:left-6"
        >
          <div className="flex gap-3">
            <span
              className={clsx(
                "grid size-8 shrink-0 place-items-center rounded-full",
                toast.tone === "success" && "bg-allow-bg text-allow",
                toast.tone === "error" && "bg-block-bg text-block",
                toast.tone === "info" && "bg-bg text-ink",
              )}
            >
              {toast.tone === "error" ? <CrossIcon /> : <CheckIcon />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-semibold">{toast.title}</p>
              {toast.body && <p className="mt-0.5 text-[13px] text-muted">{toast.body}</p>}
              {toast.receiptUrl && (
                <a
                  href={toast.receiptUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-block text-[12.5px] font-medium text-ink underline decoration-line-strong underline-offset-4"
                >
                  View signed receipt
                </a>
              )}
            </div>
            <button type="button" onClick={() => setToast(null)} aria-label="Dismiss" className="self-start text-muted hover:text-ink">
              <CrossIcon />
            </button>
          </div>
        </div>
      )}

      <DecisionDialog
        state={dialog}
        consentosUrl={consentosUrl}
        attempt={attempt}
        onTryAnyway={() => {
          setAttempt({ status: "running" });
          void callTraining(state?.features.training.receiptId ?? null, "Train anyway").then((result) =>
            setAttempt({
              status: "done",
              httpStatus: result.status,
              body: result.body as Attempt["body"],
            }),
          );
        }}
        onClose={() => {
          waitingFor.current = null;
          setDialog(null);
          setAttempt(null);
        }}
      />

      <Inspector
        log={log}
        hasTrainingGrant={features?.training.status === "active"}
        recommendationsGrant={recsStatus === "active" ? recsGrant : null}
        enforcement={enforcement}
        enforcing={enforcing}
        onEnforce={(mode) => void enforce(mode)}
        onReset={() => void reset()}
        resetting={resetting}
      />
    </div>
  );
}

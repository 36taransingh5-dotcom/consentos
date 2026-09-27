"use client";

import clsx from "clsx";
import { useState } from "react";
import { TerminalIcon } from "./icons";
import type { HttpResult, LogEntry } from "./types";

function statusTone(status: number | null) {
  if (status === null) return "text-block";
  if (status >= 400) return "text-[#ff8b7e]";
  return "text-[#7fdca8]";
}

function decisionOf(entry: LogEntry): string | null {
  const r = entry.response as { decision?: string; authorized?: boolean; code?: string; error?: string } | undefined;
  if (!r) return null;
  if (r.decision) return r.decision;
  if (typeof r.authorized === "boolean") return r.authorized ? "GRANTED" : (r.code ?? "REFUSED");
  if (r.error) return r.error;
  return null;
}

function Json({ value }: { value: unknown }) {
  return (
    <pre className="overflow-x-auto rounded-xl bg-black/30 p-3 font-mono text-[11.5px] leading-relaxed text-[#e7e7ea]">
      {value === undefined ? "—" : JSON.stringify(value, null, 2)}
    </pre>
  );
}

export function Inspector({
  log,
  hasTrainingGrant,
  recommendationsGrant,
  enforcement,
  enforcing,
  onEnforce,
  onReset,
  resetting,
}: {
  log: LogEntry[];
  hasTrainingGrant: boolean;
  recommendationsGrant: string | null;
  enforcement: { label: string; result: HttpResult } | null;
  enforcing: boolean;
  onEnforce: (mode: "held" | "none" | "borrowed") => void;
  onReset: () => void;
  resetting: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"calls" | "enforcement">("calls");
  const [selected, setSelected] = useState<string | null>(null);
  const current = log.find((e) => e.id === selected) ?? log[0] ?? null;

  return (
    <section
      aria-label="ConsentOS protocol inspector"
      className={clsx(
        "fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-[#121116] text-[#e7e7ea] shadow-[0_-12px_40px_-20px_rgba(0,0,0,0.5)]",
      )}
    >
      <div className="mx-auto flex h-12 max-w-6xl items-center gap-3 px-4 sm:px-6">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls="inspector-body"
          className="flex min-w-0 flex-1 items-center gap-2.5 text-left text-[13px]"
        >
          <TerminalIcon className="text-[#9a96a3]" />
          <span className="font-medium">Protocol inspector</span>
          <span className="hidden truncate text-[#9a96a3] sm:inline">
            · what Pixly&apos;s servers send to ConsentOS · {log.length} call{log.length === 1 ? "" : "s"}
          </span>
          <span className="ml-auto text-[#9a96a3]" aria-hidden="true">
            {open ? "▾" : "▴"}
          </span>
        </button>
        <button
          type="button"
          onClick={onReset}
          disabled={resetting}
          className="shrink-0 rounded-full border border-white/15 px-3 py-1 text-[12px] text-[#c9c6d0] hover:bg-white/5 disabled:opacity-50"
        >
          {resetting ? "Resetting…" : "Reset demo"}
        </button>
      </div>

      {open && (
        <div id="inspector-body" className="mx-auto max-w-6xl px-4 pb-5 sm:px-6">
          <div role="tablist" aria-label="Inspector" className="flex gap-1 border-b border-white/10">
            {(
              [
                ["calls", "ConsentOS calls"],
                ["enforcement", "Enforcement lab"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                role="tab"
                type="button"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                className={clsx(
                  "-mb-px border-b-2 px-3 py-2 text-[12.5px]",
                  tab === id ? "border-[#ff5a4e] text-white" : "border-transparent text-[#9a96a3] hover:text-white",
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === "calls" && (
            <div className="mt-4 grid max-h-[46vh] gap-4 overflow-hidden md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
              <ol className="max-h-[46vh] space-y-1 overflow-y-auto pr-1">
                {log.length === 0 && (
                  <li className="rounded-xl border border-dashed border-white/15 px-4 py-6 text-center text-[12.5px] text-[#9a96a3]">
                    No calls yet. Use a Pixly feature and watch the protocol here.
                  </li>
                )}
                {log.map((entry) => (
                  <li key={entry.id}>
                    <button
                      type="button"
                      onClick={() => setSelected(entry.id)}
                      className={clsx(
                        "w-full rounded-xl px-3 py-2 text-left",
                        current?.id === entry.id ? "bg-white/10" : "hover:bg-white/5",
                      )}
                    >
                      <span className="flex items-center gap-2 font-mono text-[11.5px]">
                        <span className="text-[#c4b5fd]">{entry.method}</span>
                        <span className="truncate">{entry.path}</span>
                        <span className={clsx("ml-auto", statusTone(entry.status))}>{entry.status ?? "ERR"}</span>
                      </span>
                      <span className="mt-0.5 flex items-center gap-2 text-[11.5px] text-[#9a96a3]">
                        <span className="truncate">
                          {entry.label} · {entry.hop}
                        </span>
                        <span className="ml-auto shrink-0 font-mono">
                          {decisionOf(entry) ?? ""} {entry.durationMs} ms
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
              <div className="max-h-[46vh] space-y-3 overflow-y-auto">
                {current ? (
                  <>
                    <p className="font-mono text-[11.5px] text-[#9a96a3]">
                      {current.hop} · {current.method} {current.path} → {current.status ?? current.error}
                    </p>
                    <div>
                      <p className="mb-1 text-[11px] font-semibold tracking-[0.1em] text-[#9a96a3] uppercase">Request</p>
                      <Json value={current.request} />
                    </div>
                    <div>
                      <p className="mb-1 text-[11px] font-semibold tracking-[0.1em] text-[#9a96a3] uppercase">Response</p>
                      <Json value={current.response ?? current.error} />
                    </div>
                  </>
                ) : null}
              </div>
            </div>
          )}

          {tab === "enforcement" && (
            <div className="mt-4 grid gap-5 md:grid-cols-2">
              <div>
                <p className="text-[13px] leading-relaxed text-[#c9c6d0]">
                  Pixly&apos;s training pipeline is <span className="font-mono text-white">POST /api/train-model</span>.
                  Before touching a photo it asks ConsentOS whether this exact use is granted. Try to run it:
                </p>
                <div className="mt-4 flex flex-col gap-2">
                  <button
                    type="button"
                    disabled={enforcing}
                    onClick={() => onEnforce("held")}
                    className="rounded-xl border border-white/15 px-4 py-2.5 text-left text-[13px] hover:bg-white/5 disabled:opacity-50"
                  >
                    <span className="font-medium text-white">Run the training job</span>
                    <span className="block text-[12px] text-[#9a96a3]">
                      {hasTrainingGrant ? "Sends Pixly's AI-training grant" : "Pixly holds no AI-training grant — it tries anyway"}
                    </span>
                  </button>
                  <button
                    type="button"
                    disabled={enforcing || !recommendationsGrant}
                    onClick={() => onEnforce("borrowed")}
                    className="rounded-xl border border-white/15 px-4 py-2.5 text-left text-[13px] hover:bg-white/5 disabled:opacity-40"
                  >
                    <span className="font-medium text-white">Reuse the recommendations grant</span>
                    <span className="block text-[12px] text-[#9a96a3]">
                      {recommendationsGrant ? "A valid grant — but for a different purpose" : "Enable recommendations first"}
                    </span>
                  </button>
                </div>
                <p className="mt-4 font-mono text-[11.5px] leading-relaxed text-[#9a96a3]">
                  curl -i -X POST {typeof window === "undefined" ? "" : window.location.origin}/api/train-model
                </p>
              </div>
              <div aria-live="polite">
                {enforcement ? (
                  <>
                    <p className="text-[12px] text-[#9a96a3]">{enforcement.label}</p>
                    <p className={clsx("mt-1 font-mono text-[15px] font-semibold", statusTone(enforcement.result.status))}>
                      HTTP {enforcement.result.status} {enforcement.result.statusText}
                    </p>
                    <div className="mt-2">
                      <Json value={enforcement.result.body} />
                    </div>
                  </>
                ) : (
                  <p className="rounded-xl border border-dashed border-white/15 px-4 py-8 text-center text-[12.5px] text-[#9a96a3]">
                    The response from Pixly&apos;s protected endpoint appears here.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

"use client";

import {
  RULE_CATALOG,
  ruleDisplay,
  type PolicyRuleKey,
  type PrivacyPolicy,
} from "@consentos/policy-engine";
import clsx from "clsx";
import { useMemo, useState, useTransition } from "react";
import { savePolicyAction } from "@/app/actions";
import { Button, Card, CheckIcon } from "@/components/ui";

type Option = { value: string; label: string; tone: "allow" | "block" | "ask" };

const BASIC_OPTIONS: Option[] = [
  { value: "allow", label: "Allow", tone: "allow" },
  { value: "ask", label: "Ask me", tone: "ask" },
  { value: "deny", label: "Block", tone: "block" },
];

const ANALYTICS_OPTIONS: Option[] = [
  { value: "allow_anonymized_only", label: "Anonymous only", tone: "allow" },
  { value: "allow", label: "Allow", tone: "allow" },
  { value: "ask", label: "Ask me", tone: "ask" },
  { value: "deny", label: "Block", tone: "block" },
];

const RETENTION_PRESETS = [30, 90, 180, 365];

const toneSelected: Record<Option["tone"], string> = {
  allow: "bg-allow-bg text-allow border-allow-line",
  block: "bg-block-bg text-block border-block-line",
  ask: "bg-ask-bg text-ask border-ask-line",
};

function Segmented({
  name,
  label,
  options,
  value,
  onChange,
}: {
  name: string;
  label: string;
  options: Option[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex shrink-0 flex-wrap gap-1 self-start rounded-full border border-line bg-surface-2 p-1 sm:flex-nowrap sm:self-auto"
    >
      {options.map((option) => {
        const selected = option.value === value;
        const id = `${name}-${option.value}`;
        return (
          <label
            key={option.value}
            htmlFor={id}
            className={clsx(
              "relative inline-flex h-8 cursor-pointer items-center rounded-full border px-2.5 text-[12.5px] font-medium transition-colors sm:px-3.5 sm:text-[13px]",
              "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--ring)]",
              selected ? toneSelected[option.tone] : "border-transparent text-muted hover:text-ink",
            )}
          >
            <input
              id={id}
              type="radio"
              name={name}
              value={option.value}
              checked={selected}
              onChange={() => onChange(option.value)}
              className="sr-only"
            />
            {option.label}
          </label>
        );
      })}
    </div>
  );
}

const DISPLAY_WORD: Record<string, string> = {
  ALLOW: "Allow",
  BLOCK: "Block",
  ASK: "Ask me",
  "ANONYMOUS ONLY": "Anonymous only",
};

function describeChanges(before: PrivacyPolicy, after: PrivacyPolicy): string[] {
  const changes: string[] = [];
  for (const rule of RULE_CATALOG) {
    if (before[rule.key] !== after[rule.key]) {
      changes.push(
        `${rule.label}: ${DISPLAY_WORD[ruleDisplay(before[rule.key])]} → ${DISPLAY_WORD[ruleDisplay(after[rule.key])]}`,
      );
    }
  }
  if (before.maxRetentionDays !== after.maxRetentionDays) {
    changes.push(`Maximum retention: ${before.maxRetentionDays} → ${after.maxRetentionDays} days`);
  }
  return changes;
}

type Feedback = { tone: "success" | "error"; message: string } | null;

export function PolicyEditor({
  initial,
  version,
  policyHash,
}: {
  initial: PrivacyPolicy;
  version: number;
  policyHash: string;
}) {
  const [draft, setDraft] = useState<PrivacyPolicy>(initial);
  const [saved, setSaved] = useState<PrivacyPolicy>(initial);
  const [savedVersion, setSavedVersion] = useState(version);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [pending, startTransition] = useTransition();
  const [customRetention, setCustomRetention] = useState(!RETENTION_PRESETS.includes(initial.maxRetentionDays));

  const changes = useMemo(() => describeChanges(saved, draft), [saved, draft]);
  const dirty = changes.length > 0;
  const retentionValid = Number.isInteger(draft.maxRetentionDays) && draft.maxRetentionDays >= 1 && draft.maxRetentionDays <= 3650;

  const setRule = (key: PolicyRuleKey, value: string) => {
    setFeedback(null);
    setDraft((d) => ({ ...d, [key]: value }) as PrivacyPolicy);
  };

  const save = () => {
    startTransition(async () => {
      const result = await savePolicyAction(draft);
      if (!result.ok) {
        setFeedback({ tone: "error", message: result.error });
        return;
      }
      setSaved(draft);
      setSavedVersion(result.version);
      const revoked =
        result.revokedCount > 0
          ? ` ${result.revokedCount} existing grant${result.revokedCount === 1 ? " no longer fits" : "s no longer fit"} your rules and ${result.revokedCount === 1 ? "was" : "were"} revoked.`
          : "";
      setFeedback({ tone: "success", message: `Saved as v${result.version}.${revoked}` });
    });
  };

  return (
    <div>
      <Card className="divide-y divide-line">
        {RULE_CATALOG.map((rule) => (
          <div key={rule.key} className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
            <div className="min-w-0">
              <h2 id={`rule-${rule.key}`} className="text-[15px] font-medium text-ink">
                {rule.label}
              </h2>
              <p className="mt-1 text-[13.5px] leading-relaxed text-muted">{rule.description}</p>
            </div>
            <Segmented
              name={rule.key}
              label={rule.label}
              options={rule.key === "analytics" ? ANALYTICS_OPTIONS : BASIC_OPTIONS}
              value={draft[rule.key]}
              onChange={(value) => setRule(rule.key, value)}
            />
          </div>
        ))}

        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div className="min-w-0">
            <h2 className="text-[15px] font-medium text-ink">Maximum retention</h2>
            <p className="mt-1 text-[13.5px] leading-relaxed text-muted">
              The longest any non-essential use may keep your data. Essential processing lasts as long as your account.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div role="radiogroup" aria-label="Maximum retention" className="inline-flex flex-wrap gap-1 rounded-full border border-line bg-surface-2 p-1">
              {RETENTION_PRESETS.map((days) => {
                const selected = !customRetention && draft.maxRetentionDays === days;
                return (
                  <label
                    key={days}
                    className={clsx(
                      "inline-flex h-8 cursor-pointer items-center rounded-full border px-3.5 text-[13px] font-medium tabular transition-colors",
                      "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--ring)]",
                      selected ? "border-line-strong bg-surface text-ink shadow-card" : "border-transparent text-muted hover:text-ink",
                    )}
                  >
                    <input
                      type="radio"
                      name="retention"
                      value={days}
                      checked={selected}
                      onChange={() => {
                        setCustomRetention(false);
                        setFeedback(null);
                        setDraft((d) => ({ ...d, maxRetentionDays: days }));
                      }}
                      className="sr-only"
                    />
                    {days} days
                  </label>
                );
              })}
              <label
                className={clsx(
                  "inline-flex h-8 cursor-pointer items-center rounded-full border px-3.5 text-[13px] font-medium transition-colors",
                  "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--ring)]",
                  customRetention ? "border-line-strong bg-surface text-ink shadow-card" : "border-transparent text-muted hover:text-ink",
                )}
              >
                <input
                  type="radio"
                  name="retention"
                  value="custom"
                  checked={customRetention}
                  onChange={() => setCustomRetention(true)}
                  className="sr-only"
                />
                Custom
              </label>
            </div>
            {customRetention && (
              <label className="inline-flex items-center gap-2 text-[13px] text-muted">
                <span className="sr-only">Custom retention in days</span>
                <input
                  type="number"
                  min={1}
                  max={3650}
                  inputMode="numeric"
                  value={Number.isFinite(draft.maxRetentionDays) ? draft.maxRetentionDays : ""}
                  onChange={(e) => {
                    setFeedback(null);
                    setDraft((d) => ({ ...d, maxRetentionDays: e.target.valueAsNumber }));
                  }}
                  aria-invalid={!retentionValid}
                  className="h-10 w-24 rounded-xl border border-line-strong bg-surface px-3 text-[14px] text-ink tabular focus:border-accent focus:ring-4 focus:ring-[var(--ring)] focus:outline-none"
                />
                days
              </label>
            )}
          </div>
        </div>
      </Card>

      {!retentionValid && (
        <p role="alert" className="mt-3 text-[13px] text-block">
          Retention must be a whole number of days between 1 and 3650.
        </p>
      )}

      <div
        className={clsx(
          "z-10 mt-6 rounded-2xl border p-4 transition-colors sm:flex sm:items-center sm:justify-between sm:gap-6",
          dirty ? "sticky bottom-4 border-line-strong bg-surface shadow-card" : "border-transparent px-1",
        )}
        aria-live="polite"
      >
        <div className="min-w-0 text-[13.5px]">
          {dirty ? (
            <>
              <p className="font-medium text-ink">
                {changes.length} unsaved change{changes.length === 1 ? "" : "s"}
                <span className="font-normal text-muted"> · saves as v{savedVersion + 1}</span>
              </p>
              <ul className="mt-1 space-y-0.5 text-muted">
                {changes.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </>
          ) : feedback ? (
            <p className={clsx("flex items-center gap-2", feedback.tone === "success" ? "text-allow" : "text-block")} role={feedback.tone === "error" ? "alert" : undefined}>
              {feedback.tone === "success" && <CheckIcon />}
              {feedback.message}
            </p>
          ) : (
            <p className="text-muted">
              All changes saved · v{savedVersion} is active on every integrated site.
            </p>
          )}
          {dirty && feedback?.tone === "error" && (
            <p role="alert" className="mt-1 text-block">
              {feedback.message}
            </p>
          )}
        </div>
        {dirty && (
          <div className="mt-4 flex shrink-0 gap-2 sm:mt-0">
            <Button variant="ghost" onClick={() => setDraft(saved)} disabled={pending}>
              Discard
            </Button>
            <Button onClick={save} disabled={pending || !retentionValid}>
              {pending ? "Saving…" : `Save as v${savedVersion + 1}`}
            </Button>
          </div>
        )}
      </div>

      <details className="group mt-8 rounded-2xl border border-line bg-surface">
        <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-4 text-sm font-medium text-ink">
          Advanced: the policy as data
          <span className="text-muted transition-transform group-open:rotate-90" aria-hidden="true">
            ›
          </span>
        </summary>
        <div className="border-t border-line px-5 py-4">
          <p className="text-[13px] leading-relaxed text-muted">
            This JSON is what the engine evaluates. Saved versions are serialised canonically (sorted keys, no whitespace)
            and hashed with SHA-256; receipts commit to that hash. Current hash:
          </p>
          <p className="mt-2 font-mono text-[12px] break-all text-ink-2">{policyHash}</p>
          <pre className="mt-4 overflow-x-auto rounded-xl bg-[#0f0f12] p-4 font-mono text-[12.5px] leading-relaxed text-[#e7e7ea]">
            {JSON.stringify(draft, null, 2)}
          </pre>
        </div>
      </details>
    </div>
  );
}

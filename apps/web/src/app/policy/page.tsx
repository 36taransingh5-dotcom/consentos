import type { Metadata } from "next";
import { Card, Eyebrow, Mono } from "@/components/ui";
import { formatDateTime, shortHash } from "@/lib/format";
import { requireSessionUser } from "@/server/auth";
import { asUser } from "@/server/db";
import { DEMO_USER_ID, getConfig } from "@/server/env";
import { policyHistory } from "@/server/policies";
import { DemoReset } from "./demo-reset";
import { PolicyEditor } from "./policy-editor";

export const metadata: Metadata = { title: "Your privacy rules" };

export default async function PolicyPage() {
  const user = await requireSessionUser("/policy");
  const history = await asUser(user.id, (tx) => policyHistory(tx, user.id, 20));
  const current = history[0]!;
  const isDemo = user.id === DEMO_USER_ID && getConfig().demoMode;

  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
      <div className="max-w-2xl">
        <Eyebrow>Global privacy policy · v{current.version}</Eyebrow>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight text-ink sm:text-5xl">Your Privacy Rules</h1>
        <p className="mt-4 text-[15.5px] leading-relaxed text-ink-2">
          These rules answer every ConsentOS request automatically, on every integrated site. Each save becomes a new,
          hashed version; past receipts keep pointing at the version they were decided under.
        </p>
      </div>

      <div className="mt-12 grid gap-10 lg:grid-cols-[minmax(0,1fr)_300px]">
        {/* Keyed by the first version so a save keeps local state but a demo reset remounts. */}
        <PolicyEditor
          key={history[history.length - 1]!.id}
          initial={current.policy}
          version={current.version}
          policyHash={current.policyHash}
        />

        <aside className="space-y-6" aria-label="Policy history">
          <Card className="p-5">
            <h2 className="text-sm font-semibold text-ink">Version history</h2>
            <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
              Versions are append-only. The database refuses edits to a saved version.
            </p>
            <ol className="mt-4 space-y-3">
              {history.map((v, i) => (
                <li key={v.id} className="flex items-start gap-3">
                  <span
                    className={
                      i === 0
                        ? "mt-0.5 grid h-6 min-w-9 place-items-center rounded-full bg-ink px-2 font-mono text-[11px] text-bg"
                        : "mt-0.5 grid h-6 min-w-9 place-items-center rounded-full border border-line-strong px-2 font-mono text-[11px] text-muted"
                    }
                  >
                    v{v.version}
                  </span>
                  <div className="min-w-0">
                    <p className="text-[13px] text-ink-2">
                      {formatDateTime(v.createdAt)}
                      {i === 0 && <span className="ml-1.5 text-[11px] font-medium text-allow">current</span>}
                    </p>
                    <Mono className="text-[11px] text-muted">{shortHash(v.policyHash, 6)}</Mono>
                  </div>
                </li>
              ))}
            </ol>
          </Card>
          {isDemo && <DemoReset />}
        </aside>
      </div>
    </div>
  );
}

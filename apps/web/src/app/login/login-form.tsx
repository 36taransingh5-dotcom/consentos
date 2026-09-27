"use client";

import { useActionState, useState } from "react";
import { authAction, demoSignInAction, type FormState } from "@/app/actions";
import { ArrowIcon, Button, Card } from "@/components/ui";

const inputClass =
  "h-11 w-full rounded-xl border border-line-strong bg-surface px-3.5 text-[15px] text-ink placeholder:text-faint " +
  "transition-colors focus:border-accent focus:outline-none focus:ring-4 focus:ring-[var(--ring)]";

export function LoginForm({ next, demoEmail, demoAvailable }: { next: string; demoEmail: string; demoAvailable: boolean }) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [demoState, demoAction, demoPending] = useActionState<FormState, FormData>(demoSignInAction, {});
  const [state, formAction, pending] = useActionState<FormState, FormData>(authAction, {});

  return (
    <div className="mt-10 space-y-6">
      {demoAvailable && (
        <Card className="p-5">
          <form action={demoAction}>
            <input type="hidden" name="next" value={next} />
            <p className="text-sm font-medium text-ink">Judging or just looking?</p>
            <p className="mt-1 text-[13px] text-muted">
              Enter instantly as <span className="font-mono text-ink-2">{demoEmail}</span>, with the default privacy rules.
            </p>
            <Button type="submit" size="lg" className="mt-4 w-full" disabled={demoPending}>
              {demoPending ? "Signing in…" : "Continue as demo user"}
              {!demoPending && <ArrowIcon />}
            </Button>
            {demoState.error && (
              <p role="alert" className="mt-3 text-[13px] text-block">
                {demoState.error}
              </p>
            )}
          </form>
        </Card>
      )}

      <div className="flex items-center gap-3 text-[12px] text-faint" aria-hidden="true">
        <span className="h-px flex-1 bg-line" />
        or use your own account
        <span className="h-px flex-1 bg-line" />
      </div>

      <form action={formAction} className="space-y-4" noValidate>
        <input type="hidden" name="next" value={next} />
        <input type="hidden" name="mode" value={mode} />
        <div className="space-y-1.5">
          <label htmlFor="email" className="text-[13px] font-medium text-ink-2">
            Email
          </label>
          <input id="email" name="email" type="email" autoComplete="email" required className={inputClass} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="password" className="text-[13px] font-medium text-ink-2">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            minLength={8}
            required
            className={inputClass}
          />
          {mode === "signup" && <p className="text-[12px] text-muted">At least 8 characters.</p>}
        </div>
        {state.error && (
          <p role="alert" className="rounded-xl border border-block-line bg-block-bg px-3.5 py-2.5 text-[13px] text-block">
            {state.error}
          </p>
        )}
        <Button type="submit" variant="secondary" size="lg" className="w-full" disabled={pending}>
          {pending ? "One moment…" : mode === "signin" ? "Sign in" : "Create account"}
        </Button>
      </form>

      <p className="text-center text-[13px] text-muted">
        {mode === "signin" ? "New to ConsentOS?" : "Already have an account?"}{" "}
        <button
          type="button"
          onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
          className="font-medium text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink"
        >
          {mode === "signin" ? "Create an account" : "Sign in"}
        </button>
      </p>
    </div>
  );
}

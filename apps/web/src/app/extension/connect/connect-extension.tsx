"use client";

import { useEffect, useRef, useState } from "react";
import { LogoMark } from "@/components/logo";
import { Button, Card, CheckIcon, Eyebrow } from "@/components/ui";

type State = "checking" | "missing" | "connecting" | "connected" | "error";

/**
 * Hands the extension a scoped token. The page and the extension's content
 * script talk over window.postMessage on this origin only; the content script
 * refuses tokens on any other origin.
 */
export function ConnectExtension({ email }: { email: string }) {
  const [state, setState] = useState<State>("checking");
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    const origin = window.location.origin;
    let detected = false;

    const connect = async () => {
      setState("connecting");
      try {
        const res = await fetch("/api/v1/extension/token", { method: "POST", headers: { "content-type": "application/json" } });
        if (!res.ok) throw new Error(`ConsentOS returned ${res.status}`);
        const { token, expiresAt, user } = (await res.json()) as { token: string; expiresAt: string; user: { email: string } };
        window.postMessage({ source: "consentos-web", type: "connect", token, expiresAt, user, apiUrl: origin }, origin);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not create a token.");
        setState("error");
      }
    };

    const onMessage = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== origin) return;
      const data = event.data as { source?: string; type?: string; error?: string } | null;
      if (data?.source !== "consentos-extension") return;
      if (data.type === "hello" && !detected) {
        detected = true;
        if (!started.current) {
          started.current = true;
          void connect();
        }
      } else if (data.type === "connected") {
        setState("connected");
      } else if (data.type === "connect-failed") {
        setError(data.error ?? "The extension rejected the connection.");
        setState("error");
      }
    };

    window.addEventListener("message", onMessage);
    window.postMessage({ source: "consentos-web", type: "ping" }, origin);
    const timer = window.setTimeout(() => {
      if (!detected) setState("missing");
    }, 1500);

    return () => {
      window.removeEventListener("message", onMessage);
      window.clearTimeout(timer);
    };
  }, []);

  return (
    <Card className="p-8 text-center">
      <LogoMark className="mx-auto size-12 text-ink" />
      <Eyebrow className="mt-6">Browser extension</Eyebrow>

      {(state === "checking" || state === "connecting") && (
        <>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-ink" aria-live="polite">
            {state === "checking" ? "Looking for the extension…" : "Connecting…"}
          </h1>
          <p className="mt-3 text-[14.5px] text-muted">This takes a second.</p>
        </>
      )}

      {state === "connected" && (
        <>
          <h1 className="mt-3 flex items-center justify-center gap-2 text-2xl font-semibold tracking-tight text-allow" aria-live="polite">
            <CheckIcon className="size-6" /> Extension connected
          </h1>
          <p className="mt-3 text-[14.5px] leading-relaxed text-muted">
            Signed in as <span className="text-ink">{email}</span>. Open any site that uses ConsentOS — like Pixly — and
            click the ConsentOS icon to see what it may and may not do. You can close this tab.
          </p>
        </>
      )}

      {state === "missing" && (
        <>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-ink">Install the extension first</h1>
          <p className="mt-3 text-[14.5px] leading-relaxed text-muted">
            The ConsentOS extension isn&apos;t installed in this browser yet.
          </p>
          <ol className="mx-auto mt-6 max-w-sm space-y-2 text-left text-[14px] text-ink-2">
            <li>
              1. Run <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[12.5px]">pnpm build:extension</code>
            </li>
            <li>
              2. Open <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[12.5px]">chrome://extensions</code> and
              turn on Developer mode
            </li>
            <li>
              3. Load unpacked → <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[12.5px]">apps/extension/dist</code>
            </li>
          </ol>
          <Button variant="secondary" className="mt-8" onClick={() => window.location.reload()}>
            I&apos;ve installed it
          </Button>
        </>
      )}

      {state === "error" && (
        <>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-block">Couldn&apos;t connect</h1>
          <p role="alert" className="mt-3 text-[14.5px] text-muted">
            {error}
          </p>
          <Button variant="secondary" className="mt-8" onClick={() => window.location.reload()}>
            Try again
          </Button>
        </>
      )}
    </Card>
  );
}

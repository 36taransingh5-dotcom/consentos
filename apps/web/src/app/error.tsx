"use client";

import { Button } from "@/components/ui";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center px-4 py-28 text-center">
      <h1 className="text-3xl font-semibold tracking-tight text-ink">Something went wrong</h1>
      <p className="mt-3 text-[15px] text-muted">
        ConsentOS couldn&apos;t load this page. Your rules and receipts are unaffected.
      </p>
      <Button variant="secondary" className="mt-8" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}

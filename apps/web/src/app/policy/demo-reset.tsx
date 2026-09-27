"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { resetDemoAction } from "@/app/actions";
import { Button, Card } from "@/components/ui";

export function DemoReset() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  return (
    <Card className="p-5">
      <h2 className="text-sm font-semibold text-ink">Demo account</h2>
      <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
        Restore the default rules and clear every request, receipt and event, so the demo can run again from scratch.
      </p>
      <Button
        variant="secondary"
        size="sm"
        className="mt-4"
        disabled={pending}
        onClick={() => {
          if (!window.confirm("Reset the demo account? This clears all receipts and restores the default rules.")) return;
          startTransition(async () => {
            const result = await resetDemoAction();
            setMessage(result.ok ? "Demo reset." : result.error);
            router.refresh();
          });
        }}
      >
        {pending ? "Resetting…" : "Reset demo"}
      </Button>
      {message && (
        <p className="mt-2 text-[12.5px] text-muted" role="status">
          {message}
        </p>
      )}
    </Card>
  );
}

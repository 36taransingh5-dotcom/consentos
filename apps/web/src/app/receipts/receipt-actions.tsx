"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { resolveRequestAction, revokeGrantAction } from "@/app/actions";
import { Button } from "@/components/ui";

export function RevokeButton({ receiptId, label, size = "sm" }: { receiptId: string; label: string; size?: "sm" | "md" }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="danger"
        size={size}
        disabled={pending}
        aria-label={`Revoke ${label}`}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await revokeGrantAction(receiptId);
            if (!result.ok) setError(result.error);
            router.refresh();
          });
        }}
      >
        {pending ? "Revoking…" : "Revoke"}
      </Button>
      {error && (
        <span role="alert" className="text-[12px] text-block">
          {error}
        </span>
      )}
    </div>
  );
}

export function ResolveButtons({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const answer = (decision: "ALLOW" | "DENY") =>
    startTransition(async () => {
      setError(null);
      const result = await resolveRequestAction(requestId, decision);
      if (!result.ok) setError(result.error);
      router.refresh();
    });

  return (
    <div className="flex flex-col items-start gap-1 sm:items-end">
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" disabled={pending} onClick={() => answer("DENY")}>
          Decline
        </Button>
        <Button size="sm" disabled={pending} onClick={() => answer("ALLOW")}>
          Allow
        </Button>
      </div>
      {error && (
        <span role="alert" className="text-[12px] text-block">
          {error}
        </span>
      )}
    </div>
  );
}

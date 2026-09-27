import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth";
import { DEMO_USER_EMAIL, getConfig } from "@/server/env";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/policy";
  if (await getSessionUser()) redirect(safeNext);

  return (
    <div className="mx-auto flex max-w-md flex-col px-4 py-16 sm:py-24">
      <h1 className="text-3xl font-semibold tracking-tight text-ink">Sign in to ConsentOS</h1>
      <p className="mt-3 text-[15px] leading-relaxed text-muted">
        Your rules live here. Every site that integrates ConsentOS asks them first.
      </p>
      <LoginForm next={safeNext} demoEmail={DEMO_USER_EMAIL} demoAvailable={getConfig().demoMode} />
    </div>
  );
}

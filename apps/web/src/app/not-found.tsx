import { ButtonLink } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center px-4 py-28 text-center">
      <p className="font-mono text-[13px] text-muted">404</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight text-ink">Nothing here</h1>
      <p className="mt-3 text-[15px] text-muted">
        This page or receipt doesn&apos;t exist, or it belongs to another account.
      </p>
      <ButtonLink href="/" variant="secondary" className="mt-8">
        Back to ConsentOS
      </ButtonLink>
    </div>
  );
}

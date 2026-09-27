import clsx from "clsx";

/** The ConsentOS mark: a permission switch, set. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={clsx("shrink-0", className)}>
      <rect x="1" y="1" width="30" height="30" rx="9" fill="currentColor" />
      <rect x="7" y="11" width="18" height="10" rx="5" fill="none" stroke="var(--bg)" strokeWidth="2" />
      <circle cx="20" cy="16" r="3" fill="var(--bg)" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={clsx("inline-flex items-center gap-2 font-semibold tracking-tight text-ink", className)}>
      <LogoMark className="size-6" />
      <span>ConsentOS</span>
    </span>
  );
}

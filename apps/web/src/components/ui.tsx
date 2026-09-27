import clsx from "clsx";
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

const buttonBase =
  "inline-flex items-center justify-center gap-2 rounded-full font-medium transition-colors duration-150 " +
  "disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap select-none";

const buttonVariants: Record<ButtonVariant, string> = {
  primary: "bg-ink text-bg hover:bg-ink-2",
  secondary: "bg-surface text-ink border border-line-strong hover:bg-surface-2 hover:border-faint",
  ghost: "text-ink-2 hover:text-ink hover:bg-line/60",
  danger: "bg-surface text-block border border-block-line hover:bg-block-bg",
};

const buttonSizes: Record<ButtonSize, string> = {
  sm: "h-8 px-3.5 text-[13px]",
  md: "h-10 px-5 text-sm",
  lg: "h-12 px-6 text-[15px]",
};

export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "md", className?: string) {
  return clsx(buttonBase, buttonVariants[variant], buttonSizes[size], className);
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentProps<"button"> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button className={buttonClass(variant, size, className)} {...props} />;
}

export function ButtonLink({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <Link className={buttonClass(variant, size, className)} {...props} />;
}

export function Card({ className, ...props }: ComponentProps<"div">) {
  return <div className={clsx("rounded-2xl border border-line bg-surface shadow-card", className)} {...props} />;
}

export type Status = "allow" | "block" | "ask" | "neutral" | "revoked";

const statusStyles: Record<Status, string> = {
  allow: "bg-allow-bg text-allow border-allow-line",
  block: "bg-block-bg text-block border-block-line",
  ask: "bg-ask-bg text-ask border-ask-line",
  neutral: "bg-surface-2 text-muted border-line",
  revoked: "bg-surface-2 text-muted border-line line-through decoration-1",
};

export function StatusPill({ status, children, className }: { status: Status; children: ReactNode; className?: string }) {
  return (
    <span
      className={clsx(
        "inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-semibold tracking-[0.06em] uppercase",
        statusStyles[status],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function CheckIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={clsx("size-4 shrink-0", className)}>
      <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function CrossIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={clsx("size-4 shrink-0", className)}>
      <path d="M4.5 4.5l7 7m0-7l-7 7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function QuestionIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={clsx("size-4 shrink-0", className)}>
      <path
        d="M6 6.2a2 2 0 1 1 2.9 1.8c-.6.3-.9.8-.9 1.4v.3M8 12h.01"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function ArrowIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={clsx("size-4 shrink-0", className)}>
      <path d="M3 8h9.5M9 4.5 12.5 8 9 11.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={clsx("text-[11px] font-semibold tracking-[0.14em] text-muted uppercase", className)}>{children}</p>
  );
}

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={clsx("font-mono text-[12.5px] break-all", className)}>{children}</span>;
}

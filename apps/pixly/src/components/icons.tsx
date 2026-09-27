import clsx from "clsx";

type IconProps = { className?: string };

const base = "shrink-0";

export function PixlyMark({ className }: IconProps) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={clsx(base, className)}>
      <rect width="32" height="32" rx="10" fill="var(--coral)" />
      <circle cx="16" cy="17" r="7" fill="none" stroke="#fff" strokeWidth="3" />
      <circle cx="23.5" cy="9" r="2.2" fill="#fff" />
    </svg>
  );
}

export function ShieldIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={clsx(base, "size-4", className)}>
      <path
        d="M8 1.8 3 3.6v4c0 3 2.1 5.4 5 6.6 2.9-1.2 5-3.6 5-6.6v-4L8 1.8Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="m5.8 8.1 1.6 1.6 3-3.2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function BlockedShieldIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={clsx(base, className)}>
      <path
        d="M12 2.5 4.5 5.3v6c0 4.6 3.2 8.2 7.5 10.2 4.3-2 7.5-5.6 7.5-10.2v-6L12 2.5Z"
        fill="currentColor"
        opacity="0.12"
      />
      <path
        d="M12 2.5 4.5 5.3v6c0 4.6 3.2 8.2 7.5 10.2 4.3-2 7.5-5.6 7.5-10.2v-6L12 2.5Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path d="m9.2 9.2 5.6 5.6m0-5.6-5.6 5.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function CheckIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={clsx(base, "size-4", className)}>
      <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function CrossIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={clsx(base, "size-4", className)}>
      <path d="M4.5 4.5l7 7m0-7l-7 7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function HeartIcon({ className, filled }: IconProps & { filled?: boolean }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={clsx(base, "size-4", className)}>
      <path
        d="M8 13.5S2.5 10.2 2.5 6.3A2.8 2.8 0 0 1 8 5a2.8 2.8 0 0 1 5.5 1.3C13.5 10.2 8 13.5 8 13.5Z"
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function UploadIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={clsx(base, "size-4", className)}>
      <path d="M8 10.5V3m0 0L5 6m3-3 3 3M3 11v1.5A1.5 1.5 0 0 0 4.5 14h7a1.5 1.5 0 0 0 1.5-1.5V11" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function SparkIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={clsx(base, "size-4", className)}>
      <path d="M8 1.5 9.3 6.7 14.5 8l-5.2 1.3L8 14.5 6.7 9.3 1.5 8l5.2-1.3L8 1.5Z" fill="currentColor" />
    </svg>
  );
}

export function ClockIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={clsx(base, "size-4", className)}>
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 4.8V8l2.2 1.4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function CpuIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={clsx(base, "size-4", className)}>
      <rect x="4" y="4" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6.5 2v2M9.5 2v2M6.5 12v2M9.5 12v2M2 6.5h2M2 9.5h2M12 6.5h2M12 9.5h2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

export function TerminalIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={clsx(base, "size-4", className)}>
      <path d="m3.5 5 3 3-3 3M8.5 11.5h4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

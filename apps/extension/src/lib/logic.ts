import type { EventSummary } from "@consentos/shared";
import type { Notice } from "./messages";

/**
 * Pure helpers (no chrome.* APIs) so they can be unit tested.
 */

const SERVICE_ID = /^[a-z0-9][a-z0-9-]{1,62}$/;

export function isServiceId(value: unknown): value is string {
  return typeof value === "string" && SERVICE_ID.test(value);
}

/** Only the configured ConsentOS origin may hand the extension a token. */
export function isTrustedConsentOrigin(pageOrigin: string, apiUrl: string): boolean {
  try {
    return new URL(apiUrl).origin === pageOrigin;
  } catch {
    return false;
  }
}

/** Events not seen before, oldest first. */
export function newEvents(events: EventSummary[], seen: ReadonlySet<string>): EventSummary[] {
  return events.filter((e) => !seen.has(e.id)).reverse();
}

/** Events that count towards the "blocked" badge. */
export function isBlock(event: EventSummary): boolean {
  return event.type === "consent.denied" || event.type === "enforcement.blocked";
}

export function noticeFor(event: EventSummary): Notice | null {
  const serviceName = event.serviceName ?? "A service";
  switch (event.type) {
    case "consent.denied":
      return { tone: "block", label: "Blocked by your rules", message: event.message, serviceName };
    case "enforcement.blocked":
      return { tone: "block", label: "Refused at runtime", message: event.message, serviceName };
    case "consent.allowed":
      return { tone: "allow", label: "Allowed by your rules", message: event.message, serviceName };
    case "consent.pending":
      return { tone: "ask", label: "Needs your answer", message: event.message, serviceName };
    default:
      return null;
  }
}

export function badgeFor(unreadBlocked: number): { text: string; color: string; title: string } {
  if (unreadBlocked <= 0) return { text: "", color: "#111113", title: "ConsentOS" };
  return {
    text: unreadBlocked > 99 ? "99+" : String(unreadBlocked),
    color: "#c0291d",
    title: `ConsentOS — ${unreadBlocked} blocked`,
  };
}

/** "Just now", "4 min ago", "2 h ago", "3 d ago". */
export function relativeTime(iso: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 45) return "Just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

export function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.host : null;
  } catch {
    return null;
  }
}

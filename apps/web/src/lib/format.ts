const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");

/** "26 Sep 2026" */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** "26 Sep 2026, 14:32" */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return `${formatDate(iso)}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "Just now", "4 min ago", "2 h ago", then a date. */
export function formatRelative(iso: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 45) return "Just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return formatDate(iso);
}

/** "sha256:9f86d081…b0f00a08" */
export function shortHash(hash: string, keep = 8): string {
  const [algo, hex] = hash.includes(":") ? hash.split(":") : ["", hash];
  if (!hex || hex.length <= keep * 2) return hash;
  return `${algo ? `${algo}:` : ""}${hex.slice(0, keep)}…${hex.slice(-keep)}`;
}

export function formatRetention(days: number | null): string {
  if (days === null) return "Not stated";
  if (days === 0) return "Not retained";
  if (days === 1) return "1 day";
  if (days % 365 === 0) return `${days / 365} year${days === 365 ? "" : "s"} (${days} days)`;
  return `${days} days`;
}

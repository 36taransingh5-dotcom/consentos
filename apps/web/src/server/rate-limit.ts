import "server-only";
import { ApiError } from "./errors";

/**
 * Fixed-window rate limiter held in process memory. Adequate abuse protection
 * for a single instance; a multi-instance deployment should back this with a
 * shared store (e.g. Upstash Redis or a Postgres table).
 */
const globalForLimits = globalThis as unknown as { __consentosLimits?: Map<string, { count: number; resetAt: number }> };
const windows = (globalForLimits.__consentosLimits ??= new Map());

export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()): void {
  const entry = windows.get(key);
  if (!entry || entry.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    if (windows.size > 10_000) sweep(now);
    return;
  }
  entry.count += 1;
  if (entry.count > limit) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    throw new ApiError(429, "RATE_LIMITED", "Too many requests. Slow down and try again shortly.", { retryAfter });
  }
}

function sweep(now: number): void {
  for (const [key, entry] of windows) if (entry.resetAt <= now) windows.delete(key);
}

export function resetRateLimitsForTests(): void {
  windows.clear();
}

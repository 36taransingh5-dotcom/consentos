import "server-only";
import type { ServiceSummary } from "@consentos/shared";
import { sha256Hex } from "./crypto";
import { asService, type Queryable } from "./db";
import { ApiError } from "./errors";

interface ServiceRow {
  id: string;
  name: string;
  domain: string;
  verified: boolean;
}

const toSummary = (row: ServiceRow): ServiceSummary => ({
  id: row.id,
  name: row.name,
  domain: row.domain,
  verified: row.verified,
});

export async function getService(q: Queryable, id: string): Promise<ServiceSummary | null> {
  const [row] = await q.query<ServiceRow>("select id, name, domain, verified from public.services where id = $1", [
    id,
  ]);
  return row ? toSummary(row) : null;
}

export async function listServices(q: Queryable): Promise<ServiceSummary[]> {
  const rows = await q.query<ServiceRow>("select id, name, domain, verified from public.services order by name");
  return rows.map(toSummary);
}

/**
 * Authenticate a service from `Authorization: Bearer <api key>`. Keys are
 * stored only as SHA-256 hashes; the lookup is by hash.
 */
export async function authenticateService(authorization: string | null): Promise<ServiceSummary> {
  const match = authorization?.match(/^Bearer\s+(\S+)$/i);
  if (!match) {
    throw new ApiError(401, "UNAUTHENTICATED", "Send the service API key as `Authorization: Bearer <key>`.");
  }
  const hash = sha256Hex(match[1]!);
  const [row] = await asService((tx) =>
    tx.query<ServiceRow>("select id, name, domain, verified from public.services where api_key_hash = $1", [hash]),
  );
  if (!row) throw new ApiError(401, "INVALID_API_KEY", "This API key is not recognised.");
  return toSummary(row);
}

/**
 * Does a browser origin (e.g. `http://localhost:3001`) belong to a service's
 * registered domain (e.g. `localhost:3001`)? Used by the extension so a page
 * cannot impersonate a registered service just by announcing its id.
 */
export function originMatchesDomain(origin: string, domain: string): boolean {
  try {
    const url = new URL(origin);
    const host = url.host.toLowerCase();
    const expected = domain.toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    return host === expected;
  } catch {
    return false;
  }
}

import type { ExtensionState } from "@consentos/shared";
import type { Connection } from "./messages";

export class ApiError extends Error {
  override name = "ApiError";
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}

async function call<T>(connection: Connection, path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${connection.apiUrl}${path}`, {
      ...init,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${connection.token}`,
        ...(init.body ? { "content-type": "application/json" } : {}),
      },
      cache: "no-store",
    });
  } catch {
    throw new ApiError(`Can't reach ConsentOS at ${connection.apiUrl}`, 0, "NETWORK_ERROR");
  }
  const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
  if (!res.ok) throw new ApiError(body.message ?? `ConsentOS returned ${res.status}`, res.status, body.error ?? "HTTP_ERROR");
  return body as T;
}

export function fetchState(connection: Connection, site?: { serviceId?: string; origin?: string }): Promise<ExtensionState> {
  const params = new URLSearchParams();
  if (site?.serviceId) params.set("serviceId", site.serviceId);
  if (site?.origin) params.set("origin", site.origin);
  const query = params.size > 0 ? `?${params}` : "";
  return call<ExtensionState>(connection, `/api/v1/extension/state${query}`);
}

export function revokeGrant(connection: Connection, receiptId: string): Promise<{ revokedAt: string }> {
  return call(connection, `/api/v1/receipts/${encodeURIComponent(receiptId)}/revoke`, { method: "POST" });
}

export function resolveRequest(
  connection: Connection,
  requestId: string,
  decision: "ALLOW" | "DENY",
): Promise<{ receiptId: string }> {
  return call(connection, `/api/v1/consent/requests/${encodeURIComponent(requestId)}/resolve`, {
    method: "POST",
    body: JSON.stringify({ decision }),
  });
}

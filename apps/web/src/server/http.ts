import "server-only";
import type { ApiErrorBody } from "@consentos/shared";
import { formatIssues } from "@consentos/shared";
import type { z } from "zod";
import { ConfigError } from "./env";
import { ApiError } from "./errors";

const MAX_BODY_BYTES = 16 * 1024;

export function json<T>(data: T, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function errorResponse(status: number, error: string, message: string, extra: Record<string, unknown> = {}): Response {
  const body: ApiErrorBody = { error, message, ...extra };
  return json(body, { status });
}

/** Read and validate a JSON body with a size cap. Throws ApiError on failure. */
export async function readJson<S extends z.ZodType>(req: Request, schema: S): Promise<z.infer<S>> {
  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > MAX_BODY_BYTES) throw new ApiError(413, "PAYLOAD_TOO_LARGE", "Request body is too large.");

  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) throw new ApiError(413, "PAYLOAD_TOO_LARGE", "Request body is too large.");

  let raw: unknown;
  try {
    raw = text ? JSON.parse(text) : {};
  } catch {
    throw new ApiError(400, "INVALID_JSON", "Request body must be valid JSON.");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError(400, "INVALID_REQUEST", "The request did not match the expected shape.", {
      issues: formatIssues(parsed.error),
    });
  }
  return parsed.data;
}

type Handler<C> = (req: Request, ctx: C) => Promise<Response>;

/** Map thrown ApiErrors to JSON responses; never leak internals on 500. */
export function handle<C>(handler: Handler<C>, options: { cors?: boolean } = {}): Handler<C> {
  return async (req, ctx) => {
    let response: Response;
    try {
      response = await handler(req, ctx);
    } catch (error) {
      if (error instanceof ApiError) {
        response = errorResponse(error.status, error.code, error.message, error.extra);
        if (error.status === 429 && typeof error.extra?.retryAfter === "number") {
          response.headers.set("retry-after", String(error.extra.retryAfter));
        }
      } else if (error instanceof ConfigError) {
        console.error("[consentos] configuration error:", error.message);
        response = errorResponse(500, "SERVER_MISCONFIGURED", "ConsentOS is not configured correctly.");
      } else {
        console.error("[consentos] unhandled error:", error);
        response = errorResponse(500, "INTERNAL_ERROR", "Something went wrong on our side.");
      }
    }
    if (options.cors) applyCors(response);
    return response;
  };
}

/** Public, read-only endpoints (verification, keys) can be called from any origin. */
export function applyCors(response: Response): Response {
  response.headers.set("access-control-allow-origin", "*");
  response.headers.set("access-control-allow-methods", "GET, POST, OPTIONS");
  response.headers.set("access-control-allow-headers", "content-type");
  response.headers.set("access-control-max-age", "86400");
  return response;
}

export function preflight(): Response {
  return applyCors(new Response(null, { status: 204 }));
}

export function clientAddress(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "local"
  );
}

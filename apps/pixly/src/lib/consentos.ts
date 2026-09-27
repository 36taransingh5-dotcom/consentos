import { ConsentOS } from "@consentos/sdk";
import { serverConfig } from "./config";

/** One call from Pixly's backend to ConsentOS, as shown in the protocol inspector. */
export interface Exchange {
  id: string;
  at: string;
  method: string;
  path: string;
  status: number | null;
  durationMs: number;
  request?: unknown;
  response?: unknown;
  error?: string;
}

function parse(text: string | undefined): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** A fetch that records each request/response pair. Credentials are never recorded. */
function recordingFetch(log: Exchange[]): typeof fetch {
  return async (input, init) => {
    const started = performance.now();
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const entry: Exchange = {
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      method: init?.method ?? "GET",
      path: url.pathname,
      status: null,
      durationMs: 0,
      request: typeof init?.body === "string" ? parse(init.body) : undefined,
    };
    try {
      const res = await fetch(input, init);
      entry.status = res.status;
      entry.response = parse(await res.clone().text());
      return res;
    } catch (error) {
      entry.error = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      entry.durationMs = Math.round(performance.now() - started);
      log.push(entry);
    }
  };
}

/** A ConsentOS client for one Pixly request. Pass `log` to capture the exchanges. */
export function consentos(log?: Exchange[]): ConsentOS {
  return new ConsentOS({
    serviceId: "pixly",
    apiUrl: serverConfig.apiUrl,
    apiKey: serverConfig.apiKey,
    fetch: log ? recordingFetch(log) : undefined,
  });
}

/** Exchanges travel to the inspector in a header so protected responses keep their exact shape. */
export function encodeExchanges(log: Exchange[]): string {
  return Buffer.from(JSON.stringify(log)).toString("base64url");
}

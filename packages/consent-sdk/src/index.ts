import type {
  ConsentRequestStatus,
  EvaluateResponse,
  GrantCheckResponse,
  Purpose,
  ReceiptVerification,
  SignedReceipt,
} from "./types";

export type * from "./types";

export interface ConsentOSOptions {
  /** Your registered service id, e.g. "pixly". */
  serviceId: string;
  /** Base URL of the ConsentOS API, e.g. "https://consentos.dev". */
  apiUrl: string;
  /**
   * Your service's secret API key. Required for `request`, `checkGrant`,
   * `enforce` and `getRequest`. Keep it on your server.
   */
  apiKey?: string;
  /** Custom fetch (for tests, tracing or older runtimes). */
  fetch?: typeof fetch;
  /** Per-request timeout. Default 10 s. */
  timeoutMs?: number;
}

/** Any purpose ConsentOS knows, or your own identifier (which the user will be asked about). */
export type PurposeId = Purpose | (string & {});

export interface ConsentRequestInput {
  userId: string;
  dataType: string;
  purpose: PurposeId;
  /** How long you will keep the data. Omit only for essential processing. */
  retentionDays?: number;
  /** Will the data leave your company? Defaults to false — and the receipt will say so. */
  thirdPartySharing?: boolean;
  /** Set when the data is anonymised before use. */
  anonymized?: boolean;
  /** Up to 2 KB of JSON context, hashed into the receipt. Never affects the decision. */
  metadata?: Record<string, unknown>;
}

export interface GrantCheckInput {
  userId: string;
  purpose: PurposeId;
  dataType?: string;
  /** The receipt id of the grant you hold. Omit to look up the latest grant. */
  receiptId?: string;
  /**
   * "use" (default) before touching the data — refusals appear in the user's
   * activity. "status" for UI checks that won't use the data.
   */
  intent?: "use" | "status";
}

export class ConsentOSError extends Error {
  override name = "ConsentOSError";
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly body?: unknown,
  ) {
    super(message);
  }
}

/** Thrown by `enforce` when the user has not permitted (or has revoked) this use. */
export class ConsentViolationError extends ConsentOSError {
  override name = "ConsentViolationError";
  constructor(readonly check: GrantCheckResponse) {
    super(check.message, 403, check.code, check);
  }
}

export class ConsentOS {
  readonly serviceId: string;
  private readonly apiUrl: string;
  private readonly apiKey: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: ConsentOSOptions) {
    if (!options.serviceId) throw new TypeError("ConsentOS: serviceId is required");
    if (!options.apiUrl) throw new TypeError("ConsentOS: apiUrl is required");
    this.serviceId = options.serviceId;
    this.apiUrl = options.apiUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  /**
   * Ask for permission. The user's policy decides; the response carries the
   * decision, a machine-readable reason and, for ALLOW/DENY, a signed receipt.
   * An ALLOW receipt id is your grant: store it and present it to `checkGrant`.
   */
  request(input: ConsentRequestInput): Promise<EvaluateResponse> {
    return this.call<EvaluateResponse>("POST", "/api/v1/consent/evaluate", {
      auth: true,
      body: { ...input, serviceId: this.serviceId },
    });
  }

  /**
   * Runtime enforcement. Call from the backend code path that uses the data.
   * Returns `authorized: false` with `code` CONSENT_VIOLATION or CONSENT_REVOKED
   * rather than throwing, so you can shape your own 403.
   */
  checkGrant(input: GrantCheckInput): Promise<GrantCheckResponse> {
    return this.call<GrantCheckResponse>("POST", "/api/v1/grants/check", {
      auth: true,
      body: { ...input, serviceId: this.serviceId },
    });
  }

  /** Like `checkGrant`, but throws `ConsentViolationError` unless authorised. */
  async enforce(input: GrantCheckInput): Promise<GrantCheckResponse> {
    const check = await this.checkGrant(input);
    if (!check.authorized) throw new ConsentViolationError(check);
    return check;
  }

  /** Current state of a request (useful after REQUIRE_USER). */
  getRequest(requestId: string): Promise<ConsentRequestStatus> {
    return this.call<ConsentRequestStatus>("GET", `/api/v1/consent/requests/${encodeURIComponent(requestId)}`, {
      auth: true,
    });
  }

  /** Poll a REQUIRE_USER request until the user answers, or until the timeout. */
  async waitForDecision(
    requestId: string,
    options: { timeoutMs?: number; intervalMs?: number; signal?: AbortSignal } = {},
  ): Promise<ConsentRequestStatus> {
    const deadline = Date.now() + (options.timeoutMs ?? 120_000);
    const interval = options.intervalMs ?? 2_000;
    for (;;) {
      const status = await this.getRequest(requestId);
      if (status.status !== "pending") return status;
      if (Date.now() + interval > deadline) return status;
      await sleep(interval, options.signal);
    }
  }

  /** Public integrity check: signature, payload hash, request hash, policy hash. */
  verifyReceipt(receiptId: string): Promise<ReceiptVerification> {
    return this.call<ReceiptVerification>("GET", `/api/v1/receipts/${encodeURIComponent(receiptId)}/verify`, {
      auth: false,
    });
  }

  /** Verify a receipt document you stored, without trusting ConsentOS's copy. */
  verifyReceiptDocument(receipt: SignedReceipt): Promise<ReceiptVerification & { knownToConsentOS: boolean }> {
    return this.call("POST", "/api/v1/receipts/verify", { auth: false, body: receipt });
  }

  /** The full signed receipt, for receipts issued to this service. */
  getReceipt(receiptId: string): Promise<{
    receipt: SignedReceipt;
    status: { revoked: boolean; revokedAt: string | null; revocationReason: string | null };
  }> {
    return this.call("GET", `/api/v1/receipts/${encodeURIComponent(receiptId)}`, { auth: true });
  }

  private async call<T>(method: "GET" | "POST", path: string, options: { auth: boolean; body?: unknown }): Promise<T> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (options.body !== undefined) headers["content-type"] = "application/json";
    if (options.auth) {
      if (!this.apiKey) throw new ConsentOSError("ConsentOS: this call needs an apiKey", 0, "MISSING_API_KEY");
      headers.authorization = `Bearer ${this.apiKey}`;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.apiUrl}${path}`, {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
        cache: "no-store",
      });
    } catch (error) {
      const timedOut = controller.signal.aborted;
      throw new ConsentOSError(
        timedOut ? `ConsentOS did not answer within ${this.timeoutMs} ms` : `Could not reach ConsentOS at ${this.apiUrl}`,
        0,
        timedOut ? "TIMEOUT" : "NETWORK_ERROR",
        error,
      );
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text();
    let body: unknown = undefined;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      body = text;
    }
    if (!response.ok) {
      const err = (body ?? {}) as { error?: string; message?: string };
      throw new ConsentOSError(
        err.message ?? `ConsentOS returned HTTP ${response.status}`,
        response.status,
        err.error ?? "HTTP_ERROR",
        body,
      );
    }
    return body as T;
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

import { describe, expect, it, vi } from "vitest";
import { ConsentOS, ConsentOSError, ConsentViolationError } from "./index";

function mockFetch(status: number, body: unknown) {
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
  );
}

const USER = "7e57de30-0000-4000-8000-000000000001";

describe("ConsentOS SDK", () => {
  it("sends requests with the service id and bearer key", async () => {
    const fetch = mockFetch(200, { decision: "ALLOW", receiptId: "r1" });
    const client = new ConsentOS({ serviceId: "pixly", apiUrl: "https://c.example/", apiKey: "cos_key", fetch });
    const result = await client.request({ userId: USER, dataType: "uploaded_images", purpose: "personalization", retentionDays: 30 });

    expect(result.decision).toBe("ALLOW");
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("https://c.example/api/v1/consent/evaluate");
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>).authorization).toBe("Bearer cos_key");
    expect(JSON.parse(init?.body as string)).toEqual({
      userId: USER,
      dataType: "uploaded_images",
      purpose: "personalization",
      retentionDays: 30,
      serviceId: "pixly",
    });
  });

  it("does not let callers override the service id", async () => {
    const fetch = mockFetch(200, {});
    const client = new ConsentOS({ serviceId: "pixly", apiUrl: "https://c.example", apiKey: "k", fetch });
    await client.checkGrant({ userId: USER, purpose: "personalization", serviceId: "evil" } as never);
    expect(JSON.parse(fetch.mock.calls[0]![1]!.body as string).serviceId).toBe("pixly");
  });

  it("throws ConsentOSError with the API's error code", async () => {
    const client = new ConsentOS({
      serviceId: "pixly",
      apiUrl: "https://c.example",
      apiKey: "bad",
      fetch: mockFetch(401, { error: "INVALID_API_KEY", message: "This API key is not recognised." }),
    });
    await expect(client.request({ userId: USER, dataType: "x", purpose: "y" })).rejects.toMatchObject({
      name: "ConsentOSError",
      status: 401,
      code: "INVALID_API_KEY",
    });
  });

  it("enforce throws ConsentViolationError when not authorised", async () => {
    const check = { authorized: false, code: "CONSENT_REVOKED", reason: "REVOKED", message: "revoked", receiptId: "r", checkedAt: "" };
    const client = new ConsentOS({ serviceId: "pixly", apiUrl: "https://c.example", apiKey: "k", fetch: mockFetch(200, check) });
    const error = await client.enforce({ userId: USER, purpose: "personalization" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConsentViolationError);
    expect(error).toMatchObject({ status: 403, code: "CONSENT_REVOKED" });
  });

  it("verifies receipts without an API key", async () => {
    const fetch = mockFetch(200, { valid: true });
    const client = new ConsentOS({ serviceId: "pixly", apiUrl: "https://c.example", fetch });
    await client.verifyReceipt("abc");
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("https://c.example/api/v1/receipts/abc/verify");
    expect((init?.headers as Record<string, string>).authorization).toBeUndefined();
  });

  it("refuses authenticated calls without a key", async () => {
    const client = new ConsentOS({ serviceId: "pixly", apiUrl: "https://c.example", fetch: mockFetch(200, {}) });
    await expect(client.request({ userId: USER, dataType: "x", purpose: "y" })).rejects.toBeInstanceOf(ConsentOSError);
  });

  it("reports network failures clearly", async () => {
    const client = new ConsentOS({
      serviceId: "pixly",
      apiUrl: "https://c.example",
      apiKey: "k",
      fetch: vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    });
    await expect(client.request({ userId: USER, dataType: "x", purpose: "y" })).rejects.toMatchObject({ code: "NETWORK_ERROR" });
  });

  it("polls until a pending request is answered", async () => {
    const responses = [{ status: "pending" }, { status: "pending" }, { status: "resolved", decision: "ALLOW" }];
    const fetch = vi.fn(async () => new Response(JSON.stringify(responses.shift())));
    const client = new ConsentOS({ serviceId: "pixly", apiUrl: "https://c.example", apiKey: "k", fetch });
    const result = await client.waitForDecision("req", { intervalMs: 1 });
    expect(result).toMatchObject({ status: "resolved", decision: "ALLOW" });
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});

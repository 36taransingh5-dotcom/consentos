import type { EventSummary } from "@consentos/shared";
import { describe, expect, it } from "vitest";
import { badgeFor, hostOf, isBlock, isServiceId, isTrustedConsentOrigin, newEvents, noticeFor, relativeTime } from "./logic";

const event = (id: string, type: string, extra: Partial<EventSummary> = {}): EventSummary => ({
  id,
  type,
  serviceId: "pixly",
  serviceName: "Pixly",
  decision: null,
  purpose: "foundation_model_training",
  dataType: "uploaded_images",
  receiptId: null,
  requestId: null,
  message: "Pixly tried to use your uploaded images for AI model training.",
  createdAt: new Date().toISOString(),
  ...extra,
});

describe("extension logic", () => {
  it("only trusts the configured ConsentOS origin with tokens", () => {
    expect(isTrustedConsentOrigin("http://localhost:3000", "http://localhost:3000")).toBe(true);
    expect(isTrustedConsentOrigin("http://localhost:3001", "http://localhost:3000")).toBe(false);
    expect(isTrustedConsentOrigin("https://consentos.example.evil.test", "https://consentos.example")).toBe(false);
    expect(isTrustedConsentOrigin("http://localhost:3000", "not a url")).toBe(false);
  });

  it("validates service ids announced by pages", () => {
    expect(isServiceId("pixly")).toBe(true);
    expect(isServiceId("<script>")).toBe(false);
    expect(isServiceId(42)).toBe(false);
  });

  it("finds unseen events, oldest first", () => {
    const events = [event("c", "consent.denied"), event("b", "consent.allowed"), event("a", "consent.allowed")];
    expect(newEvents(events, new Set(["a"])).map((e) => e.id)).toEqual(["b", "c"]);
  });

  it("counts blocks and enforcement refusals for the badge", () => {
    expect(isBlock(event("1", "consent.denied"))).toBe(true);
    expect(isBlock(event("2", "enforcement.blocked"))).toBe(true);
    expect(isBlock(event("3", "consent.allowed"))).toBe(false);
    expect(badgeFor(0).text).toBe("");
    expect(badgeFor(1)).toMatchObject({ text: "1", title: "ConsentOS — 1 blocked" });
    expect(badgeFor(150).text).toBe("99+");
  });

  it("maps events to in-page notices", () => {
    expect(noticeFor(event("1", "consent.denied"))).toMatchObject({ tone: "block", label: "Blocked by your rules" });
    expect(noticeFor(event("2", "consent.allowed"))?.tone).toBe("allow");
    expect(noticeFor(event("3", "policy.updated"))).toBeNull();
  });

  it("formats relative times and hosts", () => {
    const now = Date.parse("2026-09-26T12:00:00Z");
    expect(relativeTime("2026-09-26T11:59:50Z", now)).toBe("Just now");
    expect(relativeTime("2026-09-26T11:55:00Z", now)).toBe("5 min ago");
    expect(hostOf("https://example.com/path")).toBe("example.com");
    expect(hostOf("chrome://extensions")).toBeNull();
  });
});

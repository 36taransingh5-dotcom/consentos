import { describe, expect, it } from "vitest";
import { issueToken, verifyToken } from "@/server/auth/tokens";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { originMatchesDomain } from "@/server/services";

const user = { id: "7e57de30-0000-4000-8000-000000000001", email: "demo@consentos.dev" };

describe("tokens", () => {
  it("round-trips", () => {
    expect(verifyToken(issueToken(user, "extension"), "extension")).toMatchObject({ sub: user.id, scope: "extension" });
  });

  it("does not accept a session token as an extension token", () => {
    expect(verifyToken(issueToken(user, "session"), "extension")).toBeNull();
  });

  it("rejects expired and tampered tokens", () => {
    const old = issueToken(user, "extension", Date.now() - 31 * 24 * 60 * 60 * 1000);
    expect(verifyToken(old, "extension")).toBeNull();

    const [body, mac] = issueToken(user, "extension").split(".");
    const forgedBody = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body!, "base64url").toString()), sub: "someone-else" })).toString("base64url");
    expect(verifyToken(`${forgedBody}.${mac}`, "extension")).toBeNull();
    expect(verifyToken("garbage", "extension")).toBeNull();
    expect(verifyToken(undefined, "extension")).toBeNull();
  });
});

describe("passwords", () => {
  it("verifies the right password only", async () => {
    const hash = await hashPassword("correct horse");
    expect(await verifyPassword("correct horse", hash)).toBe(true);
    expect(await verifyPassword("wrong horse", hash)).toBe(false);
    expect(await verifyPassword("x", null)).toBe(false);
  });
});

describe("originMatchesDomain", () => {
  it("matches host and port exactly", () => {
    expect(originMatchesDomain("http://localhost:3001", "localhost:3001")).toBe(true);
    expect(originMatchesDomain("https://pixly.example", "pixly.example")).toBe(true);
    expect(originMatchesDomain("http://localhost:3002", "localhost:3001")).toBe(false);
    expect(originMatchesDomain("https://pixly.example.evil.test", "pixly.example")).toBe(false);
    expect(originMatchesDomain("not a url", "pixly.example")).toBe(false);
  });
});

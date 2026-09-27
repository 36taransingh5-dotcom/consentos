import { cookies } from "next/headers";
import { isFeatureId, type FeatureId } from "./features";

const COOKIE = "pixly_grants";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Pixly remembers which ConsentOS grant (receipt id) backs each feature, the
 * way a real service would store it next to the user. Grant ids are not
 * secrets — ConsentOS checks every use server-to-server — so an httpOnly
 * cookie is enough for the demo.
 */
export type GrantMap = Partial<Record<FeatureId, string>>;

export async function readGrants(): Promise<GrantMap> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const grants: GrantMap = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (isFeatureId(key) && typeof value === "string" && UUID.test(value)) grants[key] = value;
    }
    return grants;
  } catch {
    return {};
  }
}

export async function writeGrants(grants: GrantMap): Promise<void> {
  (await cookies()).set(COOKIE, JSON.stringify(grants), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function clearGrants(): Promise<void> {
  (await cookies()).delete(COOKIE);
}

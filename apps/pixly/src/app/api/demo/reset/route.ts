import { serverConfig } from "@/lib/config";
import { clearGrants } from "@/lib/grants";

/** POST /api/demo/reset — reset the linked ConsentOS demo account and Pixly's own state. */
export async function POST(req: Request): Promise<Response> {
  if (req.headers.get("origin") !== new URL(req.url).origin) {
    return Response.json({ error: "FORBIDDEN", message: "Cross-origin request rejected." }, { status: 403 });
  }
  if (!serverConfig.demoResetToken) {
    return Response.json({ error: "NOT_CONFIGURED", message: "Demo reset is not configured." }, { status: 404 });
  }
  try {
    const res = await fetch(`${serverConfig.apiUrl}/api/demo/reset`, {
      method: "POST",
      headers: { "x-consentos-demo-token": serverConfig.demoResetToken },
      cache: "no-store",
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      return Response.json({ error: "RESET_FAILED", message: body.message ?? `ConsentOS returned ${res.status}` }, { status: 502 });
    }
  } catch {
    return Response.json({ error: "CONSENTOS_UNAVAILABLE", message: "ConsentOS could not be reached." }, { status: 502 });
  }
  await clearGrants();
  return Response.json({ ok: true });
}

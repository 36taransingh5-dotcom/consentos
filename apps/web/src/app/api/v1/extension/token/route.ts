import { authenticateUserRequest, issueExtensionToken } from "@/server/auth";
import { ApiError } from "@/server/errors";
import { handle, json } from "@/server/http";

/**
 * POST /api/v1/extension/token — exchange the web session for a scoped,
 * expiring extension token. Same-origin only; the page hands the token to the
 * extension's content script, which only accepts it on the ConsentOS origin.
 */
export const POST = handle(async (req: Request) => {
  if (req.headers.get("authorization")) {
    throw new ApiError(400, "SESSION_REQUIRED", "Request an extension token with your web session.");
  }
  const user = await authenticateUserRequest(req, { mutation: true });
  return json({ ...issueExtensionToken(user), user });
});

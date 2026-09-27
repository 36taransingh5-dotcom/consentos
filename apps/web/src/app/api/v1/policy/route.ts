import { updatePolicySchema } from "@consentos/shared";
import { authenticateUserRequest } from "@/server/auth";
import { asUser } from "@/server/db";
import { handle, json, readJson } from "@/server/http";
import { currentPolicy, policyHistory, updatePolicy } from "@/server/policies";

/** GET /api/v1/policy — the signed-in user's current policy and its version history. */
export const GET = handle(async (req: Request) => {
  const user = await authenticateUserRequest(req);
  const result = await asUser(user.id, async (tx) => ({
    current: await currentPolicy(tx, user.id),
    history: await policyHistory(tx, user.id, 20),
  }));
  return json(result);
});

/** PUT /api/v1/policy — save a new immutable policy version. */
export const PUT = handle(async (req: Request) => {
  const user = await authenticateUserRequest(req, { mutation: true });
  const { policy } = await readJson(req, updatePolicySchema);
  return json(await updatePolicy(user.id, policy));
});

import { CONSENTOS, DEMO_RESET_TOKEN, expect, openPopup, PIXLY, shot, tabIdFor, test } from "./fixtures";

/**
 * The two-minute demo, end to end, with the real extension:
 *
 *   rules → extension recognises Pixly → Pixly requests → deterministic
 *   decision → extension reflects it → signed receipt → protected API
 *   verifies → unauthorised action gets 403 → receipt verifies later →
 *   revocation stops the next call.
 */
test("ConsentOS demo flow", async ({ context, worker, extensionId, request }) => {
  // Start from a clean demo account.
  const reset = await request.post(`${CONSENTOS}/api/demo/reset`, {
    headers: { "x-consentos-demo-token": DEMO_RESET_TOKEN },
  });
  expect(reset.ok()).toBe(true);

  // Sign in to ConsentOS as the demo user and connect the extension.
  const web = await context.newPage();
  await web.goto(`${CONSENTOS}/login?next=/extension/connect`);
  await web.getByRole("button", { name: "Continue as demo user" }).click();
  await expect(web.getByRole("heading", { name: "Extension connected" })).toBeVisible();

  // Scene 1 — the extension shows the user's rules.
  await web.goto(`${CONSENTOS}/policy`);
  await expect(web.getByRole("heading", { name: "Your Privacy Rules" })).toBeVisible();
  await shot(web, "01-policy");
  const rulesPopup = await openPopup(context, extensionId);
  await expect(rulesPopup.getByRole("heading", { name: "Your Privacy Rules" })).toBeVisible();
  for (const [label, value] of <[string, string][]>[
    ["AI model training", "BLOCK"],
    ["Targeted advertising", "BLOCK"],
    ["Third-party data sharing", "BLOCK"],
    ["Personalised recommendations", "ALLOW"],
    ["Retention limit", "90 days"],
  ]) {
    await expect(rulesPopup.locator(".rules .row", { hasText: label })).toContainText(value);
  }
  await expect(rulesPopup.getByText("This site has not integrated ConsentOS yet.")).toBeVisible();
  await shot(rulesPopup, "02-popup-rules");
  await rulesPopup.close();

  // Scene 2 — open Pixly. It asks for essential storage, then smart recommendations.
  const pixly = await context.newPage();
  await pixly.goto(PIXLY);
  await expect(pixly.getByText("Account storage: allowed")).toBeVisible();
  const pixlyTab = await tabIdFor(worker, PIXLY);

  await pixly.getByRole("button", { name: "Enable smart recommendations" }).click();
  await expect(pixly.getByText("ConsentOS approved this request")).toBeVisible();
  await expect(pixly.getByText("Personal recommendations enabled.")).toBeVisible();
  await expect(pixly.getByRole("heading", { name: "Picked for you" })).toBeVisible();
  await shot(pixly, "03-pixly-allowed");

  let popup = await openPopup(context, extensionId, pixlyTab);
  await expect(popup.getByText("Protected")).toBeVisible();
  await expect(popup.locator(".stat.allow strong")).toHaveText("2");
  await expect(popup.getByLabel("What Pixly may do")).toContainText("Personalised recommendations");
  await expect(popup.getByLabel("What Pixly may do")).toContainText("Essential account storage");
  await popup.close();

  // Scene 3 — Pixly asks to train AI on the user's photos. Blocked.
  await pixly.getByRole("button", { name: "Help train Pixly AI" }).click();
  const dialog = pixly.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "ConsentOS blocked this action." })).toBeVisible();
  await expect(dialog).toContainText("Your photos cannot be used for foundation-model training.");
  // The extension reacts at the same moment: an in-page notice and a badge.
  await expect(pixly.locator("consentos-notice")).toContainText("Blocked by your rules");
  await expect.poll(() => worker.evaluate(() => chrome.action.getBadgeText({}))).toBe("1");
  await shot(pixly, "04-pixly-blocked");
  await dialog.getByRole("button", { name: "OK" }).click();

  popup = await openPopup(context, extensionId, pixlyTab);
  await expect(popup.getByText("Pixly tried to use your uploaded images for AI model training.")).toBeVisible();
  await expect(popup.locator(".event .pill")).toHaveText("Blocked");
  await expect(popup.getByLabel("What Pixly may do")).toContainText("AI model training");
  await shot(popup, "05-popup-pixly");
  await popup.close();

  // Excessive retention: allowed purpose, but 730 days > 90.
  await pixly.getByRole("button", { name: "Turn on Memories" }).click();
  await expect(dialog).toContainText("Requested retention");
  await expect(dialog).toContainText("730 days");
  await expect(dialog).toContainText("Your limit");
  await expect(dialog).toContainText("90 days");
  await shot(pixly, "06-pixly-retention");
  await dialog.getByRole("button", { name: "OK" }).click();

  // Scene 4 — Pixly's own backend refuses to train without a grant.
  const train = await request.post(`${PIXLY}/api/train-model`, { data: {} });
  expect(train.status()).toBe(403);
  expect(await train.json()).toEqual({
    error: "CONSENT_VIOLATION",
    message: "The user has not granted permission for foundation-model training.",
  });

  // Scene 5 — the personalisation receipt verifies.
  const state = await (await pixly.request.get(`${PIXLY}/api/state`)).json();
  const receiptId: string = state.features.recommendations.receiptId;
  await web.goto(`${CONSENTOS}/receipts/${receiptId}`);
  await expect(web.getByText("Verified", { exact: true })).toBeVisible();
  for (const check of ["Signature verified", "Policy hash verified", "Request hash verified", "Payload unchanged"]) {
    await expect(web.getByText(check)).toBeVisible();
  }
  await shot(web, "07-receipt");
  const verify = await (await request.get(`${CONSENTOS}/api/v1/receipts/${receiptId}/verify`)).json();
  expect(verify).toMatchObject({ valid: true, payloadIntact: true, signatureValid: true });

  // Revocation from the extension stops Pixly's next use.
  popup = await openPopup(context, extensionId, pixlyTab);
  await popup.getByRole("button", { name: "Revoke Personalised recommendations" }).click();
  await expect(popup.locator(".stat.allow strong")).toHaveText("1");
  await popup.close();
  await expect(pixly.getByRole("heading", { name: "Recommendations paused" })).toBeVisible();
  const recs = await pixly.request.get(`${PIXLY}/api/recommendations`);
  expect(recs.status()).toBe(403);
  expect((await recs.json()).error).toBe("CONSENT_REVOKED");
  await shot(pixly, "08-pixly-revoked");
});

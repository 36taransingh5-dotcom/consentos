import { CONSENTOS, DEMO_RESET_TOKEN, expect, openPopup, PIXLY, shot, tabIdFor, test } from "./fixtures";

/**
 * The demo, exactly as presented, with the real extension:
 *
 *   Act 1 — Rule: don't train AI on my photos → Pixly asks → blocked →
 *           Pixly's backend tries anyway → 403.
 *   Act 2 — Recommendations are allowed → signed receipt → receipt
 *           verifies → revoke → access disappears.
 */
test("ConsentOS demo flow", async ({ context, worker, extensionId, request }) => {
  // Start from a clean demo account, signed in, extension connected.
  const reset = await request.post(`${CONSENTOS}/api/demo/reset`, {
    headers: { "x-consentos-demo-token": DEMO_RESET_TOKEN },
  });
  expect(reset.ok()).toBe(true);
  const web = await context.newPage();
  await web.goto(`${CONSENTOS}/login?next=/extension/connect`);
  await web.getByRole("button", { name: "Continue as demo user" }).click();
  await expect(web.getByRole("heading", { name: "Extension connected" })).toBeVisible();
  await web.goto(`${CONSENTOS}/policy`);
  await expect(web.getByRole("heading", { name: "Your Privacy Rules" })).toBeVisible();
  await shot(web, "01-policy");

  /* ------------------------------------------------------------------ */
  /* Act 1 — the rule, the block, the 403                                */
  /* ------------------------------------------------------------------ */

  // The rule: don't train AI on my photos.
  const rulesPopup = await openPopup(context, extensionId);
  await expect(rulesPopup.getByRole("heading", { name: "Your Privacy Rules" })).toBeVisible();
  await expect(rulesPopup.locator(".rules .row", { hasText: "AI model training" })).toContainText("BLOCK");
  for (const [label, value] of <[string, string][]>[
    ["Targeted advertising", "BLOCK"],
    ["Third-party data sharing", "BLOCK"],
    ["Personalised recommendations", "ALLOW"],
    ["Retention limit", "90 days"],
  ]) {
    await expect(rulesPopup.locator(".rules .row", { hasText: label })).toContainText(value);
  }
  await expect(rulesPopup.getByRole("heading", { name: "ConsentOS integration not detected." })).toBeVisible();
  await shot(rulesPopup, "02-popup-rules");
  await rulesPopup.close();

  // Pixly asks → blocked.
  const pixly = await context.newPage();
  await pixly.goto(PIXLY);
  await expect(pixly.getByText("Account storage: allowed")).toBeVisible();
  const pixlyTab = await tabIdFor(worker, PIXLY);

  await pixly.getByRole("button", { name: "Help train Pixly AI" }).click();
  const dialog = pixly.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "ConsentOS blocked this action." })).toBeVisible();
  await expect(dialog).toContainText("Your photos cannot be used for foundation-model training.");
  await expect(dialog).toContainText("Purpose requestedFoundation-model training");
  await expect(dialog).toContainText("Your ConsentOS ruleBLOCK");
  await expect(dialog).toContainText("DecisionDENY");
  // The extension reacts at the same moment: an in-page notice and a badge.
  await expect(pixly.locator("consentos-notice")).toContainText("Blocked by your rules");
  await expect.poll(() => worker.evaluate(() => chrome.action.getBadgeText({}))).toBe("1");

  // The backend tries anyway → 403.
  await dialog.getByRole("button", { name: "Run the training job anyway" }).click();
  await expect(dialog).toContainText("HTTP 403 Forbidden");
  await expect(dialog).toContainText("CONSENT_VIOLATION");
  await expect(dialog).toContainText("The user has not granted permission for foundation-model training.");
  await shot(pixly, "04-pixly-blocked");
  await dialog.getByRole("button", { name: "OK" }).click();

  // Same refusal for any caller, not just the Pixly UI.
  const train = await request.post(`${PIXLY}/api/train-model`, { data: {} });
  expect(train.status()).toBe(403);
  expect(await train.json()).toEqual({
    error: "CONSENT_VIOLATION",
    message: "The user has not granted permission for foundation-model training.",
  });

  // The extension saw both: the blocked request, then the refused attempt.
  let popup = await openPopup(context, extensionId, pixlyTab);
  await expect(
    popup.getByText("Pixly's server tried to use your uploaded images for AI model training without permission."),
  ).toBeVisible();
  await expect(popup.locator(".event .pill")).toHaveText("Refused");
  await expect(popup.getByLabel("Why")).toContainText("Purpose attemptedFoundation-model training");
  await expect(popup.getByLabel("Why")).toContainText("Valid grantNone");
  await expect(popup.getByLabel("Why")).toContainText("Result403 REFUSED");
  await expect(popup.getByLabel("What Pixly may do")).toContainText("AI model training");
  await shot(popup, "05-popup-pixly");
  await popup.close();

  /* ------------------------------------------------------------------ */
  /* Act 2 — allowed, receipted, verified, revoked                       */
  /* ------------------------------------------------------------------ */

  await pixly.getByRole("button", { name: "Enable smart recommendations" }).click();
  await expect(pixly.getByText("ConsentOS approved this request")).toBeVisible();
  await expect(pixly.getByText("Personal recommendations enabled.")).toBeVisible();
  await expect(pixly.getByRole("heading", { name: "Picked for you" })).toBeVisible();
  await shot(pixly, "03-pixly-allowed");

  // The signed receipt verifies.
  const state = await (await pixly.request.get(`${PIXLY}/api/state`)).json();
  const receiptId: string = state.features.recommendations.receiptId;
  await web.goto(`${CONSENTOS}/receipts/${receiptId}`);
  await expect(web.getByText("Verified", { exact: true })).toBeVisible();
  for (const check of ["Signature verified", "Policy hash verified", "Request hash verified", "Payload unchanged"]) {
    await expect(web.getByText(check)).toBeVisible();
  }
  await expect(web.getByLabel("Decision summary")).toContainText("ALLOW");
  await shot(web, "07-receipt");
  const verify = await (await request.get(`${CONSENTOS}/api/v1/receipts/${receiptId}/verify`)).json();
  expect(verify).toMatchObject({ valid: true, payloadIntact: true, signatureValid: true });

  // Revoke → access disappears.
  popup = await openPopup(context, extensionId, pixlyTab);
  await expect(popup.locator(".stat.allow strong")).toHaveText("2");
  await popup.getByRole("button", { name: "Revoke Personalised recommendations" }).click();
  await expect(popup.locator(".stat.allow strong")).toHaveText("1");
  await popup.close();
  await expect(pixly.getByRole("heading", { name: "Recommendations paused" })).toBeVisible();
  const recs = await pixly.request.get(`${PIXLY}/api/recommendations`);
  expect(recs.status()).toBe(403);
  expect((await recs.json()).error).toBe("CONSENT_REVOKED");
  await shot(pixly, "08-pixly-revoked");

  /* ------------------------------------------------------------------ */
  /* Beyond the script: an allowed purpose, but too-long retention       */
  /* ------------------------------------------------------------------ */

  await pixly.getByRole("button", { name: "Turn on Memories" }).click();
  await expect(dialog).toContainText("730 days");
  await expect(dialog).toContainText("90 days");
  await shot(pixly, "06-pixly-retention");
  await dialog.getByRole("button", { name: "OK" }).click();
});

import { CONSENTOS, DEMO_RESET_TOKEN, expect, openPopup, PIXLY, shot, tabIdFor, test } from "./fixtures";
import type { Page } from "@playwright/test";

async function setRule(page: Page, rule: string, option: string) {
  await page.getByRole("radiogroup", { name: rule }).getByText(option, { exact: true }).click();
}

async function save(page: Page, version: number) {
  await page.getByRole("button", { name: `Save as v${version}` }).click();
  await expect(page.getByText(`Saved as v${version}.`)).toBeVisible();
}

test("changing rules changes what Pixly may do", async ({ context, worker, extensionId, request }) => {
  await request.post(`${CONSENTOS}/api/demo/reset`, { headers: { "x-consentos-demo-token": DEMO_RESET_TOKEN } });

  const web = await context.newPage();
  await web.goto(`${CONSENTOS}/login?next=/extension/connect`);
  await web.getByRole("button", { name: "Continue as demo user" }).click();
  await expect(web.getByRole("heading", { name: "Extension connected" })).toBeVisible();

  const pixly = await context.newPage();
  await pixly.goto(PIXLY);
  await expect(pixly.getByText("Account storage: allowed")).toBeVisible();
  await pixly.getByRole("button", { name: "Enable smart recommendations" }).click();
  await expect(pixly.getByText("Personal recommendations enabled.")).toBeVisible();

  // 1. "Ask me" for AI training: Pixly waits, the user answers in the extension.
  //    Pixly's training job keeps photos for a year, so the retention limit must allow that too:
  //    deny-overrides means a retention breach would block it before the user is ever asked.
  await web.goto(`${CONSENTOS}/policy`);
  await setRule(web, "AI model training", "Ask me");
  await web.getByRole("radiogroup", { name: "Maximum retention" }).getByText("365 days").click();
  await save(web, 2);

  await pixly.bringToFront();
  await pixly.getByRole("button", { name: "Help train Pixly AI" }).click();
  await expect(pixly.getByRole("heading", { name: "Your rules want to check with you." })).toBeVisible();

  const pixlyTab = await tabIdFor(worker, PIXLY);
  const popup = await openPopup(context, extensionId, pixlyTab);
  await expect(popup.getByText("Needs your answer")).toBeVisible();
  await shot(popup, "09-popup-needs-answer");
  await popup.getByRole("button", { name: "Allow" }).click();
  await expect(popup.getByText("Needs your answer")).toBeHidden();
  await popup.close();

  // Pixly picks up the answer, and its training job now runs under the grant.
  await expect(pixly.getByText("Thanks — your photos will help train Pixly AI.")).toBeVisible({ timeout: 20_000 });
  const state = await (await pixly.request.get(`${PIXLY}/api/state`)).json();
  expect(state.features.training.status).toBe("active");
  const train = await pixly.request.post(`${PIXLY}/api/train-model`, {
    data: { grantId: state.features.training.receiptId },
  });
  expect(train.status()).toBe(202);

  // 2. Blocking personalisation revokes the live grant automatically.
  await web.bringToFront();
  await web.reload();
  await setRule(web, "Personalised recommendations", "Block");
  await web.getByRole("button", { name: "Save as v3" }).click();
  await expect(web.getByText(/Saved as v3\. 1 existing grant no longer fits your rules and was revoked\./)).toBeVisible();

  await pixly.bringToFront();
  await expect(pixly.getByRole("heading", { name: "Recommendations paused" })).toBeVisible({ timeout: 15_000 });
  const recs = await pixly.request.get(`${PIXLY}/api/recommendations`);
  expect(recs.status()).toBe(403);
  expect((await recs.json()).error).toBe("CONSENT_REVOKED");

  // Receipts still point at the version that decided them.
  await web.goto(`${CONSENTOS}/receipts`);
  await expect(web.getByRole("heading", { name: "All decisions" })).toBeVisible();
  await web.getByRole("link", { name: /Pixly · AI model training/ }).first().click();
  await expect(web.getByText("Policy version")).toBeVisible();
  await expect(web.getByText("v2", { exact: true })).toBeVisible();
  await expect(web.getByText("Verified", { exact: true })).toBeVisible();
});

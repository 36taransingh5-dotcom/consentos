import type { Page } from "@playwright/test";
import { expect, openPopup, registeredTabs, signInAndConnect, test } from "./fixtures";

const html = (head: string) => `<!doctype html><html><head><title>Test page</title>${head}</head><body><h1>Test page</h1></body></html>`;

async function newlyRegisteredTab(worker: Parameters<typeof registeredTabs>[0], before: number[]): Promise<number> {
  let found: number | undefined;
  await expect
    .poll(async () => {
      found = (await registeredTabs(worker)).find((id) => !before.includes(id));
      return found;
    })
    .toBeDefined();
  return found!;
}

async function open(context: import("@playwright/test").BrowserContext, url: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(url);
  return page;
}

test("the extension only treats explicit, origin-verified integrations as protected", async ({
  context,
  worker,
  extensionId,
}) => {
  await signInAndConnect(context);

  // 1. A page on Pixly's origin that declares itself only via window.__CONSENTOS_SERVICE__.
  await context.route("http://localhost:3001/declared-by-global", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: html(`<script>window.__CONSENTOS_SERVICE__ = { serviceId: "pixly", name: "Pixly", protocol: "consentos/1" };</script>`),
    }),
  );
  let before = await registeredTabs(worker);
  await open(context, "http://localhost:3001/declared-by-global");
  const globalTab = await newlyRegisteredTab(worker, before);
  let popup = await openPopup(context, extensionId, globalTab);
  await expect(popup.locator(".site-name")).toHaveText("Pixly");
  await expect(popup.getByText("Protected", { exact: true })).toBeVisible();
  await popup.close();

  // 2. A page on another origin claiming to be Pixly: not treated as Pixly.
  await context.route("http://localhost:4010/**", (route) =>
    route.fulfill({ contentType: "text/html", body: html(`<meta name="consentos-service" content="pixly">`) }),
  );
  before = await registeredTabs(worker);
  await open(context, "http://localhost:4010/impostor");
  const impostorTab = await newlyRegisteredTab(worker, before);
  popup = await openPopup(context, extensionId, impostorTab);
  await expect(popup.getByRole("alert")).toContainText("Unverified claim");
  await expect(popup.getByRole("alert")).toContainText("isn't served from Pixly's registered address");
  await expect(popup.getByText("Protected", { exact: true })).toHaveCount(0);
  await popup.close();

  // 3. A site with no integration is never shown as protected.
  await context.route("http://localhost:4011/**", (route) => route.fulfill({ contentType: "text/html", body: html("") }));
  const plain = await open(context, "http://localhost:4011/");
  await plain.waitForTimeout(1500);
  // No registration happened for the plain site, so describe the popup's own tab (no service).
  popup = await openPopup(context, extensionId);
  await expect(popup.getByRole("heading", { name: "ConsentOS integration not detected." })).toBeVisible();
  await expect(popup.getByText("Protected", { exact: true })).toHaveCount(0);
  expect((await registeredTabs(worker)).length).toBe(2);
});

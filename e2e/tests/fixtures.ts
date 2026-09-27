import { chromium, test as base, type BrowserContext, type Page, type Worker } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, "../..");
/** E2E_HOSTED=1 runs against deployed URLs with an extension built for them. */
export const HOSTED = process.env.E2E_HOSTED === "1";
export const CONSENTOS = (process.env.E2E_CONSENTOS_URL ?? "http://localhost:3000").replace(/\/+$/, "");
export const PIXLY = (process.env.E2E_PIXLY_URL ?? "http://localhost:3001").replace(/\/+$/, "");
export const DEMO_RESET_TOKEN = process.env.E2E_DEMO_RESET_TOKEN ?? "cos_test_demo_reset_local_only";

const EXTENSION = path.join(ROOT, HOSTED ? "apps/extension/dist-hosted" : "apps/extension/dist");
// Local runs refresh the README screenshots; hosted runs keep theirs out of the repo.
export const SHOTS = HOSTED ? path.join(ROOT, "e2e/test-results/hosted-screenshots") : path.join(ROOT, "docs/screenshots");

export const test = base.extend<{ context: BrowserContext; worker: Worker; extensionId: string }>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext("", {
      channel: "chromium",
      viewport: { width: 1280, height: 860 },
      args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
    });
    // Quality bar: no uncaught errors or console errors on any page, popup included.
    const errors: string[] = [];
    const watch = (page: Page) => {
      page.on("pageerror", (error) => errors.push(`${page.url()} — ${error.message}`));
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(`${page.url()} — ${message.text()}`);
      });
    };
    context.pages().forEach(watch);
    context.on("page", watch);
    await use(context);
    await context.close();
    expect(errors, "console errors during the test").toEqual([]);
  },
  worker: async ({ context }, use) => {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
    await use(worker);
  },
  extensionId: async ({ worker }, use) => {
    await use(new URL(worker.url()).host);
  },
});

export const expect = test.expect;

export async function shot(page: Page, name: string) {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

/** Open the popup as a page, pinned to a tab (or to itself for "no site"). */
export async function openPopup(context: BrowserContext, extensionId: string, tabId?: number): Promise<Page> {
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 380, height: 600 });
  await popup.goto(`chrome-extension://${extensionId}/popup.html${tabId ? `?tabId=${tabId}` : ""}`);
  return popup;
}

/**
 * The extension has no `tabs` permission, so it cannot read tab URLs. Find the
 * tab through its own registry of tabs that announced a ConsentOS service.
 */
export async function tabIdFor(worker: Worker, origin: string): Promise<number> {
  let id: number | null = null;
  await expect
    .poll(async () => {
      id = await worker.evaluate(async (wanted) => {
        const all = await chrome.storage.session.get(null);
        const entry = Object.entries(all).find(
          ([key, value]) => key.startsWith("tab:") && (value as { origin: string }).origin === wanted,
        );
        return entry ? Number(entry[0].slice(4)) : null;
      }, origin);
      return id;
    })
    .not.toBeNull();
  return id!;
}

/** Reset the demo account, sign in as the demo user and connect the extension. */
export async function signInAndConnect(context: BrowserContext): Promise<Page> {
  const reset = await context.request.post(`${CONSENTOS}/api/demo/reset`, {
    headers: { "x-consentos-demo-token": DEMO_RESET_TOKEN },
  });
  expect(reset.ok()).toBe(true);
  const web = await context.newPage();
  await web.goto(`${CONSENTOS}/login?next=/extension/connect`);
  await web.getByRole("button", { name: "Continue as demo user" }).click();
  await expect(web.getByRole("heading", { name: "Extension connected" })).toBeVisible();
  return web;
}

/** Tab ids the extension has registered as belonging to a ConsentOS service. */
export async function registeredTabs(worker: Worker): Promise<number[]> {
  return worker.evaluate(async () => {
    const all = await chrome.storage.session.get(null);
    return Object.keys(all)
      .filter((key) => key.startsWith("tab:"))
      .map((key) => Number(key.slice(4)));
  });
}

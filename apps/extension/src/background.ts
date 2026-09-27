import { ApiError, fetchState } from "./lib/api";
import { POLL_MINUTES } from "./lib/config";
import { badgeFor, isBlock, isServiceId, isTrustedConsentOrigin, newEvents, noticeFor } from "./lib/logic";
import type { ToBackground, ToContent } from "./lib/messages";
import {
  getApiUrl,
  getConnection,
  getEventCursor,
  removeTabService,
  setConnection,
  setEventCursor,
  setTabService,
  setUnreadBlocked,
  tabsShowing,
} from "./lib/storage";

/**
 * Background service worker.
 *
 * It never decides anything. It learns which tabs belong to integrated
 * services, polls ConsentOS for the user's latest decisions, keeps the badge
 * in sync, and asks content scripts to show a brief notice when a decision
 * lands on the page the user is looking at.
 */

function setupAlarm() {
  void chrome.alarms.create("poll", { periodInMinutes: POLL_MINUTES });
  void poll();
}

chrome.runtime.onInstalled.addListener(setupAlarm);
chrome.runtime.onStartup.addListener(setupAlarm);
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "poll") void poll();
});
chrome.tabs.onRemoved.addListener((tabId) => void removeTabService(tabId));

async function renderBadge(unreadBlocked: number, connected: boolean) {
  if (!connected) {
    await chrome.action.setBadgeText({ text: "" });
    await chrome.action.setTitle({ title: "ConsentOS — not connected" });
    return;
  }
  const badge = badgeFor(unreadBlocked);
  await chrome.action.setBadgeBackgroundColor({ color: badge.color });
  await chrome.action.setBadgeTextColor?.({ color: "#ffffff" });
  await chrome.action.setBadgeText({ text: badge.text });
  await chrome.action.setTitle({ title: badge.title });
}

let inFlight: Promise<void> | null = null;
let queued = false;

/** Poll ConsentOS for new decisions. Coalesces concurrent triggers. */
function poll(): Promise<void> {
  if (inFlight) {
    queued = true;
    return inFlight;
  }
  inFlight = (async () => {
    try {
      await pollOnce();
    } finally {
      inFlight = null;
      if (queued) {
        queued = false;
        void poll();
      }
    }
  })();
  return inFlight;
}

async function pollOnce() {
  const connection = await getConnection();
  if (!connection) {
    await renderBadge(0, false);
    return;
  }

  let state;
  try {
    state = await fetchState(connection);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      await setConnection(null);
      await renderBadge(0, false);
    }
    return;
  }

  const cursor = await getEventCursor();
  const fresh = newEvents(state.recentEvents, cursor.seen);
  const seen = [...cursor.seen, ...fresh.map((e) => e.id)];

  // First poll after connecting: remember history without replaying it.
  if (!cursor.primed) {
    await setEventCursor({ seen, unreadBlocked: 0, primed: true });
    await renderBadge(0, true);
    return;
  }

  let unreadBlocked = cursor.unreadBlocked;
  for (const event of fresh) {
    if (isBlock(event)) unreadBlocked += 1;
    const notice = noticeFor(event);
    if (!notice || !event.serviceId) continue;
    for (const tabId of await tabsShowing(event.serviceId)) {
      const message: ToContent = { type: "notice", notice };
      chrome.tabs.sendMessage(tabId, message).catch(() => undefined);
    }
  }
  await setEventCursor({ seen, unreadBlocked, primed: true });
  await renderBadge(unreadBlocked, true);
}

chrome.runtime.onMessage.addListener((raw: unknown, sender, sendResponse) => {
  const message = raw as ToBackground;
  // Only accept messages from this extension's own content scripts and pages.
  if (sender.id !== chrome.runtime.id) return false;

  switch (message.type) {
    case "service-detected": {
      const tabId = sender.tab?.id;
      // sender.origin comes from the browser, not from the page.
      const origin = sender.origin ?? (sender.url ? new URL(sender.url).origin : undefined);
      if (tabId === undefined || !origin || !isServiceId(message.serviceId)) return false;
      void setTabService(tabId, {
        serviceId: message.serviceId,
        name: typeof message.name === "string" ? message.name.slice(0, 60) : undefined,
        origin,
        detectedAt: new Date().toISOString(),
      });
      return false;
    }

    case "decision-hint":
    case "refresh":
      void poll();
      return false;

    case "popup-opened":
      void getConnection().then(async (connection) => {
        await setUnreadBlocked(0);
        await renderBadge(0, Boolean(connection));
      });
      return false;

    case "connect": {
      void (async () => {
        const origin = sender.origin ?? (sender.url ? new URL(sender.url).origin : "");
        const apiUrl = await getApiUrl();
        if (!sender.tab || !isTrustedConsentOrigin(origin, apiUrl) || !isTrustedConsentOrigin(origin, message.apiUrl)) {
          sendResponse({ ok: false, error: `This extension is set up for ${apiUrl}.` });
          return;
        }
        if (typeof message.token !== "string" || !message.user?.email) {
          sendResponse({ ok: false, error: "Malformed connection." });
          return;
        }
        await setConnection({ apiUrl, token: message.token, user: message.user, expiresAt: message.expiresAt });
        await poll();
        sendResponse({ ok: true });
      })();
      return true; // async response
    }

    default:
      return false;
  }
});

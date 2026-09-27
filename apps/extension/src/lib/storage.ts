import { DEFAULT_API_URL } from "./config";
import type { Connection, TabService } from "./messages";

/**
 * chrome.storage.local: the server URL, the connection (scoped token), and
 * which events the user has already been told about. Pages cannot read it.
 * chrome.storage.session: which tab is showing which service.
 */

interface LocalData {
  apiUrl?: string;
  connection?: Connection | null;
  seenEventIds?: string[];
  unreadBlocked?: number;
  primed?: boolean;
}

async function getLocal(): Promise<LocalData> {
  return (await chrome.storage.local.get(null)) as LocalData;
}

export async function getApiUrl(): Promise<string> {
  return (await getLocal()).apiUrl ?? DEFAULT_API_URL;
}

export async function setApiUrl(apiUrl: string): Promise<void> {
  await chrome.storage.local.set({ apiUrl: apiUrl.replace(/\/+$/, "") });
}

export async function getConnection(): Promise<Connection | null> {
  const { connection } = await getLocal();
  if (!connection) return null;
  if (new Date(connection.expiresAt).getTime() <= Date.now()) return null;
  return connection;
}

export async function setConnection(connection: Connection | null): Promise<void> {
  await chrome.storage.local.set({ connection, seenEventIds: [], unreadBlocked: 0, primed: false });
}

export async function getEventCursor(): Promise<{ seen: Set<string>; unreadBlocked: number; primed: boolean }> {
  const data = await getLocal();
  return { seen: new Set(data.seenEventIds ?? []), unreadBlocked: data.unreadBlocked ?? 0, primed: data.primed ?? false };
}

export async function setEventCursor(cursor: { seen: string[]; unreadBlocked: number; primed: boolean }): Promise<void> {
  await chrome.storage.local.set({
    seenEventIds: cursor.seen.slice(-200),
    unreadBlocked: cursor.unreadBlocked,
    primed: cursor.primed,
  });
}

export async function setUnreadBlocked(unreadBlocked: number): Promise<void> {
  await chrome.storage.local.set({ unreadBlocked });
}

const tabKey = (tabId: number) => `tab:${tabId}`;

export async function setTabService(tabId: number, info: TabService): Promise<void> {
  await chrome.storage.session.set({ [tabKey(tabId)]: info });
}

export async function getTabService(tabId: number): Promise<TabService | null> {
  const data = await chrome.storage.session.get(tabKey(tabId));
  return (data[tabKey(tabId)] as TabService | undefined) ?? null;
}

export async function removeTabService(tabId: number): Promise<void> {
  await chrome.storage.session.remove(tabKey(tabId));
}

export async function tabsShowing(serviceId: string): Promise<number[]> {
  const all = await chrome.storage.session.get(null);
  return Object.entries(all)
    .filter(([key, value]) => key.startsWith("tab:") && (value as TabService).serviceId === serviceId)
    .map(([key]) => Number(key.slice(4)));
}

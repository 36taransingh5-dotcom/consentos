/** Messages between the content script, the background worker and the popup. */

export interface Connection {
  apiUrl: string;
  token: string;
  user: { id: string; email: string };
  expiresAt: string;
}

export type ToBackground =
  | { type: "service-detected"; serviceId: string; name?: string }
  | { type: "decision-hint"; requestId?: string }
  | { type: "connect"; token: string; user: { id: string; email: string }; apiUrl: string; expiresAt: string }
  | { type: "popup-opened" }
  | { type: "refresh" };

export interface Notice {
  tone: "allow" | "block" | "ask";
  label: string;
  message: string;
  serviceName: string;
}

export type ToContent = { type: "notice"; notice: Notice };

/** A page on a registered service, as seen by the content script. */
export interface TabService {
  serviceId: string;
  name?: string;
  /** The tab's real origin, provided by the browser (not by the page). */
  origin: string;
  detectedAt: string;
}

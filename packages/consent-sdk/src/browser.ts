/**
 * Browser helpers. They never carry secrets and never make decisions: they
 * only tell the ConsentOS extension which service this page belongs to, and
 * nudge it to refresh when a decision has been made. The extension always
 * fetches the truth from ConsentOS itself and checks this page's origin
 * against the service's registered domain.
 */

export const PROTOCOL = "consentos/1";

export interface ServiceAnnouncement {
  serviceId: string;
  name?: string;
}

declare global {
  interface Window {
    __CONSENTOS_SERVICE__?: ServiceAnnouncement & { protocol: string };
  }
}

/** Declare that this page is an integrated ConsentOS service. Idempotent. */
export function announceService(announcement: ServiceAnnouncement): void {
  if (typeof window === "undefined") return;
  window.__CONSENTOS_SERVICE__ = { ...announcement, protocol: PROTOCOL };

  let meta = document.querySelector<HTMLMetaElement>('meta[name="consentos-service"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = "consentos-service";
    document.head.appendChild(meta);
  }
  meta.content = announcement.serviceId;
  if (announcement.name) meta.dataset.name = announcement.name;

  window.postMessage(
    { source: "consentos-sdk", type: "announce", protocol: PROTOCOL, ...announcement },
    window.location.origin,
  );
}

/** Tell the extension a decision just happened so it refreshes immediately. */
export function notifyDecision(event: { requestId: string }): void {
  if (typeof window === "undefined") return;
  window.postMessage({ source: "consentos-sdk", type: "decision", requestId: event.requestId }, window.location.origin);
}

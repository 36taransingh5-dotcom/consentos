import { DEFAULT_API_URL } from "./lib/config";
import { isServiceId, isTrustedConsentOrigin } from "./lib/logic";
import type { Notice, ToBackground, ToContent } from "./lib/messages";

/**
 * Content script. Runs on every page but only acts on explicit integrations:
 *
 *  - an integrated service declares itself with
 *    <meta name="consentos-service" content="…"> or the SDK's announce message;
 *  - on the ConsentOS web app (and only there) it relays the extension token;
 *  - it renders a short notice when the background worker reports a decision.
 *
 * No DOM scraping, and nothing a page says is treated as a decision.
 */

const ORIGIN = window.location.origin;

function send(message: ToBackground) {
  chrome.runtime.sendMessage(message).catch(() => undefined);
}

function announce(serviceId: string, name?: string) {
  if (isServiceId(serviceId)) send({ type: "service-detected", serviceId, name });
}

const meta = document.querySelector<HTMLMetaElement>('meta[name="consentos-service"]');
if (meta?.content) announce(meta.content, meta.dataset.name);

async function onConsentOSOrigin(): Promise<boolean> {
  const { apiUrl } = (await chrome.storage.local.get("apiUrl")) as { apiUrl?: string };
  return isTrustedConsentOrigin(ORIGIN, apiUrl ?? DEFAULT_API_URL);
}

function reply(data: Record<string, unknown>) {
  window.postMessage({ source: "consentos-extension", ...data }, ORIGIN);
}

void onConsentOSOrigin().then((trusted) => {
  if (trusted) reply({ type: "hello", version: chrome.runtime.getManifest().version });
});

window.addEventListener("message", (event: MessageEvent) => {
  if (event.source !== window || event.origin !== ORIGIN) return;
  const data = event.data as Record<string, unknown> | null;
  if (!data || typeof data !== "object") return;

  if (data.source === "consentos-sdk") {
    if (data.type === "announce" && typeof data.serviceId === "string") {
      announce(data.serviceId, typeof data.name === "string" ? data.name : undefined);
    } else if (data.type === "decision") {
      send({ type: "decision-hint", requestId: typeof data.requestId === "string" ? data.requestId : undefined });
    }
    return;
  }

  if (data.source === "consentos-web") {
    void onConsentOSOrigin().then(async (trusted) => {
      if (!trusted) return;
      if (data.type === "ping") {
        reply({ type: "hello", version: chrome.runtime.getManifest().version });
      } else if (data.type === "connect") {
        const response = (await chrome.runtime
          .sendMessage({
            type: "connect",
            token: data.token,
            user: data.user,
            apiUrl: data.apiUrl,
            expiresAt: data.expiresAt,
          } as ToBackground)
          .catch(() => ({ ok: false, error: "The extension did not respond." }))) as { ok: boolean; error?: string };
        reply(response.ok ? { type: "connected" } : { type: "connect-failed", error: response.error });
      }
    });
  }
});

/* ------------------------------------------------------------------ */
/* In-page notice                                                      */
/* ------------------------------------------------------------------ */

const TONES: Record<Notice["tone"], { fg: string; bg: string; dot: string }> = {
  block: { fg: "#b42318", bg: "#fdf0ee", dot: "#d92d20" },
  allow: { fg: "#087443", bg: "#eaf7f0", dot: "#12b76a" },
  ask: { fg: "#9a5a04", bg: "#fff6e3", dot: "#f79009" },
};

let host: HTMLElement | null = null;
let hideTimer: number | undefined;

function showNotice(notice: Notice) {
  if (!host) {
    host = document.createElement("consentos-notice");
    host.style.cssText =
      "all: initial; position: fixed; inset: 16px 16px auto auto; margin: 0; padding: 0; border: 0; " +
      "background: transparent; overflow: visible; display: block; z-index: 2147483647;";
    host.attachShadow({ mode: "open" });
    // A manual popover renders in the browser's top layer, above page modals.
    host.setAttribute("popover", "manual");
    document.documentElement.appendChild(host);
  }
  try {
    if (!host.matches(":popover-open")) host.showPopover();
  } catch {
    // Popover unsupported or element detached: the fixed position still works.
  }
  const root = host.shadowRoot!;
  const tone = TONES[notice.tone];
  root.innerHTML = `
    <style>
      .card { width: 320px; box-sizing: border-box; font: 13px/1.45 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
        color: #111113; background: #ffffff; border: 1px solid #e6e6e1; border-radius: 16px; padding: 14px 16px;
        box-shadow: 0 12px 32px -12px rgba(17,17,19,.28), 0 2px 6px rgba(17,17,19,.06);
        animation: in .28s cubic-bezier(.2,.8,.2,1) both; }
      .top { display: flex; align-items: center; gap: 8px; }
      .brand { font-weight: 600; letter-spacing: -.01em; }
      .mark { width: 18px; height: 18px; }
      .close { margin-left: auto; border: 0; background: none; color: #6b6b73; font-size: 16px; cursor: pointer; line-height: 1; padding: 2px 4px; border-radius: 6px; }
      .close:focus-visible { outline: 2px solid #2442d6; }
      .label { display: inline-flex; align-items: center; gap: 6px; margin-top: 10px; padding: 2px 8px; border-radius: 999px;
        font-size: 10.5px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: ${tone.fg}; background: ${tone.bg}; }
      .dot { width: 6px; height: 6px; border-radius: 999px; background: ${tone.dot}; }
      .msg { margin: 8px 0 0; color: #3a3a40; }
      @keyframes in { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: none; } }
      @media (prefers-reduced-motion: reduce) { .card { animation: none; } }
    </style>
    <div class="card" role="status" aria-live="polite">
      <div class="top">
        <svg class="mark" viewBox="0 0 32 32" aria-hidden="true"><rect x="1" y="1" width="30" height="30" rx="9" fill="#111113"/><rect x="7" y="11" width="18" height="10" rx="5" fill="none" stroke="#fff" stroke-width="2"/><circle cx="20" cy="16" r="3" fill="#fff"/></svg>
        <span class="brand">ConsentOS</span>
        <button class="close" type="button" aria-label="Dismiss">×</button>
      </div>
      <span class="label"><span class="dot"></span></span>
      <p class="msg"></p>
    </div>`;
  // Text is set via textContent, never parsed as HTML.
  root.querySelector(".label")!.append(notice.label);
  root.querySelector(".msg")!.textContent = notice.message;
  root.querySelector(".close")!.addEventListener("click", hide);
  window.clearTimeout(hideTimer);
  hideTimer = window.setTimeout(hide, 6000);
}

function hide() {
  host?.remove();
  host = null;
}

chrome.runtime.onMessage.addListener((raw: unknown) => {
  const message = raw as ToContent;
  if (message?.type === "notice") showNotice(message.notice);
});

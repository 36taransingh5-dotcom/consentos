/**
 * Runs in the page's own JavaScript world (MV3 `world: "MAIN"`), where it can
 * see `window.__CONSENTOS_SERVICE__`, which the isolated content script cannot.
 * It only re-announces what the page itself declared; the extension still
 * verifies the page's origin against the service's registered domain.
 */
interface Declared {
  serviceId?: unknown;
  name?: unknown;
}

function announce(): boolean {
  const declared = (window as unknown as { __CONSENTOS_SERVICE__?: Declared }).__CONSENTOS_SERVICE__;
  if (!declared || typeof declared.serviceId !== "string") return false;
  window.postMessage(
    {
      source: "consentos-sdk",
      type: "announce",
      serviceId: declared.serviceId,
      name: typeof declared.name === "string" ? declared.name : undefined,
    },
    window.location.origin,
  );
  return true;
}

// Apps often declare themselves after hydration; look a few times, then stop.
if (!announce()) {
  let attempts = 0;
  const timer = window.setInterval(() => {
    if (announce() || ++attempts >= 10) window.clearInterval(timer);
  }, 500);
}

declare const __CONSENTOS_API_URL__: string | undefined;

/** Default ConsentOS server, set at build time (CONSENTOS_API_URL). */
export const DEFAULT_API_URL: string =
  typeof __CONSENTOS_API_URL__ === "string" ? __CONSENTOS_API_URL__ : "http://localhost:3000";

/** How often the background worker polls while idle. Chrome's minimum is 30 s. */
export const POLL_MINUTES = 0.5;

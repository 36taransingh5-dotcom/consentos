const apiUrl = (process.env.CONSENTOS_API_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const local = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(apiUrl);

/**
 * Server-side configuration. The API key is Pixly's secret and never reaches
 * the browser. Local test values are only used against a local ConsentOS.
 */
export const serverConfig = {
  apiUrl,
  apiKey: process.env.CONSENTOS_API_KEY ?? (local ? "cos_test_pixly_local_only_7c1f3e9a2b" : undefined),
  /**
   * The ConsentOS user this Pixly account is linked to. A production service
   * would learn this through an account-linking flow; the demo links Pixly's
   * signed-in user to the ConsentOS demo account.
   */
  consentosUserId: process.env.PIXLY_CONSENTOS_USER_ID ?? "7e57de30-0000-4000-8000-000000000001",
  demoResetToken: process.env.CONSENTOS_DEMO_RESET_TOKEN ?? (local ? "cos_test_demo_reset_local_only" : undefined),
};

/** Public: where the "Protected by ConsentOS" links go. */
export const CONSENTOS_WEB_URL = process.env.NEXT_PUBLIC_CONSENTOS_WEB_URL ?? "http://localhost:3000";

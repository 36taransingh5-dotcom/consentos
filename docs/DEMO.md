# The two-minute demo

Everything here is live: real API calls, real signatures, real `403`s. The same flow is automated in [`e2e/tests/demo.spec.ts`](../e2e/tests/demo.spec.ts).

## Before you start (≈1 minute, once)

```bash
pnpm install
pnpm dev                 # ConsentOS :3000 · Pixly :3001 · extension build (watch)
```

1. In Chrome, open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and choose `apps/extension/dist`. Pin the ConsentOS icon.
2. Go to <http://localhost:3000/login> and click **Continue as demo user**.
3. Go to <http://localhost:3000/extension/connect>. It should say **Extension connected**.
4. To start clean: on <http://localhost:3000/policy>, click **Reset demo** (or use the button in Pixly's inspector bar).

Keep two tabs open: **ConsentOS** (`/policy`) and **Pixly** (`localhost:3001`).

**Using the live deployment instead:** build the extension with `CONSENTOS_API_URL=https://consentos.vercel.app EXTENSION_OUT_DIR=dist-hosted pnpm --filter @consentos/extension build`, load `apps/extension/dist-hosted`, and use https://consentos.vercel.app and https://consentos-pixly.vercel.app in place of the localhost URLs.

---

## Act 1 — "Don't train AI on my photos" (≈50 s)

**The rule.** Open the extension: **Your Privacy Rules → AI model training: BLOCK.**

> "I set this once. Every app that integrates ConsentOS has to ask it."

**Pixly asks.** In Pixly, click **Help train Pixly AI**.

**Blocked.** Pixly shows *"ConsentOS blocked this action."* with the reasoning spelled out: *Purpose requested: Foundation-model training → Your ConsentOS rule: BLOCK → Decision: DENY*. At the same moment the extension shows its own notice and its badge turns to **1**.

**The backend tries anyway.** In the same dialog, click **Run the training job anyway**. Pixly's real server calls its protected `/api/train-model` endpoint, which asks ConsentOS for a grant first:

```http
POST /api/train-model  →  HTTP 403 Forbidden
{ "error": "CONSENT_VIOLATION",
  "message": "The user has not granted permission for foundation-model training." }
```

> "That's not the UI hiding a button. The training job itself refused to run."

(Open the extension if you like: *Pixly's server tried … without permission. ConsentOS refused.* Purpose attempted → Valid grant: None → 403 REFUSED.)

## Act 2 — "Recommendations are fine" (≈50 s)

**Allowed.** Click **Enable smart recommendations**. You get *"ConsentOS approved this request. Personal recommendations enabled."*, and *Picked for you* appears.

**Signed receipt.** Click **Receipt** in the Smart recommendations card (or *View signed receipt* in the confirmation).

**It verifies.** The receipt page shows **Verified**: signature, policy hash, request hash, payload unchanged. Optional: click **Stretch retention to 10 years** under tamper detection, and the edited copy fails.

> "This proves exactly what I allowed, under exactly which version of my rules, when."

**Revoke → access disappears.** In the extension, click **Revoke** next to Personalised recommendations. Within a few seconds Pixly shows **Recommendations paused**, and its recommendations endpoint now returns `403 CONSENT_REVOKED`.

> **Privacy shouldn't be a popup you click. It should be infrastructure software has to obey.**

---

### If something looks off

- **Extension says "Connect ConsentOS"**: visit `/extension/connect` again while signed in.
- **Popup shows "Can't reach ConsentOS"**: is `pnpm dev` running? The server URL is under the gear icon.
- **Pixly shows a red "can't reach ConsentOS" bar**: ConsentOS isn't running on :3000.
- **Retention limits:** **Turn on Memories** asks for 730 days; personalisation is allowed, but it's blocked with *Requested retention 730 days · Your limit 90 days*.
- **Want to show "Ask me"?** On `/policy`, set AI model training to **Ask me** and the retention limit to **365 days**, then save. Pixly waits, and you answer with **Allow** in the extension. The retention limit matters because of deny-overrides: a 365-day request under a 90-day limit is blocked before you're ever asked.

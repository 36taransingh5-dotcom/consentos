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

---

## Scene 1 — the rules (15 s)

Open the extension on the ConsentOS tab.

> "I set these once. Every site that integrates ConsentOS has to ask them."

The popup shows **Your Privacy Rules**: AI model training BLOCK · Targeted advertising BLOCK · Third-party sharing BLOCK · Personalised recommendations ALLOW · Retention limit 90 days. The site card reads *"This site has not integrated ConsentOS yet. Your policy remains active for supported services."*

## Scene 2 — a request that's allowed (25 s)

Switch to **Pixly** and click **Enable smart recommendations**.

- Pixly's backend sends `POST /api/v1/consent/evaluate` (purpose `personalization`, 30 days, not shared).
- The toast reads **"ConsentOS approved this request — Personal recommendations enabled."** and *Picked for you* appears, served by a consent-protected endpoint.
- Open the extension: **Protected on Pixly · Allowed 2** (essential storage, which Pixly asked for on load, plus recommendations) with **Revoke** buttons.
- Optional: expand Pixly's **Protocol inspector** at the bottom to show the exact JSON request and response.

## Scene 3 — a request that's blocked (25 s)

Click **Help train Pixly AI**.

- Pixly shows **"ConsentOS blocked this action. Your photos cannot be used for foundation-model training."**
- At the same moment the extension shows an in-page notice (*Blocked by your rules*) and the badge turns red with **1**.
- Open the extension: *Latest: Pixly tried to use your uploaded images for AI model training. BLOCKED.* AI model training is marked *tried just now*.

Optional (10 s): click **Turn on Memories**. Personalisation is allowed, but Memories wants 730 days: **Requested retention 730 days · Your limit 90 days**.

## Scene 4 — the backend can't cheat (20 s)

In Pixly's inspector, open **Enforcement lab** and click **Run the training job** (or run `curl -i -X POST http://localhost:3001/api/train-model`):

```http
HTTP/1.1 403 Forbidden
{ "error": "CONSENT_VIOLATION",
  "message": "The user has not granted permission for foundation-model training." }
```

> "This isn't the UI hiding a button. Pixly's training job asked ConsentOS, and ConsentOS said no."

Then click **Reuse the recommendations grant**. A perfectly valid grant, for the wrong purpose, is still refused: *"The presented grant covers personalisation, not foundation-model training."*

## Scene 5 — the receipt (20 s)

In the recommendations feature card, click **Receipt**, or open it from the extension or `/receipts`.

- **Verified**: ✓ Signature verified · ✓ Policy hash verified · ✓ Request hash verified · ✓ Payload unchanged.
- "How the decision was made" lists every check the deterministic engine ran.
- Click **Stretch retention to 10 years** under *See tamper detection*. The edited copy fails its signature and hash checks.

> "This proves exactly what was authorised, under exactly which version of my rules, at that moment."

## Close (10 s)

In the extension, click **Revoke** on Personalised recommendations. Within a few seconds Pixly shows **Recommendations paused**, and its endpoint now returns `403 CONSENT_REVOKED`.

> **Privacy shouldn't be a popup you click. It should be infrastructure software has to obey.**

---

### If something looks off

- **Extension says "Connect ConsentOS"**: visit `/extension/connect` again while signed in.
- **Popup shows "Can't reach ConsentOS"**: is `pnpm dev` running? The server URL is under the gear icon.
- **Pixly shows a red "can't reach ConsentOS" bar**: ConsentOS isn't running on :3000.
- **Want to show "Ask me"?** On `/policy`, set AI model training to **Ask me** and the retention limit to **365 days**, then save. Pixly waits, and you answer with **Allow** in the extension. The retention limit matters because of deny-overrides: a 365-day request under a 90-day limit is blocked before you're ever asked.

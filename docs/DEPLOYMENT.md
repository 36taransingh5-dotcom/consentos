# Deploying ConsentOS (Vercel + Supabase)

Locally ConsentOS runs on embedded Postgres and needs no configuration. A deployment is **two Vercel projects** from this repository (ConsentOS and Pixly), plus **one Supabase database** connected to ConsentOS through Vercel's Supabase integration.

Reference deployment. The full end-to-end suite passes against it, including Supabase Auth sign-in, row-level security on Supabase Postgres, and the extension built for this server:

| App | URL | Vercel project | Root directory |
| --- | --- | --- | --- |
| ConsentOS | https://consentos.vercel.app | `consentos` | `apps/web` |
| Pixly | https://consentos-pixly.vercel.app | `consentos-pixly` | `apps/pixly` |

## 1. Create the Vercel projects

Create two projects from this repository, both with framework **Next.js**:

- **`consentos`**, root directory **`apps/web`**
- **`consentos-pixly`**, root directory **`apps/pixly`**

Set `ENABLE_EXPERIMENTAL_COREPACK=1` on both, so Vercel uses the pnpm version pinned in `package.json`.

**Deployment protection:** use *Standard Protection* (`prod_deployment_urls_and_all_previews`). The production domains must be public: judges open them, and Pixly's backend calls ConsentOS's API server-to-server. Newer Vercel projects may default to protecting every URL except custom domains, which blocks both.

## 2. Connect Supabase (ConsentOS only)

In the `consentos` project: **Storage → Create Database → Supabase** (Free), then connect it to **Production**. Leave the environment-variable prefix empty.

The integration injects `POSTGRES_URL` (pooled), `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` and related variables. ConsentOS reads these directly, and also accepts the newer `*_PUBLISHABLE_KEY` / `SUPABASE_SECRET_KEY` names.

You don't need to run the migrations by hand. With `CONSENTOS_AUTO_MIGRATE=true`, the first request applies [`supabase/migrations`](../supabase/migrations), which are bundled into the server build. It then creates the Pixly service record and the demo user (through the Supabase admin API) with the default policy. Concurrent cold starts are serialised with an advisory lock.

<details>
<summary>Migrating by hand instead</summary>

```bash
DATABASE_URL="postgres://…" pnpm --filter @consentos/web db:migrate   # also reads POSTGRES_URL_NON_POOLING / POSTGRES_URL
```

Or paste the files in `supabase/migrations/` into the Supabase SQL editor, in order.
</details>

## 3. Environment variables

### ConsentOS (`consentos`)

| Variable | Value |
| --- | --- |
| `CONSENTOS_PUBLIC_URL` | `https://consentos.vercel.app` |
| `NEXT_PUBLIC_PIXLY_URL` | `https://consentos-pixly.vercel.app` |
| `PIXLY_DOMAIN` | `consentos-pixly.vercel.app` (the extension checks Pixly pages against this) |
| `CONSENTOS_AUTO_MIGRATE` | `true` |
| `CONSENTOS_DEMO_MODE` | `true` for a public demo |
| `CONSENTOS_SIGNING_KEY` | Ed25519 private key: base64 of a PKCS#8 PEM (**sensitive**) |
| `CONSENTOS_SESSION_SECRET` | ≥ 32 random characters (**sensitive**) |
| `PIXLY_API_KEY` | Pixly's service key (**sensitive**) |
| `CONSENTOS_DEMO_RESET_TOKEN` | Random token (**sensitive**) |
| *(from the Supabase integration)* | `POSTGRES_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, … |

### Pixly (`consentos-pixly`)

| Variable | Value |
| --- | --- |
| `CONSENTOS_API_URL` | `https://consentos.vercel.app` |
| `NEXT_PUBLIC_CONSENTOS_WEB_URL` | `https://consentos.vercel.app` |
| `CONSENTOS_API_KEY` | same value as ConsentOS's `PIXLY_API_KEY` (**sensitive**) |
| `CONSENTOS_DEMO_RESET_TOKEN` | same value as ConsentOS's (**sensitive**) |
| `PIXLY_CONSENTOS_USER_ID` | `7e57de30-0000-4000-8000-000000000001` (the demo user) |

To generate the secrets without printing them, write each to a private file and pipe it into the Vercel CLI:

```bash
umask 077 && node -e '
const c = require("crypto"), fs = require("fs");
fs.writeFileSync("CONSENTOS_SIGNING_KEY", Buffer.from(c.generateKeyPairSync("ed25519").privateKey.export({ format: "pem", type: "pkcs8" })).toString("base64"));
fs.writeFileSync("CONSENTOS_SESSION_SECRET", c.randomBytes(32).toString("base64url"));
fs.writeFileSync("PIXLY_API_KEY", "cos_live_" + c.randomBytes(24).toString("base64url"));
fs.writeFileSync("CONSENTOS_DEMO_RESET_TOKEN", "cos_demo_" + c.randomBytes(24).toString("base64url"));'
```

```bash
vercel env add CONSENTOS_SIGNING_KEY production --sensitive < CONSENTOS_SIGNING_KEY   # and so on
```

## 4. Deploy

From the repository root (the whole monorepo is uploaded; `.vercelignore` keeps out local data and build output):

```bash
VERCEL_PROJECT_ID=<consentos id> VERCEL_ORG_ID=<team id> vercel deploy --prod
VERCEL_PROJECT_ID=<pixly id>     VERCEL_ORG_ID=<team id> vercel deploy --prod
```

Alternatively, connect the GitHub repository to both projects for automatic deploys. Check the result with `curl https://consentos.vercel.app/api/health`: it should report `"storage":"postgres","auth":"supabase"`.

## 5. The extension for the deployed server

```bash
CONSENTOS_API_URL=https://consentos.vercel.app EXTENSION_OUT_DIR=dist-hosted pnpm --filter @consentos/extension build
```

Load `apps/extension/dist-hosted` unpacked in Chrome, sign in at https://consentos.vercel.app, and open `/extension/connect`. The build adds the server to `host_permissions`. The popup's settings can also switch a local build to any server.

## 6. Verify the hosted flow

```bash
E2E_HOSTED=1 \
E2E_CONSENTOS_URL=https://consentos.vercel.app \
E2E_PIXLY_URL=https://consentos-pixly.vercel.app \
E2E_DEMO_RESET_TOKEN="$(cat CONSENTOS_DEMO_RESET_TOKEN)" \
pnpm test:e2e
```

This runs the full demo against the live URLs with the real extension built for them, and resets the demo account afterwards.

## Operational notes

- **Plain Postgres** (Neon, RDS, …) without Supabase: apply the local shim first (`CONSENTOS_APPLY_SHIM=true pnpm --filter @consentos/web db:migrate`). ConsentOS then uses its built-in email/password auth.
- **Key rotation:** set the new `CONSENTOS_SIGNING_KEY`, and add the old public key (from `GET /api/v1/keys`) to `CONSENTOS_VERIFICATION_KEYS` as a JSON array of JWKs, so older receipts keep verifying.
- **Rate limits** are per serverless instance. For stricter limits, back `src/server/rate-limit.ts` with a shared store.
- **Embedded PGlite is local-only.** Serverless file systems are ephemeral, so a deployment needs a database URL, and ConsentOS refuses to start without its secrets in that mode.

# Deploying ConsentOS (Supabase + Vercel)

Locally ConsentOS runs on embedded Postgres and needs no configuration. A deployment is **two Vercel projects** from this repository (ConsentOS and Pixly), sharing **one Supabase project** that ConsentOS uses for Postgres and Auth.

> **What has been verified.** The `DATABASE_URL` code path (node-postgres, migrations, RLS via `set local role`, evaluation, signing, enforcement, revocation) is covered by an automated test that serves the real migrations over the Postgres wire protocol ([`apps/web/test/postgres-driver.test.ts`](../apps/web/test/postgres-driver.test.ts)). The Supabase Auth adapter is implemented, but this build was not run against a live Supabase project. Check sign-in once after your first deploy.

## 1. Supabase

1. Create a project.
2. Apply the schema. Pick one of:
   - SQL editor: paste [`supabase/migrations/20260926000000_consentos_init.sql`](../supabase/migrations/20260926000000_consentos_init.sql) and run it.
   - From your machine, using the **direct** connection string on port 5432:

     ```bash
     DATABASE_URL="postgres://postgres:…@db.<ref>.supabase.co:5432/postgres" pnpm --filter @consentos/web db:migrate
     ```

   - `supabase db push` with the Supabase CLI.

   Don't mix `db:migrate` with the Supabase CLI on the same database; they track migrations separately.
3. **Authentication → Providers → Email**: keep it enabled. ConsentOS creates users pre-confirmed through the admin API, so no confirmation email is needed.
4. Note down the project URL, the anon key, the service-role key, and the **transaction pooler** connection string (port 6543) for the app.

If a user query fails with `permission denied to set role "authenticated"`, give your connection role membership in the Supabase API roles:

```sql
grant anon, authenticated, service_role to postgres;
```

## 2. Secrets

```bash
# Ed25519 signing key (base64 of a PKCS#8 PEM; keep it secret)
node -e "const {generateKeyPairSync}=require('crypto');const k=generateKeyPairSync('ed25519').privateKey.export({format:'pem',type:'pkcs8'});console.log(Buffer.from(k).toString('base64'))"
```

```bash
# Session secret, Pixly's API key and the demo reset token
node -e "for (const n of ['CONSENTOS_SESSION_SECRET','PIXLY_API_KEY','CONSENTOS_DEMO_RESET_TOKEN']) console.log(n+'='+(n==='PIXLY_API_KEY'?'cos_live_':'')+require('crypto').randomBytes(32).toString('base64url'))"
```

## 3. Vercel — ConsentOS (`apps/web`)

New project → import the repository → **Root Directory `apps/web`**. Vercel detects Next.js and pnpm workspaces.

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | Supabase transaction pooler URL (`…:6543/postgres`) |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | from Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | from Supabase (server only) |
| `CONSENTOS_SIGNING_KEY` | base64 PEM from step 2 |
| `CONSENTOS_SESSION_SECRET` | from step 2 |
| `CONSENTOS_PUBLIC_URL` | e.g. `https://consentos-web.vercel.app` |
| `PIXLY_API_KEY` | from step 2 |
| `PIXLY_DOMAIN` | Pixly's host, e.g. `pixly-demo.vercel.app` |
| `NEXT_PUBLIC_PIXLY_URL` | e.g. `https://pixly-demo.vercel.app` |
| `CONSENTOS_DEMO_MODE` | `true` for a judging deployment, otherwise `false` |
| `CONSENTOS_DEMO_RESET_TOKEN` | from step 2 (only needed in demo mode) |
| `CONSENTOS_DEMO_PASSWORD` | password for `demo@consentos.dev` |

On the first request ConsentOS seeds the Pixly service record (with the hash of `PIXLY_API_KEY`), the demo user (through the Supabase admin API) and the demo user's default policy.

## 4. Vercel — Pixly (`apps/pixly`)

Second project → same repository → **Root Directory `apps/pixly`**.

| Variable | Value |
| --- | --- |
| `CONSENTOS_API_URL` | ConsentOS URL |
| `CONSENTOS_API_KEY` | the same value as `PIXLY_API_KEY` |
| `PIXLY_CONSENTOS_USER_ID` | `7e57de30-0000-4000-8000-000000000001` (the demo user) |
| `CONSENTOS_DEMO_RESET_TOKEN` | same as ConsentOS |
| `NEXT_PUBLIC_CONSENTOS_WEB_URL` | ConsentOS URL |

## 5. The extension

```bash
CONSENTOS_API_URL=https://consentos-web.vercel.app pnpm build:extension
```

Load `apps/extension/dist` unpacked, or zip it for the Chrome Web Store. The build adds the server to `host_permissions`. Users can also switch servers from the popup's settings.

## Operational notes

- **Plain Postgres** (Neon, RDS, …) without Supabase: apply the local shim first (`CONSENTOS_APPLY_SHIM=true pnpm --filter @consentos/web db:migrate`). ConsentOS then uses its built-in email/password auth.
- **Key rotation:** set the new `CONSENTOS_SIGNING_KEY`, and add the old public key (from `GET /api/v1/keys`) to `CONSENTOS_VERIFICATION_KEYS` as a JSON array of JWKs, so older receipts keep verifying.
- **Rate limits** are per serverless instance. For stricter limits, back `src/server/rate-limit.ts` with a shared store.
- The embedded PGlite mode is for local development only. Serverless file systems are ephemeral, so a deployment must set `DATABASE_URL`, and ConsentOS refuses to start without its secrets in that mode.

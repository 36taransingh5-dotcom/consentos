-- Local-only shim that recreates the Supabase primitives ConsentOS depends on,
-- so the real migrations (including row-level security) run unchanged on
-- embedded Postgres (PGlite). Never apply this to a Supabase project: those
-- objects already exist there.

create schema if not exists auth;

-- Mirrors the columns of Supabase's auth.users that ConsentOS uses. In local
-- mode, ConsentOS's own password auth stores a scrypt hash here.
create table if not exists auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text not null unique,
  encrypted_password text,
  created_at         timestamptz not null default now()
);

-- Same definition Supabase uses: the subject of the current request's JWT claims.
create or replace function auth.uid() returns uuid
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

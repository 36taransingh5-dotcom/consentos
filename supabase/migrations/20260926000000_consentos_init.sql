-- ConsentOS schema.
--
-- Targets Supabase Postgres: relies on auth.users, auth.uid() and the anon /
-- authenticated / service_role roles. For local development the same file runs
-- on embedded Postgres (PGlite) after supabase/local/00_supabase_shim.sql
-- recreates those Supabase primitives.
--
-- Security model
--   * Row-level security is enabled on every table.
--   * End users (role `authenticated`) can read only their own policies,
--     requests, receipts and events, may append new policy versions, may
--     resolve their own pending requests and may revoke their own grants.
--   * Only the server (table owner / service_role) evaluates requests and
--     issues signed receipts. Users cannot insert receipts.
--   * Policy versions are append-only; receipts are immutable except for a
--     one-way revocation stamp. Both are enforced by triggers, not just RLS.

-- ---------------------------------------------------------------------------
-- Services: sites and apps that integrate ConsentOS.
-- ---------------------------------------------------------------------------
create table public.services (
  id           text primary key check (id ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  name         text not null check (char_length(name) between 1 and 80),
  -- host[:port] the service is served from, used by the extension to verify
  -- that a page claiming to be this service really is.
  domain       text not null check (char_length(domain) between 1 and 253),
  -- sha256 (hex) of the service's secret API key. The key itself is never stored.
  api_key_hash text not null check (api_key_hash ~ '^[0-9a-f]{64}$'),
  verified     boolean not null default false,
  created_at   timestamptz not null default now()
);

create unique index services_api_key_hash_idx on public.services (api_key_hash);

-- ---------------------------------------------------------------------------
-- Privacy policies: append-only, versioned per user.
-- ---------------------------------------------------------------------------
create table public.privacy_policies (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  version     integer not null check (version > 0),
  policy_json jsonb not null,
  -- "sha256:<hex>" of the canonical JSON serialisation of policy_json.
  policy_hash text not null check (policy_hash ~ '^sha256:[0-9a-f]{64}$'),
  created_at  timestamptz not null default now(),
  unique (user_id, version)
);

-- ---------------------------------------------------------------------------
-- Consent requests: every evaluation, whatever the outcome.
-- ---------------------------------------------------------------------------
create table public.consent_requests (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users (id) on delete cascade,
  service_id          text not null references public.services (id) on delete cascade,
  data_type           text not null,
  purpose             text not null,
  retention_days      integer check (retention_days is null or retention_days >= 0),
  third_party_sharing boolean not null default false,
  request_payload     jsonb not null,
  decision            text not null check (decision in ('ALLOW', 'DENY', 'REQUIRE_USER')),
  reason_code         text not null,
  reason              text not null,
  evaluation_trace    jsonb not null default '[]'::jsonb,
  policy_version      integer not null,
  engine_version      text not null,
  -- REQUIRE_USER requests stay 'pending' until the user answers.
  status              text not null default 'decided' check (status in ('decided', 'pending', 'resolved')),
  resolved_decision   text check (resolved_decision in ('ALLOW', 'DENY')),
  resolved_at         timestamptz,
  created_at          timestamptz not null default now(),
  check ((status = 'resolved') = (resolved_decision is not null and resolved_at is not null))
);

create index consent_requests_user_created_idx on public.consent_requests (user_id, created_at desc);
create index consent_requests_pending_idx on public.consent_requests (user_id, created_at desc) where status = 'pending';

-- ---------------------------------------------------------------------------
-- Consent receipts: signed record of a decision. An ALLOW receipt is a grant.
-- ---------------------------------------------------------------------------
create table public.consent_receipts (
  id                 uuid primary key,
  consent_request_id uuid not null unique references public.consent_requests (id) on delete cascade,
  user_id            uuid not null references auth.users (id) on delete cascade,
  service_id         text not null references public.services (id) on delete cascade,
  purpose            text not null,
  data_type          text not null,
  decision           text not null check (decision in ('ALLOW', 'DENY')),
  payload            jsonb not null,
  payload_hash       text not null check (payload_hash ~ '^sha256:[0-9a-f]{64}$'),
  signature          text not null,
  key_id             text not null,
  issued_at          timestamptz not null,
  revoked_at         timestamptz,
  revocation_reason  text check (revocation_reason in ('user', 'policy_change', 'superseded')),
  check ((revoked_at is null) = (revocation_reason is null)),
  check (revoked_at is null or decision = 'ALLOW')
);

create index consent_receipts_user_issued_idx on public.consent_receipts (user_id, issued_at desc);
create index consent_receipts_active_grants_idx
  on public.consent_receipts (user_id, service_id, purpose, data_type)
  where decision = 'ALLOW' and revoked_at is null;

-- ---------------------------------------------------------------------------
-- Audit events: append-only activity log, also what the extension polls.
-- ---------------------------------------------------------------------------
create table public.audit_events (
  id         uuid primary key default gen_random_uuid(),
  -- Monotonic cursor for pollers; several events can share a timestamp.
  seq        bigint generated always as identity,
  user_id    uuid not null references auth.users (id) on delete cascade,
  service_id text references public.services (id) on delete set null,
  event_type text not null check (event_type ~ '^[a-z_]+\.[a-z_]+$'),
  metadata   jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index audit_events_seq_idx on public.audit_events (seq);
create index audit_events_user_seq_idx on public.audit_events (user_id, seq desc);

-- ---------------------------------------------------------------------------
-- Immutability guards (apply to every role, including the server).
-- ---------------------------------------------------------------------------
create function public.forbid_policy_update() returns trigger
language plpgsql as $$
begin
  raise exception 'privacy policy versions are immutable; insert a new version instead'
    using errcode = 'check_violation';
end;
$$;

create trigger privacy_policies_immutable
  before update on public.privacy_policies
  for each row execute function public.forbid_policy_update();

create function public.guard_receipt_update() returns trigger
language plpgsql as $$
begin
  if new.id is distinct from old.id
     or new.consent_request_id is distinct from old.consent_request_id
     or new.user_id is distinct from old.user_id
     or new.service_id is distinct from old.service_id
     or new.purpose is distinct from old.purpose
     or new.data_type is distinct from old.data_type
     or new.decision is distinct from old.decision
     or new.payload is distinct from old.payload
     or new.payload_hash is distinct from old.payload_hash
     or new.signature is distinct from old.signature
     or new.key_id is distinct from old.key_id
     or new.issued_at is distinct from old.issued_at then
    raise exception 'consent receipts are immutable; only revocation can be recorded'
      using errcode = 'check_violation';
  end if;
  if old.revoked_at is not null
     and (new.revoked_at is distinct from old.revoked_at
          or new.revocation_reason is distinct from old.revocation_reason) then
    raise exception 'a revoked grant cannot be reinstated'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger consent_receipts_guard
  before update on public.consent_receipts
  for each row execute function public.guard_receipt_update();

create function public.forbid_event_update() returns trigger
language plpgsql as $$
begin
  raise exception 'audit events are append-only'
    using errcode = 'check_violation';
end;
$$;

create trigger audit_events_append_only
  before update on public.audit_events
  for each row execute function public.forbid_event_update();

-- ---------------------------------------------------------------------------
-- Row-level security.
-- ---------------------------------------------------------------------------
alter table public.services         enable row level security;
alter table public.privacy_policies enable row level security;
alter table public.consent_requests enable row level security;
alter table public.consent_receipts enable row level security;
alter table public.audit_events     enable row level security;

-- Services are a public directory. api_key_hash is hidden by column grants below.
create policy services_public_read on public.services
  for select to anon, authenticated using (true);

create policy privacy_policies_select_own on public.privacy_policies
  for select to authenticated using (user_id = (select auth.uid()));
create policy privacy_policies_insert_own on public.privacy_policies
  for insert to authenticated with check (user_id = (select auth.uid()));

create policy consent_requests_select_own on public.consent_requests
  for select to authenticated using (user_id = (select auth.uid()));
create policy consent_requests_resolve_own on public.consent_requests
  for update to authenticated
  using (user_id = (select auth.uid()) and status = 'pending')
  with check (user_id = (select auth.uid()) and status = 'resolved');

create policy consent_receipts_select_own on public.consent_receipts
  for select to authenticated using (user_id = (select auth.uid()));
create policy consent_receipts_revoke_own on public.consent_receipts
  for update to authenticated
  using (user_id = (select auth.uid()) and decision = 'ALLOW' and revoked_at is null)
  with check (user_id = (select auth.uid()) and revocation_reason = 'user');

create policy audit_events_select_own on public.audit_events
  for select to authenticated using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Privileges. Supabase grants broad defaults on public tables; narrow them.
-- ---------------------------------------------------------------------------
revoke all on public.services, public.privacy_policies, public.consent_requests,
  public.consent_receipts, public.audit_events from anon, authenticated;

grant select (id, name, domain, verified, created_at) on public.services to anon, authenticated;
grant select, insert on public.privacy_policies to authenticated;
grant select on public.consent_requests to authenticated;
grant update (status, resolved_decision, resolved_at) on public.consent_requests to authenticated;
grant select on public.consent_receipts to authenticated;
grant update (revoked_at, revocation_reason) on public.consent_receipts to authenticated;
grant select on public.audit_events to authenticated;

grant all on public.services, public.privacy_policies, public.consent_requests,
  public.consent_receipts, public.audit_events to service_role;

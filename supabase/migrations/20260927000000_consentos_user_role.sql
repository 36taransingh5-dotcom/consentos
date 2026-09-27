-- Close ConsentOS tables to Supabase's auto-generated REST API.
--
-- On Supabase, `anon` and `authenticated` are also the roles PostgREST uses for
-- every request carrying the project's anon key or a user's session. ConsentOS
-- users hold Supabase sessions, so granting table access to `authenticated`
-- would let them bypass the ConsentOS API entirely — for example, appending a
-- policy version with a hash the server never computed.
--
-- Instead, the ConsentOS server switches to a dedicated role, `consentos_user`,
-- plus the user's JWT claims for every user-scoped query. Row-level security
-- still applies to each of those queries. `anon` and `authenticated` get no
-- privileges on ConsentOS tables at all.

create schema if not exists consentos_private;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'consentos_user') then
    create role consentos_user nologin noinherit;
  end if;
end
$$;

-- The migrating role (Supabase: postgres) is the role the server connects as.
grant consentos_user to current_user;

-- The user id for the current transaction, from the claims the server sets.
-- Owned here rather than relying on privileges in Supabase's `auth` schema.
create or replace function consentos_private.request_user_id() returns uuid
language sql stable set search_path = '' as $$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid
$$;

revoke all on function consentos_private.request_user_id() from public;
grant usage on schema consentos_private to consentos_user;
grant execute on function consentos_private.request_user_id() to consentos_user;

-- Replace the policies that targeted Supabase's API roles.
drop policy if exists services_public_read on public.services;
drop policy if exists privacy_policies_select_own on public.privacy_policies;
drop policy if exists privacy_policies_insert_own on public.privacy_policies;
drop policy if exists consent_requests_select_own on public.consent_requests;
drop policy if exists consent_requests_resolve_own on public.consent_requests;
drop policy if exists consent_receipts_select_own on public.consent_receipts;
drop policy if exists consent_receipts_revoke_own on public.consent_receipts;
drop policy if exists audit_events_select_own on public.audit_events;

create policy services_directory_read on public.services
  for select to consentos_user using (true);

create policy privacy_policies_select_own on public.privacy_policies
  for select to consentos_user using (user_id = (select consentos_private.request_user_id()));
create policy privacy_policies_insert_own on public.privacy_policies
  for insert to consentos_user with check (user_id = (select consentos_private.request_user_id()));

create policy consent_requests_select_own on public.consent_requests
  for select to consentos_user using (user_id = (select consentos_private.request_user_id()));
create policy consent_requests_resolve_own on public.consent_requests
  for update to consentos_user
  using (user_id = (select consentos_private.request_user_id()) and status = 'pending')
  with check (user_id = (select consentos_private.request_user_id()) and status = 'resolved');

create policy consent_receipts_select_own on public.consent_receipts
  for select to consentos_user using (user_id = (select consentos_private.request_user_id()));
create policy consent_receipts_revoke_own on public.consent_receipts
  for update to consentos_user
  using (user_id = (select consentos_private.request_user_id()) and decision = 'ALLOW' and revoked_at is null)
  with check (user_id = (select consentos_private.request_user_id()) and revocation_reason = 'user');

create policy audit_events_select_own on public.audit_events
  for select to consentos_user using (user_id = (select consentos_private.request_user_id()));

-- Privileges: nothing for Supabase's API roles, the minimum for consentos_user.
revoke all on public.services, public.privacy_policies, public.consent_requests,
  public.consent_receipts, public.audit_events from anon, authenticated;

grant usage on schema public to consentos_user;
grant select (id, name, domain, verified, created_at) on public.services to consentos_user;
grant select, insert on public.privacy_policies to consentos_user;
grant select on public.consent_requests to consentos_user;
grant update (status, resolved_decision, resolved_at) on public.consent_requests to consentos_user;
grant select on public.consent_receipts to consentos_user;
grant update (revoked_at, revocation_reason) on public.consent_receipts to consentos_user;
grant select on public.audit_events to consentos_user;

-- Trigger functions should not resolve names through a caller-controlled search_path.
alter function public.forbid_policy_update() set search_path = '';
alter function public.guard_receipt_update() set search_path = '';
alter function public.forbid_event_update() set search_path = '';

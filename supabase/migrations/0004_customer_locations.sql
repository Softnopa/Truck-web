-- ============================================================================
-- Truck App — additive migration
--
-- Switches customer location from "captured once, at the moment of a warning"
-- to continuous background tracking, shown live on the owner's map.
--
-- This is a real change to what customers agreed to, not just new columns:
-- `consent_version` lets the app tell an already-answered customer apart from
-- one who answered under the OLD promise ("never in the background, never on
-- a schedule"). Bumping CURRENT_CONSENT_VERSION in the app code routes every
-- existing customer back through /permissions to accept the new terms before
-- tracking ever starts for them.
--
-- Run this once in: Supabase Dashboard -> SQL Editor -> New query -> Run.
-- ============================================================================

alter table public.consents add column if not exists consent_version integer not null default 1;

create table if not exists public.customer_locations (
  user_id    uuid primary key references public.profiles (id) on delete cascade,
  lat        double precision not null,
  lng        double precision not null,
  accuracy   double precision,
  updated_at timestamptz not null default now()
);

alter table public.customer_locations enable row level security;

-- A customer writes only their own row. Owners read every row; a customer
-- never needs to read another customer's location.
drop policy if exists customer_locations_owner_read on public.customer_locations;
create policy customer_locations_owner_read on public.customer_locations
  for select to authenticated
  using (public.is_owner());

drop policy if exists customer_locations_self_read on public.customer_locations;
create policy customer_locations_self_read on public.customer_locations
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists customer_locations_self_write on public.customer_locations;
create policy customer_locations_self_write on public.customer_locations
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists customer_locations_self_update on public.customer_locations;
create policy customer_locations_self_update on public.customer_locations
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Revoking consent deletes the row (enforced in app code on revoke), but a
-- customer may also do it directly.
drop policy if exists customer_locations_self_delete on public.customer_locations;
create policy customer_locations_self_delete on public.customer_locations
  for delete to authenticated
  using (user_id = auth.uid());

-- The owner map watches this table live.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'customer_locations'
     )
  then
    alter publication supabase_realtime add table public.customer_locations;
  end if;
end;
$$;

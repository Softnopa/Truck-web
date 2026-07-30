-- ============================================================================
-- Truck App — additive migration
--
-- Walk-in customers.
--
-- Until now a "customer" meant a row in `profiles`, and `profiles.id` is keyed
-- to `auth.users`. So the only people an owner could sell to were people who
-- had installed the app and signed in. That is wrong for a fruit truck: most
-- buyers are strangers at the roadside who will never own an account, and the
-- Mijozlar screen had no way to add one — there was nothing for a `+` to do.
--
-- This adds `customers`: a plain document table the owners write directly, in
-- exactly the shape of `trucks` / `sales` / `payments` (id, payload, timestamps).
--
-- No change is needed to `sales`. A sale already stores `customerId` as free
-- text inside its `payload` with no foreign key, so it can point at a row here
-- just as easily as at a profile. Ids are prefixed `cust_` by the app and can
-- never collide with the uuids `profiles` uses.
--
-- Auth-backed customers keep working unchanged; the app merges the two lists.
--
-- Run this once in: Supabase Dashboard -> SQL Editor -> New query -> Run.
-- ============================================================================

create table if not exists public.customers (
  id         text        primary key,
  payload    jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table public.customers enable row level security;

-- Owner-only, like the truck list. A signed-in customer has their own profile
-- row and never needs to read this table, so no customer policy is granted.
drop policy if exists customers_owner_all on public.customers;
create policy customers_owner_all on public.customers
  for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

-- Realtime, so a walk-in added on Azamat's phone shows up on Zafar's without
-- waiting for a tab switch. Matches what 0002 did for the other doc tables.
alter table public.customers replica identity full;

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    return;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'customers'
  ) then
    alter publication supabase_realtime add table public.customers;
  end if;
end;
$$;

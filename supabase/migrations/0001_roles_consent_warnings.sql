-- ============================================================================
-- Truck App — additive migration
--
-- Adds ONLY new objects. The pre-existing tables (trucks, sales, payments,
-- owners) are never altered and their rows are never touched.
--
-- Attribution and the removal of custom inputs are handled inside the existing
-- `payload` jsonb documents, which needs no DDL.
--
-- Run this once in: Supabase Dashboard -> SQL Editor -> New query -> Run.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  role        text not null default 'customer' check (role in ('owner', 'customer')),
  full_name   text not null default '',
  phone       text,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.consents (
  user_id               uuid primary key references public.profiles (id) on delete cascade,
  location_granted      boolean not null default false,
  notifications_granted boolean not null default false,
  terms_accepted        boolean not null default false,
  decided_at            timestamptz,
  revoked_at            timestamptz,
  updated_at            timestamptz not null default now()
);

create table if not exists public.warnings (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles (id) on delete cascade,
  owner_id    uuid not null references public.profiles (id) on delete cascade,
  result      text not null default 'pending'
              check (result in ('pending', 'located', 'denied', 'unavailable', 'no_device')),
  lat         double precision,
  lng         double precision,
  accuracy    double precision,
  located_at  timestamptz,
  created_at  timestamptz not null default now()
);

create table if not exists public.user_settings (
  user_id    uuid primary key references public.profiles (id) on delete cascade,
  language   text not null default 'ru' check (language in ('en', 'ru', 'uz')),
  accent     text not null default 'emerald',
  text_scale numeric(3, 2) not null default 1.00 check (text_scale between 0.85 and 1.35),
  updated_at timestamptz not null default now()
);

create table if not exists public.push_tokens (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  token      text not null,
  platform   text not null default 'ios' check (platform in ('ios', 'android', 'web')),
  updated_at timestamptz not null default now(),
  primary key (user_id, token)
);

create index if not exists warnings_customer_created_idx on public.warnings (customer_id, created_at desc);
create index if not exists warnings_owner_created_idx    on public.warnings (owner_id, created_at desc);
create index if not exists profiles_role_idx             on public.profiles (role);

-- ---------------------------------------------------------------------------
-- 2. Helpers
-- ---------------------------------------------------------------------------

-- security definer so RLS policies on profiles can call it without recursing.
create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'owner'
  );
$$;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- A user may edit their own profile, but only an owner may change `role`
-- or `created_by`. Blocks self-promotion to owner.
create or replace function public.guard_profile_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- auth.uid() is null for the SQL editor and the service role. Those are admin
  -- contexts, and clamping them here would silently undo promote_owner().
  if auth.uid() is not null and not public.is_owner() then
    new.role := old.role;
    new.created_by := old.created_by;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

-- Every new auth user becomes a customer with default settings and a blank
-- consent record. Role is never read from client-supplied metadata: promote
-- owners explicitly with public.promote_owner() below.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
      split_part(coalesce(new.email, 'user'), '@', 1)
    )
  )
  on conflict (id) do nothing;

  insert into public.user_settings (user_id) values (new.id) on conflict do nothing;
  insert into public.consents (user_id) values (new.id) on conflict do nothing;

  return new;
end;
$$;

-- Keeps the pre-existing `owners` table truthful as roles change, so nothing
-- that already reads it goes stale.
create or replace function public.sync_owners_table()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role = 'owner' then
    insert into public.owners (user_id, name)
    values (new.id, new.full_name)
    on conflict (user_id) do update set name = excluded.name;
  else
    delete from public.owners where user_id = new.id;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Triggers
-- ---------------------------------------------------------------------------

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

drop trigger if exists profiles_guard_update on public.profiles;
create trigger profiles_guard_update
  before update on public.profiles
  for each row execute function public.guard_profile_update();

drop trigger if exists profiles_sync_owners on public.profiles;
create trigger profiles_sync_owners
  after insert or update of role, full_name on public.profiles
  for each row execute function public.sync_owners_table();

drop trigger if exists consents_touch on public.consents;
create trigger consents_touch before update on public.consents
  for each row execute function public.touch_updated_at();

drop trigger if exists user_settings_touch on public.user_settings;
create trigger user_settings_touch before update on public.user_settings
  for each row execute function public.touch_updated_at();

drop trigger if exists push_tokens_touch on public.push_tokens;
create trigger push_tokens_touch before update on public.push_tokens
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 4. Row level security
-- ---------------------------------------------------------------------------

alter table public.profiles      enable row level security;
alter table public.consents      enable row level security;
alter table public.warnings      enable row level security;
alter table public.user_settings enable row level security;
alter table public.push_tokens   enable row level security;

-- profiles ------------------------------------------------------------------
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_owner());

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update to authenticated
  using (id = auth.uid() or public.is_owner())
  with check (id = auth.uid() or public.is_owner());

-- consents ------------------------------------------------------------------
drop policy if exists consents_select on public.consents;
create policy consents_select on public.consents
  for select to authenticated
  using (user_id = auth.uid() or public.is_owner());

drop policy if exists consents_upsert on public.consents;
create policy consents_upsert on public.consents
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists consents_update on public.consents;
create policy consents_update on public.consents
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- warnings ------------------------------------------------------------------
-- Owners raise and read every warning. A customer sees only warnings aimed at
-- them and may only ever write back their own location result.
drop policy if exists warnings_select on public.warnings;
create policy warnings_select on public.warnings
  for select to authenticated
  using (public.is_owner() or customer_id = auth.uid());

drop policy if exists warnings_insert on public.warnings;
create policy warnings_insert on public.warnings
  for insert to authenticated
  with check (public.is_owner() and owner_id = auth.uid());

drop policy if exists warnings_customer_respond on public.warnings;
create policy warnings_customer_respond on public.warnings
  for update to authenticated
  using (customer_id = auth.uid())
  with check (customer_id = auth.uid());

-- user_settings -------------------------------------------------------------
drop policy if exists user_settings_select on public.user_settings;
create policy user_settings_select on public.user_settings
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists user_settings_insert on public.user_settings;
create policy user_settings_insert on public.user_settings
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists user_settings_update on public.user_settings;
create policy user_settings_update on public.user_settings
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- push_tokens ---------------------------------------------------------------
drop policy if exists push_tokens_select on public.push_tokens;
create policy push_tokens_select on public.push_tokens
  for select to authenticated
  using (user_id = auth.uid() or public.is_owner());

drop policy if exists push_tokens_insert on public.push_tokens;
create policy push_tokens_insert on public.push_tokens
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists push_tokens_update on public.push_tokens;
create policy push_tokens_update on public.push_tokens
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists push_tokens_delete on public.push_tokens;
create policy push_tokens_delete on public.push_tokens
  for delete to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 5. RLS for the pre-existing business tables
--
-- Row data is never touched — only the access rules around it.
--
-- NOTE: `owners` already carried a self-referencing policy that made every read
-- fail with 42P17 "infinite recursion detected in policy for relation owners".
-- Any policy that reads the same table it guards recurses forever. We drop all
-- legacy policies on these four tables and replace them with ones that route
-- through public.is_owner(), which is SECURITY DEFINER and therefore bypasses
-- RLS instead of re-entering it.
-- ---------------------------------------------------------------------------

do $$
declare
  pol record;
begin
  for pol in
    select policyname, tablename
    from pg_policies
    where schemaname = 'public'
      and tablename in ('trucks', 'sales', 'payments', 'owners')
  loop
    execute format('drop policy if exists %I on public.%I', pol.policyname, pol.tablename);
  end loop;
end;
$$;

alter table public.trucks   enable row level security;
alter table public.sales    enable row level security;
alter table public.payments enable row level security;
alter table public.owners   enable row level security;

-- Inventory is owner-only: a customer never needs the truck list, so no read
-- policy is granted for it at all.
drop policy if exists trucks_owner_all on public.trucks;
create policy trucks_owner_all on public.trucks
  for all to authenticated using (public.is_owner()) with check (public.is_owner());

-- A customer reads only the sales documents that name them.
drop policy if exists sales_owner_all on public.sales;
create policy sales_owner_all on public.sales
  for all to authenticated using (public.is_owner()) with check (public.is_owner());

drop policy if exists sales_customer_read on public.sales;
create policy sales_customer_read on public.sales
  for select to authenticated
  using (deleted_at is null and payload ->> 'customerId' = auth.uid()::text);

drop policy if exists payments_owner_all on public.payments;
create policy payments_owner_all on public.payments
  for all to authenticated using (public.is_owner()) with check (public.is_owner());

drop policy if exists payments_customer_read on public.payments;
create policy payments_customer_read on public.payments
  for select to authenticated
  using (
    deleted_at is null
    and exists (
      -- `payments.` qualifier is required: `sales` also has a `payload` column,
      -- so an unqualified reference would bind to the inner relation.
      select 1 from public.sales s
      where s.id = payments.payload ->> 'saleId'
        and s.payload ->> 'customerId' = auth.uid()::text
    )
  );

drop policy if exists owners_read on public.owners;
create policy owners_read on public.owners
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- 6. Realtime — the customer device reacts to a WARN while in the foreground
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'warnings'
     )
  then
    alter publication supabase_realtime add table public.warnings;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Backfill + owner promotion
-- ---------------------------------------------------------------------------

-- Give every pre-existing auth user a profile, settings and consent row.
insert into public.profiles (id, full_name)
select u.id, split_part(coalesce(u.email, 'user'), '@', 1)
from auth.users u
on conflict (id) do nothing;

insert into public.user_settings (user_id) select id from public.profiles
on conflict (user_id) do nothing;

insert into public.consents (user_id) select id from public.profiles
on conflict (user_id) do nothing;

-- Promote one of the three bosses. Call it once per owner AFTER the account
-- exists in Authentication -> Users.
--
--   select public.promote_owner('azamat@example.com', 'Azamat');
--   select public.promote_owner('farrux@example.com', 'Farrux');
--   select public.promote_owner('zafar@example.com',  'Zafar');
create or replace function public.promote_owner(user_email text, display_name text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  target uuid;
begin
  select id into target from auth.users where lower(email) = lower(user_email);
  if target is null then
    return 'No auth user with email ' || user_email;
  end if;

  insert into public.profiles (id, role, full_name)
  values (target, 'owner', display_name)
  on conflict (id) do update set role = 'owner', full_name = excluded.full_name;

  insert into public.user_settings (user_id) values (target) on conflict do nothing;
  insert into public.consents (user_id) values (target) on conflict do nothing;

  return display_name || ' is now an owner.';
end;
$$;

-- EXECUTE is granted to PUBLIC by default, so revoking from PUBLIC is what
-- actually keeps this out of reach of the anon and authenticated roles.
revoke execute on function public.promote_owner(text, text) from public;

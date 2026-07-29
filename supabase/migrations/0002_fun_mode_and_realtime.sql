-- ============================================================================
-- 1. Fun / Calm skin preference
-- 2. Live sync between owners' phones
--
-- Safe to re-run. SQL Editor -> New query -> Run.
-- ============================================================================

alter table public.user_settings
  add column if not exists fun_mode boolean not null default false;

-- Realtime only emits for tables inside the publication. 0001 added `warnings`;
-- these are what make one owner's edit show up on the other owner's phone
-- without waiting for a screen to regain focus.
--
-- RLS still applies to realtime, so a customer only ever receives events for
-- rows they were already allowed to read.
do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    return;
  end if;

  foreach t in array array['trucks', 'sales', 'payments', 'profiles'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;

-- Realtime sends old-row data for UPDATE/DELETE only when the table has a
-- replica identity. Without this, deletes arrive with null payloads.
alter table public.trucks   replica identity full;
alter table public.sales    replica identity full;
alter table public.payments replica identity full;

-- ============================================================================
-- Truck App — additive migration
--
-- Fixes client visibility.
--
-- 0003 scoped `clients` to the owner who created the row (`owner_id =
-- auth.uid()`), which does not match how this business works: trucks, sales and
-- payments are all visible to every owner, and a contact list that only its
-- creator can see means Azamat cannot message a client Farrux added.
--
-- `owner_id` stays on the row as attribution — who added this contact — but it
-- no longer gates who can read it.
--
-- Run this once in: Supabase Dashboard -> SQL Editor -> New query -> Run.
-- ============================================================================

drop policy if exists clients_owner_all on public.clients;

-- Any owner reads every client.
drop policy if exists clients_select on public.clients;
create policy clients_select on public.clients
  for select to authenticated
  using (public.is_owner());

-- New rows are stamped with the owner creating them, so attribution stays honest.
drop policy if exists clients_insert on public.clients;
create policy clients_insert on public.clients
  for insert to authenticated
  with check (public.is_owner() and owner_id = auth.uid());

drop policy if exists clients_update on public.clients;
create policy clients_update on public.clients
  for update to authenticated
  using (public.is_owner())
  with check (public.is_owner());

drop policy if exists clients_delete on public.clients;
create policy clients_delete on public.clients
  for delete to authenticated
  using (public.is_owner());

-- ============================================================================
-- Truck App — additive migration
--
-- Adds a `clients` table: people the owner wants to message on Telegram who
-- never install this app. Deliberately separate from `profiles` — a profile
-- is always backed by an `auth.users` row, a client never is.
--
-- Run this once in: Supabase Dashboard -> SQL Editor -> New query -> Run.
-- ============================================================================

create table if not exists public.clients (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid not null references public.profiles (id) on delete cascade,
  name              text not null default '',
  phone             text,
  -- Random, URL-safe, and unique: embedded in the t.me/<bot>?start=<code> link
  -- an owner sends the client. The webhook trades it for a chat id once the
  -- client taps Start, and never needs to change after that.
  invite_code       text not null default replace(encode(gen_random_bytes(9), 'base64'), '/', '_'),
  telegram_chat_id  bigint,
  telegram_linked_at timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (invite_code)
);

create index if not exists clients_owner_idx on public.clients (owner_id, created_at desc);
create index if not exists clients_chat_idx  on public.clients (telegram_chat_id) where telegram_chat_id is not null;

drop trigger if exists clients_touch on public.clients;
create trigger clients_touch before update on public.clients
  for each row execute function public.touch_updated_at();

alter table public.clients enable row level security;

-- Owner-only: a client has no auth.users row and never reads this table
-- directly. The edge functions use the service role key, which bypasses RLS.
drop policy if exists clients_owner_all on public.clients;
create policy clients_owner_all on public.clients
  for all to authenticated
  using (public.is_owner() and owner_id = auth.uid())
  with check (public.is_owner() and owner_id = auth.uid());

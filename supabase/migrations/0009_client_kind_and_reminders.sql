-- ============================================================================
-- Truck App — additive migration
--
-- Contacts learn three things:
--
--   kind             a contact is either a private chat or a group. A group
--                    gets the sales report; a chat gets payment reminders.
--                    Everything created before this was a private chat.
--
--   customer_id      which customer this contact is. Debt lives on `sales`,
--                    keyed by customer, and a contact had no way to point at
--                    one — so nothing could work out what a contact owed.
--                    Free text, exactly like `sales.payload.customerId`: it
--                    holds either a `profiles` uuid or a walk-in `cust_...` id,
--                    which is why it is not a foreign key.
--
--   last_reminded_at when this contact was last chased for payment, so the
--                    automatic sweep nudges every few days rather than every
--                    time it runs.
--
-- Run this once in: Supabase Dashboard -> SQL Editor -> New query -> Run.
-- ============================================================================

alter table public.clients
  add column if not exists kind text not null default 'chat',
  add column if not exists customer_id text,
  add column if not exists last_reminded_at timestamptz;

do $$
begin
  alter table public.clients
    add constraint clients_kind_check check (kind in ('chat', 'group'));
exception
  when duplicate_object then null;
end $$;

-- The reminder sweep looks up contacts by customer; the report looks up groups.
create index if not exists clients_customer_idx
  on public.clients (customer_id) where customer_id is not null;

create index if not exists clients_group_idx
  on public.clients (kind) where telegram_chat_id is not null;

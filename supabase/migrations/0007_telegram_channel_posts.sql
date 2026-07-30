-- ============================================================================
-- Truck App — additive migration
--
-- A record of what has already been announced in the Telegram channel.
--
-- The app asks the `announce-telegram` edge function to post whenever a truck
-- or a sale is written. That call can be repeated — a flaky market connection
-- retries, two owners' devices both see the realtime insert, a screen remounts
-- — and a channel that shows the same sale three times is worse than one that
-- shows it late. This table is the claim ticket: the function inserts here
-- first, and only the insert that wins gets to post.
--
-- It is deliberately not a queue. Nothing reads it to find work; it only
-- answers "has this already gone out".
--
-- Run this once in: Supabase Dashboard -> SQL Editor -> New query -> Run.
-- ============================================================================

create table if not exists public.telegram_posts (
  -- Matches the document tables: their ids are text (`truck_...`, `sale_...`),
  -- not uuids.
  kind       text        not null check (kind in ('truck', 'sale')),
  doc_id     text        not null,
  message_id bigint,
  posted_at  timestamptz not null default now(),
  primary key (kind, doc_id)
);

alter table public.telegram_posts enable row level security;

-- No policy, on purpose. RLS with zero policies denies every authenticated
-- caller, and the only writer is the edge function using the service role key,
-- which bypasses RLS. Nothing in the app should read or write this table.

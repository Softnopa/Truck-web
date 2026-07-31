-- ============================================================================
-- Truck App — additive migration
--
-- Lets `telegram_posts` remember one more thing: the growth report pinned in
-- each group.
--
-- 0007 created that table as a claim ticket — "has this truck or sale already
-- been announced" — and constrained `kind` to exactly those two. The Growth
-- button posts a report and pins it, and a pin that is never replaced turns a
-- group's pinned list into a scroll of every report ever sent. So the function
-- keeps the last report's message id per group and unpins it before pinning
-- the next one, which needs a row here.
--
-- `doc_id` holds the group's Telegram chat id for these rows, not a document
-- id. It is text already, and one row per group is exactly the uniqueness the
-- existing primary key gives.
--
-- Run this once in: Supabase Dashboard -> SQL Editor -> New query -> Run.
-- ============================================================================

alter table public.telegram_posts
  drop constraint if exists telegram_posts_kind_check;

alter table public.telegram_posts
  add constraint telegram_posts_kind_check
  check (kind in ('truck', 'sale', 'report'));

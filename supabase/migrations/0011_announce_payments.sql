-- ============================================================================
-- Truck App — additive migration
--
-- Lets a repayment be announced.
--
-- `telegram_posts` is the claim ticket that stops a retry posting the same
-- thing twice, and its `kind` has been widened once already (0010, for the
-- pinned report). Money coming back is now news the groups get too, so
-- 'payment' joins the list — without this the announcement is rejected by the
-- check constraint and the bot stays silent about every repayment.
--
-- Run this once in: Supabase Dashboard -> SQL Editor -> New query -> Run.
-- ============================================================================

alter table public.telegram_posts
  drop constraint if exists telegram_posts_kind_check;

alter table public.telegram_posts
  add constraint telegram_posts_kind_check
  check (kind in ('truck', 'sale', 'report', 'payment'));

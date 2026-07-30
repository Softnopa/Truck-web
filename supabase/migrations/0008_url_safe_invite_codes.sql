-- ============================================================================
-- Truck App — additive migration
--
-- Repairs invite codes that Telegram cannot carry.
--
-- 0003 minted them as `replace(encode(gen_random_bytes(9), 'base64'), '/', '_')`,
-- which escapes `/` but leaves `+` in place. A Telegram deep-link start
-- parameter may only contain A-Z, a-z, 0-9, `_` and `-`, and `+` in a query
-- string decodes to a space besides — so `t.me/<bot>?start=aB+cD` arrives at
-- the webhook as `/start aB cD`, matches no row, and the client is never
-- linked. Roughly one code in six contained a `+`, so a sixth of all invite
-- links silently did nothing.
--
-- This is base64url: the same 9 random bytes, `+` and `/` mapped to `-` and `_`.
--
-- Rewriting an unlinked client's code invalidates the old link, which never
-- worked anyway — the owner shares the new one. Linked clients keep their chat
-- id; the code is only ever used to make that first connection.
--
-- Run this once in: Supabase Dashboard -> SQL Editor -> New query -> Run.
-- ============================================================================

alter table public.clients
  alter column invite_code
  set default translate(encode(gen_random_bytes(9), 'base64'), '+/', '-_');

update public.clients
   set invite_code = translate(invite_code, '+/', '-_')
 where invite_code like '%+%'
    or invite_code like '%/%';

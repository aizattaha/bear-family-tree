-- ============================================================
-- Upgrade 2 — personalised invite previews
-- Run once in the Supabase SQL editor (after upgrade-1).
-- Lets the create-account page greet the invitee by name:
-- "Kak Yana, you're invited to join Bear Family Tree!"
-- ============================================================

alter table tree_invite add column if not exists invite_name text;

-- anonymous preview: holders of a valid, unexpired code may see the
-- name it was addressed to (and nothing else)
create or replace function invite_preview(invite_code text) returns text
language sql security definer stable as $$
  select invite_name from tree_invite
  where code = invite_code and expires_at > now();
$$;

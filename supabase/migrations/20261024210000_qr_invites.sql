-- ============================================================
-- QR invites (2026-10-24) — a keeper shows a QR code on their phone and the
-- relative standing with them scans it, signs up and takes their place.
-- Aizat's choice: scan within 5 minutes, then 30 minutes to finish.
--   * make_qr_invite(p, invite_nm): keepers only. A single-use invite for
--     one unclaimed person that must be opened within 5 minutes. A new one
--     replaces that person's QR invite nobody opened ("refresh"), and QR
--     invites of the tree that ran out are swept away at the same time.
--   * open_invite(code): the app calls it, signed out, the moment an invite
--     link or QR code is opened. A QR invite opened in time gets 30 minutes
--     from then to finish signing up. Answers what the landing page shows
--     (the name, when it runs out), or null for an unknown, used or expired
--     code. 14-day link invites are only read, never changed.
--   * tree_invite.kind: 'link' (the 14-day ones, as before) | 'qr';
--     tree_invite.opened_at: when a QR invite was first opened.
-- join_with_invite is unchanged: it already refuses an expired code, and a
-- person's invite (link or QR) is used up when they take their place.
-- ============================================================

alter table tree_invite add column if not exists kind text not null default 'link';
alter table tree_invite add column if not exists opened_at timestamptz;
alter table tree_invite drop constraint if exists tree_invite_kind;
alter table tree_invite add constraint tree_invite_kind check (kind in ('link', 'qr'));

-- keepers still make 14-day links straight into the table; QR invites only
-- come from make_qr_invite, so their 5 and 30 minutes are the database's
drop policy if exists invite_insert on tree_invite;
create policy invite_insert on tree_invite for insert
  with check (in_tree(tree_id) and is_super_user() and kind = 'link' and opened_at is null);

create or replace function make_qr_invite(p uuid, invite_nm text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare t uuid := my_tree(); c text; until timestamptz;
begin
  if not is_super_user() then raise exception 'only a tree keeper can make an invite'; end if;
  if not exists (select 1 from person where id = p and deleted_at is null and tree_id = t) then
    raise exception 'that person isn''t in your tree'; end if;
  if exists (select 1 from person where id = p and claimed_by is not null) then
    raise exception 'that profile has already been claimed'; end if;
  delete from tree_invite where tree_id = t and kind = 'qr'
    and (expires_at <= now() or (person_id = p and opened_at is null));
  insert into tree_invite (tree_id, person_id, invite_name, kind, created_by, expires_at)
    values (t, p, nullif(left(btrim(coalesce(invite_nm, '')), 80), ''), 'qr', auth.uid(),
            now() + interval '5 minutes')
    returning code, expires_at into c, until;
  return jsonb_build_object('code', c, 'expires_at', until, 'seconds', 300);
end $$;

create or replace function open_invite(invite_code text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare i tree_invite%rowtype;
begin
  update tree_invite set opened_at = now(), expires_at = now() + interval '30 minutes'
    where code = invite_code and kind = 'qr' and opened_at is null and expires_at > now();
  select * into i from tree_invite where code = invite_code and expires_at > now();
  if not found then return null; end if;
  return jsonb_build_object('name', i.invite_name, 'kind', i.kind, 'expires_at', i.expires_at,
    'seconds', ceil(extract(epoch from i.expires_at - now()))::int);
end $$;

revoke execute on function make_qr_invite(uuid, text), open_invite(text) from public, anon, authenticated;
grant execute on function make_qr_invite(uuid, text) to authenticated;
-- the landing page is signed out; a stale sign-in in the browser may still send its token
grant execute on function open_invite(text) to anon, authenticated;

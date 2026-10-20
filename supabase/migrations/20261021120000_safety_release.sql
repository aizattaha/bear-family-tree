-- ============================================================
-- Upgrade 5 — safety release (review round 2026-10-21)
-- Applied with `supabase db push` (tested first on a local stack).
--   a. partner status / year ended can actually be saved
--   b. a household may only rename itself — never make itself super
--      or move into another tree (supers change only via set_super)
--   c. the legacy join_tree back door is gone; only supers read invites
--   d. born and photo values must look like what the app writes
-- ============================================================

-- ---------- a. relationship: status + ended are editable ----------
-- same reach as rel_del (super, or within 5 branches of either person);
-- only status and ended may change — who is linked to whom never does
drop policy if exists rel_update on relationship;
create policy rel_update on relationship for update
  using (in_tree(tree_id) and ( is_super_user()
    or branch_distance(person_a) <= 5 or branch_distance(person_b) <= 5 ))
  with check (in_tree(tree_id) and ( is_super_user()
    or branch_distance(person_a) <= 5 or branch_distance(person_b) <= 5 ));
revoke update on relationship from anon, authenticated;
grant update (status, ended) on relationship to authenticated;

-- ---------- b. nucleus: rename only ----------
-- column grants: members can write tree_name and label, nothing else.
-- is_super moves only through set_super(); tree_id never moves.
revoke update on nucleus from anon, authenticated;
grant update (tree_name, label) on nucleus to authenticated;
drop policy if exists nucleus_update on nucleus;
create policy nucleus_update on nucleus for update
  using (id = my_nucleus()) with check (id = my_nucleus());

-- ---------- c. invites ----------
-- join_tree ignored person-targeted invites and never used them up;
-- join_with_invite (upgrade 1) replaces it
drop function if exists join_tree(text, text, text);
-- codes are keys: only supers (who create and revoke them) may read them
drop policy if exists invite_select on tree_invite;
create policy invite_select on tree_invite for select
  using (in_tree(tree_id) and is_super_user());

-- ---------- d. value checks ----------
-- born: 'YYYY' or 'YYYY-MM-DD' (what the app has always asked for)
alter table person drop constraint if exists person_born_format;
alter table person add constraint person_born_format
  check (born is null or born ~ '^\d{4}(-\d{2}-\d{2})?$');
-- photos: an inline base64 image the app made itself (≤384px JPEG,
-- tens of KB); anything else — a URL, markup, a 10 MB blob — is refused
alter table person drop constraint if exists person_photo_format;
alter table person add constraint person_photo_format check (
  (photo_kid is null or (length(photo_kid) <= 500000
    and photo_kid ~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$'))
  and (photo_teen is null or (length(photo_teen) <= 500000
    and photo_teen ~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$'))
  and (photo_adult is null or (length(photo_adult) <= 500000
    and photo_adult ~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$')));

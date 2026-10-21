-- ============================================================
-- Upgrade 6 — "only us" nicknames (2026-10-21, Aizat's request)
-- Applied with `supabase db push` (tested first on a local stack).
--   a private nickname is readable only by the household that wrote it
--   (claims the viewer person) and the household of the person it names.
--   No super-user exception: "only us" means only us.
-- ============================================================

alter table nickname add column if not exists private boolean not null default false;

-- public rows: anyone in the tree, as before.
-- private rows: only if my household claims the viewer or the named person.
-- If the named person is unclaimed, that leaves just the viewer's household.
drop policy if exists nick_select on nickname;
create policy nick_select on nickname for select using (
  in_tree(tree_id) and ( not private
    or exists (select 1 from person
      where id in (nickname.viewer_person_id, nickname.person_id)
        and claimed_by = my_nucleus()) ));

-- only the household that wrote a nickname may change it (text or the
-- private flag), and the changed row must still be theirs, in their tree
drop policy if exists nick_update on nickname;
create policy nick_update on nickname for update
  using (exists (select 1 from person
    where id = viewer_person_id and claimed_by = my_nucleus()))
  with check (in_tree(tree_id) and exists (select 1 from person
    where id = viewer_person_id and claimed_by = my_nucleus()));

-- ============================================================
-- Upgrade 4 — super users can edit everyone + revoke invites
-- Run once in the Supabase SQL editor (after upgrade-1).
-- ============================================================

-- supers edit any person (claimed or not, any distance)
drop policy if exists person_update on person;
create policy person_update on person for update using (
  in_tree(tree_id) and ( is_super_user()
    or (claimed_by is not null and claimed_by = my_nucleus())
    or (claimed_by is null and branch_distance(id) <= 5) ));

-- supers manage any relationship
drop policy if exists rel_del on relationship;
create policy rel_del on relationship for delete using (
  in_tree(tree_id) and ( is_super_user()
    or branch_distance(person_a) <= 5 or branch_distance(person_b) <= 5 ));

-- supers steward any memorial
drop policy if exists memorial_write on memorial;
create policy memorial_write on memorial for insert with check (
  in_tree(tree_id) and (is_super_user() or branch_distance(person_id) <= 5));
drop policy if exists memorial_update on memorial;
create policy memorial_update on memorial for update using (
  in_tree(tree_id) and (is_super_user() or branch_distance(person_id) <= 5));
drop policy if exists memorial_delete on memorial;
create policy memorial_delete on memorial for delete using (
  in_tree(tree_id) and (is_super_user() or branch_distance(person_id) <= 5));

-- supers can revoke pending invites
drop policy if exists invite_delete on tree_invite;
create policy invite_delete on tree_invite for delete using (
  in_tree(tree_id) and is_super_user());

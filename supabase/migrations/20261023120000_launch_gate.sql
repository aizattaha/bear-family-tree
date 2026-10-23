-- ============================================================
-- Upgrade 7 — Phase 0 "launch gate" (2026-10-23)
-- Applied with `supabase db push` (tested first on a local stack).
--   a. kinship: 5 steps deep (all the edit rules ever ask for), rebuilt
--      once per statement instead of once per row, one rebuild per tree
--      at a time, and no longer callable through the API
--   b. remove_person(): soft delete + links + nicknames + memorial +
--      open invites in one transaction, under the same edit rules
--   c. release_claim(): a super user can undo a claim; every release is
--      written to claim_log (who, when, which household lost it)
--   d. created_at / updated_at / created_by on the family tables
--   e. SEC-08: every SECURITY DEFINER function pins its search_path;
--      anon can call only invite_preview; authenticated keeps only what
--      the app calls or the row-level rules need
-- The BearHaus Finance objects in this database (beta_invites,
-- check_invite, create_household_setup) are deliberately not touched.
-- ============================================================

-- ---------- a. kinship ----------
-- the closure only ever answers "within 5 branches?", so stop walking at 5
-- (12 steps kept ~70% of the rows for nothing). The advisory lock makes a
-- second rebuild of the same tree wait and then see the first one's result
-- (two at once could also collide on the primary key).
create or replace function rebuild_kinship(t uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('kinship:' || t::text, 0));
  delete from kinship where tree_id = t;
  insert into kinship (tree_id, person_a, person_b, hops)
  with recursive edges as (
    select person_a as a, person_b as b from relationship where tree_id = t
    union select person_b, person_a from relationship where tree_id = t
  ), walk (a, b, hops) as (
    select a, b, 1 from edges
    union
    select w.a, e.b, w.hops + 1
    from walk w join edges e on e.a = w.b
    where w.hops < 5 and e.b <> w.a
  )
  select t, a, b, min(hops) from walk group by a, b;
end $$;

-- once per statement, per tree touched: adding a child with two parents or
-- removing someone with six links is one rebuild, not two or six. A status
-- or year-ended change doesn't move any link, so it rebuilds nothing.
drop trigger if exists relationship_changed on relationship;
create or replace function trg_rel_changed() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare t uuid;
begin
  if TG_OP = 'INSERT' then
    for t in select distinct tree_id from new_rows loop perform rebuild_kinship(t); end loop;
  elsif TG_OP = 'DELETE' then
    for t in select distinct tree_id from old_rows loop perform rebuild_kinship(t); end loop;
  else
    for t in
      select o.tree_id from old_rows o join new_rows n on n.id = o.id
        where (o.person_a, o.person_b, o.tree_id) is distinct from (n.person_a, n.person_b, n.tree_id)
      union
      select n.tree_id from old_rows o join new_rows n on n.id = o.id
        where (o.person_a, o.person_b, o.tree_id) is distinct from (n.person_a, n.person_b, n.tree_id)
    loop perform rebuild_kinship(t); end loop;
  end if;
  return null;
end $$;
drop trigger if exists relationship_added on relationship;
drop trigger if exists relationship_removed on relationship;
drop trigger if exists relationship_moved on relationship;
create trigger relationship_added after insert on relationship
  referencing new table as new_rows for each statement execute function trg_rel_changed();
create trigger relationship_removed after delete on relationship
  referencing old table as old_rows for each statement execute function trg_rel_changed();
create trigger relationship_moved after update on relationship
  referencing old table as old_rows new table as new_rows
  for each statement execute function trg_rel_changed();

-- apply the 5-step cap to every tree now
select rebuild_kinship(id) from tree;

-- ---------- b. remove a person, all or nothing ----------
-- same rule as editing them (person_update): a super user, the household
-- that claimed them, or — if unclaimed — family within 5 branches. The
-- check runs before any link goes, while the links still prove the reach.
create or replace function remove_person(p uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare t uuid; c uuid;
begin
  select tree_id, claimed_by into t, c from person
    where id = p and deleted_at is null for update;
  if t is null or t is distinct from my_tree() then raise exception 'that person isn''t in your tree'; end if;
  if not (is_super_user() or (c is not null and c = my_nucleus())
          or (c is null and branch_distance(p) <= 5)) then
    raise exception 'that person is outside what you can edit';
  end if;
  update person set deleted_at = now() where id = p;
  delete from relationship where person_a = p or person_b = p;   -- one kinship rebuild
  delete from nickname where person_id = p or viewer_person_id = p;
  delete from memorial where person_id = p;
  delete from tree_invite where person_id = p;                    -- nobody can claim a removed profile
end $$;

-- ---------- c. release a claim (super users only), with a record ----------
create table if not exists claim_log (
  id bigint generated always as identity primary key,
  tree_id uuid not null references tree(id) on delete cascade,
  person_id uuid not null references person(id) on delete cascade,
  action text not null check (action in ('release')),
  nucleus_id uuid,        -- the household that had the claim
  by_user uuid,           -- the login that released it
  by_nucleus uuid,        -- and its household
  at timestamptz not null default now()
);
alter table claim_log enable row level security;
drop policy if exists claim_log_select on claim_log;
create policy claim_log_select on claim_log for select using (in_tree(tree_id) and is_super_user());
-- written only by release_claim(); nobody edits the record
revoke all on claim_log from anon, authenticated;
grant select on claim_log to authenticated;
revoke all on sequence claim_log_id_seq from anon, authenticated;

create or replace function release_claim(p uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare t uuid; c uuid;
begin
  if not is_super_user() then raise exception 'only a super user can release a claim'; end if;
  select tree_id, claimed_by into t, c from person
    where id = p and deleted_at is null for update;
  if t is null or t is distinct from my_tree() then raise exception 'that person isn''t in your tree'; end if;
  if c is null then raise exception 'that profile isn''t claimed'; end if;
  update person set claimed_by = null where id = p;
  insert into claim_log (tree_id, person_id, action, nucleus_id, by_user, by_nucleus)
    values (t, p, 'release', c, auth.uid(), my_nucleus());
end $$;

-- ---------- d. who added / changed what, and when ----------
-- existing rows keep NULL (unknown) rather than pretending they're new
alter table person add column if not exists updated_at timestamptz;
alter table person add column if not exists created_by uuid;
alter table relationship add column if not exists created_at timestamptz;
alter table relationship add column if not exists updated_at timestamptz;
alter table relationship add column if not exists created_by uuid;
alter table nickname add column if not exists created_at timestamptz;
alter table nickname add column if not exists updated_at timestamptz;
alter table nickname add column if not exists created_by uuid;
alter table memorial add column if not exists created_at timestamptz;
alter table memorial add column if not exists updated_at timestamptz;
alter table memorial add column if not exists created_by uuid;
-- the database fills these in itself, so a client can't claim someone else wrote a row
create or replace function stamp_row() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if TG_OP = 'INSERT' then
    new.created_at := now(); new.created_by := auth.uid();
  else
    new.created_at := old.created_at; new.created_by := old.created_by;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists person_stamp on person;
create trigger person_stamp before insert or update on person
  for each row execute function stamp_row();
drop trigger if exists relationship_stamp on relationship;
create trigger relationship_stamp before insert or update on relationship
  for each row execute function stamp_row();
drop trigger if exists nickname_stamp on nickname;
create trigger nickname_stamp before insert or update on nickname
  for each row execute function stamp_row();
drop trigger if exists memorial_stamp on memorial;
create trigger memorial_stamp before insert or update on memorial
  for each row execute function stamp_row();

-- ---------- e. SEC-08: pinned search_path, least privilege ----------
alter function my_nucleus() set search_path = public, pg_temp;
alter function my_tree() set search_path = public, pg_temp;
alter function in_tree(uuid) set search_path = public, pg_temp;
alter function branch_distance(uuid) set search_path = public, pg_temp;
alter function is_super_user() set search_path = public, pg_temp;
alter function create_tree(text, text) set search_path = public, pg_temp;
alter function claim_person(uuid) set search_path = public, pg_temp;
alter function set_super(uuid, boolean) set search_path = public, pg_temp;
alter function join_with_invite(text, text, text) set search_path = public, pg_temp;
alter function invite_preview(text) set search_path = public, pg_temp;

-- nobody gets anything by default (functions are executable by PUBLIC unless revoked)
revoke execute on function my_nucleus(), my_tree(), in_tree(uuid), branch_distance(uuid),
  is_super_user(), create_tree(text, text), claim_person(uuid), set_super(uuid, boolean),
  join_with_invite(text, text, text), invite_preview(text), rebuild_kinship(uuid),
  trg_rel_changed(), remove_person(uuid), release_claim(uuid), stamp_row()
  from public, anon, authenticated;
-- signed-out visitors: only the "Kak Yana, you're invited" greeting
grant execute on function invite_preview(text) to anon, authenticated;
-- signed-in: what the app calls …
grant execute on function create_tree(text, text), claim_person(uuid), set_super(uuid, boolean),
  join_with_invite(text, text, text), remove_person(uuid), release_claim(uuid) to authenticated;
-- … and what the row-level rules call on every read and write
grant execute on function my_nucleus(), in_tree(uuid), branch_distance(uuid), is_super_user()
  to authenticated;
-- my_tree, rebuild_kinship, trg_rel_changed and stamp_row stay internal

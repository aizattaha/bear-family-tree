-- ============================================================
-- Upgrade 1 — super users + person-targeted invites
-- Run once in the Supabase SQL editor (after schema.sql).
-- ============================================================

alter table nucleus add column if not exists is_super boolean not null default false;
alter table tree_invite add column if not exists person_id uuid references person(id) on delete cascade;

create or replace function is_super_user() returns boolean
language sql security definer stable as $$
  select coalesce((select is_super from nucleus where id = my_nucleus()), false);
$$;

-- the FIRST household of every existing tree becomes its super user
update nucleus n set is_super = true
where n.id = (select id from nucleus x where x.tree_id = n.tree_id order by created_at asc limit 1)
  and not exists (select 1 from nucleus s where s.tree_id = n.tree_id and s.is_super);

-- new trees: the creator is the super user
create or replace function create_tree(nucleus_label text, tree_nm text)
returns uuid language plpgsql security definer as $$
declare t uuid; n uuid;
begin
  insert into tree default values returning id into t;
  insert into nucleus (tree_id, tree_name, label, is_super)
    values (t, tree_nm, nucleus_label, true) returning id into n;
  insert into account (user_id, nucleus_id) values (auth.uid(), n);
  return t;
end $$;

-- supers manage supers: max 3 per tree, never zero
create or replace function set_super(target uuid, flag boolean) returns void
language plpgsql security definer as $$
declare t uuid;
begin
  if not is_super_user() then raise exception 'only a super user can do this'; end if;
  select tree_id into t from nucleus where id = target;
  if t is null or t <> my_tree() then raise exception 'unknown household'; end if;
  if flag then
    if (select count(*) from nucleus where tree_id = t and is_super) >= 3
      then raise exception 'a tree can have at most 3 super users'; end if;
  else
    if (select is_super from nucleus where id = target)
       and (select count(*) from nucleus where tree_id = t and is_super) <= 1
      then raise exception 'the tree needs at least one super user'; end if;
  end if;
  update nucleus set is_super = flag where id = target;
end $$;

-- invites become super-user territory
drop policy if exists invite_insert on tree_invite;
create policy invite_insert on tree_invite for insert
  with check (in_tree(tree_id) and is_super_user());

-- join with a code; a person-targeted invite claims that person and is single-use
create or replace function join_with_invite(invite_code text, nucleus_label text, tree_nm text)
returns jsonb language plpgsql security definer as $$
declare t uuid; pid uuid; n uuid;
begin
  select tree_id, person_id into t, pid from tree_invite
    where code = invite_code and expires_at > now();
  if t is null then raise exception 'invalid or expired invite'; end if;
  if pid is not null and exists (select 1 from person where id = pid and claimed_by is not null)
    then raise exception 'that profile has already been claimed — ask for a fresh invite'; end if;
  insert into nucleus (tree_id, tree_name, label)
    values (t, tree_nm, nucleus_label) returning id into n;
  insert into account (user_id, nucleus_id) values (auth.uid(), n)
    on conflict (user_id) do update set nucleus_id = n;
  if pid is not null then
    update person set claimed_by = n where id = pid;
    delete from tree_invite where code = invite_code;  -- single use
  end if;
  return jsonb_build_object('nucleus_id', n, 'person_id', pid);
end $$;

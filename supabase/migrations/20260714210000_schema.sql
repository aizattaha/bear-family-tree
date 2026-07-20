-- ============================================================
-- Bear Family Tree — Supabase schema + RLS
-- Run this in the Supabase SQL editor of a fresh project.
-- Matches family-tree-concept.md §6 (v1 starting point — review
-- before production use; the local app works without this).
-- ============================================================

-- ---------- tables ----------

create table tree (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now()
);

create table nucleus (
  id uuid primary key default gen_random_uuid(),
  tree_id uuid not null references tree(id) on delete cascade,
  tree_name text not null default 'our family',
  label text not null default 'a household',
  created_at timestamptz default now()
);

create table account (
  user_id uuid primary key references auth.users(id) on delete cascade,
  nucleus_id uuid not null references nucleus(id) on delete cascade
);

create table person (
  id uuid primary key default gen_random_uuid(),
  tree_id uuid not null references tree(id) on delete cascade,
  full_name text not null,
  photo_kid text,            -- storage paths: young kid / teen / adult
  photo_teen text,
  photo_adult text,
  main_photo text default 'adult' check (main_photo in ('kid','teen','adult')),
  born text,                 -- 'YYYY' or 'YYYY-MM-DD'; drives sibling order (oldest left)
  gender char(1) check (gender in ('m','f')),        -- couple order: husband left, wife right
  couple_pos text check (couple_pos in ('left','right')), -- per-couple override, wins over gender
  living_country char(2),    -- ISO code -> flag on the node
  notes text default '',
  claimed_by uuid references nucleus(id),  -- null = unverified
  deleted_at timestamptz,    -- soft delete only
  created_at timestamptz default now()
);

create table relationship (
  id uuid primary key default gen_random_uuid(),
  tree_id uuid not null references tree(id) on delete cascade,
  person_a uuid not null references person(id) on delete cascade,
  person_b uuid not null references person(id) on delete cascade,
  kind text not null check (kind in ('partner','parent-child')), -- a = parent
  status text default 'together' check (status in ('together','separated','divorced')), -- partner links only
  ended text,                -- optional year the partnership ended
  unique (person_a, person_b, kind)
);

create table nickname (
  id uuid primary key default gen_random_uuid(),
  tree_id uuid not null references tree(id) on delete cascade,
  person_id uuid not null references person(id) on delete cascade,
  viewer_person_id uuid not null references person(id) on delete cascade,
  text text not null,
  unique (person_id, viewer_person_id)
);

create table memorial_style (
  id text primary key,
  group_name text not null,      -- 'Islam' | 'Christian' | 'Chinese traditions' | 'Generic' | 'Custom'
  with_date_template text not null,
  without_date_template text not null
);

create table memorial (
  person_id uuid primary key references person(id) on delete cascade,
  tree_id uuid not null references tree(id) on delete cascade,
  passed_on text,                -- 'YYYY' or 'YYYY-MM-DD' or null (passed, date unknown)
  style_id text not null default 'gen1' references memorial_style(id),
  custom_text text
);

-- graph distance closure, maintained by trigger
create table kinship (
  tree_id uuid not null,
  person_a uuid not null,
  person_b uuid not null,
  hops int not null,
  primary key (person_a, person_b)
);

create table tree_invite (
  code text primary key default encode(gen_random_bytes(6), 'hex'),
  tree_id uuid not null references tree(id) on delete cascade,
  created_by uuid references auth.users(id),
  expires_at timestamptz default now() + interval '14 days'
);

insert into memorial_style values
 ('isl1','Islam','Returned to Allah on [date]','Returned to Allah'),
 ('isl2','Islam','Allahyarham · [date]','Allahyarham'),
 ('isl3','Islam','Allahyarhamah · [date]','Allahyarhamah'),
 ('chr1','Christian','Went home to the Lord on [date]','Went home to the Lord'),
 ('chr2','Christian','At rest in Christ · [date]','At rest in Christ'),
 ('chr3','Christian','In loving memory · [date]','In loving memory'),
 ('chi1','Chinese traditions','安息 · at rest · [date]','安息 · at rest'),
 ('chi2','Chinese traditions','往生 on [date]','往生'),
 ('gen1','Generic','Passed on [date]','Passed'),
 ('gen2','Generic','Rest in peace · [date]','Rest in peace'),
 ('custom','Custom','','');

-- ---------- helpers (security definer avoids recursive RLS) ----------

create or replace function my_nucleus() returns uuid
language sql security definer stable as $$
  select nucleus_id from account where user_id = auth.uid();
$$;

create or replace function my_tree() returns uuid
language sql security definer stable as $$
  select n.tree_id from account a join nucleus n on n.id = a.nucleus_id
  where a.user_id = auth.uid();
$$;

create or replace function in_tree(t uuid) returns boolean
language sql security definer stable as $$
  select t = my_tree();
$$;

-- min hops from any person claimed by my nucleus to person p
create or replace function branch_distance(p uuid) returns int
language sql security definer stable as $$
  select coalesce(min(k.hops), case when exists
      (select 1 from person where id = p and claimed_by = my_nucleus())
      then 0 end, 999)
  from kinship k
  join person me on me.id = k.person_a and me.claimed_by = my_nucleus()
  where k.person_b = p;
$$;

-- ---------- kinship closure maintenance ----------
-- Family trees are small (hundreds, not millions): recompute the
-- whole tree's closure on any relationship change. Simple and correct.

create or replace function rebuild_kinship(t uuid) returns void
language plpgsql security definer as $$
begin
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
    where w.hops < 12 and e.b <> w.a
  )
  select t, a, b, min(hops) from walk group by a, b;
end $$;

create or replace function trg_rel_changed() returns trigger
language plpgsql security definer as $$
begin
  perform rebuild_kinship(coalesce(new.tree_id, old.tree_id));
  return coalesce(new, old);
end $$;

create trigger relationship_changed
after insert or update or delete on relationship
for each row execute function trg_rel_changed();

-- ---------- RLS ----------

alter table tree enable row level security;
alter table nucleus enable row level security;
alter table account enable row level security;
alter table person enable row level security;
alter table relationship enable row level security;
alter table nickname enable row level security;
alter table memorial enable row level security;
alter table memorial_style enable row level security;
alter table kinship enable row level security;
alter table tree_invite enable row level security;

create policy tree_select on tree for select using (in_tree(id));

create policy nucleus_select on nucleus for select using (in_tree(tree_id));
-- you rename YOUR view of the tree, never anyone else's
create policy nucleus_update on nucleus for update using (id = my_nucleus());

create policy account_select on account for select using (user_id = auth.uid());
create policy account_delete on account for delete using (user_id = auth.uid());

-- everyone in the tree can VIEW every person
create policy person_select on person for select using (in_tree(tree_id));
-- claimed: only the claiming nucleus. unclaimed: within 5 branches.
create policy person_update on person for update using (
  in_tree(tree_id) and (
    (claimed_by is not null and claimed_by = my_nucleus())
    or (claimed_by is null and branch_distance(id) <= 5)
  ));
create policy person_insert on person for insert with check (in_tree(tree_id));

create policy rel_select on relationship for select using (in_tree(tree_id));
create policy rel_write on relationship for insert with check (in_tree(tree_id));
create policy rel_del on relationship for delete using (
  in_tree(tree_id) and (branch_distance(person_a) <= 5 or branch_distance(person_b) <= 5));

create policy nick_select on nickname for select using (in_tree(tree_id));
-- you write only your own nicknames (viewer must be claimed by your nucleus)
create policy nick_write on nickname for insert with check (
  in_tree(tree_id) and exists (select 1 from person
    where id = viewer_person_id and claimed_by = my_nucleus()));
create policy nick_update on nickname for update using (
  exists (select 1 from person where id = viewer_person_id and claimed_by = my_nucleus()));
create policy nick_delete on nickname for delete using (
  exists (select 1 from person where id = viewer_person_id and claimed_by = my_nucleus()));

-- THE deliberate exception: memorial phrasing is stewarded by nearby
-- family (<=5 branches) whether or not the profile is claimed.
create policy memorial_select on memorial for select using (in_tree(tree_id));
create policy memorial_write on memorial for insert with check (
  in_tree(tree_id) and branch_distance(person_id) <= 5);
create policy memorial_update on memorial for update using (
  in_tree(tree_id) and branch_distance(person_id) <= 5);
create policy memorial_delete on memorial for delete using (
  in_tree(tree_id) and branch_distance(person_id) <= 5);

create policy styles_select on memorial_style for select using (true);
create policy kinship_select on kinship for select using (in_tree(tree_id));
create policy invite_select on tree_invite for select using (in_tree(tree_id));
create policy invite_insert on tree_invite for insert with check (in_tree(tree_id));

-- ---------- RPCs ----------

-- first user: create a tree + own nucleus
create or replace function create_tree(nucleus_label text, tree_nm text)
returns uuid language plpgsql security definer as $$
declare t uuid; n uuid;
begin
  insert into tree default values returning id into t;
  insert into nucleus (tree_id, tree_name, label) values (t, tree_nm, nucleus_label) returning id into n;
  insert into account (user_id, nucleus_id) values (auth.uid(), n);
  return t;
end $$;

-- join via invite code, creating or joining a nucleus
create or replace function join_tree(invite_code text, nucleus_label text, tree_nm text)
returns uuid language plpgsql security definer as $$
declare t uuid; n uuid;
begin
  select tree_id into t from tree_invite where code = invite_code and expires_at > now();
  if t is null then raise exception 'invalid or expired invite'; end if;
  insert into nucleus (tree_id, tree_name, label) values (t, tree_nm, nucleus_label) returning id into n;
  insert into account (user_id, nucleus_id) values (auth.uid(), n)
    on conflict (user_id) do update set nucleus_id = n;
  return n;
end $$;

-- claim a person into my nucleus (this is me / in my household)
create or replace function claim_person(p uuid) returns void
language plpgsql security definer as $$
begin
  update person set claimed_by = my_nucleus()
  where id = p and tree_id = my_tree() and claimed_by is null;
  if not found then raise exception 'already claimed — talk to that nucleus'; end if;
end $$;

-- ---------- storage ----------
-- Create a PUBLIC=false bucket named 'photos'. Policy: path must start
-- with the caller's tree id, e.g.  <tree_id>/<person_id>/adult.jpg
-- (add via Dashboard > Storage > policies):
--   (bucket_id = 'photos' and (storage.foldername(name))[1] = my_tree()::text)

-- ============================================================
-- Soft-launch fixes (round-2 review "Fix now", 24 Oct 2026; Aizat agreed every item)
-- Applied with `supabase db push` (tested first on a local stack).
--   a. households are named after a member ("Adam's household") instead of
--      "our household"; a joining household gets the tree's name for the tree
--   b. a reset code alone finds the login (no email to remember): the first 2 of
--      its 8 symbols find the row, the whole code is still checked against a
--      bcrypt hash; at most 3 codes waiting per tree and 20 in the database;
--      5 wrong tries still burn a code, and 20 failed tries in 30 minutes, by
--      anyone, stop every reset until the 30 minutes are up. The member can
--      see who reset their password and when (my_password_resets)
--   c. invites: "not me" cancels a personal invite (decline_invite); a QR code
--      gives 10 minutes after it is opened (was 30); nobody is invited to take
--      the place of someone with a memorial; used invites are kept and marked
--      (used_at, used_by, uses, channel) instead of deleted, with a counts-only
--      view for keepers (invite_funnel)
--   d. a new family tree needs a keeper's one-time "start a tree" code
--      (make_newtree_code → create_tree), one tree per login, and a tree holds
--      at most 5,000 people
--   e. the role is called "tree keeper" and the unit "household" in every
--      message the database sends back
-- ============================================================

-- ---------- a. households named after a member ----------
-- label_auto: the household hasn't been given a name yet — the first member it
-- claims names it ("Adam's household"). A name someone typed is never touched.
alter table nucleus add column if not exists label_auto boolean not null default false;

-- the name someone goes by: their own "You go by" (never a private one), else the
-- first word of their name; nothing for a "?" (name not known yet) or a removed person
create or replace function goes_by(p uuid) returns text
language sql stable set search_path = public, pg_temp as $$
  select case when x.name_unknown or x.deleted_at is not null then null
    else coalesce(nullif(left(btrim(n.text), 40), ''), nullif(left(split_part(btrim(x.full_name), ' ', 1), 40), '')) end
  from person x left join nickname n on n.person_id = x.id and n.viewer_person_id = x.id and not n.private
  where x.id = p;
$$;

-- runs as its owner: a keeper filling in someone's name may name that person's
-- (still unnamed) household, which the keeper couldn't rename themselves
create or replace function name_household() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare nm text;
begin
  if new.claimed_by is null then return null; end if;
  nm := goes_by(new.id);
  if nm is null then return null; end if;
  update nucleus set label = nm || '''s household', label_auto = false
    where id = new.claimed_by and label_auto;
  return null;
end $$;
drop trigger if exists person_names_household on person;
create trigger person_names_household after insert or update of claimed_by, full_name on person
  for each row execute function name_household();

-- the households already called by a placeholder get their members' names now
-- (up to two, oldest entry first: "Adam & Hana's household"); one with no
-- named member yet waits for its first
do $$
declare named int; waiting int;
begin
  update nucleus set label_auto = true
    where lower(btrim(label)) in ('', 'our household', 'a household', 'new household');
  update nucleus n set label = m.names || '''s household', label_auto = false
    from (select claimed_by, string_agg(nm, ' & ' order by k) names
          from (select claimed_by, goes_by(id) nm,
                  row_number() over (partition by claimed_by order by created_at nulls first, born nulls last, full_name) k
                from person where claimed_by is not null and goes_by(id) is not null) x
          where k <= 2 group by claimed_by) m
    where n.id = m.claimed_by and n.label_auto;
  get diagnostics named = row_count;
  update nucleus set label = 'new household' where label_auto;
  select count(*) into waiting from nucleus where label_auto;
  raise notice 'households named after their members: % (% still waiting for a named member)', named, waiting;
end $$;

-- a household's starting name and its name for the tree, from what a client sent:
-- empty or one of the old placeholders → named later by its first member; someone
-- joining tree t (empty, or the old app's "our family") → the tree name the keepers use
create or replace function household_names(t uuid, nucleus_label text, tree_nm text, out lbl text, out tn text)
language plpgsql stable set search_path = public, pg_temp as $$
begin
  lbl := nullif(left(btrim(coalesce(nucleus_label, '')), 80), '');
  if lower(lbl) in ('our household', 'a household', 'new household') then lbl := null; end if;
  tn := nullif(left(btrim(coalesce(tree_nm, '')), 80), '');
  if t is not null and lower(tn) = 'our family' then tn := null; end if;
  if tn is null and t is not null then
    select tree_name into tn from nucleus where tree_id = t order by is_super desc, created_at limit 1;
  end if;
  tn := coalesce(tn, 'our family');
end $$;

-- ---------- c (part). invites keep their history ----------
alter table tree_invite add column if not exists created_at timestamptz;
alter table tree_invite alter column created_at set default now();
alter table tree_invite add column if not exists channel text;          -- qr | link (a person's 14-day link) | code (general)
alter table tree_invite add column if not exists used_at timestamptz;   -- personal: when it was used; general: the latest use
alter table tree_invite add column if not exists used_by uuid references nucleus(id) on delete set null;
alter table tree_invite add column if not exists uses int not null default 0;
alter table tree_invite add column if not exists declined_at timestamptz; -- "not me" on the invite's page
update tree_invite set channel = case when kind = 'qr' then 'qr' when person_id is null then 'code' else 'link' end
  where channel is null;
alter table tree_invite alter column channel set not null;
alter table tree_invite drop constraint if exists tree_invite_channel;
alter table tree_invite add constraint tree_invite_channel check (channel in ('qr', 'link', 'code'));

-- the database fills these in itself: a keeper writing a link can't backdate it,
-- pick its channel or make it look used or declined
create or replace function invite_stamp() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  new.created_at := now();
  new.channel := case when new.kind = 'qr' then 'qr' when new.person_id is null then 'code' else 'link' end;
  new.used_at := null; new.used_by := null; new.uses := 0; new.declined_at := null;
  return new;
end $$;
drop trigger if exists tree_invite_stamp on tree_invite;
create trigger tree_invite_stamp before insert on tree_invite for each row execute function invite_stamp();

-- a personal 14-day link only for someone living, on the tree and unclaimed
drop policy if exists invite_insert on tree_invite;
create policy invite_insert on tree_invite for insert with check (
  in_tree(tree_id) and is_super_user() and kind = 'link' and opened_at is null
  and (tree_invite.person_id is null or exists (select 1 from person x
    where x.id = tree_invite.person_id and x.tree_id = tree_invite.tree_id and x.deleted_at is null
      and x.claimed_by is null and not exists (select 1 from memorial m where m.person_id = x.id))));
-- used and declined invites are the record: keepers delete only ones never used
drop policy if exists invite_delete on tree_invite;
create policy invite_delete on tree_invite for delete using (
  in_tree(tree_id) and is_super_user() and used_at is null and declined_at is null);

-- the old greeting (cached pages may still call it): live invites only
create or replace function invite_preview(invite_code text) returns text
language sql security definer stable set search_path = public, pg_temp as $$
  select invite_name from tree_invite
  where code = invite_code and expires_at > now() and declined_at is null
    and (person_id is null or used_at is null);
$$;

-- a keeper makes a QR invite: as before, but never for someone with a memorial,
-- and only codes nobody opened are swept away (an opened one is part of the record)
create or replace function make_qr_invite(p uuid, invite_nm text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare t uuid := my_tree(); c text; until timestamptz;
begin
  if not is_super_user() then raise exception 'only a tree keeper can make an invite'; end if;
  if not exists (select 1 from person where id = p and deleted_at is null and tree_id = t) then
    raise exception 'that person isn''t in your tree'; end if;
  if exists (select 1 from person where id = p and claimed_by is not null) then
    raise exception 'that profile has already been claimed'; end if;
  if exists (select 1 from memorial where person_id = p) then
    raise exception 'that person has a memorial on the tree — invites are only for living relatives'; end if;
  delete from tree_invite where tree_id = t and kind = 'qr' and opened_at is null and used_at is null
    and declined_at is null and (expires_at <= now() or person_id = p);
  insert into tree_invite (tree_id, person_id, invite_name, kind, created_by, expires_at)
    values (t, p, nullif(left(btrim(coalesce(invite_nm, '')), 80), ''), 'qr', auth.uid(),
            now() + interval '5 minutes')
    returning code, expires_at into c, until;
  return jsonb_build_object('code', c, 'expires_at', until, 'seconds', 300);
end $$;

-- the landing page, signed out. A QR code opened in time now gets 10 minutes
-- (was 30). A 14-day link's first open is noted too (for the counts) without
-- changing its 14 days. Nothing for a used, declined or run-out invite, or one
-- for someone removed, already claimed, or with a memorial. The family preview
-- ("Is this you?") is unchanged.
create or replace function open_invite(invite_code text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare i tree_invite%rowtype; fam jsonb;
begin
  select * into i from tree_invite where code = invite_code and expires_at > now() and declined_at is null
    and (person_id is null or used_at is null) for update;
  if not found then return null; end if;
  if i.person_id is not null and not exists (select 1 from person x where x.id = i.person_id
      and x.deleted_at is null and x.claimed_by is null
      and not exists (select 1 from memorial m where m.person_id = x.id)) then return null; end if;
  if i.opened_at is null then
    update tree_invite set opened_at = now(),
      expires_at = case when kind = 'qr' then now() + interval '10 minutes' else expires_at end
      where code = i.code returning * into i;
  end if;
  if i.person_id is not null then
    with links as (
      select 'parents' grp, r.person_a pid from relationship r
        where r.kind = 'parent-child' and r.person_b = i.person_id
      union select 'children', r.person_b from relationship r
        where r.kind = 'parent-child' and r.person_a = i.person_id
      union select 'partners', case when r.person_a = i.person_id then r.person_b else r.person_a end
        from relationship r where r.kind = 'partner' and i.person_id in (r.person_a, r.person_b)
          and r.status in ('together', 'dating')
      union select 'siblings', c.person_b from relationship p
        join relationship c on c.kind = 'parent-child' and c.person_a = p.person_a
        where p.kind = 'parent-child' and p.person_b = i.person_id and c.person_b <> i.person_id),
    named as (
      select l.grp, coalesce(nullif(left(btrim(n.text), 40), ''), split_part(btrim(x.full_name), ' ', 1)) nm,
        row_number() over (partition by l.grp order by x.born nulls last, x.full_name) k
      from links l join person x on x.id = l.pid and x.tree_id = i.tree_id and x.deleted_at is null and not x.name_unknown
      left join nickname n on n.person_id = x.id and n.viewer_person_id = x.id and not n.private)
    select coalesce(jsonb_object_agg(grp, names), '{}'::jsonb) into fam
      from (select grp, jsonb_agg(nm order by k) names from named where k <= 12 group by grp) g;
  end if;
  return jsonb_build_object('name', i.invite_name, 'kind', i.kind, 'expires_at', i.expires_at,
    'seconds', ceil(extract(epoch from i.expires_at - now()))::int, 'family', fam,
    'unknown', (select name_unknown from person where id = i.person_id));
end $$;

-- "not me": whoever holds a personal invite can cancel it — it stops working at
-- once, stays on record, and the keeper's screen says so. General codes aren't
-- for one person, so there's nothing to decline.
create or replace function decline_invite(invite_code text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update tree_invite set declined_at = now(), expires_at = least(expires_at, now())
    where code = invite_code and person_id is not null and used_at is null
      and declined_at is null and expires_at > now();
  return found;
end $$;

-- a keeper ends an invite that has been used (a general code) — it can't be
-- deleted any more, because it's part of the record
create or replace function stop_invite(invite_code text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not is_super_user() then raise exception 'only a tree keeper can stop an invite'; end if;
  update tree_invite set expires_at = now()
    where code = invite_code and tree_id = my_tree() and expires_at > now();
  return found;
end $$;

-- joining: as before, plus — the invite is marked used (not deleted); a household
-- is named after its member; the tree name defaults to the keepers'; nobody takes
-- the place of someone removed or with a memorial; two invites for one person
-- can't both claim them
create or replace function join_with_invite(invite_code text, nucleus_label text, tree_nm text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare i tree_invite%rowtype; n uuid; nm record;
begin
  select * into i from tree_invite where code = invite_code and expires_at > now() and declined_at is null
    and (person_id is null or used_at is null) for update;
  if not found then raise exception 'invalid or expired invite'; end if;
  if i.person_id is not null then
    if exists (select 1 from person where id = i.person_id and claimed_by is not null) then
      raise exception 'that profile has already been claimed — ask for a fresh invite'; end if;
    if not exists (select 1 from person x where x.id = i.person_id and x.deleted_at is null
        and not exists (select 1 from memorial m where m.person_id = x.id)) then
      raise exception 'invalid or expired invite'; end if;
  end if;
  select * into nm from household_names(i.tree_id, nucleus_label, tree_nm);
  insert into nucleus (tree_id, tree_name, label, label_auto)
    values (i.tree_id, nm.tn, coalesce(nm.lbl, 'new household'), nm.lbl is null) returning id into n;
  insert into account (user_id, nucleus_id) values (auth.uid(), n)
    on conflict (user_id) do update set nucleus_id = n;
  if i.person_id is not null then
    update person set claimed_by = n where id = i.person_id and claimed_by is null;
    if not found then raise exception 'that profile has already been claimed — ask for a fresh invite'; end if;
  end if;
  update tree_invite set used_at = now(), used_by = n, uses = uses + 1 where code = i.code;
  return jsonb_build_object('nucleus_id', n, 'person_id', i.person_id);
end $$;

-- removing someone: as before, but only their invites nobody used or declined go —
-- a used one is the record of how they joined
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
  delete from tree_invite where person_id = p and used_at is null and declined_at is null;
  update tree_invite set expires_at = least(expires_at, now()) where person_id = p; -- the rest can't be used either
end $$;

-- keepers' numbers: invites made / opened / used / declined / still live, per
-- channel — counts only, no names. Reads as the caller, so the invite rules
-- apply: a keeper sees their own tree's numbers, anyone else sees none
drop view if exists invite_funnel;
create view invite_funnel with (security_invoker = true) as
  select channel, count(*)::int made, count(opened_at)::int opened,
    (count(*) filter (where uses > 0))::int used, coalesce(sum(uses), 0)::int joins,
    count(declined_at)::int declined,
    (count(*) filter (where expires_at > now() and declined_at is null and (person_id is null or used_at is null)))::int live
  from tree_invite group by channel;

-- ---------- b. reset codes: the code alone finds the login ----------
alter table password_reset add column if not exists user_id uuid;      -- the login it opens, fixed when it's made
alter table password_reset add column if not exists code_prefix text;  -- first 2 symbols: finds the row, proves nothing
create index if not exists password_reset_prefix on password_reset (code_prefix) where used_at is null and revoked_at is null;
-- codes made for the old email form can't be found without an email: stop them
update password_reset set revoked_at = now() where used_at is null and revoked_at is null and code_prefix is null;

-- failed tries, counted for everyone together in 30-minute windows (one row)
create table if not exists password_reset_guard (
  id int primary key default 1 check (id = 1),
  window_start timestamptz not null default now(),
  failures int not null default 0
);
alter table password_reset_guard enable row level security;
revoke all on password_reset_guard from anon, authenticated;
-- the old per-email counter goes with the email form
drop function if exists redeem_reset_code(text, text, text);
drop table if exists password_reset_failure;

create or replace function issue_reset_code(p uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  t uuid; h uuid; u uuid; n int; code text; b bytea; i int; until timestamptz;
  symbols constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; -- 31, no 0/O or 1/I/L to misread
begin
  if not is_super_user() then raise exception 'only a tree keeper can make a reset code'; end if;
  select tree_id, claimed_by into t, h from person where id = p and deleted_at is null;
  if t is null or t is distinct from my_tree() then raise exception 'that person isn''t in your tree'; end if;
  if h is null then raise exception 'nobody has claimed that profile yet — send them an invite instead'; end if;
  if (select tree_id from nucleus where id = h) is distinct from t then raise exception 'that household isn''t in your tree'; end if;
  select count(*), (array_agg(user_id))[1] into n, u from account where nucleus_id = h;
  if n = 0 then raise exception 'that household has no login to reset'; end if;
  if n > 1 then raise exception 'that household has more than one login — ask the tree''s owner to help'; end if;
  -- one keeper at a time, so the limits and the prefix check below can't race
  perform pg_advisory_xact_lock(hashtextextended('reset:issue', 0));
  -- one live code per household: making a new one stops the old one
  update password_reset set revoked_at = now() where nucleus_id = h and used_at is null and revoked_at is null;
  if (select count(*) from password_reset where tree_id = t and used_at is null and revoked_at is null and expires_at > now()) >= 3 then
    raise exception '3 reset codes are already waiting in this tree — wait until one is used or runs out (30 minutes)'; end if;
  if (select count(*) from password_reset where used_at is null and revoked_at is null and expires_at > now()) >= 20 then
    raise exception 'too many reset codes are waiting right now — please try again in 30 minutes'; end if;
  -- 8 random symbols; bytes 248–255 are skipped so every symbol is equally likely.
  -- The first 2 must differ from every other live code's, so they find exactly one
  loop
    code := '';
    while length(code) < 8 loop
      b := extensions.gen_random_bytes(16);
      for i in 0..15 loop
        exit when length(code) = 8;
        if get_byte(b, i) < 248 then code := code || substr(symbols, get_byte(b, i) % 31 + 1, 1); end if;
      end loop;
    end loop;
    exit when not exists (select 1 from password_reset where code_prefix = left(code, 2)
      and used_at is null and revoked_at is null and expires_at > now());
  end loop;
  insert into password_reset (tree_id, nucleus_id, person_id, user_id, code_prefix, code_hash, created_by, created_by_nucleus)
    values (t, h, p, u, left(code, 2), extensions.crypt(code, extensions.gen_salt('bf', 8)), auth.uid(), my_nucleus())
    returning expires_at into until;
  return jsonb_build_object('code', code, 'expires_at', until);
end $$;

-- the sign-in screen, signed out: the code and a new password, nothing else.
-- Answers {result: ok, email, reset_id} — the email so the app can sign them in
-- and show which login it was — or {result: short | long | locked | no}: an
-- unknown, wrong, expired, used or burned code all look the same. Failures are
-- returned, not raised, so the counters are kept.
create or replace function redeem_reset_code(reset_code text, new_password text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  c text := upper(regexp_replace(coalesce(reset_code, ''), '[^0-9A-Za-z]', '', 'g'));
  r password_reset%rowtype; g password_reset_guard%rowtype; ok boolean := false; e text;
begin
  if length(coalesce(new_password, '')) < 6 then return jsonb_build_object('result', 'short'); end if; -- Supabase Auth's minimum
  if octet_length(new_password) > 72 then return jsonb_build_object('result', 'long'); end if;       -- bcrypt reads no further
  -- one try at a time, for everyone: parallel guesses can't slip past the counters
  perform pg_advisory_xact_lock(hashtextextended('reset:redeem', 0));
  insert into password_reset_guard (id) values (1) on conflict (id) do nothing;
  select * into g from password_reset_guard where id = 1;
  if g.window_start < now() - interval '30 minutes' then
    update password_reset_guard set window_start = now(), failures = 0 where id = 1;
    g.failures := 0;
  end if;
  if g.failures >= 20 then return jsonb_build_object('result', 'locked'); end if;
  if length(c) = 8 then
    select pr.* into r from password_reset pr
      where pr.code_prefix = left(c, 2) and pr.used_at is null and pr.revoked_at is null and pr.expires_at > now()
      order by pr.created_at desc limit 1 for update;
  end if;
  -- the same bcrypt work whether or not a code was found, so the timing says nothing either
  if r.id is not null then ok := r.code_hash = extensions.crypt(c, r.code_hash);
  else perform extensions.crypt(c, extensions.gen_salt('bf', 8)); end if;
  -- the login must still exist, be an ordinary one, and still belong to that household
  if ok then
    select u.email into e from auth.users u join account a on a.user_id = u.id and a.nucleus_id = r.nucleus_id
      where u.id = r.user_id and u.deleted_at is null and not coalesce(u.is_sso_user, false);
    ok := e is not null;
  end if;
  if not ok then
    update password_reset_guard set failures = failures + 1 where id = 1;
    if r.id is not null then
      update password_reset set attempts = attempts + 1,
        revoked_at = case when attempts + 1 >= 5 then now() end where id = r.id;
    end if;
    return jsonb_build_object('result', 'no');
  end if;
  update auth.users set encrypted_password = extensions.crypt(new_password, extensions.gen_salt('bf', 10)),
    updated_at = now() where id = r.user_id;
  delete from auth.sessions where user_id = r.user_id;  -- signed out everywhere: the new password is needed
  update password_reset set used_at = now(), used_by = r.user_id where id = r.id;
  return jsonb_build_object('result', 'ok', 'email', e, 'reset_id', r.id);
end $$;

-- the member's side of a reset: who reset MY password, and when (last 90 days,
-- newest first) — the app shows it once on every device that didn't do it, and
-- always on the member's own card. Nobody else's resets, no codes.
create or replace function my_password_resets() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'at', r.used_at, 'by', coalesce(n.label, 'a tree keeper'))
    order by r.used_at desc), '[]'::jsonb)
  from (select * from password_reset where used_by = auth.uid() and used_at > now() - interval '90 days'
        order by used_at desc limit 5) r
  left join nucleus n on n.id = r.created_by_nucleus;
$$;

-- ---------- d. new trees only through a keeper's link ----------
alter table tree add column if not exists created_by uuid;  -- the login that started it (older trees: unknown)

create table if not exists newtree_code (
  code text primary key default encode(extensions.gen_random_bytes(6), 'hex'),
  tree_id uuid references tree(id) on delete cascade,        -- the tree whose keeper made it
  created_by uuid,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days',
  used_at timestamptz,
  used_by uuid,
  new_tree uuid references tree(id) on delete set null
);
alter table newtree_code enable row level security;
revoke all on newtree_code from anon, authenticated;

-- a keeper's "start your own tree" link for a friend: works once, for 14 days;
-- at most 5 waiting per tree
create or replace function make_newtree_code() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare t uuid := my_tree(); c text; until timestamptz;
begin
  if not is_super_user() then raise exception 'only a tree keeper can invite someone to start a new tree'; end if;
  perform pg_advisory_xact_lock(hashtextextended('newtree:' || t::text, 0));
  if (select count(*) from newtree_code where tree_id = t and used_at is null and expires_at > now()) >= 5 then
    raise exception '5 start-a-tree links from your tree are already waiting — wait until one is used or runs out (14 days)'; end if;
  insert into newtree_code (tree_id, created_by) values (t, auth.uid()) returning code, expires_at into c, until;
  return jsonb_build_object('code', c, 'expires_at', until);
end $$;

drop function if exists create_tree(text, text);
create or replace function create_tree(nucleus_label text, tree_nm text, start_code text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare t uuid; n uuid; c text; nm record;
begin
  if auth.uid() is null then raise exception 'please sign in first'; end if;
  if exists (select 1 from account where user_id = auth.uid()) then
    raise exception 'this login already has a place in a family tree'; end if;
  if exists (select 1 from tree where created_by = auth.uid()) then
    raise exception 'this login has already started a family tree — one per login'; end if;
  select code into c from newtree_code where code = lower(btrim(coalesce(start_code, '')))
    and used_at is null and expires_at > now() for update;
  if c is null then
    raise exception 'a new family tree needs a start-a-tree link from a tree keeper — ask them for a fresh one'; end if;
  select * into nm from household_names(null, nucleus_label, tree_nm);
  insert into tree (created_by) values (auth.uid()) returning id into t;
  insert into nucleus (tree_id, tree_name, label, label_auto, is_super)
    values (t, nm.tn, coalesce(nm.lbl, 'new household'), nm.lbl is null, true) returning id into n;
  insert into account (user_id, nucleus_id) values (auth.uid(), n);
  update newtree_code set used_at = now(), used_by = auth.uid(), new_tree = t where code = c;
  return t;
end $$;

-- at most 5,000 people per tree (removed ones count: they still take space)
create or replace function cap_people() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare t uuid;
begin
  for t in select distinct tree_id from new_rows loop
    if (select count(*) from person where tree_id = t) > 5000 then
      raise exception 'a family tree can hold at most 5,000 people — ask the tree''s owner if you need more';
    end if;
  end loop;
  return null;
end $$;
drop trigger if exists person_cap on person;
create trigger person_cap after insert on person referencing new table as new_rows
  for each statement execute function cap_people();

-- ---------- e. "tree keeper" and "household" in what the database says ----------
create or replace function set_super(target uuid, flag boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare t uuid;
begin
  if not is_super_user() then raise exception 'only a tree keeper can do this'; end if;
  select tree_id into t from nucleus where id = target;
  if t is null or t <> my_tree() then raise exception 'unknown household'; end if;
  if flag then
    if (select count(*) from nucleus where tree_id = t and is_super) >= 3
      then raise exception 'a tree can have at most 3 tree keepers'; end if;
  else
    if (select is_super from nucleus where id = target)
       and (select count(*) from nucleus where tree_id = t and is_super) <= 1
      then raise exception 'the tree needs at least one tree keeper'; end if;
  end if;
  update nucleus set is_super = flag where id = target;
end $$;

create or replace function release_claim(p uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare t uuid; c uuid;
begin
  if not is_super_user() then raise exception 'only a tree keeper can release a claim'; end if;
  select tree_id, claimed_by into t, c from person
    where id = p and deleted_at is null for update;
  if t is null or t is distinct from my_tree() then raise exception 'that person isn''t in your tree'; end if;
  if c is null then raise exception 'that profile isn''t claimed'; end if;
  update person set claimed_by = null where id = p;
  insert into claim_log (tree_id, person_id, action, nucleus_id, by_user, by_nucleus)
    values (t, p, 'release', c, auth.uid(), my_nucleus());
end $$;

create or replace function claim_person(p uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update person set claimed_by = my_nucleus()
  where id = p and tree_id = my_tree() and claimed_by is null;
  if not found then raise exception 'already claimed — talk to that household'; end if;
end $$;

-- ---------- who may call what ----------
-- nothing by default (functions are executable by PUBLIC unless revoked; new
-- tables and views get every privilege in this project unless revoked)
revoke execute on function goes_by(uuid), name_household(), household_names(uuid, text, text), invite_stamp(),
  invite_preview(text), make_qr_invite(uuid, text), open_invite(text), decline_invite(text), stop_invite(text),
  join_with_invite(text, text, text), issue_reset_code(uuid), redeem_reset_code(text, text), my_password_resets(),
  make_newtree_code(), create_tree(text, text, text), cap_people(), set_super(uuid, boolean), release_claim(uuid),
  claim_person(uuid), remove_person(uuid)
  from public, anon, authenticated;
-- signed out (the landing page, the reset screen); a stale sign-in may still send its token
grant execute on function invite_preview(text), open_invite(text), decline_invite(text), redeem_reset_code(text, text)
  to anon, authenticated;
-- signed in: what the app calls
grant execute on function make_qr_invite(uuid, text), stop_invite(text), join_with_invite(text, text, text),
  issue_reset_code(uuid), my_password_resets(), make_newtree_code(), create_tree(text, text, text),
  set_super(uuid, boolean), release_claim(uuid), claim_person(uuid), remove_person(uuid)
  to authenticated;
-- goes_by, name_household, household_names, invite_stamp and cap_people stay internal
revoke all on invite_funnel from anon, authenticated;
grant select on invite_funnel to authenticated;

-- ============================================================
-- Upgrade 9 — keepers help relatives back in, no emails (2026-10-24)
-- A tree keeper (super user) makes a one-time reset code from a claimed
-- person's card. The relative types their login email, the code and a new
-- password on the sign-in screen, and keeps the SAME login.
--   * a code: 8 characters, stored only as a bcrypt hash, works once, for
--     30 minutes, for the logins of that one household; a newer code for
--     the household replaces it; 5 wrong tries burn it
--   * every code is a record: which keeper, for which household, when,
--     how many wrong tries, when it was used
--   * redeeming gives the same answer for every kind of failure, so it never
--     says whether an email has a login; 10 failures for one email within
--     30 minutes lock that email out until the 30 minutes are up
--   * the new password is stored the way Supabase Auth stores its own
--     (bcrypt, cost 10, in auth.users.encrypted_password) and, like
--     Supabase's own password change, every other sign-in of that login ends
-- ============================================================

-- the functions below write to Supabase Auth's tables and use pgcrypto from
-- the extensions schema: if this project's database doesn't allow that,
-- stop here and change nothing
do $$ begin
  if not (has_table_privilege('auth.users', 'SELECT') and has_column_privilege('auth.users', 'encrypted_password', 'UPDATE')
          and has_column_privilege('auth.users', 'updated_at', 'UPDATE') and has_table_privilege('auth.sessions', 'DELETE')) then
    raise exception 'this role cannot update auth.users / auth.sessions — keeper reset codes need another design';
  end if;
  perform extensions.crypt('x', extensions.gen_salt('bf', 4)), extensions.digest('x', 'sha256'),
    extensions.gen_random_bytes(1);
end $$;

create table if not exists password_reset (
  id bigint generated always as identity primary key,
  tree_id uuid not null references tree(id) on delete cascade,
  nucleus_id uuid not null references nucleus(id) on delete cascade, -- the household whose login it opens
  person_id uuid references person(id) on delete set null,          -- the card the keeper used
  code_hash text not null,
  created_by uuid,            -- the keeper's login
  created_by_nucleus uuid,    -- and household
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 minutes',
  attempts int not null default 0,
  used_at timestamptz,
  used_by uuid,               -- the login whose password was changed
  revoked_at timestamptz      -- replaced by a newer code, or 5 wrong tries
);
create index if not exists password_reset_live on password_reset (nucleus_id) where used_at is null and revoked_at is null;

-- failed tries per email typed — kept as a hash, never the email itself
create table if not exists password_reset_failure (
  email_hash text primary key,
  window_start timestamptz not null default now(),
  failures int not null default 0
);

-- only the two functions below touch these; nothing through the API
alter table password_reset enable row level security;
alter table password_reset_failure enable row level security;
revoke all on password_reset, password_reset_failure from anon, authenticated;
revoke all on sequence password_reset_id_seq from anon, authenticated;

-- a keeper makes a code for the household that claimed person p
create or replace function issue_reset_code(p uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  t uuid; h uuid; code text := ''; b bytea; i int; until timestamptz;
  symbols constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; -- 31, no 0/O or 1/I/L to misread
begin
  if not is_super_user() then raise exception 'only a tree keeper can make a reset code'; end if;
  select tree_id, claimed_by into t, h from person where id = p and deleted_at is null;
  if t is null or t is distinct from my_tree() then raise exception 'that person isn''t in your tree'; end if;
  if h is null then raise exception 'nobody has claimed that profile yet — send them an invite instead'; end if;
  if (select tree_id from nucleus where id = h) is distinct from t then raise exception 'that household isn''t in your tree'; end if;
  if not exists (select 1 from account where nucleus_id = h) then raise exception 'that household has no login to reset'; end if;
  -- 8 random symbols; bytes 248–255 are skipped so every symbol is equally likely
  while length(code) < 8 loop
    b := extensions.gen_random_bytes(16);
    for i in 0..15 loop
      exit when length(code) = 8;
      if get_byte(b, i) < 248 then code := code || substr(symbols, get_byte(b, i) % 31 + 1, 1); end if;
    end loop;
  end loop;
  -- one live code per household: making a new one stops the old one
  update password_reset set revoked_at = now() where nucleus_id = h and used_at is null and revoked_at is null;
  insert into password_reset (tree_id, nucleus_id, person_id, code_hash, created_by, created_by_nucleus)
    values (t, h, p, extensions.crypt(code, extensions.gen_salt('bf', 8)), auth.uid(), my_nucleus())
    returning expires_at into until;
  return jsonb_build_object('code', code, 'expires_at', until);
end $$;

-- the sign-in screen, signed out: email + code + new password.
-- answers 'ok', 'short' / 'long' (password length), 'locked' (too many
-- failures for this email), or 'no' for everything else — unknown email,
-- no code, wrong, expired, used or burned code all look the same.
-- Failures are returned, not raised, so the counters are kept.
create or replace function redeem_reset_code(login_email text, reset_code text, new_password text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  e text := lower(btrim(coalesce(login_email, '')));
  c text := upper(regexp_replace(coalesce(reset_code, ''), '[^0-9A-Za-z]', '', 'g'));
  eh text; u uuid; r password_reset%rowtype; f password_reset_failure%rowtype; ok boolean := false;
begin
  if length(coalesce(new_password, '')) < 6 then return 'short'; end if; -- Supabase Auth's minimum
  if octet_length(new_password) > 72 then return 'long'; end if;       -- bcrypt reads no further
  eh := encode(extensions.digest(e, 'sha256'), 'hex');
  -- one try at a time per email, so parallel guesses can't slip past the counters
  perform pg_advisory_xact_lock(hashtextextended('reset:' || eh, 0));
  delete from password_reset_failure where window_start < now() - interval '30 minutes';
  select * into f from password_reset_failure where email_hash = eh;
  if f.failures >= 10 then return 'locked'; end if;
  select id into u from auth.users
    where lower(email) = e and deleted_at is null and not coalesce(is_sso_user, false);
  if u is not null then
    select pr.* into r from password_reset pr join account a on a.nucleus_id = pr.nucleus_id and a.user_id = u
      where pr.used_at is null and pr.revoked_at is null and pr.expires_at > now()
      order by pr.created_at desc limit 1 for update of pr;
  end if;
  -- the same bcrypt work whether or not there's a code, so the timing says nothing either
  if r.id is not null then ok := r.code_hash = extensions.crypt(c, r.code_hash);
  else perform extensions.crypt(c, extensions.gen_salt('bf', 8)); end if;
  if not ok then
    insert into password_reset_failure as x (email_hash, failures) values (eh, 1)
      on conflict (email_hash) do update set failures = x.failures + 1;
    if r.id is not null then
      update password_reset set attempts = attempts + 1,
        revoked_at = case when attempts + 1 >= 5 then now() end where id = r.id;
    end if;
    return 'no';
  end if;
  update auth.users set encrypted_password = extensions.crypt(new_password, extensions.gen_salt('bf', 10)),
    updated_at = now() where id = u;
  delete from auth.sessions where user_id = u;  -- signed out everywhere: the new password is needed
  update password_reset set used_at = now(), used_by = u where id = r.id;
  delete from password_reset_failure where email_hash = eh;
  return 'ok';
end $$;

revoke execute on function issue_reset_code(uuid), redeem_reset_code(text, text, text)
  from public, anon, authenticated;
grant execute on function issue_reset_code(uuid) to authenticated;
-- the sign-in screen is signed out; a stale sign-in in the browser may still send its token
grant execute on function redeem_reset_code(text, text, text) to anon, authenticated;

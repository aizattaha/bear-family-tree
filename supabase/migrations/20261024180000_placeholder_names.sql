-- ============================================================
-- Placeholder names (2026-10-24, Aizat's "placeholder polish")
-- Applied with `supabase db push` (tested first on a local stack).
--   A married-in spouse whose name isn't known yet is added as "?" (or "-"), so the
--   couple exists and the children hang under them; the real name is typed
--   in later, without relinking anyone. name_unknown marks those people
--   behind the scenes. The database sets it on every save from the name
--   itself — only "?"s and dashes ("?", "??", "-", "—"), "unknown" (any case)
--   or empty → true; a real name → false — so it can never disagree with
--   what was typed, whatever a client sends. Who may read or edit anyone is
--   unchanged.
-- ============================================================

alter table person add column if not exists name_unknown boolean not null default false;

-- the people already in the tree. Only the mark changes: the edit stamp
-- (updated_at) stays as it was, so nobody looks freshly edited
do $$
declare marked int; live int;
begin
  alter table person disable trigger person_stamp;
  update person set name_unknown = true
    where full_name ~* '^\s*([-?\u2013\u2014]*|unknown)\s*$' and not name_unknown;
  get diagnostics marked = row_count;
  alter table person enable trigger person_stamp;
  select count(*) into live from person where name_unknown and deleted_at is null;
  raise notice 'placeholder names marked: % (% still in the tree)', marked, live;
end $$;

-- every new person and every edit from now on
create or replace function mark_name_unknown() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  new.name_unknown := coalesce(new.full_name, '') ~* '^\s*([-?\u2013\u2014]*|unknown)\s*$';
  return new;
end $$;
drop trigger if exists person_name_unknown on person;
create trigger person_name_unknown before insert or update on person
  for each row execute function mark_name_unknown();
-- internal, like stamp_row: only the trigger runs it
revoke execute on function mark_name_unknown() from public, anon, authenticated;

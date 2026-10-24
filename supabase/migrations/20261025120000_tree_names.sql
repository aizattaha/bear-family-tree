-- ============================================================
-- The name on the tree (2026-10-25, Aizat: a first name of two words)
-- Applied with `supabase db push` (tested first on a local stack).
--   The tree shows the first word of someone's full name until they choose
--   their own ("You go by"). That is wrong when the first name itself is two
--   words ("Mei Ling", "Nur Aina"): the tree said just "Mei". short_name is
--   the family's pick of what the tree shows instead, set by whoever may
--   already edit that person (the person_update rule, unchanged). Empty for
--   everyone today, so nobody's name on the tree changes.
--   What the tree shows, in order: your own nickname for them → their own
--   "You go by" → short_name → the first word of the full name.
--   The signed-out functions (invite_preview, open_invite, decline_invite,
--   redeem_reset_code) are not touched.
-- ============================================================

alter table person add column if not exists short_name text;
-- the app trims it, keeps it to 40 characters and sends null for "not set"
alter table person drop constraint if exists person_short_name_format;
alter table person add constraint person_short_name_format check (
  short_name is null or (short_name = btrim(short_name) and short_name <> '' and char_length(short_name) <= 40));

-- a household is named after the name its first member goes by — the family's
-- pick counts too, so a first member called "Mei Ling Tan" names "Mei Ling's household"
create or replace function goes_by(p uuid) returns text
language sql stable set search_path = public, pg_temp as $$
  select case when x.name_unknown or x.deleted_at is not null then null
    else coalesce(nullif(left(btrim(n.text), 40), ''), nullif(left(btrim(x.short_name), 40), ''),
                  nullif(left(split_part(btrim(x.full_name), ' ', 1), 40), '')) end
  from person x left join nickname n on n.person_id = x.id and n.viewer_person_id = x.id and not n.private
  where x.id = p;
$$;
drop trigger if exists person_names_household on person;
create trigger person_names_household after insert or update of claimed_by, full_name, short_name on person
  for each row execute function name_household();
-- still internal: only the household-naming trigger uses it
revoke execute on function goes_by(uuid) from public, anon, authenticated;

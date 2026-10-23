-- ============================================================
-- Upgrade 8 — remove the BearHaus Finance leftovers (2026-10-24)
-- On 2026-07-20 three objects belonging to a different app (BearHaus
-- Finance) were created in this database by hand, by mistake. They were
-- never in a migration and never used, and Aizat has confirmed that idea
-- is scrapped. Their 11 unused rows now live only in the backups.
--   table    beta_invites
--   function check_invite(text)                                     — callable by anyone
--   function create_household_setup(text, text, text[], text, text[]) — callable by anyone, can only fail
-- `if exists` keeps this harmless on a fresh database, where they never existed.
-- ============================================================
drop function if exists public.check_invite(text);
drop function if exists public.create_household_setup(text, text, text[], text, text[]);
drop table if exists public.beta_invites;

-- a signature that doesn't match would make the lines above skip silently:
-- stop the whole change instead, so nothing is left half-removed
do $$ begin
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace
             and proname in ('check_invite', 'create_household_setup'))
     or to_regclass('public.beta_invites') is not null then
    raise exception 'BearHaus Finance leftovers still present — check the exact function signatures';
  end if;
end $$;

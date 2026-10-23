-- TEST STACKS ONLY. Never put this file in supabase/migrations/ for real.
-- Production had three BearHaus Finance objects, created by hand on
-- 2026-07-20 (never in a migration). A test copies this in as
-- 20260720000000_test_finance_drift.sql so the clean-up migration
-- (20261024090000_remove_finance_leftovers.sql) has the same things to
-- remove as production: same names, same signatures, callable by anyone.
create table public.beta_invites (
  code text primary key, note text, max_uses int default 1,
  used_count int default 0, created_at timestamptz default now());
alter table public.beta_invites enable row level security;
insert into public.beta_invites (code, note) values ('TEST-ONE', 'stand-in'), ('TEST-TWO', 'stand-in');
create function public.check_invite(p_code text) returns boolean
language sql security definer set search_path = public as $$
  select exists (select 1 from beta_invites where code = p_code and used_count < max_uses);
$$;
create function public.create_household_setup(p_code text, p_household text, p_people text[],
  p_joint_label text, p_countries text[]) returns void
language plpgsql security definer set search_path = public as $$
begin raise exception 'households does not exist'; end $$;

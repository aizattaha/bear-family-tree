-- TEST STACKS ONLY. Never put this file in supabase/migrations/ for real:
-- it would open every new table to signed-out visitors in production.
-- Production is an older Supabase project: anon + authenticated get every
-- privilege on new tables, and EXECUTE on new functions, in schema public.
-- New local stacks don't, so a test copies this in as the FIRST migration
-- (20260101000000_test_prod_grants.sql) to behave like production.
alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated, service_role;

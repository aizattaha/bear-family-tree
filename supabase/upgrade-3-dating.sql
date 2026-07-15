-- ============================================================
-- Upgrade 3 — girlfriend/boyfriend ("dating") partner status
-- Run once in the Supabase SQL editor.
-- ============================================================

alter table relationship drop constraint if exists relationship_status_check;
alter table relationship add constraint relationship_status_check
  check (status in ('together','dating','separated','divorced'));

-- ============================================================
-- "Is this you?" (2026-10-24, Aizat's request after trying QR invites)
-- A personal invite's sign-up page shows a small preview of the family
-- the person is joining, so they can be sure it's them before making an
-- account. open_invite now also answers `family`:
--   {parents, partners, children, siblings}: lists of first names
--   * the name each person goes by themselves ("You go by"), else the first
--     word of their full name — never anyone else's nickname, never a
--     private one
--   * current partners only (together / dating); siblings share a parent
--   * live people only; nobody whose name isn't known yet; at most 12 a list
--   * nothing else: no photos, dates, places or ids
-- plus `unknown`: whether the invited person's own name isn't known yet, so
-- the preview draws them as the tree does (a dashed "?")
-- Only for a live personal invite (general codes and dead codes: as before).
-- Who may call it is unchanged.
-- ============================================================

create or replace function open_invite(invite_code text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare i tree_invite%rowtype; fam jsonb;
begin
  update tree_invite set opened_at = now(), expires_at = now() + interval '30 minutes'
    where code = invite_code and kind = 'qr' and opened_at is null and expires_at > now();
  select * into i from tree_invite where code = invite_code and expires_at > now();
  if not found then return null; end if;
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

-- unchanged: the landing page is signed out; a stale sign-in may still send its token
revoke execute on function open_invite(text) from public;
grant execute on function open_invite(text) to anon, authenticated;

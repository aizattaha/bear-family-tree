// Bear Family Tree — permission test suite. LOCAL / CI Supabase stacks only.
// Signs up synthetic users (@test.invalid) and runs the same calls the app makes.
//   1. safety release (2026-10-21): the 40 original checks
//   2. "only us" nicknames (2026-10-21): the 33 original checks
//   3. launch gate (2026-10-23): kinship, remove_person, release_claim, timestamps
//   4. keeper reset codes (2026-10-24): who may make one, redeeming, real sign-in after, limits
//   5. placeholder names (2026-10-24): "?" people marked name_unknown, edit rules unchanged
//   6. QR invites (2026-10-24): 5 minutes to scan, then 30 to sign up; refresh; single use
//   7. catalog: search_path + who may call which function, Finance leftovers gone
// env: SUPABASE_URL, SUPABASE_KEY (publishable), DB_CONTAINER (the stack's db container)
// usage: node permissions.mjs        (exit code 1 if anything fails)
import { createClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';
import { randomUUID, randomBytes } from 'node:crypto';

const URL = process.env.SUPABASE_URL || 'http://127.0.0.1:56521';
const KEY = process.env.SUPABASE_KEY || 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH'; // shared local default
const DB = process.env.DB_CONTAINER || 'supabase_db_bft_phase0';
if (!/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(URL)) throw new Error('local stacks only — never production');
const run = randomBytes(3).toString('hex');
let pass = 0, fail = 0, section = '';
const check = (name, ok, extra = '') => { ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${section}${name}${extra ? '  — ' + extra : ''}`); };
const psql = stopOnError => q => execFileSync('docker', ['exec', '-i', DB, 'psql', '-U', 'postgres', '-d', 'postgres', '-tA',
  '-v', `ON_ERROR_STOP=${stopOnError ? 1 : 0}`], { input: q, stdio: ['pipe', 'pipe', 'pipe'] }).toString();
const sql = psql(false);
const sqlErr = q => { try { return psql(true)(q); } catch (e) { return 'ERR: ' + e.stderr.toString(); } };
// run SQL as a signed-in user, the way PostgREST does
const asUser = (c, q) => sqlErr(`begin; set local role authenticated; set local request.jwt.claims='{"sub":"${c.uid}","role":"authenticated"}'; ${q}; commit;`);
const client = () => createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
async function user(tag) {
  const c = client();
  c.email = `${tag}.${run}@test.invalid`; c.password = randomBytes(12).toString('hex');
  const { data, error } = await c.auth.signUp({ email: c.email, password: c.password });
  if (error) throw error; c.uid = data.user.id; return c;
}
const nucOf = async c => (await c.from('account').select('nucleus_id')).data[0]?.nucleus_id;
const treeOf = c => sql(`select n.tree_id from account a join nucleus n on n.id=a.nucleus_id where a.user_id='${c.uid}'`).trim();
const isSuper = c => sql(`select n.is_super from account a join nucleus n on n.id=a.nucleus_id where a.user_id='${c.uid}'`).trim() === 't';
const anon = client();

/* ============ 1. safety release (2026-10-21) ============ */
section = '[safety] ';
const A = await user('a'), B = await user('b'), C = await user('c');
let r = await A.rpc('create_tree', { nucleus_label: 'A house', tree_nm: 'A tree' });
check('create_tree works', !r.error, r.error?.message);
const treeA = r.data, nucA = await nucOf(A);
const pA = randomUUID(), pPartner = randomUUID(), pKid = randomUUID();
r = await A.from('person').insert([
  { id: pA, tree_id: treeA, full_name: 'Test A', claimed_by: nucA, born: '1980' },
  { id: pPartner, tree_id: treeA, full_name: 'Test Partner', born: '1982-03-04' },
  { id: pKid, tree_id: treeA, full_name: 'Test Kid' }]);
check('add person works', !r.error, r.error?.message);
r = await A.from('relationship').insert([
  { tree_id: treeA, person_a: pA, person_b: pPartner, kind: 'partner', status: 'together' },
  { tree_id: treeA, person_a: pA, person_b: pKid, kind: 'parent-child' }]).select('id');
check('add relationship works', !r.error && r.data.length === 2, r.error?.message);
const relPartner = r.data?.[0]?.id;
r = await A.from('relationship').update({ status: 'divorced', ended: '2020' }).eq('id', relPartner).select('id');
const saved = (await A.from('relationship').select('status,ended').eq('id', relPartner)).data[0];
check('partner status SAVES (divorced, 2020)', !r.error && r.data.length === 1 && saved.status === 'divorced' && saved.ended === '2020',
  `rows=${r.data?.length} err=${r.error?.message || '-'}`);
r = await A.from('relationship').update({ status: 'dating', ended: null }).eq('id', relPartner).select('id');
check('partner status can be set back (dating)', !r.error && r.data.length === 1, r.error?.message);
r = await A.from('relationship').update({ person_b: pKid }).eq('id', relPartner).select('id');
check('relationship endpoints cannot be rewired by update', !!r.error, r.error?.message);
r = await A.from('tree_invite').insert({ tree_id: treeA }).select('code').single();
check('super creates general invite (insert+returning)', !r.error, r.error?.message);
const codeGeneral = r.data?.code;
r = await A.from('tree_invite').insert({ tree_id: treeA, person_id: pPartner, invite_name: 'Partner' }).select('code').single();
check('super creates personal invite', !r.error, r.error?.message);
const codePersonal = r.data?.code;
r = await B.rpc('join_with_invite', { invite_code: codeGeneral, nucleus_label: 'B house', tree_nm: 'B tree' });
check('join_with_invite (general code) works', !r.error, r.error?.message);
const nucB = await nucOf(B);
const pB = randomUUID();
r = await B.from('person').insert({ id: pB, tree_id: treeA, full_name: 'Test B', claimed_by: nucB });
check('member adds themselves', !r.error, r.error?.message);
await B.from('relationship').insert({ tree_id: treeA, person_a: pPartner, person_b: pB, kind: 'parent-child' });
r = await B.from('tree_invite').select('code');
check('non-super member cannot read invite codes', !r.error && r.data.length === 0, `seen=${r.data?.length}`);
r = await A.from('tree_invite').select('code');
check('super still reads invite codes', !r.error && r.data.length >= 1, `seen=${r.data?.length}`);
r = await B.rpc('invite_preview', { invite_code: codePersonal });
check('invite_preview still works', !r.error && r.data === 'Partner', r.error?.message);
r = await C.rpc('join_tree', { invite_code: codePersonal, nucleus_label: 'C house', tree_nm: 'x' });
check('join_tree is gone', !!r.error, r.error?.message || 'joined');
r = await C.rpc('create_tree', { nucleus_label: 'C house', tree_nm: 'C tree' });
check('second tree via create_tree', !r.error, r.error?.message);
const treeC = r.data;
r = await B.from('nucleus').update({ is_super: true }).eq('id', nucB).select('id');
check('member CANNOT make itself super (API)', !!r.error && !isSuper(B), `err=${r.error?.message || '-'}`);
r = await B.from('nucleus').update({ tree_id: treeC }).eq('id', nucB).select('id');
check('member CANNOT move its household to another tree (API)', !!r.error && treeOf(B) === treeA, `err=${r.error?.message || '-'}`);
r = await B.from('nucleus').update({ tree_name: 'renamed by B' }).eq('id', nucB).select('id');
check('member can still rename its own tree view', !r.error && r.data.length === 1, r.error?.message);
r = await B.from('nucleus').update({ tree_name: 'hijack' }).eq('id', nucA).select('id');
check('member cannot rename another household', !r.error && r.data.length === 0, r.error?.message);
let out = asUser(B, `update nucleus set tree_id='${treeC}'`);
check('bare `UPDATE nucleus SET tree_id` is blocked', /permission denied/.test(out) && treeOf(B) === treeA, out.trim().split('\n').pop());
out = asUser(B, `update nucleus set is_super=true`);
check('bare `UPDATE nucleus SET is_super` is blocked', /permission denied/.test(out) && !isSuper(B), out.trim().split('\n').pop());
r = await A.rpc('set_super', { target: nucB, flag: true });
check('set_super promotes (A → B)', !r.error && isSuper(B), r.error?.message);
r = await B.from('tree_invite').select('code');
check('promoted super can read invites', !r.error && r.data.length >= 1, `seen=${r.data?.length}`);
r = await A.rpc('set_super', { target: nucB, flag: false });
check('set_super demotes (A → B)', !r.error && !isSuper(B), r.error?.message);
r = await B.rpc('set_super', { target: nucA, flag: false });
check('non-super cannot use set_super', !!r.error, r.error?.message);
const D = await user('d');
r = await D.rpc('join_with_invite', { invite_code: codePersonal, nucleus_label: 'D house', tree_nm: 'D tree' });
check('join_with_invite (personal) claims the profile', !r.error && r.data?.person_id === pPartner, r.error?.message);
r = await A.from('tree_invite').select('code').eq('code', codePersonal);
check('personal invite is single-use', !r.error && r.data.length === 0);
r = await A.from('person').update({ born: '<img src=x onerror=alert(1)>' }).eq('id', pKid).select('id');
check('bad Born value refused by the database', !!r.error, r.error?.message);
r = await A.from('person').update({ born: '2015-07-01' }).eq('id', pKid).select('id');
check('good Born value accepted', !r.error && r.data.length === 1, r.error?.message);
r = await A.from('person').update({ photo_adult: 'x" onerror="alert(1)' }).eq('id', pA).select('id');
check('bad photo value refused', !!r.error, r.error?.message);
r = await A.from('person').update({ photo_adult: 'data:image/jpeg;base64,' + randomBytes(30000).toString('base64') }).eq('id', pA).select('id');
check('real JPEG data photo accepted', !r.error && r.data.length === 1, r.error?.message);
r = await A.from('person').update({ photo_kid: 'data:image/jpeg;base64,' + 'A'.repeat(600000) }).eq('id', pA).select('id');
check('oversized photo refused', !!r.error, r.error?.message);
r = await A.from('person').update({ photo_teen: 'data:image/svg+xml;base64,PHN2Zz4=' }).eq('id', pA).select('id');
check('SVG photo refused', !!r.error, r.error?.message);
r = await A.from('nickname').upsert({ tree_id: treeA, person_id: pKid, viewer_person_id: pA, text: 'Adik' },
  { onConflict: 'person_id,viewer_person_id' }).select('id');
check('nickname upsert works', !r.error && r.data.length === 1, r.error?.message);
r = await A.from('memorial').upsert({ person_id: pKid, tree_id: treeA, passed_on: '2021', style_id: 'gen1' }).select('person_id');
check('memorial upsert works', !r.error && r.data.length === 1, r.error?.message);
r = await A.from('memorial').delete().eq('person_id', pKid).select('person_id');
check('memorial delete works', !r.error && r.data.length === 1, r.error?.message);
// the old app's two-step removal must keep working while cached copies are around
r = await A.from('person').update({ deleted_at: new Date().toISOString() }).eq('id', pKid).select('id');
check('remove person (soft delete) works', !r.error && r.data.length === 1, r.error?.message);
r = await A.from('relationship').delete().or(`person_a.eq.${pKid},person_b.eq.${pKid}`).select('id');
check('remove person links works', !r.error && r.data.length === 1, r.error?.message);
r = await C.from('relationship').delete().eq('id', relPartner).select('id');
check('outsider delete changes 0 rows', !r.error && r.data.length === 0, r.error?.message);
r = await C.from('relationship').update({ status: 'divorced' }).eq('id', relPartner).select('id');
check('outsider status update changes 0 rows', !r.error && r.data.length === 0, r.error?.message);

/* ============ 2. "only us" nicknames (2026-10-21) ============ */
section = '[nick] ';
{
  const texts = async c => (await c.from('nickname').select('text')).data.map(r => r.text).sort();
  const upsert = (c, row) => c.from('nickname').upsert(row, { onConflict: 'person_id,viewer_person_id' }).select('id');
  const H = await user('h'), W = await user('w'), S = await user('s'), M = await user('m');
  r = await H.rpc('create_tree', { nucleus_label: 'H house', tree_nm: 'H tree' });
  const tree = r.data, nucH = await nucOf(H);
  const pH = randomUUID(), pWife = randomUUID(), pS = randomUUID(), pM = randomUUID(), pCousin = randomUUID();
  r = await H.from('person').insert([
    { id: pH, tree_id: tree, full_name: 'Test Husband', claimed_by: nucH },
    { id: pWife, tree_id: tree, full_name: 'Test Wife' },
    { id: pS, tree_id: tree, full_name: 'Test Super' },
    { id: pM, tree_id: tree, full_name: 'Test Member' },
    { id: pCousin, tree_id: tree, full_name: 'Test Cousin (unclaimed)' }]);
  check('setup: people added', !r.error, r.error?.message);
  await H.from('relationship').insert({ tree_id: tree, person_a: pH, person_b: pWife, kind: 'partner' });
  for (const [c, pid, lab] of [[W, pWife, 'W house'], [S, pS, 'S house'], [M, pM, 'M house']]) {
    const inv = await H.from('tree_invite').insert({ tree_id: tree, person_id: pid }).select('code').single();
    r = await c.rpc('join_with_invite', { invite_code: inv.data.code, nucleus_label: lab, tree_nm: lab });
    check(`setup: ${lab} joins and claims their profile`, !r.error && r.data?.person_id === pid, r.error?.message);
  }
  r = await H.rpc('set_super', { target: await nucOf(S), flag: true });
  check('setup: S is a super user', !r.error && isSuper(S), r.error?.message);
  r = await upsert(H, { tree_id: tree, person_id: pWife, viewer_person_id: pH, text: 'Dear', private: true });
  check('H saves "Dear" for wife, private', !r.error && r.data.length === 1, r.error?.message);
  r = await upsert(H, { tree_id: tree, person_id: pCousin, viewer_person_id: pH, text: 'Cuz', private: true });
  check('H saves "Cuz" for unclaimed cousin, private', !r.error && r.data.length === 1, r.error?.message);
  r = await upsert(H, { tree_id: tree, person_id: pS, viewer_person_id: pH, text: 'Pak S', private: false });
  check('H saves public "Pak S"', !r.error && r.data.length === 1, r.error?.message);
  r = await upsert(W, { tree_id: tree, person_id: pH, viewer_person_id: pWife, text: 'Abang' });
  check('W saves public "Abang" (no private field, like the old app)', !r.error && r.data.length === 1, r.error?.message);
  r = await upsert(M, { tree_id: tree, person_id: pS, viewer_person_id: pM, text: 'Kak S', private: true });
  check('M saves private "Kak S" about S', !r.error && r.data.length === 1, r.error?.message);
  const def = (await W.from('nickname').select('private').eq('viewer_person_id', pWife)).data[0];
  check('a row saved without the flag is public (default false)', def?.private === false);
  const tH = await texts(H), tW = await texts(W), tS = await texts(S), tM = await texts(M);
  check('H (writer) sees Dear + Cuz', tH.includes('Dear') && tH.includes('Cuz'), tH.join(','));
  check('W (named person) sees Dear', tW.includes('Dear'), tW.join(','));
  check('W does NOT see Cuz (named person unclaimed → writer only)', !tW.includes('Cuz'));
  check('S (super, 3rd household) sees neither Dear nor Cuz', !tS.includes('Dear') && !tS.includes('Cuz'), tS.join(','));
  check('M (4th household) sees neither Dear nor Cuz', !tM.includes('Dear') && !tM.includes('Cuz'), tM.join(','));
  check('public names unchanged: everyone sees Pak S + Abang', [tH, tW, tS, tM].every(t => t.includes('Pak S') && t.includes('Abang')));
  check('S sees private "Kak S" because it is ABOUT S', tS.includes('Kak S'));
  check('H and W do not see M\'s private "Kak S"', !tH.includes('Kak S') && !tW.includes('Kak S'));
  r = await S.from('nickname').select('id').eq('private', true).eq('viewer_person_id', pH);
  check('S filtering for private rows by H gets 0', !r.error && r.data.length === 0, r.error?.message);
  r = await S.from('nickname').select('id', { count: 'exact', head: true }).eq('person_id', pWife);
  check('S counting rows about the wife gets 0 (no leak through counts)', !r.error && r.count === 0, `count=${r.count}`);
  const dearIs = () => sqlErr(`select text||'/'||case when private then 't' else 'f' end from nickname where person_id='${pWife}' and viewer_person_id='${pH}'`).trim();
  r = await W.from('nickname').update({ private: false }).eq('person_id', pWife).eq('viewer_person_id', pH).select('id');
  check('W (named person) cannot clear the flag', !r.error && r.data.length === 0 && dearIs() === 'Dear/t', r.error?.message || dearIs());
  r = await W.from('nickname').delete().eq('person_id', pWife).eq('viewer_person_id', pH).select('id');
  check('W cannot delete it', !r.error && r.data.length === 0 && dearIs() === 'Dear/t');
  r = await S.from('nickname').update({ private: false }).eq('viewer_person_id', pH).select('id');
  check('super S cannot change H\'s nicknames (private or public)', !r.error && r.data.length === 0 && dearIs() === 'Dear/t');
  r = await upsert(S, { tree_id: tree, person_id: pWife, viewer_person_id: pH, text: 'hijack', private: false });
  check('super S cannot overwrite via upsert', !!r.error && dearIs() === 'Dear/t', r.error?.message);
  r = await H.from('nickname').update({ viewer_person_id: pWife }).eq('person_id', pCousin).eq('viewer_person_id', pH).select('id');
  check('H cannot hand a nickname to someone else\'s viewer', !!r.error || r.data.length === 0, r.error?.message || 'rows=' + r.data.length);
  r = await upsert(H, { tree_id: tree, person_id: pWife, viewer_person_id: pH, text: 'Dear', private: false });
  check('H clears the flag', !r.error && r.data.length === 1 && dearIs() === 'Dear/f', r.error?.message);
  check('…and now S and M see Dear', (await texts(S)).includes('Dear') && (await texts(M)).includes('Dear'));
  r = await upsert(H, { tree_id: tree, person_id: pWife, viewer_person_id: pH, text: 'Dear', private: true });
  check('H sets it again', !r.error && r.data.length === 1 && dearIs() === 'Dear/t');
  check('…and S and M no longer see it', !(await texts(S)).includes('Dear') && !(await texts(M)).includes('Dear'));
  r = await upsert(H, { tree_id: tree, person_id: pWife, viewer_person_id: pH, text: 'Dearest' });
  check('an upsert without the flag keeps it private', !r.error && dearIs() === 'Dearest/t', dearIs());
  r = await H.from('nickname').delete().match({ person_id: pWife, viewer_person_id: pH }).select('id');
  check('H can delete it (app\'s delete call)', !r.error && r.data.length === 1, r.error?.message);
  const pol = sqlErr(`select qual from pg_policies where tablename='nickname' and policyname='nick_select'`);
  check('nick_select has no is_super_user() exception', /private/.test(pol) && !/is_super/.test(pol), pol.trim().replace(/\s+/g, ' '));
}

/* ============ 3. launch gate (2026-10-23) ============ */
section = '[kinship] ';
// B (plain member, claims pB) gets a branch: pB → pNear (+ partner), and a
// chain pB → x1 → … → x5 → pFar, so x5 is 5 branches away and pFar 6
const pNear = randomUUID(), pNearP = randomUUID(), chain = [1, 2, 3, 4, 5].map(() => randomUUID()), pFar = randomUUID();
r = await B.from('person').insert([pNear, pNearP, ...chain, pFar].map((id, i) => ({ id, tree_id: treeA, full_name: 'Branch ' + i })));
check('setup: branch people added', !r.error, r.error?.message);
const kinRows = () => sql(`select count(*)||'/'||coalesce(string_agg(distinct xmin::text, ','),'-') from kinship where tree_id='${treeA}'`).trim();
// the statement trigger, proven: two links in ONE statement → one rebuild call (stamp_row runs per row)
out = asUser(B, `explain (analyze, costs off, timing off) insert into relationship (tree_id, kind, person_a, person_b) values
  ('${treeA}','parent-child','${pB}','${pNear}'), ('${treeA}','partner','${pNear}','${pNearP}')`);
check('2 links in one statement → kinship trigger runs once', /Trigger relationship_added: calls=1/.test(out),
  (out.match(/Trigger [a-z_]+: calls=\d+/g) || [out.trim().split('\n').pop()]).join(', '));
r = await B.from('relationship').insert([pB, ...chain].map((a, i) => ({ tree_id: treeA, kind: 'parent-child', person_a: a, person_b: [...chain, pFar][i] }))).select('id');
check('setup: chain linked (6 links, one request)', !r.error && r.data.length === 6, r.error?.message);
check('kinship never stores more than 5 steps', sql(`select coalesce(max(hops),0) from kinship`).trim() === '5', sql(`select max(hops) from kinship`).trim());
check('x5 is exactly 5 branches from B; pFar is not stored', sql(`select hops from kinship where person_a='${pB}' and person_b='${chain[4]}'`).trim() === '5'
  && sql(`select count(*) from kinship where person_a='${pB}' and person_b='${pFar}'`).trim() === '0');
const before = kinRows();
r = await A.from('relationship').update({ status: 'separated', ended: '2019' }).eq('id', relPartner).select('id');
check('a status change saves and does not rewrite kinship', !r.error && r.data.length === 1 && kinRows() === before, `${before} → ${kinRows()}`);
// six people added at the same moment from two logins: no duplicate-key errors, closure exact
const six = [1, 2, 3, 4, 5, 6].map(() => randomUUID());
await A.from('person').insert(six.map((id, i) => ({ id, tree_id: treeA, full_name: 'Parallel ' + i })));
const res = await Promise.all(six.map((id, i) => (i % 2 ? A : B).from('relationship')
  .insert({ tree_id: treeA, kind: 'parent-child', person_a: i % 2 ? pA : pB, person_b: id }).select('id')));
check('6 links added at the same time all save', res.every(x => !x.error && x.data.length === 1), res.map(x => x.error?.message).filter(Boolean).join('; '));
const closureDiff = () => sql(`with recursive edges as (select person_a a, person_b b, tree_id t from relationship
    union select person_b, person_a, tree_id from relationship),
  walk(t,a,b,hops) as (select t,a,b,1 from edges union select w.t, w.a, e.b, w.hops+1 from walk w join edges e on e.a=w.b and e.t=w.t where w.hops<5 and e.b<>w.a),
  want as (select t,a,b,min(hops) h from walk group by t,a,b), have as (select tree_id t, person_a a, person_b b, hops h from kinship)
  select (select count(*) from (select * from want except select * from have) x) + (select count(*) from (select * from have except select * from want) y)`).trim();
check('kinship matches a fresh calculation exactly', closureDiff() === '0', 'differences=' + closureDiff());
for (const [who, c] of [['a signed-in super', A], ['a signed-out visitor', anon]]) {
  r = await c.rpc('rebuild_kinship', { t: treeA });
  check(`${who} cannot call rebuild_kinship`, !!r.error, r.error?.message || 'ran');
}

section = '[remove] ';
// fixtures on pNear: names for and by them, a memorial, an open personal invite
await A.from('nickname').upsert({ tree_id: treeA, person_id: pNear, viewer_person_id: pA, text: 'Near (A)' }, { onConflict: 'person_id,viewer_person_id' });
await B.from('nickname').upsert({ tree_id: treeA, person_id: pNear, viewer_person_id: pB, text: 'Near (B)', private: true }, { onConflict: 'person_id,viewer_person_id' });
sql(`insert into nickname (tree_id, person_id, viewer_person_id, text) values ('${treeA}','${pA}','${pNear}','by Near')`);
await B.from('memorial').upsert({ person_id: pNear, tree_id: treeA, passed_on: '2001', style_id: 'gen1' });
await A.from('tree_invite').insert({ tree_id: treeA, person_id: pNear, invite_name: 'Near' });
const traces = p => sql(`select (select count(*) from relationship where person_a='${p}' or person_b='${p}')||'/'||
  (select count(*) from nickname where person_id='${p}' or viewer_person_id='${p}')||'/'||(select count(*) from memorial where person_id='${p}')||'/'||
  (select count(*) from tree_invite where person_id='${p}')||'/'||(select count(*) from kinship where person_a='${p}' or person_b='${p}')||'/'||
  (select case when deleted_at is null then 'live' else 'removed' end from person where id='${p}')`).trim();
check('setup: pNear has links/names/memorial/invite/kinship', /^2\/3\/1\/1\/\d+\/live$/.test(traces(pNear)), traces(pNear));
r = await anon.rpc('remove_person', { p: pNear });
check('a signed-out visitor cannot remove anyone', !!r.error && traces(pNear).endsWith('live'), r.error?.message || 'removed');
r = await C.rpc('remove_person', { p: pNear });
check('another tree\'s household cannot remove them', !!r.error && traces(pNear).endsWith('live'), r.error?.message || 'removed');
let far0 = traces(pFar);
r = await B.rpc('remove_person', { p: pFar });
check('member cannot remove someone 6 branches away — nothing changes', !!r.error && traces(pFar) === far0, `${r.error?.message || 'removed'} · ${traces(pFar)}`);
let pp0 = traces(pPartner);
r = await B.rpc('remove_person', { p: pPartner });
check('member cannot remove someone another household claimed — nothing changes', !!r.error && traces(pPartner) === pp0, `${r.error?.message || 'removed'}`);
r = await B.rpc('remove_person', { p: pNear });
check('member removes an unclaimed relative 1 branch away', !r.error, r.error?.message);
check('…links, names (to/by/private), memorial, open invite and kinship all gone; person soft-deleted', traces(pNear) === '0/0/0/0/0/removed', traces(pNear));
check('…the other side keeps everyone else (partner still there, still linked to nobody)', traces(pNearP).endsWith('live'), traces(pNearP));
r = await B.rpc('remove_person', { p: pNear });
check('removing someone already removed is refused', !!r.error, r.error?.message || 'ran');
r = await B.from('person').select('id').eq('id', pNear).is('deleted_at', null);
check('the app\'s person load no longer returns them', !r.error && r.data.length === 0);
check('kinship still matches a fresh calculation', closureDiff() === '0', 'differences=' + closureDiff());
// a well-connected person, through the API with the 8 s limit signed-in users have
const hub = randomUUID(), hubKids = [1, 2, 3, 4, 5, 6, 7].map(() => randomUUID());
await A.from('person').insert([hub, ...hubKids].map((id, i) => ({ id, tree_id: treeA, full_name: 'Hub ' + i })));
await A.from('relationship').insert([{ tree_id: treeA, kind: 'partner', person_a: pA, person_b: hub },
  ...hubKids.map(k => ({ tree_id: treeA, kind: 'parent-child', person_a: hub, person_b: k }))]);
const t0 = performance.now(); r = await A.rpc('remove_person', { p: hub }); const ms = Math.round(performance.now() - t0);
check('super removes a person with 8 links in one call', !r.error && traces(hub).startsWith('0/0/0/0/0/removed'), `${r.error?.message || 'ok'} · ${ms} ms`);
pp0 = traces(pPartner);
r = await A.rpc('remove_person', { p: pPartner });
check('super can remove someone another household claimed', !r.error && traces(pPartner) === '0/0/0/0/0/removed', r.error?.message || traces(pPartner));

section = '[release] ';
// D's household claimed pPartner (now removed); give D a fresh claimed person
const pD = randomUUID();
await D.from('person').insert({ id: pD, tree_id: treeA, full_name: 'Test D', claimed_by: await nucOf(D) });
r = await B.rpc('release_claim', { p: pD });
check('a non-super member cannot release a claim', !!r.error && sql(`select claimed_by is not null from person where id='${pD}'`).trim() === 't', r.error?.message || 'released');
r = await anon.rpc('release_claim', { p: pD });
check('a signed-out visitor cannot release a claim', !!r.error, r.error?.message || 'released');
r = await C.rpc('release_claim', { p: pD });
check('a super of another tree cannot release it', !!r.error && sql(`select claimed_by is not null from person where id='${pD}'`).trim() === 't', r.error?.message || 'released');
r = await A.rpc('release_claim', { p: pD });
check('the tree\'s super releases D\'s claim', !r.error && sql(`select claimed_by is null from person where id='${pD}'`).trim() === 't', r.error?.message);
const log = sql(`select action||'/'||(nucleus_id='${await nucOf(D)}')||'/'||(by_user='${A.uid}')||'/'||(by_nucleus='${nucA}') from claim_log where person_id='${pD}'`).trim();
check('…and it is recorded: release, which household lost it, who did it', log === 'release/true/true/true', log);
r = await A.rpc('release_claim', { p: pD });
check('releasing an unclaimed profile is refused', !!r.error, r.error?.message || 'ran');
r = await A.from('claim_log').select('id').eq('person_id', pD);
check('the super can read the record', !r.error && r.data.length === 1, r.error?.message);
r = await B.from('claim_log').select('id');
check('a non-super member reads 0 records', !r.error && r.data.length === 0, r.error?.message);
r = await A.from('claim_log').insert({ tree_id: treeA, person_id: pD, action: 'release' }).select('id');
check('nobody can write a fake record', !!r.error, r.error?.message || 'inserted');
r = await A.from('claim_log').delete().eq('person_id', pD).select('id');
check('nobody can delete the record', !!r.error || r.data.length === 0, r.error?.message || 'rows=' + r.data.length);
r = await D.rpc('claim_person', { p: pD });
check('after a release the profile can be claimed again', !r.error, r.error?.message);

section = '[stamps] ';
const pT = randomUUID(), stamp = (t, w) => sql(`select (created_at is not null)||'/'||coalesce(created_by::text,'null')||'/'||coalesce(to_char(updated_at,'HH24:MI:SS.US'),'null') from ${t} where ${w}`).trim();
r = await B.from('person').insert({ id: pT, tree_id: treeA, full_name: 'Stamp test', created_by: A.uid, created_at: '2000-01-01' });
let st = stamp('person', `id='${pT}'`);
check('new person: created_at + created_by filled by the database (a spoofed value is ignored)', !r.error && st.startsWith(`true/${B.uid}/`), r.error?.message || st);
check('…created_at is now, not the value the client sent', sql(`select created_at > now() - interval '1 minute' from person where id='${pT}'`).trim() === 't');
await new Promise(res => setTimeout(res, 20));
r = await A.from('person').update({ full_name: 'Stamp test 2', created_by: A.uid }).eq('id', pT).select('id');
const st2 = stamp('person', `id='${pT}'`);
check('edit: updated_at moves, created_by stays the original author', !r.error && st2.split('/')[1] === B.uid && st2.split('/')[2] !== st.split('/')[2], `${st} → ${st2}`);
r = await B.from('relationship').insert({ tree_id: treeA, kind: 'parent-child', person_a: pB, person_b: pT }).select('id');
const relT = r.data?.[0]?.id;
check('new link: stamped with its author', !r.error && stamp('relationship', `id='${relT}'`).startsWith(`true/${B.uid}/`), r.error?.message);
r = await B.from('nickname').upsert({ tree_id: treeA, person_id: pT, viewer_person_id: pB, text: 'T' }, { onConflict: 'person_id,viewer_person_id' }).select('id');
const n1 = stamp('nickname', `person_id='${pT}'`);
await B.from('nickname').upsert({ tree_id: treeA, person_id: pT, viewer_person_id: pB, text: 'T2' }, { onConflict: 'person_id,viewer_person_id' });
const n2 = stamp('nickname', `person_id='${pT}'`);
check('nickname upsert: stamped, and the second save only moves updated_at', !r.error && n1.startsWith(`true/${B.uid}/`) && n2.split('/')[1] === B.uid && n2 !== n1, `${n1} → ${n2}`);
r = await B.from('memorial').upsert({ person_id: pT, tree_id: treeA, passed_on: '1999', style_id: 'gen1' }).select('person_id');
check('memorial: stamped with its author', !r.error && stamp('memorial', `person_id='${pT}'`).startsWith(`true/${B.uid}/`), r.error?.message);

/* ============ 4. keeper reset codes (2026-10-24) ============ */
section = '[reset] ';
{
  // K keeps the tree; R and O are two other households in it; X keeps a different tree
  const K = await user('k'), R = await user('r'), O = await user('o'), X = await user('x');
  r = await K.rpc('create_tree', { nucleus_label: 'K house', tree_nm: 'K tree' });
  const tree = r.data, nucK = await nucOf(K);
  const pK = randomUUID(), pR = randomUUID(), pO = randomUUID(), pU = randomUUID();
  r = await K.from('person').insert([{ id: pK, tree_id: tree, full_name: 'Test Keeper', claimed_by: nucK },
    { id: pR, tree_id: tree, full_name: 'Test Relative' }, { id: pO, tree_id: tree, full_name: 'Test Other' },
    { id: pU, tree_id: tree, full_name: 'Test Unclaimed' }]);
  check('setup: people added', !r.error, r.error?.message);
  for (const [c, pid, lab] of [[R, pR, 'R house'], [O, pO, 'O house']]) {
    const inv = await K.from('tree_invite').insert({ tree_id: tree, person_id: pid }).select('code').single();
    r = await c.rpc('join_with_invite', { invite_code: inv.data.code, nucleus_label: lab, tree_nm: lab });
    check(`setup: ${lab} joins and claims their profile`, !r.error && r.data?.person_id === pid, r.error?.message);
  }
  r = await X.rpc('create_tree', { nucleus_label: 'X house', tree_nm: 'X tree' });
  check('setup: X keeps a tree of its own', !r.error && isSuper(X), r.error?.message);
  const nucR = await nucOf(R);
  const issue = (c, p) => c.rpc('issue_reset_code', { p });
  const redeem = (email, code, pw, c = anon) => c.rpc('redeem_reset_code', { login_email: email, reset_code: code, new_password: pw });
  const signIn = (email, password) => client().auth.signInWithPassword({ email, password });
  const lastId = () => sql(`select max(id) from password_reset where nucleus_id='${nucR}'`).trim();
  const rec = id => sql(`select attempts||'/'||(used_at is not null)||'/'||(revoked_at is not null) from password_reset where id=${id}`).trim();
  const hashOf = u => sql(`select encrypted_password from auth.users where id='${u}'`).trim();
  const sessions = u => sql(`select count(*) from auth.sessions where user_id='${u}'`).trim();

  // who may make a code
  r = await issue(O, pR);
  check('a member who isn\'t a keeper cannot make a code', !!r.error, r.error?.message || 'made one');
  r = await issue(anon, pR);
  check('a signed-out visitor cannot make a code', !!r.error, r.error?.message || 'made one');
  r = await issue(X, pR);
  check('a keeper of another tree cannot make a code for this tree', !!r.error, r.error?.message || 'made one');
  r = await issue(K, pU);
  check('no code for an unclaimed profile (there is no login to open)', !!r.error, r.error?.message || 'made one');
  const none = sql(`select count(*) from password_reset where tree_id='${tree}'`).trim();
  check('…and none of those left a code behind', none === '0', none);
  r = await issue(K, pR);
  const code1 = r.data?.code, id1 = lastId();
  check('the keeper makes a code: 8 characters, none that look alike', !r.error && /^[2-9A-HJKMNP-Z]{8}$/.test(code1 || ''), r.error?.message || code1);
  const mins = (new Date(r.data?.expires_at) - Date.now()) / 60000;
  check('…that lasts 30 minutes', mins > 29 && mins <= 30.1, mins.toFixed(1) + ' min');
  const stored = sql(`select row_to_json(p)::text from password_reset p where id=${id1}`);
  check('…stored only as a bcrypt hash (the code itself is nowhere in the record)', /"code_hash":"\$2a\$/.test(stored) && !stored.includes(code1));
  const who = sql(`select (tree_id='${tree}')||'/'||(nucleus_id='${nucR}')||'/'||(person_id='${pR}')||'/'||(created_by='${K.uid}')||'/'||(created_by_nucleus='${nucK}') from password_reset where id=${id1}`).trim();
  check('…and recorded: which tree, which household, from whose card, by which keeper', who === 'true/true/true/true/true', who);
  for (const [lab, c] of [['the keeper', K], ['a signed-out visitor', anon]]) {
    r = await c.from('password_reset').select('id');
    check(`${lab} cannot read the codes through the API`, !!r.error, r.error?.message || 'rows=' + r.data.length);
    r = await c.from('password_reset_failure').select('email_hash');
    check(`${lab} cannot read the failed tries through the API`, !!r.error, r.error?.message || 'rows=' + r.data.length);
  }

  // redeeming: one answer for every kind of failure
  r = await redeem(R.email, 'WRONG234', 'new-password-1');
  check('wrong code → "no"', r.data === 'no', r.error?.message || r.data);
  check('…counted on the code (1 wrong try)', rec(id1) === '1/false/false', rec(id1));
  r = await redeem(`nobody.${run}@test.invalid`, code1, 'new-password-1');
  check('an email with no login → the same "no"', r.data === 'no', r.error?.message || r.data);
  r = await redeem(O.email, code1, 'new-password-1');
  check('another household\'s login with this code → the same "no"', r.data === 'no', r.error?.message || r.data);
  check('…and that household\'s password still works', !(await signIn(O.email, O.password)).error);
  r = await redeem(R.email, code1, '12345');
  check('a new password under 6 characters → "short", and the code is not used up', r.data === 'short' && rec(id1) === '1/false/false', r.data);
  r = await redeem(R.email, code1, 'x'.repeat(73));
  check('a new password over 72 characters → "long"', r.data === 'long', r.data);
  const oldHash = hashOf(R.uid), before = sessions(R.uid);
  r = await redeem('  ' + R.email.toUpperCase() + ' ', code1.slice(0, 4).toLowerCase() + '-' + code1.slice(4), 'new-password-1');
  check('the right code (lower case, with a dash; email in capitals) → "ok"', r.data === 'ok', r.error?.message || r.data);
  check('the new password is stored the way Supabase Auth stores them (bcrypt, cost 10)', /^\$2a\$10\$/.test(hashOf(R.uid)) && hashOf(R.uid) !== oldHash, hashOf(R.uid).slice(0, 7));
  check('every earlier sign-in of that login has ended', before !== '0' && sessions(R.uid) === '0', `${before} → ${sessions(R.uid)}`);
  r = await R.auth.refreshSession();
  check('…so an old sign-in cannot carry on', !!r.error, r.error?.message || 'refreshed');
  r = await signIn(R.email, R.password);
  check('the old password no longer signs in', !!r.error, r.error?.message || 'signed in');
  r = await signIn(R.email, 'new-password-1');
  check('the new password signs in through Supabase Auth — the SAME login', !r.error && r.data.user?.id === R.uid, r.error?.message);
  const R2 = client(); await R2.auth.setSession(r.data.session);
  check('…landing in the same household and tree', await nucOf(R2) === nucR && treeOf(R) === tree);
  check('the code is marked used, by that login', sql(`select (used_at is not null)||'/'||(used_by='${R.uid}') from password_reset where id=${id1}`).trim() === 'true/true');
  r = await redeem(R.email, code1, 'new-password-2');
  check('a code works only once', r.data === 'no', r.data);

  // a newer code replaces the older one; 5 wrong tries burn a code
  const code2 = (await issue(K, pR)).data?.code, id2 = lastId();
  const code3 = (await issue(K, pR)).data?.code, id3 = lastId();
  check('making a new code stops the previous one', rec(id2) === '0/false/true' && rec(id3) === '0/false/false', `${rec(id2)} · ${rec(id3)}`);
  r = await redeem(R.email, code2, 'new-password-2');
  check('…the replaced code gets "no"', r.data === 'no', r.data);
  for (let i = 0; i < 4; i++) await redeem(R.email, 'WRONG23' + (i + 2), 'new-password-2');
  check('5 wrong tries burn the code', rec(id3) === '5/false/true', rec(id3));
  r = await redeem(R.email, code3, 'new-password-2');
  check('…after which even the right code gets "no"', r.data === 'no' && !(await signIn(R.email, 'new-password-1')).error, r.data);

  // 10 failures for one email in 30 minutes lock it — the same with or without a login
  sql(`delete from password_reset_failure`); // count from zero: R has no live code now (the last one burned)
  const tries = [];
  for (let i = 0; i < 10; i++) tries.push((await redeem(R.email, 'WRONG234', 'new-password-2')).data);
  const code4 = (await issue(K, pR)).data?.code, id4 = lastId();
  r = await redeem(R.email, code4, 'new-password-2');
  check('10 failures for one email in 30 minutes → "locked", even with a fresh, right code',
    tries.every(a => a === 'no') && r.data === 'locked' && rec(id4) === '0/false/false', `${tries.join(',')} → ${r.data} · ${rec(id4)}`);
  const ghost = `ghost.${run}@test.invalid`, answers = [];
  for (let i = 0; i < 11; i++) answers.push((await redeem(ghost, 'WRONG234', 'new-password-2')).data);
  check('an email with no login locks the same way (10 × "no", then "locked")', answers.slice(0, 10).every(a => a === 'no') && answers[10] === 'locked', answers.join(','));
  check('failed tries are kept as a hash, never the email typed',
    sql(`select count(*) from password_reset_failure where email_hash !~ '^[0-9a-f]{64}$'`).trim() === '0' && Number(sql(`select count(*) from password_reset_failure`)) === 2);
  sql(`update password_reset_failure set window_start = now() - interval '31 minutes'`); // 30 minutes later
  r = await redeem(R.email, code4, 'new-password-2');
  check('after 30 minutes the email may try again — and the code still works', r.data === 'ok' && !(await signIn(R.email, 'new-password-2')).error, r.data);

  // expired; signed in; many guesses at once
  const code5 = (await issue(K, pR)).data?.code, id5 = lastId();
  sql(`update password_reset set expires_at = now() - interval '1 second' where id=${id5}`);
  r = await redeem(R.email, code5, 'new-password-3');
  check('an expired code → "no"', r.data === 'no' && rec(id5) === '0/false/false', `${r.data} · ${rec(id5)}`);
  r = await redeem(R.email, 'WRONG234', 'new-password-3', K);
  check('the reset screen still works with a stale sign-in in the browser', r.data === 'no', r.error?.message || r.data);
  const code6 = (await issue(K, pR)).data?.code, id6 = lastId();
  sql(`delete from password_reset_failure`);
  const burst = await Promise.all(Array.from({ length: 20 }, (_, i) => redeem(R.email, 'GUESS' + String(222 + i), 'new-password-3')));
  const tally = {}; burst.forEach(x => { const k = x.data || x.error?.message; tally[k] = (tally[k] || 0) + 1; });
  check('20 guesses at the same moment: only 5 count against the code, then it is burned and the email locks',
    rec(id6) === '5/false/true' && tally.no === 10 && tally.locked === 10, `${rec(id6)} · ${JSON.stringify(tally)}`);
  r = await redeem(R.email, code6, 'new-password-3');
  check('…none of them got in, and the password is unchanged', r.data === 'locked' && !(await signIn(R.email, 'new-password-2')).error, r.data);
}

/* ============ 5. placeholder names (2026-10-24): "?" people, name_unknown ============ */
section = '[names] ';
const unk = id => sql(`select name_unknown from person where id='${id}'`).trim();
const pQ = randomUUID();
r = await B.from('person').insert({ id: pQ, tree_id: treeA, full_name: '?', gender: 'f' }).select('id');
await B.from('relationship').insert({ tree_id: treeA, kind: 'partner', person_a: pB, person_b: pQ });
check('a person added as "?" is marked name_unknown by the database', !r.error && unk(pQ) === 't', r.error?.message || unk(pQ));
for (const [nm, want] of [['??', 't'], ['  Unknown ', 't'], ['UNKNOWN', 't'], ['', 't'], ['Siti Aminah', 'f'], ['?', 't'], ['Ali?', 'f'], ['Unknown Ali', 'f'],
  ['-', 't'], [' -- ', 't'], ['\u2014', 't'], ['\u2013', 't'], ['?-', 't'], ['Ali-Hassan', 'f'], ['-Ali', 'f']]) { // Aizat types "-" for the same thing
  r = await B.from('person').update({ full_name: nm }).eq('id', pQ).select('id');
  check(`renamed to "${nm}" → name_unknown ${want === 't'}`, !r.error && r.data.length === 1 && unk(pQ) === want, r.error?.message || `rows=${r.data?.length} mark=${unk(pQ)}`);
}
r = await B.from('person').update({ full_name: '?', name_unknown: false }).eq('id', pQ).select('id');
check('a client can\'t clear the mark while the name is still "?"', !r.error && unk(pQ) === 't', r.error?.message || unk(pQ));
r = await B.from('person').update({ full_name: 'Siti', name_unknown: true }).eq('id', pQ).select('id');
check('a client can\'t set the mark on a real name', !r.error && unk(pQ) === 'f', r.error?.message || unk(pQ));
const pQ2 = randomUUID();
r = await B.from('person').insert({ id: pQ2, tree_id: treeA, full_name: 'Ali', name_unknown: true }).select('id');
check('…not when adding someone either', !r.error && unk(pQ2) === 'f', r.error?.message || unk(pQ2));
// who may fill in a name is unchanged: a "?" 7 branches from B (below pFar) is out of B's reach
const pQfar = randomUUID();
await B.from('person').insert({ id: pQfar, tree_id: treeA, full_name: '?' });
await B.from('relationship').insert({ tree_id: treeA, kind: 'parent-child', person_a: pFar, person_b: pQfar });
r = await B.from('person').update({ full_name: 'Far Name' }).eq('id', pQfar).select('id');
check('a member more than 5 branches away still can\'t fill in the name', !r.error && r.data.length === 0 && unk(pQfar) === 't', r.error?.message || `rows=${r.data?.length}`);
r = await A.from('person').update({ full_name: 'Far Name' }).eq('id', pQfar).select('id');
check('a tree keeper (super) can, and the mark clears', !r.error && r.data.length === 1 && unk(pQfar) === 'f', r.error?.message || `rows=${r.data?.length}`);
r = await C.from('person').select('id,name_unknown').eq('id', pQ);
check('another tree still sees nothing', !r.error && r.data.length === 0, r.error?.message || 'rows=' + r.data.length);
r = await anon.from('person').select('name_unknown').limit(1);
check('signed-out visitors still read nothing', !!r.error || r.data.length === 0, r.error?.message || 'rows=' + r.data.length);

/* ============ 6. QR invites (2026-10-24): 5 minutes to scan, then 30 to sign up ============ */
section = '[qr] ';
{
  // Q keeps the tree; M is a member (not a keeper); Y keeps another tree; J1–J3 are relatives joining
  const Q = await user('qk'), M = await user('qm'), Y = await user('qy'), J1 = await user('qj1'), J2 = await user('qj2'), J3 = await user('qj3');
  r = await Q.rpc('create_tree', { nucleus_label: 'Q house', tree_nm: 'Q tree' });
  const tree = r.data, nucQ = await nucOf(Q);
  const pQ = randomUUID(), pM = randomUUID(), p1 = randomUUID(), p2 = randomUUID(), p3 = randomUUID(), pGone = randomUUID();
  r = await Q.from('person').insert([{ id: pQ, tree_id: tree, full_name: 'Test Keeper Q', claimed_by: nucQ },
    { id: pM, tree_id: tree, full_name: 'Test Member' }, { id: p1, tree_id: tree, full_name: 'Test One' },
    { id: p2, tree_id: tree, full_name: 'Test Two' }, { id: p3, tree_id: tree, full_name: 'Test Three' },
    { id: pGone, tree_id: tree, full_name: 'Test Removed' }]);
  check('setup: people added', !r.error, r.error?.message);
  const linkM = await Q.from('tree_invite').insert({ tree_id: tree, person_id: pM }).select('code').single();
  r = await M.rpc('join_with_invite', { invite_code: linkM.data.code, nucleus_label: 'M house', tree_nm: 'M tree' });
  check('setup: M joins with a 14-day link (unchanged)', !r.error && r.data?.person_id === pM, r.error?.message);
  await Y.rpc('create_tree', { nucleus_label: 'Y house', tree_nm: 'Y tree' });
  await Q.rpc('remove_person', { p: pGone });
  const make = (c, p, nm = 'Kak One') => c.rpc('make_qr_invite', { p, invite_nm: nm });
  const open = (code, c = anon) => c.rpc('open_invite', { invite_code: code });
  const row = code => sql(`select kind||'|'||(opened_at is not null)||'|'||round(extract(epoch from expires_at - now()))||'|'||coalesce(invite_name,'∅')||'|'||coalesce(created_by::text,'') from tree_invite where code='${code}'`).trim();
  const qrsOf = p => sql(`select count(*) from tree_invite where person_id='${p}' and kind='qr'`).trim();
  const near = (s, want) => Math.abs(Number(s) - want) <= 3;

  // who may make one
  const before = sql(`select count(*) from tree_invite where tree_id='${tree}'`).trim();
  r = await make(M, p1);
  check('a member who isn\'t a keeper cannot make a QR invite', !!r.error, r.error?.message || 'made one');
  r = await make(anon, p1);
  check('a signed-out visitor cannot make a QR invite', !!r.error, r.error?.message || 'made one');
  r = await make(Y, p1);
  check('a keeper of another tree cannot make one for this tree', !!r.error, r.error?.message || 'made one');
  r = await make(Q, pQ);
  check('nor for a profile already claimed', !!r.error && /already been claimed/.test(r.error.message), r.error?.message || 'made one');
  r = await make(Q, pGone);
  check('nor for someone removed from the tree', !!r.error, r.error?.message || 'made one');
  check('…and none of those left an invite behind', sql(`select count(*) from tree_invite where tree_id='${tree}'`).trim() === before);
  r = await Q.from('tree_invite').insert({ tree_id: tree, person_id: p1, kind: 'qr', expires_at: new Date(Date.now() + 864e5).toISOString() }).select('code');
  check('a keeper can\'t write a QR invite into the table directly (only make_qr_invite sets its minutes)', !!r.error, r.error?.message || 'inserted');
  r = await Q.from('tree_invite').insert({ tree_id: tree, person_id: p1, opened_at: new Date().toISOString() }).select('code');
  check('…nor a link that claims to be opened already', !!r.error, r.error?.message || 'inserted');

  // making one
  r = await make(Q, p1, '  Kak One  ');
  const c1 = r.data?.code, f1 = row(c1).split('|');
  check('a keeper makes a QR invite: code + 300 seconds', !r.error && /^[0-9a-f]{12}$/.test(c1 || '') && r.data.seconds === 300, r.error?.message || JSON.stringify(r.data));
  check('stored as kind qr, not opened, runs out in 5 minutes, name trimmed, made by the keeper',
    f1[0] === 'qr' && f1[1] === 'false' && near(f1[2], 300) && f1[3] === 'Kak One' && f1[4] === Q.uid, row(c1));
  r = await make(Q, p2, 'x'.repeat(200));
  check('a long name is cut to 80 characters; an empty one is stored as none', !r.error && row(r.data.code).split('|')[3].length === 80
    && (await make(Q, p2, '   ')).data && sql(`select count(*) from tree_invite where person_id='${p2}' and kind='qr' and invite_name is null`).trim() === '1');
  r = await M.from('tree_invite').select('code').eq('code', c1);
  check('a member can\'t read QR codes (only keepers read invites)', !r.error && r.data.length === 0, r.error?.message);

  // refresh: a new code, the old one goes
  r = await make(Q, p1);
  const c1b = r.data?.code;
  check('refresh: a brand-new code, and the old one is deleted', !r.error && c1b !== c1 && row(c1) === '' && qrsOf(p1) === '1', `${row(c1)} · ${qrsOf(p1)}`);
  r = await open(c1);
  check('…so the old code opens nothing', !r.error && r.data === null, r.error?.message || JSON.stringify(r.data));

  // opening it (the relative's phone, signed out)
  r = await open(c1b);
  const f1b = row(c1b).split('|');
  check('opening a QR code in time: its 30 minutes start (name, kind, ~1800 s)', !r.error && r.data?.name === 'Kak One' && r.data.kind === 'qr'
    && near(r.data.seconds, 1800) && f1b[1] === 'true' && near(f1b[2], 1800), r.error?.message || JSON.stringify(r.data) + ' · ' + row(c1b));
  sql(`update tree_invite set opened_at = opened_at - interval '10 minutes', expires_at = expires_at - interval '10 minutes' where code='${c1b}'`);
  r = await open(c1b, J2);
  check('opening it again (even signed in) does not add more time', !r.error && near(r.data?.seconds, 1200) && near(row(c1b).split('|')[2], 1200), JSON.stringify(r.data));
  r = await Q.from('tree_invite').delete().eq('code', c1b).is('opened_at', null).select('code');
  check('closing the keeper\'s sheet leaves a scanned code alone (they\'re signing up)', !r.error && r.data.length === 0 && row(c1b) !== '', r.error?.message);
  r = await make(Q, p1);
  const c1c = r.data?.code;
  check('refresh after a scan keeps the scanned code too — first to finish takes the place', !r.error && row(c1b) !== '' && qrsOf(p1) === '2', qrsOf(p1));
  r = await J1.rpc('join_with_invite', { invite_code: c1b, nucleus_label: 'J1 house', tree_nm: 'J1 tree' });
  check('20 minutes after scanning: sign-up finishes and claims the right person', !r.error && r.data?.person_id === p1
    && sql(`select claimed_by from person where id='${p1}'`).trim() === await nucOf(J1), r.error?.message);
  check('…and that code is used up', row(c1b) === '' && (await open(c1b)).data === null);
  r = await J3.rpc('join_with_invite', { invite_code: c1c, nucleus_label: 'J3 house', tree_nm: 'J3 tree' });
  check('the other live code can\'t take the claimed profile', !!r.error && /already been claimed/.test(r.error.message), r.error?.message || 'joined');

  // too slow
  r = await make(Q, p2);
  const c2 = r.data?.code;
  sql(`update tree_invite set expires_at = now() - interval '1 second' where code='${c2}'`); // 5 minutes later, nobody scanned
  r = await open(c2);
  check('not scanned within 5 minutes: opening it gives nothing, and it stays shut', !r.error && r.data === null && row(c2).split('|')[1] === 'false'
    && Number(row(c2).split('|')[2]) <= 0, r.error?.message || row(c2));
  r = await J2.rpc('join_with_invite', { invite_code: c2, nucleus_label: 'J2 house', tree_nm: 'J2 tree' });
  check('…and signing up with it is refused', !!r.error && /invalid or expired/.test(r.error.message) && !(await nucOf(J2)), r.error?.message || 'joined');
  r = await make(Q, p3);
  const c3 = r.data?.code;
  check('the next QR code anyone makes sweeps away ones that ran out', !r.error && row(c2) === '', row(c2));
  await open(c3);
  sql(`update tree_invite set expires_at = now() - interval '1 second' where code='${c3}'`); // 30 minutes after the scan
  r = await J2.rpc('join_with_invite', { invite_code: c3, nucleus_label: 'J2 house', tree_nm: 'J2 tree' });
  check('scanned, but not finished within 30 minutes: refused', !!r.error && /invalid or expired/.test(r.error.message)
    && sql(`select claimed_by is null from person where id='${p3}'`).trim() === 't', r.error?.message || 'joined');

  // 14-day links: only read, never changed
  const ln = await Q.from('tree_invite').insert({ tree_id: tree, person_id: p3, invite_name: 'Kak Three' }).select('code').single();
  const stamp = code => sql(`select expires_at::text||'|'||coalesce(opened_at::text,'not opened') from tree_invite where code='${code}'`).trim();
  const was = stamp(ln.data.code);
  r = await open(ln.data.code);
  check('opening a 14-day link greets them by name and changes nothing', !r.error && r.data?.name === 'Kak Three' && r.data.kind === 'link'
    && near(r.data.seconds, 14 * 86400) && stamp(ln.data.code) === was, r.error?.message || `${was} → ${stamp(ln.data.code)}`);
  r = await open('nope');
  check('an unknown code: nothing', !r.error && r.data === null, r.error?.message);
  r = await open(null);
  check('no code at all: nothing', !r.error && r.data === null, r.error?.message);
  r = await J2.rpc('join_with_invite', { invite_code: ln.data.code, nucleus_label: 'J2 house', tree_nm: 'J2 tree' });
  check('the 14-day link still works as before', !r.error && r.data?.person_id === p3, r.error?.message);
  r = await Q.rpc('make_qr_invite', { p: p3, invite_nm: 'x' });
  check('no QR code for someone who just took their place', !!r.error, r.error?.message || 'made one');
  const left = sql(`select count(*) from tree_invite where tree_id='${tree}' and kind='qr' and expires_at > now()`).trim();
  r = await Q.from('tree_invite').delete().eq('code', c1c).select('code');
  check('a keeper can delete a QR code (cancel it)', !r.error && r.data.length === 1 && left === '1', r.error?.message || left);
}

/* ============ 7. catalog: search_path + who may call what ============ */
section = '[catalog] ';
const rows = q => sql(q).trim().split('\n').filter(Boolean);
// production's hand-made BearHaus Finance objects (stand-ins: tests/prod-finance-drift.sql) are removed by upgrade 8
const finance = rows(`select proname from pg_proc where pronamespace='public'::regnamespace and proname in ('check_invite','create_household_setup')
  union all select 'beta_invites' where to_regclass('public.beta_invites') is not null`);
check('the BearHaus Finance leftovers are gone (beta_invites, check_invite, create_household_setup)', finance.length === 0, finance.join(', '));
r = await anon.rpc('check_invite', { p_code: 'TEST-ONE' });
check('signed-out visitors can no longer call check_invite', !!r.error, r.error?.message || 'ran');
const unpinned = rows(`select proname from pg_proc where pronamespace='public'::regnamespace and prosecdef
  and not exists (select 1 from unnest(coalesce(proconfig,'{}')) c where c like 'search_path=%')`);
check('every SECURITY DEFINER function pins its search_path', unpinned.length === 0, unpinned.join(', '));
const callable = role => rows(`select proname from pg_proc where pronamespace='public'::regnamespace
  and has_function_privilege('${role}', oid, 'execute') order by 1`).join(',');
check('signed-out visitors (anon) can call only invite_preview, open_invite and redeem_reset_code', callable('anon') === 'invite_preview,open_invite,redeem_reset_code', callable('anon'));
const WANT = 'branch_distance,claim_person,create_tree,in_tree,invite_preview,is_super_user,issue_reset_code,join_with_invite,make_qr_invite,my_nucleus,open_invite,redeem_reset_code,release_claim,remove_person,set_super';
check('signed-in users can call only what the app and the row rules need', callable('authenticated') === WANT, callable('authenticated'));
const pub = rows(`select proname from pg_proc where pronamespace='public'::regnamespace
  and exists (select 1 from aclexplode(coalesce(proacl, acldefault('f', proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE')`);
check('no function is open to PUBLIC', pub.length === 0, pub.join(', '));
for (const [fn, args] of [['create_tree', { nucleus_label: 'x', tree_nm: 'x' }], ['claim_person', { p: pA }], ['set_super', { target: nucA, flag: true }],
  ['join_with_invite', { invite_code: codeGeneral, nucleus_label: 'x', tree_nm: 'x' }], ['my_tree', {}], ['branch_distance', { p: pA }],
  ['issue_reset_code', { p: pA }], ['make_qr_invite', { p: pKid, invite_nm: 'x' }]]) {
  r = await anon.rpc(fn, args);
  check(`signed-out visitor calling ${fn} is refused`, !!r.error, r.error?.message || 'ran');
}
r = await anon.rpc('invite_preview', { invite_code: 'nope' });
check('signed-out visitor can still use invite_preview', !r.error, r.error?.message);
r = await anon.rpc('open_invite', { invite_code: 'nope' });
check('signed-out visitor can use open_invite (the landing page)', !r.error && r.data === null, r.error?.message);
r = await anon.from('memorial_style').select('id').limit(1);
check('the daily keep-awake read still works signed out (memorial_style)', !r.error && r.data.length === 1, r.error?.message);
r = await anon.from('person').select('id').limit(1);
check('signed-out visitors still read no people', !!r.error || r.data.length === 0, r.error?.message || 'rows=' + r.data.length);
const trg = rows(`select tgname||':'||case when tgtype & 1 = 1 then 'row' else 'statement' end from pg_trigger where tgrelid='relationship'::regclass and not tgisinternal order by 1`).join(',');
check('relationship triggers: 3 statement-level kinship triggers + per-row stamp', trg === 'relationship_added:statement,relationship_moved:statement,relationship_removed:statement,relationship_stamp:row', trg);
const ptrg = rows(`select tgname||':'||case when tgtype & 1 = 1 then 'row' else 'statement' end from pg_trigger where tgrelid='person'::regclass and not tgisinternal order by 1`).join(',');
check('person triggers: name_unknown mark + stamp, per row', ptrg === 'person_name_unknown:row,person_stamp:row', ptrg);
check('mark_name_unknown is internal (nobody can call it directly)', rows(`select 1 from pg_proc p where proname='mark_name_unknown'
  and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))`).length === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

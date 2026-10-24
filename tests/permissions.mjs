// Bear Family Tree — permission test suite. LOCAL / CI Supabase stacks only.
// Signs up synthetic users (@test.invalid) and runs the same calls the app makes.
//   1. safety release (2026-10-21): the 40 original checks
//   2. "only us" nicknames (2026-10-21): the 33 original checks
//   3. launch gate (2026-10-23): kinship, remove_person, release_claim, timestamps
//   4. keeper reset codes (2026-10-24): who may make one, redeeming, real sign-in after, limits
//   5. placeholder names (2026-10-24): "?" people marked name_unknown, edit rules unchanged
//   6. QR invites (2026-10-24): 5 minutes to scan, then 30 to sign up; refresh; single use
//      + "Is this you?": a personal invite's family, first names only
//   7. soft-launch fixes (2026-10-25): households named after a member, start-a-tree codes
//      + caps, "not me", used invites kept + counts, the code alone resets a password
//   7b. the name on the tree (2026-10-25): short_name — set only by whoever may edit the person
//   8. catalog: search_path + who may call which function, Finance leftovers gone
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
// a new tree needs a keeper's one-time start code (2026-10-25); tests mint one directly
const startCode = () => sql(`with x as (insert into newtree_code default values returning code) select code from x`).trim();
const newTree = (c, label, tn) => c.rpc('create_tree', { nucleus_label: label, tree_nm: tn, start_code: startCode() });

/* ============ 1. safety release (2026-10-21) ============ */
section = '[safety] ';
const A = await user('a'), B = await user('b'), C = await user('c');
let r = await newTree(A, 'A house', 'A tree');
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
r = await newTree(C, 'C house', 'C tree');
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
r = await A.from('tree_invite').select('used_at,uses').eq('code', codePersonal);
check('personal invite is single-use: kept, marked used', !r.error && r.data.length === 1 && !!r.data[0].used_at && r.data[0].uses === 1, JSON.stringify(r.data));
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
  r = await newTree(H, 'H house', 'H tree');
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
await A.from('tree_invite').insert({ tree_id: treeA, person_id: pNear, invite_name: 'Near' }); // (before the memorial: none after)
await B.from('memorial').upsert({ person_id: pNear, tree_id: treeA, passed_on: '2001', style_id: 'gen1' });
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
check('super can remove someone another household claimed — the invite they joined with stays on record', !r.error && traces(pPartner) === '0/0/0/1/0/removed'
  && sql(`select (used_at is not null)||'/'||(expires_at <= now()) from tree_invite where person_id='${pPartner}'`).trim() === 'true/true', r.error?.message || traces(pPartner));

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

/* ============ 4. keeper reset codes (2026-10-24; the code alone finds the login since 2026-10-25) ============ */
section = '[reset] ';
{
  // K keeps the tree; R and O are two other households in it; X keeps a different tree
  const K = await user('k'), R = await user('r'), O = await user('o'), X = await user('x');
  r = await newTree(K, 'K house', 'K tree');
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
  r = await newTree(X, 'X house', 'X tree');
  check('setup: X keeps a tree of its own', !r.error && isSuper(X), r.error?.message);
  const nucR = await nucOf(R), nucO = await nucOf(O);
  const issue = (c, p) => c.rpc('issue_reset_code', { p });
  const redeem = (code, pw, c = anon) => c.rpc('redeem_reset_code', { reset_code: code, new_password: pw });
  const res = x => x.data?.result || x.error?.message;
  const signIn = (email, password) => client().auth.signInWithPassword({ email, password });
  const lastId = (n = nucR) => sql(`select max(id) from password_reset where nucleus_id='${n}'`).trim();
  const rec = id => sql(`select attempts||'/'||(used_at is not null)||'/'||(revoked_at is not null) from password_reset where id=${id}`).trim();
  const hashOf = u => sql(`select encrypted_password from auth.users where id='${u}'`).trim();
  const sessions = u => sql(`select count(*) from auth.sessions where user_id='${u}'`).trim();
  const guard = () => sql(`select coalesce((select failures from password_reset_guard), 0)`).trim();
  const freshWindow = () => sql(`delete from password_reset_guard`);
  // a wrong code that can't match any live code's first 2 symbols (so it counts only for everyone)
  const stranger = () => { const live = sql(`select string_agg(code_prefix, ',') from password_reset where used_at is null and revoked_at is null and expires_at > now()`);
    for (const a of '23456789ABCDEFGHJKMNPQRSTUVWXYZ') for (const b of '23456789ABCDEFGHJKMNPQRSTUVWXYZ') if (!live.includes(a + b)) return a + b + 'WRONG2'; };
  const samePrefix = code => code.slice(0, 2) + (code.slice(2) === 'WWWWWW' ? 'XXXXXX' : 'WWWWWW');

  // who may make a code
  r = await issue(O, pR);
  check('a member who isn\'t a keeper cannot make a code', !!r.error, r.error?.message || 'made one');
  r = await issue(anon, pR);
  check('a signed-out visitor cannot make a code', !!r.error, r.error?.message || 'made one');
  r = await issue(X, pR);
  check('a keeper of another tree cannot make a code for this tree', !!r.error, r.error?.message || 'made one');
  r = await issue(K, pU);
  check('no code for an unclaimed profile (there is no login to open)', !!r.error, r.error?.message || 'made one');
  check('…and none of those left a code behind', sql(`select count(*) from password_reset where tree_id='${tree}'`).trim() === '0');
  r = await issue(K, pR);
  const code1 = r.data?.code, id1 = lastId();
  check('the keeper makes a code: 8 characters, none that look alike', !r.error && /^[2-9A-HJKMNP-Z]{8}$/.test(code1 || ''), r.error?.message || code1);
  const mins = (new Date(r.data?.expires_at) - Date.now()) / 60000;
  check('…that lasts 30 minutes', mins > 29 && mins <= 30.1, mins.toFixed(1) + ' min');
  const stored = sql(`select row_to_json(p)::text from password_reset p where id=${id1}`);
  check('…stored as a bcrypt hash; only its first 2 symbols are kept plain, to find it', /"code_hash":"\$2a\$/.test(stored)
    && !stored.includes(code1) && !stored.includes(code1.slice(2)) && stored.includes(`"code_prefix":"${code1.slice(0, 2)}"`));
  const who = sql(`select (tree_id='${tree}')||'/'||(nucleus_id='${nucR}')||'/'||(person_id='${pR}')||'/'||(created_by='${K.uid}')||'/'||(created_by_nucleus='${nucK}')||'/'||(user_id='${R.uid}') from password_reset where id=${id1}`).trim();
  check('…and recorded: which tree, household, card, keeper — and the one login it opens', who === 'true/true/true/true/true/true', who);
  for (const [lab, c] of [['the keeper', K], ['a signed-out visitor', anon]]) {
    r = await c.from('password_reset').select('id');
    check(`${lab} cannot read the codes through the API`, !!r.error, r.error?.message || 'rows=' + r.data.length);
    r = await c.from('password_reset_guard').select('failures');
    check(`${lab} cannot read the failed-tries counter through the API`, !!r.error, r.error?.message || 'rows=' + r.data.length);
  }
  r = await anon.rpc('redeem_reset_code', { login_email: R.email, reset_code: code1, new_password: 'new-password-1' });
  check('the old email + code form is gone', !!r.error, r.error?.message || JSON.stringify(r.data));
  check('the old per-email counter table is gone', sql(`select to_regclass('public.password_reset_failure') is null`).trim() === 't');

  // redeeming: the code and a new password, nothing else
  freshWindow();
  r = await redeem(stranger(), 'new-password-1');
  check('a wrong code → "no", counted for everyone, not against the live code', res(r) === 'no' && guard() === '1' && rec(id1) === '0/false/false', `${res(r)} · ${guard()} · ${rec(id1)}`);
  r = await redeem(samePrefix(code1), 'new-password-1');
  check('a wrong code starting like the live one → "no", and it counts against that code too', res(r) === 'no' && guard() === '2' && rec(id1) === '1/false/false', `${res(r)} · ${rec(id1)}`);
  r = await redeem('', 'new-password-1');
  check('no code at all → the same "no"', res(r) === 'no', res(r));
  r = await redeem(code1, '12345');
  check('a new password under 6 characters → "short", and the code is not used up', res(r) === 'short' && rec(id1) === '1/false/false', res(r));
  r = await redeem(code1, 'x'.repeat(73));
  check('a new password over 72 characters → "long"', res(r) === 'long', res(r));
  const oldHash = hashOf(R.uid), before = sessions(R.uid);
  r = await redeem(' ' + code1.slice(0, 4).toLowerCase() + '-' + code1.slice(4) + ' ', 'new-password-1');
  check('the right code alone (lower case, with a dash) → "ok"', res(r) === 'ok', JSON.stringify(r.data) || r.error?.message);
  check('…and it answers with that login\'s email (to sign in, and to show them) and the record\'s id',
    r.data?.email === R.email && String(r.data?.reset_id) === id1, JSON.stringify(r.data));
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
  check('…and the other household\'s password still works', !(await signIn(O.email, O.password)).error);
  check('the code is marked used, by that login', sql(`select (used_at is not null)||'/'||(used_by='${R.uid}') from password_reset where id=${id1}`).trim() === 'true/true');
  r = await redeem(code1, 'new-password-2');
  check('a code works only once', res(r) === 'no', res(r));

  // the member is told: who reset MY password, and when
  r = await R2.rpc('my_password_resets');
  check('the member sees the reset on their login: when, and which keeper\'s household', !r.error && r.data?.length === 1
    && String(r.data[0].id) === id1 && r.data[0].by === 'K house' && Math.abs(new Date(r.data[0].at) - Date.now()) < 60000, r.error?.message || JSON.stringify(r.data));
  const O2 = client(); await O2.auth.signInWithPassword({ email: O.email, password: O.password });
  r = await O2.rpc('my_password_resets');
  check('another household sees none of it', !r.error && Array.isArray(r.data) && r.data.length === 0, r.error?.message || JSON.stringify(r.data));
  r = await anon.rpc('my_password_resets');
  check('a signed-out visitor cannot ask', !!r.error, r.error?.message || JSON.stringify(r.data));

  // a newer code replaces the older one; 5 wrong tries burn a code
  const code2 = (await issue(K, pR)).data?.code, id2 = lastId();
  const code3 = (await issue(K, pR)).data?.code, id3 = lastId();
  check('making a new code stops the previous one', rec(id2) === '0/false/true' && rec(id3) === '0/false/false', `${rec(id2)} · ${rec(id3)}`);
  r = await redeem(code2, 'new-password-2');
  check('…the replaced code gets "no"', res(r) === 'no', res(r));
  freshWindow();
  for (let i = 0; i < 5; i++) await redeem(samePrefix(code3), 'new-password-2');
  check('5 wrong tries at a code burn it', rec(id3) === '5/false/true', rec(id3));
  r = await redeem(code3, 'new-password-2');
  check('…after which even the right code gets "no"', res(r) === 'no' && !(await signIn(R.email, 'new-password-1')).error, res(r));

  // 20 failed tries by anyone, within 30 minutes, stop every reset until the 30 minutes are up
  freshWindow();
  const code4 = (await issue(K, pR)).data?.code, id4 = lastId();
  const tries = [];
  for (let i = 0; i < 20; i++) tries.push(res(await redeem(stranger(), 'new-password-2')));
  r = await redeem(code4, 'new-password-2');
  check('20 failed tries (all codes, everyone) → "locked" for everyone, even a fresh, right code',
    tries.every(a => a === 'no') && res(r) === 'locked' && rec(id4) === '0/false/false' && guard() === '20', `${tries.join(',')} → ${res(r)} · ${rec(id4)} · ${guard()}`);
  sql(`update password_reset_guard set window_start = now() - interval '31 minutes'`); // 30 minutes later
  r = await redeem(code4, 'new-password-2');
  check('after 30 minutes resets work again — and the code still works', res(r) === 'ok' && !(await signIn(R.email, 'new-password-2')).error && guard() === '0', `${res(r)} · ${guard()}`);

  // expired; signed in; the login moved or gone; many guesses at once
  const code5 = (await issue(K, pR)).data?.code, id5 = lastId();
  sql(`update password_reset set expires_at = now() - interval '1 second' where id=${id5}`);
  r = await redeem(code5, 'new-password-3');
  check('an expired code → "no"', res(r) === 'no' && rec(id5) === '0/false/false', `${res(r)} · ${rec(id5)}`);
  r = await redeem(stranger(), 'new-password-3', K);
  check('the reset screen still works with a stale sign-in in the browser', res(r) === 'no', res(r));
  const code6 = (await issue(K, pO)).data?.code, id6 = lastId(nucO);
  sql(`update account set nucleus_id='${nucK}' where user_id='${O.uid}'`); // the login left that household after the code was made
  r = await redeem(code6, 'new-password-3');
  check('a code whose login no longer belongs to that household → "no", password unchanged', res(r) === 'no' && !(await signIn(O.email, O.password)).error, res(r));
  sql(`update account set nucleus_id='${nucO}' where user_id='${O.uid}'`);
  freshWindow();
  const code7 = (await issue(K, pR)).data?.code, id7 = lastId();
  const burst = await Promise.all(Array.from({ length: 30 }, () => redeem(samePrefix(code7), 'new-password-3')));
  const tally = {}; burst.forEach(x => { const k = res(x); tally[k] = (tally[k] || 0) + 1; });
  check('30 guesses at the same moment: 5 count against the code (then it\'s burned), 20 in all, the rest "locked"',
    rec(id7) === '5/false/true' && tally.no === 20 && tally.locked === 10 && guard() === '20', `${rec(id7)} · ${JSON.stringify(tally)} · ${guard()}`);
  r = await redeem(code7, 'new-password-3');
  check('…none of them got in, and the password is unchanged', res(r) === 'locked' && !(await signIn(R.email, 'new-password-2')).error, res(r));
  freshWindow();

  // bounds on codes waiting to be used: 3 per tree, 20 in the whole database
  const T = await user('t'), pT2 = randomUUID();
  await K.from('person').insert({ id: pT2, tree_id: tree, full_name: 'Test Fourth' });
  const invT = await K.from('tree_invite').insert({ tree_id: tree, person_id: pT2 }).select('code').single();
  await T.rpc('join_with_invite', { invite_code: invT.data.code, nucleus_label: '', tree_nm: '' });
  sql(`update password_reset set revoked_at = now() where tree_id='${tree}' and used_at is null and revoked_at is null`);
  const three = [await issue(K, pR), await issue(K, pO), await issue(K, pK)];
  r = await issue(K, pT2);
  check('a 4th code waiting in one tree is refused', three.every(x => !x.error) && !!r.error && /3 reset codes/.test(r.error.message), r.error?.message || 'made one');
  r = await issue(K, pR);
  check('…but replacing a household\'s own code is fine (it stops the old one first)', !r.error, r.error?.message);
  sql(`update password_reset set revoked_at = now() where tree_id='${tree}' and nucleus_id='${nucR}' and used_at is null and revoked_at is null`);
  const liveAll = Number(sql(`select count(*) from password_reset where used_at is null and revoked_at is null and expires_at > now()`));
  sql(`insert into password_reset (tree_id, nucleus_id, code_hash, code_prefix) select '${treeA}', '${nucA}', 'x', 'zz' from generate_series(1, ${Math.max(0, 20 - liveAll)})`);
  r = await issue(K, pR);
  check('with 20 codes waiting in the whole database, no keeper can make another', !!r.error && /too many reset codes/.test(r.error.message), r.error?.message || 'made one');
  sql(`delete from password_reset where code_hash='x'`);
  check('live codes never share their first 2 symbols', sql(`select count(*) - count(distinct code_prefix) from password_reset where used_at is null and revoked_at is null and expires_at > now()`).trim() === '0');
  // a household with two logins: the code couldn't know which one
  const R3 = await user('r3');
  sql(`insert into account (user_id, nucleus_id) values ('${R3.uid}', '${nucR}')`);
  r = await issue(K, pR);
  check('a household with two logins gets no code (it couldn\'t tell which login)', !!r.error && /more than one login/.test(r.error.message), r.error?.message || 'made one');
  sql(`delete from account where user_id='${R3.uid}'`);
}

/* ============ 5. placeholder names (2026-10-24): "?" people, name_unknown ============ */
section = '[names] ';
const unk = id => sql(`select name_unknown from person where id='${id}'`).trim();
const pQ = randomUUID();
r = await B.from('person').insert({ id: pQ, tree_id: treeA, full_name: '?', gender: 'f' }).select('id');
await B.from('relationship').insert({ tree_id: treeA, kind: 'partner', person_a: pB, person_b: pQ });
check('a person added as "?" is marked name_unknown by the database', !r.error && unk(pQ) === 't', r.error?.message || unk(pQ));
const pQe = randomUUID();
r = await B.from('person').insert({ id: pQe, tree_id: treeA, full_name: '' }).select('id');
check('a person added with an empty name is accepted and marked too (the app allows it)', !r.error && unk(pQe) === 't', r.error?.message || unk(pQe));
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

/* ============ 6. QR invites (2026-10-24): 5 minutes to scan, then 10 (was 30) to sign up ============ */
section = '[qr] ';
{
  // Q keeps the tree; M is a member (not a keeper); Y keeps another tree; J1–J3 are relatives joining
  const Q = await user('qk'), M = await user('qm'), Y = await user('qy'), J1 = await user('qj1'), J2 = await user('qj2'), J3 = await user('qj3');
  r = await newTree(Q, 'Q house', 'Q tree');
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
  await newTree(Y, 'Y house', 'Y tree');
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
  check('refresh: a brand-new code, and the old one (never opened) is deleted', !r.error && c1b !== c1 && row(c1) === '' && qrsOf(p1) === '1', `${row(c1)} · ${qrsOf(p1)}`);
  r = await open(c1);
  check('…so the old code opens nothing', !r.error && r.data === null, r.error?.message || JSON.stringify(r.data));

  // opening it (the relative's phone, signed out)
  r = await open(c1b);
  const f1b = row(c1b).split('|');
  check('opening a QR code in time: its 10 minutes start (name, kind, ~600 s)', !r.error && r.data?.name === 'Kak One' && r.data.kind === 'qr'
    && near(r.data.seconds, 600) && f1b[1] === 'true' && near(f1b[2], 600), r.error?.message || JSON.stringify(r.data) + ' · ' + row(c1b));
  sql(`update tree_invite set opened_at = opened_at - interval '5 minutes', expires_at = expires_at - interval '5 minutes' where code='${c1b}'`);
  r = await open(c1b, J2);
  check('opening it again (even signed in) does not add more time', !r.error && near(r.data?.seconds, 300) && near(row(c1b).split('|')[2], 300), JSON.stringify(r.data));
  r = await Q.from('tree_invite').delete().eq('code', c1b).is('opened_at', null).select('code');
  check('closing the keeper\'s sheet leaves a scanned code alone (they\'re signing up)', !r.error && r.data.length === 0 && row(c1b) !== '', r.error?.message);
  r = await make(Q, p1);
  const c1c = r.data?.code;
  check('refresh after a scan keeps the scanned code too — first to finish takes the place', !r.error && row(c1b) !== '' && qrsOf(p1) === '2', qrsOf(p1));
  r = await J1.rpc('join_with_invite', { invite_code: c1b, nucleus_label: 'J1 house', tree_nm: 'J1 tree' });
  check('5 minutes after scanning: sign-up finishes and claims the right person', !r.error && r.data?.person_id === p1
    && sql(`select claimed_by from person where id='${p1}'`).trim() === await nucOf(J1), r.error?.message);
  check('…and that code is used up: kept as a record, opens nothing', sql(`select (used_at is not null)||'/'||uses||'/'||(used_by='${await nucOf(J1)}') from tree_invite where code='${c1b}'`).trim() === 'true/1/true'
    && (await open(c1b)).data === null);
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
  sql(`update tree_invite set expires_at = now() - interval '1 second' where code='${c3}'`); // 10 minutes after the scan
  r = await J2.rpc('join_with_invite', { invite_code: c3, nucleus_label: 'J2 house', tree_nm: 'J2 tree' });
  check('scanned, but not finished within 10 minutes: refused', !!r.error && /invalid or expired/.test(r.error.message)
    && sql(`select claimed_by is null from person where id='${p3}'`).trim() === 't', r.error?.message || 'joined');

  // 14-day links: only read, never changed
  const ln = await Q.from('tree_invite').insert({ tree_id: tree, person_id: p3, invite_name: 'Kak Three' }).select('code').single();
  const stamp = code => sql(`select expires_at::text||'|'||coalesce(opened_at::text,'not opened') from tree_invite where code='${code}'`).trim();
  const was = stamp(ln.data.code);
  r = await open(ln.data.code);
  check('opening a 14-day link greets them by name; its 14 days don\'t change, only the first open is noted', !r.error && r.data?.name === 'Kak Three' && r.data.kind === 'link'
    && near(r.data.seconds, 14 * 86400) && was.endsWith('|not opened') && stamp(ln.data.code).split('|')[0] === was.split('|')[0]
    && !stamp(ln.data.code).endsWith('|not opened'), r.error?.message || `${was} → ${stamp(ln.data.code)}`);
  const first = stamp(ln.data.code); await open(ln.data.code);
  check('…opening it again changes nothing', stamp(ln.data.code) === first, `${first} → ${stamp(ln.data.code)}`);
  r = await open('nope');
  check('an unknown code: nothing', !r.error && r.data === null, r.error?.message);
  r = await open(null);
  check('no code at all: nothing', !r.error && r.data === null, r.error?.message);
  r = await J2.rpc('join_with_invite', { invite_code: ln.data.code, nucleus_label: 'J2 house', tree_nm: 'J2 tree' });
  check('the 14-day link still works as before', !r.error && r.data?.person_id === p3, r.error?.message);
  r = await Q.rpc('make_qr_invite', { p: p3, invite_nm: 'x' });
  check('no QR code for someone who just took their place', !!r.error, r.error?.message || 'made one');
  const left = sql(`select count(*) from tree_invite where tree_id='${tree}' and kind='qr' and expires_at > now() and used_at is null`).trim();
  r = await Q.from('tree_invite').delete().eq('code', c1c).select('code');
  check('a keeper can delete a QR code (cancel it)', !r.error && r.data.length === 1 && left === '1', r.error?.message || left);
}

/* ============ 6b. "Is this you?" (2026-10-24): a personal invite shows its family, first names only ============ */
section = '[preview] ';
{
  const K2 = await user('pk'), J4 = await user('pj');
  r = await newTree(K2, 'P house', 'P tree');
  const tree = r.data, nucK = await nucOf(K2), id = () => randomUUID();
  const dad = id(), mum = id(), me = id(), sis = id(), oldSis = id(), half = id(), ph = id(), gone = id(), pt = id(), ex = id(), kid = id();
  r = await K2.from('person').insert([
    { id: dad, tree_id: tree, full_name: 'Adam Test', born: '1950', claimed_by: nucK },
    { id: mum, tree_id: tree, full_name: 'Hawa Test', born: '1952' },
    { id: me, tree_id: tree, full_name: '', gender: 'f' },                      // the "?" being invited
    { id: sis, tree_id: tree, full_name: 'Sara Test', born: '1980' },
    { id: oldSis, tree_id: tree, full_name: 'Aina Test', born: '1975' },
    { id: half, tree_id: tree, full_name: 'Hadi Test', born: '1990' },          // Adam's only
    { id: ph, tree_id: tree, full_name: '?' },                                  // a sister not named yet
    { id: gone, tree_id: tree, full_name: 'Gone Test' },
    { id: pt, tree_id: tree, full_name: 'Paul Partner' }, { id: ex, tree_id: tree, full_name: 'Eddie Ex' },
    { id: kid, tree_id: tree, full_name: 'Kim Kid Test' }]);
  check('setup: a family of 11', !r.error, r.error?.message);
  const pc = (a, b) => ({ tree_id: tree, kind: 'parent-child', person_a: a, person_b: b });
  r = await K2.from('relationship').insert([pc(dad, me), pc(mum, me), pc(dad, sis), pc(mum, sis), pc(dad, oldSis), pc(mum, oldSis),
    pc(dad, half), pc(dad, ph), pc(mum, gone), pc(me, kid),
    { tree_id: tree, kind: 'partner', person_a: me, person_b: pt, status: 'together' },
    { tree_id: tree, kind: 'partner', person_a: ex, person_b: me, status: 'divorced' },
    { tree_id: tree, kind: 'partner', person_a: dad, person_b: mum, status: 'together' }]);
  check('setup: links', !r.error, r.error?.message);
  r = await K2.rpc('remove_person', { p: gone });
  check('setup: one sister removed from the tree', !r.error, r.error?.message);
  // Adam goes by "Abah" (shown); Hawa's own nickname is "only us" (never shown); Adam's nickname for Sara is his, not hers
  sql(`insert into nickname (tree_id, person_id, viewer_person_id, text, private) values
    ('${tree}', '${dad}', '${dad}', 'Abah', false), ('${tree}', '${mum}', '${mum}', 'SecretMum', true), ('${tree}', '${sis}', '${dad}', 'Kakak', false)`);
  const qr = await K2.rpc('make_qr_invite', { p: me, invite_nm: 'Daughter of Abah & Hawa' });
  r = await anon.rpc('open_invite', { invite_code: qr.data?.code });
  const f = r.data?.family || {};
  check('a personal invite answers with the family it joins (signed out)', !r.error && r.data?.name === 'Daughter of Abah & Hawa' && !!r.data.family, r.error?.message || JSON.stringify(r.data));
  check('…and says their own name isn\'t known yet (the preview draws a "?")', r.data?.unknown === true, JSON.stringify(r.data?.unknown));
  check('parents: the name each goes by themselves, else the first name — never a private one', JSON.stringify(f.parents) === '["Abah","Hawa"]', JSON.stringify(f.parents));
  check('brothers & sisters: anyone sharing a parent, oldest first — no "?"s, no removed people, nobody else\'s nickname for them',
    JSON.stringify(f.siblings) === '["Aina","Sara","Hadi"]', JSON.stringify(f.siblings));
  check('partner: the current one only, not an ex', JSON.stringify(f.partners) === '["Paul"]', JSON.stringify(f.partners));
  check('children', JSON.stringify(f.children) === '["Kim"]', JSON.stringify(f.children));
  check('first names only: no surnames, years, ids or other fields', !/Test|Partner|Ex|19\d\d|[0-9a-f]{8}-/.test(JSON.stringify(f))
    && Object.keys(f).every(k => ['parents', 'partners', 'children', 'siblings'].includes(k)), JSON.stringify(f));
  const ln = await K2.from('tree_invite').insert({ tree_id: tree, person_id: pt, invite_name: 'Paul' }).select('code').single();
  r = await anon.rpc('open_invite', { invite_code: ln.data?.code });
  check('a 14-day link shows family too — Paul\'s only link is a "?", so nobody is listed', !r.error && JSON.stringify(r.data?.family) === '{}' && r.data.unknown === false, JSON.stringify(r.data));
  const gen = await K2.from('tree_invite').insert({ tree_id: tree }).select('code').single();
  r = await anon.rpc('open_invite', { invite_code: gen.data?.code });
  check('a general code shows no family (it isn\'t for one person)', !r.error && r.data && r.data.family === null && r.data.unknown === null, JSON.stringify(r.data));
  r = await J4.rpc('join_with_invite', { invite_code: qr.data?.code, nucleus_label: 'J4 house', tree_nm: 'J4 tree' });
  check('…and taking the place still works', !r.error && r.data?.person_id === me, r.error?.message);
  r = await anon.rpc('open_invite', { invite_code: qr.data?.code });
  check('once used, the code shows nothing at all', !r.error && r.data === null, JSON.stringify(r.data));
}

/* ============ 7. soft-launch fixes (2026-10-25) ============ */
section = '[houses] ';
{
  // households are named after a member instead of "our household"
  const H = await user('hk'), J = await user('hj'), G = await user('hg'), U = await user('hu'), T = await user('ht');
  const lab = n => sql(`select label||'|'||label_auto||'|'||tree_name from nucleus where id='${n}'`).trim();
  r = await newTree(H, '', 'Keluarga Test');
  const tree = r.data, nucH = await nucOf(H);
  check('a new tree with no household name: waiting for its first member, with the tree name typed', !r.error && lab(nucH) === 'new household|true|Keluarga Test', r.error?.message || lab(nucH));
  const pH = randomUUID();
  await H.from('person').insert({ id: pH, tree_id: tree, full_name: 'Adam Test', claimed_by: nucH });
  check('…the founder adds themselves: "Adam\'s household"', lab(nucH) === "Adam's household|false|Keluarga Test", lab(nucH));
  await H.from('person').update({ full_name: 'Adnan Test' }).eq('id', pH);
  check('…a name typed later doesn\'t rename it again', lab(nucH).startsWith("Adam's household|false"), lab(nucH));
  const pHana = randomUUID(), pQ = randomUUID(), pYana = randomUUID();
  await H.from('person').insert([{ id: pHana, tree_id: tree, full_name: 'Hana Test' }, { id: pQ, tree_id: tree, full_name: '?' },
    { id: pYana, tree_id: tree, full_name: 'Siti Aryana Test' }]);
  sql(`insert into nickname (tree_id, person_id, viewer_person_id, text, private) values ('${tree}', '${pYana}', '${pYana}', 'Kak Yana', false)`);
  const inv = async (pid) => (await H.from('tree_invite').insert({ tree_id: tree, ...(pid ? { person_id: pid } : {}) }).select('code').single()).data.code;
  r = await J.rpc('join_with_invite', { invite_code: await inv(pHana), nucleus_label: '', tree_nm: '' });
  const nucJ = await nucOf(J);
  check('joining with a personal invite and no names: "Hana\'s household", and the keepers\' name for the tree', !r.error && lab(nucJ) === "Hana's household|false|Keluarga Test", r.error?.message || lab(nucJ));
  r = await G.rpc('join_with_invite', { invite_code: await inv(pYana), nucleus_label: 'our household', tree_nm: 'our family' });
  const nucG = await nucOf(G);
  check('the old app\'s "our household"/"our family" count as empty; the name they go by is used', !r.error && lab(nucG) === "Kak Yana's household|false|Keluarga Test", r.error?.message || lab(nucG));
  r = await U.rpc('join_with_invite', { invite_code: await inv(pQ), nucleus_label: '', tree_nm: '' });
  const nucU = await nucOf(U);
  check('taking the place of a "?": the household waits for a name', !r.error && lab(nucU).startsWith('new household|true'), r.error?.message || lab(nucU));
  r = await H.from('nucleus').update({ label: 'renamed by the keeper' }).eq('id', nucU).select('id');
  check('…a keeper still can\'t rename another household directly', !r.error && r.data.length === 0 && lab(nucU).startsWith('new household|true'), r.error?.message);
  r = await H.from('person').update({ full_name: 'Siti Nur Test' }).eq('id', pQ).select('id');
  check('…but filling in that person\'s name names their household: "Siti\'s household"', !r.error && lab(nucU).startsWith("Siti's household|false"), r.error?.message || lab(nucU));
  r = await T.rpc('join_with_invite', { invite_code: await inv(null), nucleus_label: 'The Smiths', tree_nm: 'Our side' });
  const nucT = await nucOf(T), pT = randomUUID();
  check('a household name someone typed is kept', !r.error && lab(nucT) === 'The Smiths|false|Our side', r.error?.message || lab(nucT));
  await T.from('person').insert({ id: pT, tree_id: tree, full_name: 'Tom Test', claimed_by: nucT });
  check('…and their first member doesn\'t change it', lab(nucT) === 'The Smiths|false|Our side', lab(nucT));
  const V = await user('hv'), pV = randomUUID();
  await V.rpc('join_with_invite', { invite_code: await inv(null), nucleus_label: '', tree_nm: '' });
  const nucV = await nucOf(V);
  check('a general code, no names: waits for its first member', lab(nucV).startsWith('new household|true'), lab(nucV));
  await H.from('person').insert({ id: pV, tree_id: tree, full_name: 'Vera Test' });
  r = await V.rpc('claim_person', { p: pV });
  check('…claiming themselves on "Who are you?" names it', !r.error && lab(nucV).startsWith("Vera's household|false"), r.error?.message || lab(nucV));
  const W = await user('hw'), pW = randomUUID();
  await W.rpc('join_with_invite', { invite_code: await inv(null), nucleus_label: '', tree_nm: '' });
  const nucW = await nucOf(W);
  r = await W.from('person').insert({ id: pW, tree_id: tree, full_name: 'Wan Test', claimed_by: nucW }).select('id');
  check('…and so does "Add me"', !r.error && lab(nucW).startsWith("Wan's household|false"), r.error?.message || lab(nucW));
}

section = '[newtree] ';
{
  const K = await user('nk'), M = await user('nm'), F1 = await user('nf1'), F2 = await user('nf2'), F3 = await user('nf3'), O = await user('no');
  r = await newTree(K, 'K house', 'K tree');
  const tree = r.data, nucK = await nucOf(K);
  const pM = randomUUID();
  await K.from('person').insert({ id: pM, tree_id: tree, full_name: 'Member Test' });
  const invM = await K.from('tree_invite').insert({ tree_id: tree, person_id: pM }).select('code').single();
  await M.rpc('join_with_invite', { invite_code: invM.data.code, nucleus_label: '', tree_nm: '' });
  const ct = (c, code) => c.rpc('create_tree', { nucleus_label: '', tree_nm: 'Friend tree', start_code: code });
  r = await F1.rpc('create_tree', { nucleus_label: 'x', tree_nm: 'x' });
  check('the old create_tree without a code is gone', !!r.error, r.error?.message || 'made a tree');
  r = await ct(F1, null);
  check('a new login without a code can\'t start a tree', !!r.error && /start-a-tree link/.test(r.error.message) && !(await nucOf(F1)), r.error?.message || 'made a tree');
  r = await ct(F1, 'abcdefabcdef');
  check('…nor with a made-up code', !!r.error && !(await nucOf(F1)), r.error?.message || 'made a tree');
  r = await M.rpc('make_newtree_code');
  check('a member who isn\'t a keeper can\'t make a start-a-tree code', !!r.error, r.error?.message || 'made one');
  r = await anon.rpc('make_newtree_code');
  check('a signed-out visitor can\'t either', !!r.error, r.error?.message || 'made one');
  r = await K.rpc('make_newtree_code');
  const code = r.data?.code, days = (new Date(r.data?.expires_at) - Date.now()) / 864e5;
  check('a keeper makes one: 12 characters, 14 days', !r.error && /^[0-9a-f]{12}$/.test(code || '') && days > 13.9 && days <= 14.01, r.error?.message || JSON.stringify(r.data));
  check('…recorded: which tree, which keeper', sql(`select (tree_id='${tree}')||'/'||(created_by='${K.uid}') from newtree_code where code='${code}'`).trim() === 'true/true');
  r = await K.from('newtree_code').select('code');
  check('nobody reads the codes through the API', !!r.error || r.data.length === 0, r.error?.message || 'rows=' + r.data.length);
  r = await ct(F1, ' ' + code.toUpperCase() + ' ');
  const t1 = r.data, nucF1 = await nucOf(F1);
  check('the friend starts their own tree with it (spaces/capitals don\'t matter), as its keeper', !r.error && !!t1 && t1 !== tree && isSuper(F1), r.error?.message);
  check('…the code is used up, and says which tree it made', sql(`select (used_by='${F1.uid}')||'/'||(new_tree='${t1}') from newtree_code where code='${code}'`).trim() === 'true/true');
  r = await ct(F2, code);
  check('a code works once', !!r.error && !(await nucOf(F2)), r.error?.message || 'made a tree');
  const c2 = (await K.rpc('make_newtree_code')).data?.code;
  await F1.from('account').delete().eq('user_id', F1.uid);
  r = await ct(F1, c2);
  check('one tree per login: leaving it and trying again is refused', !!r.error && /one per login/.test(r.error.message), r.error?.message || 'made a tree');
  sql(`insert into account (user_id, nucleus_id) values ('${F1.uid}', '${nucF1}')`);
  r = await ct(M, c2);
  check('a login already in a tree can\'t start another', !!r.error && /already has a place/.test(r.error.message), r.error?.message || 'made a tree');
  sql(`update newtree_code set expires_at = now() - interval '1 second' where code='${c2}'`);
  r = await ct(F2, c2);
  check('a code past its 14 days is refused', !!r.error && !(await nucOf(F2)), r.error?.message || 'made a tree');
  const more = [];
  for (let i = 0; i < 6; i++) more.push(await K.rpc('make_newtree_code'));
  check('at most 5 codes waiting per tree', more.slice(0, 5).every(x => !x.error) && !!more[5].error && /5 start-a-tree links/.test(more[5].error.message), more.map(x => x.error?.message || 'ok').join(' · '));
  // at most 5,000 people per tree (removed ones count too)
  const pF3 = randomUUID();
  r = await newTree(F3, '', 'Big');
  const big = r.data;
  sql(`insert into person (tree_id, full_name) select '${big}', 'Bulk ' || g from generate_series(1, 4998) g`);
  r = await F3.from('person').insert({ id: pF3, tree_id: big, full_name: 'Number 4999', claimed_by: await nucOf(F3) }).select('id');
  check('a tree can grow to 5,000 people', !r.error, r.error?.message);
  r = await F3.from('person').insert([{ tree_id: big, full_name: 'Number 5000' }, { tree_id: big, full_name: 'Number 5001' }]).select('id');
  check('…but not past it — the whole insert is refused', !!r.error && /5,000 people/.test(r.error.message)
    && sql(`select count(*) from person where tree_id='${big}'`).trim() === '4999', r.error?.message || 'added');
  r = await F3.from('person').insert({ tree_id: big, full_name: 'Number 5000' }).select('id');
  check('…one more fits exactly', !r.error && sql(`select count(*) from person where tree_id='${big}'`).trim() === '5000', r.error?.message);
  r = await F3.from('person').insert({ tree_id: big, full_name: 'Number 5001' }).select('id');
  check('…and the next is refused', !!r.error, r.error?.message || 'added');
  r = await O.rpc('make_newtree_code');
  check('a login with no tree can\'t make a code', !!r.error, r.error?.message || 'made one');
}

section = '[decline] ';
{
  // "not me" on the "Is this you?" page cancels a personal invite; the keeper sees it
  const K = await user('dk'), J = await user('dj');
  r = await newTree(K, 'K house', 'K tree');
  const tree = r.data, pA2 = randomUUID(), pB2 = randomUUID(), pC2 = randomUUID();
  await K.from('person').insert([{ id: pA2, tree_id: tree, full_name: 'Ana Test' }, { id: pB2, tree_id: tree, full_name: 'Bo Test' },
    { id: pC2, tree_id: tree, full_name: 'Cy Test' }]);
  const link = (await K.from('tree_invite').insert({ tree_id: tree, person_id: pA2, invite_name: 'Ana' }).select('code').single()).data.code;
  const gen = (await K.from('tree_invite').insert({ tree_id: tree }).select('code').single()).data.code;
  const decl = code => sql(`select (declined_at is not null)||'/'||(expires_at <= now()) from tree_invite where code='${code}'`).trim();
  r = await anon.rpc('decline_invite', { invite_code: gen });
  check('a general code can\'t be declined (it isn\'t for one person)', !r.error && r.data === false && decl(gen) === 'false/false', r.error?.message || decl(gen));
  r = await anon.rpc('decline_invite', { invite_code: 'nope' });
  check('an unknown code: nothing happens', !r.error && r.data === false, r.error?.message);
  r = await anon.rpc('decline_invite', { invite_code: link });
  check('"not me", signed out, cancels a personal link at once', !r.error && r.data === true && decl(link) === 'true/true', r.error?.message || decl(link));
  r = await anon.rpc('open_invite', { invite_code: link });
  check('…it opens nothing any more', !r.error && r.data === null, JSON.stringify(r.data));
  r = await J.rpc('join_with_invite', { invite_code: link, nucleus_label: '', tree_nm: '' });
  check('…and nobody can join with it', !!r.error && /invalid or expired/.test(r.error.message) && !(await nucOf(J)), r.error?.message || 'joined');
  r = await K.from('tree_invite').select('declined_at').eq('code', link);
  check('the keeper can see it was declined', !r.error && !!r.data[0]?.declined_at, r.error?.message);
  r = await K.from('tree_invite').delete().eq('code', link).select('code');
  check('…and it stays on record (a declined invite can\'t be deleted)', !r.error && r.data.length === 0, r.error?.message || 'deleted');
  r = await anon.rpc('decline_invite', { invite_code: link });
  check('declining twice does nothing more', !r.error && r.data === false);
  const qr = (await K.rpc('make_qr_invite', { p: pB2, invite_nm: 'Bo' })).data.code;
  await anon.rpc('open_invite', { invite_code: qr });
  r = await anon.rpc('decline_invite', { invite_code: qr });
  const r2 = await K.from('tree_invite').select('opened_at,declined_at').eq('code', qr);
  check('a scanned QR code: "not me" cancels it, and the keeper\'s screen (which reads the row) sees it', r.data === true && !!r2.data?.[0]?.declined_at, JSON.stringify(r2.data));
  r = await K.rpc('make_qr_invite', { p: pB2, invite_nm: 'Bo' });
  check('…the keeper can then make a fresh code for the right person', !r.error && !!r.data?.code, r.error?.message);
  const used = (await K.from('tree_invite').insert({ tree_id: tree, person_id: pC2 }).select('code').single()).data.code;
  await J.rpc('join_with_invite', { invite_code: used, nucleus_label: '', tree_nm: '' });
  r = await anon.rpc('decline_invite', { invite_code: used });
  check('a used invite can\'t be declined afterwards', !r.error && r.data === false && sql(`select declined_at is null from tree_invite where code='${used}'`).trim() === 't');
}

section = '[memorial] ';
{
  // nobody is invited to take the place of someone with a memorial
  const K = await user('mk'), J = await user('mj');
  r = await newTree(K, 'K house', 'K tree');
  const tree = r.data, pOld = randomUUID(), pLate = randomUUID();
  await K.from('person').insert([{ id: pOld, tree_id: tree, full_name: 'Tok Test' }, { id: pLate, tree_id: tree, full_name: 'Nek Test' }]);
  await K.from('memorial').upsert({ person_id: pOld, tree_id: tree, passed_on: '2001', style_id: 'gen1' });
  r = await K.rpc('make_qr_invite', { p: pOld, invite_nm: 'Tok' });
  check('no QR code for someone with a memorial', !!r.error && /memorial/.test(r.error.message), r.error?.message || 'made one');
  r = await K.from('tree_invite').insert({ tree_id: tree, person_id: pOld }).select('code');
  check('no 14-day link for them either', !!r.error, r.error?.message || 'made one');
  const ln = (await K.from('tree_invite').insert({ tree_id: tree, person_id: pLate }).select('code').single()).data.code;
  await K.from('memorial').upsert({ person_id: pLate, tree_id: tree, passed_on: '2026', style_id: 'gen1' });
  r = await anon.rpc('open_invite', { invite_code: ln });
  check('a link made before a memorial was added opens nothing', !r.error && r.data === null, JSON.stringify(r.data));
  r = await J.rpc('join_with_invite', { invite_code: ln, nucleus_label: '', tree_nm: '' });
  check('…and can\'t be used to join', !!r.error && sql(`select claimed_by is null from person where id='${pLate}'`).trim() === 't', r.error?.message || 'joined');
  r = await K.from('tree_invite').insert({ tree_id: tree, person_id: pOld, used_at: new Date().toISOString() }).select('code');
  check('the rule can\'t be dodged by sending extra fields', !!r.error, r.error?.message || 'made one');
}

section = '[kept] ';
{
  // used invites are kept and marked; keepers get counts only
  const K = await user('kk'), M = await user('km'), J1 = await user('kj1'), J2 = await user('kj2'), J3 = await user('kj3'), Y = await user('ky');
  r = await newTree(K, 'K house', 'K tree');
  await newTree(Y, 'Y house', 'Y tree');
  const tree = r.data, pM = randomUUID(), p1 = randomUUID(), pQ = randomUUID();
  await K.from('person').insert([{ id: pM, tree_id: tree, full_name: 'Member Test' }, { id: p1, tree_id: tree, full_name: 'One Test' },
    { id: pQ, tree_id: tree, full_name: 'Qr Test' }]);
  const fake = await K.from('tree_invite').insert({ tree_id: tree, person_id: pM, channel: 'qr', uses: 7, used_at: '2020-01-01', created_at: '2000-01-01', declined_at: null })
    .select('code,channel,uses,used_at,created_at').single();
  check('a keeper writing a link can\'t pick its channel, backdate it or make it look used', !fake.error && fake.data.channel === 'link'
    && fake.data.uses === 0 && fake.data.used_at === null && new Date(fake.data.created_at) > Date.now() - 60000, fake.error?.message || JSON.stringify(fake.data));
  await M.rpc('join_with_invite', { invite_code: fake.data.code, nucleus_label: '', tree_nm: '' });
  const nucM = await nucOf(M);
  check('a used personal link is kept: when, which household, once, channel link',
    sql(`select (used_at is not null)||'/'||(used_by='${nucM}')||'/'||uses||'/'||channel from tree_invite where code='${fake.data.code}'`).trim() === 'true/true/1/link');
  r = await K.from('tree_invite').delete().eq('code', fake.data.code).select('code');
  check('…and the keeper can\'t delete the record', !r.error && r.data.length === 0, r.error?.message);
  const gen = (await K.from('tree_invite').insert({ tree_id: tree }).select('code').single()).data.code;
  await J1.rpc('join_with_invite', { invite_code: gen, nucleus_label: '', tree_nm: '' });
  await J2.rpc('join_with_invite', { invite_code: gen, nucleus_label: '', tree_nm: '' });
  check('a general code counts each household that joined with it, and keeps working',
    sql(`select uses||'/'||channel||'/'||(used_by='${await nucOf(J2)}')||'/'||(expires_at > now()) from tree_invite where code='${gen}'`).trim() === '2/code/true/true');
  r = await K.from('tree_invite').delete().eq('code', gen).select('code');
  check('…once used it can\'t be deleted', !r.error && r.data.length === 0);
  r = await M.rpc('stop_invite', { invite_code: gen });
  check('…a member can\'t stop it', !!r.error, r.error?.message || 'stopped');
  r = await Y.rpc('stop_invite', { invite_code: gen });
  check('…a stranger with their own tree can\'t either', !!r.error || r.data === false, r.error?.message || JSON.stringify(r.data));
  r = await K.rpc('stop_invite', { invite_code: gen });
  check('…a keeper stops it: it stays on record', !r.error && r.data === true && sql(`select uses||'/'||(expires_at <= now()) from tree_invite where code='${gen}'`).trim() === '2/true', r.error?.message);
  r = await J3.rpc('join_with_invite', { invite_code: gen, nucleus_label: '', tree_nm: '' });
  check('…after which nobody joins with it', !!r.error && /invalid or expired/.test(r.error.message), r.error?.message || 'joined');
  const qr = (await K.rpc('make_qr_invite', { p: pQ, invite_nm: 'Qr' })).data.code;
  await anon.rpc('open_invite', { invite_code: qr });
  const ln1 = (await K.from('tree_invite').insert({ tree_id: tree, person_id: p1 }).select('code').single()).data.code;
  await anon.rpc('open_invite', { invite_code: ln1 });
  await anon.rpc('decline_invite', { invite_code: ln1 });
  r = await K.from('invite_funnel').select('*').order('channel');
  const f = Object.fromEntries((r.data || []).map(x => [x.channel, `${x.made}/${x.opened}/${x.used}/${x.joins}/${x.declined}/${x.live}`]));
  check('keepers see counts per channel: made/opened/used/joins/declined/live', !r.error
    && f.code === '1/0/1/2/0/0' && f.link === '2/1/1/1/1/0' && f.qr === '1/1/0/0/0/1', r.error?.message || JSON.stringify(f));
  check('…counts only: no codes, names or people', Object.keys(r.data?.[0] || {}).sort().join(',') === 'channel,declined,joins,live,made,opened,used');
  r = await M.from('invite_funnel').select('*');
  check('a member sees no counts', !r.error && r.data.length === 0, r.error?.message || JSON.stringify(r.data));
  r = await Y.from('invite_funnel').select('*');
  check('another tree\'s keeper sees only their own (none)', !r.error && r.data.length === 0, r.error?.message || JSON.stringify(r.data));
  r = await anon.from('invite_funnel').select('*');
  check('a signed-out visitor sees nothing', !!r.error || r.data.length === 0, r.error?.message || 'rows=' + r.data.length);
  r = await K.rpc('remove_person', { p: pM });
  check('removing someone keeps the invite they joined with', !r.error && sql(`select count(*) from tree_invite where code='${fake.data.code}'`).trim() === '1', r.error?.message);
}

/* ============ 7b. the name on the tree (2026-10-25): short_name ============ */
section = '[treename] ';
{
  const sn = id => sql(`select coalesce(short_name, '<none>') from person where id='${id}'`).trim();
  const x5 = chain[4]; // 5 branches from B, nobody's claim
  r = await B.from('person').update({ short_name: 'Mei Ling' }).eq('id', x5).select('id');
  check('a member sets the name on the tree for someone within 5 branches', !r.error && r.data.length === 1 && sn(x5) === 'Mei Ling', r.error?.message || sn(x5));
  r = await B.from('person').update({ short_name: 'Mei Ling' }).eq('id', pB).select('id');
  check('…and for someone their own household claimed', !r.error && r.data.length === 1 && sn(pB) === 'Mei Ling', r.error?.message || sn(pB));
  r = await B.from('person').update({ short_name: 'Far Name' }).eq('id', pFar).select('id');
  check('a member CAN\'T set it for someone 6 branches away', !r.error && r.data.length === 0 && sn(pFar) === '<none>', r.error?.message || sn(pFar));
  r = await B.from('person').update({ short_name: 'Not Mine' }).eq('id', pA).select('id');
  check('a member CAN\'T set it for someone another household claimed', !r.error && r.data.length === 0 && sn(pA) === '<none>', r.error?.message || sn(pA));
  r = await A.from('person').update({ short_name: 'Far Name' }).eq('id', pFar).select('id');
  check('a tree keeper (super) can, at any distance', !r.error && r.data.length === 1 && sn(pFar) === 'Far Name', r.error?.message || sn(pFar));
  r = await C.from('person').update({ short_name: 'Other Tree' }).eq('id', x5).select('id');
  check('someone from another tree can\'t', !r.error && r.data.length === 0 && sn(x5) === 'Mei Ling', r.error?.message || sn(x5));
  r = await anon.from('person').update({ short_name: 'Signed Out' }).eq('id', x5).select('id');
  check('a signed-out visitor can\'t', (!!r.error || r.data.length === 0) && sn(x5) === 'Mei Ling', r.error?.message || sn(x5));
  r = await C.from('person').select('short_name').eq('id', x5);
  check('another tree reads nothing', !r.error && r.data.length === 0, r.error?.message || 'rows=' + r.data.length);
  r = await anon.from('person').select('short_name').limit(1);
  check('signed-out visitors read nothing', !!r.error || r.data.length === 0, r.error?.message || 'rows=' + r.data.length);
  // the old app (a phone still on the page from before) never sends it: a save leaves it as it was
  r = await B.from('person').update({ full_name: 'Mei Ling Test', born: '1990' }).eq('id', x5).select('id');
  check('a save without it (the old app) keeps it', !r.error && r.data.length === 1 && sn(x5) === 'Mei Ling', r.error?.message || sn(x5));
  for (const [v, ok] of [['', false], [' Mei Ling', false], ['Mei Ling ', false], ['x'.repeat(41), false], ['x'.repeat(40), true], [null, true]]) {
    r = await B.from('person').update({ short_name: v }).eq('id', x5).select('id');
    check(`short_name ${v === null ? 'null (not set)' : JSON.stringify(v.length > 12 ? v.length + ' characters' : v)} → ${ok ? 'saved' : 'refused'}`,
      ok ? !r.error && r.data.length === 1 : !!r.error, r.error?.message || 'rows=' + r.data?.length);
  }
  check('…null clears it', sn(x5) === '<none>', sn(x5));
  const pAdd = randomUUID();
  r = await B.from('person').insert({ id: pAdd, tree_id: treeA, full_name: 'Nur Aina Test', short_name: 'Nur Aina' }).select('id');
  check('Add relative can send it with the new person', !r.error && sn(pAdd) === 'Nur Aina', r.error?.message || sn(pAdd));
  // a household is named after its first member's name on the tree; their own "You go by" still wins
  const goes = id => sql(`select coalesce(goes_by('${id}'), '<none>')`).trim();
  const pPlain = randomUUID();
  await B.from('person').insert({ id: pPlain, tree_id: treeA, full_name: 'Siti Nur Test' });
  check('the database\'s "goes by": the first word when nothing is set ("Siti")', goes(pPlain) === 'Siti', goes(pPlain));
  check('…the name on the tree when it is ("Nur Aina")', goes(pAdd) === 'Nur Aina', goes(pAdd));
  sql(`insert into nickname (tree_id, person_id, viewer_person_id, text, private) values ('${treeA}', '${pAdd}', '${pAdd}', 'Kak Aina', false)`);
  check('…their own "You go by" before both ("Kak Aina")', goes(pAdd) === 'Kak Aina', goes(pAdd));
  const K = await user('tk');
  r = await newTree(K, '', 'Keluarga Test');
  const tk = r.data, nucK = await nucOf(K), pK = randomUUID();
  const lab = n => sql(`select label||'|'||label_auto from nucleus where id='${n}'`).trim();
  await K.from('person').insert({ id: pK, tree_id: tk, full_name: 'Mei Ling Tan', short_name: 'Mei Ling', claimed_by: nucK });
  check('a founder added as "Mei Ling Tan", on the tree as "Mei Ling": "Mei Ling\'s household"', lab(nucK) === "Mei Ling's household|false", lab(nucK));
  const col = sql(`select data_type||'|'||is_nullable from information_schema.columns where table_schema='public' and table_name='person' and column_name='short_name'`).trim();
  check('person.short_name: text, empty for everyone unless set', col === 'text|YES', col);
}

/* ============ 8. catalog: search_path + who may call what ============ */
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
check('signed-out visitors (anon) can call only decline_invite, invite_preview, open_invite and redeem_reset_code',
  callable('anon') === 'decline_invite,invite_preview,open_invite,redeem_reset_code', callable('anon'));
const WANT = 'branch_distance,claim_person,create_tree,decline_invite,in_tree,invite_preview,is_super_user,issue_reset_code,join_with_invite,make_newtree_code,make_qr_invite,my_nucleus,my_password_resets,open_invite,redeem_reset_code,release_claim,remove_person,set_super,stop_invite';
check('signed-in users can call only what the app and the row rules need', callable('authenticated') === WANT, callable('authenticated'));
const pub = rows(`select proname from pg_proc where pronamespace='public'::regnamespace
  and exists (select 1 from aclexplode(coalesce(proacl, acldefault('f', proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE')`);
check('no function is open to PUBLIC', pub.length === 0, pub.join(', '));
for (const [fn, args] of [['create_tree', { nucleus_label: 'x', tree_nm: 'x', start_code: startCode() }], ['claim_person', { p: pA }], ['set_super', { target: nucA, flag: true }],
  ['join_with_invite', { invite_code: codeGeneral, nucleus_label: 'x', tree_nm: 'x' }], ['my_tree', {}], ['branch_distance', { p: pA }],
  ['issue_reset_code', { p: pA }], ['make_qr_invite', { p: pKid, invite_nm: 'x' }], ['make_newtree_code', {}], ['stop_invite', { invite_code: codeGeneral }],
  ['my_password_resets', {}], ['goes_by', { p: pA }]]) {
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
check('person triggers: 5,000-people cap per statement; name_unknown mark, household naming + stamp per row',
  ptrg === 'person_cap:statement,person_name_unknown:row,person_names_household:row,person_stamp:row', ptrg);
const internal = rows(`select proname from pg_proc p where pronamespace='public'::regnamespace and proname in
  ('mark_name_unknown','goes_by','name_household','household_names','invite_stamp','cap_people')
  and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))`);
check('trigger and helper functions are internal (nobody can call them directly)', internal.length === 0, internal.join(', '));
for (const tbl of ['newtree_code', 'password_reset_guard']) {
  const g = rows(`select grantee||':'||privilege_type from information_schema.role_table_grants where table_schema='public' and table_name='${tbl}' and grantee in ('anon','authenticated')`);
  check(`${tbl}: no API access at all`, g.length === 0, g.join(', '));
}
const fg = rows(`select grantee||':'||privilege_type from information_schema.role_table_grants where table_schema='public' and table_name='invite_funnel' and grantee in ('anon','authenticated') order by 1`).join(',');
check('invite_funnel: signed-in users may only read it (and it reads as the caller)', fg === 'authenticated:SELECT'
  && sql(`select coalesce(array_to_string(reloptions, ','), '') from pg_class where relname='invite_funnel'`).trim() === 'security_invoker=true', fg);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

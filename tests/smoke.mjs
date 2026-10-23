// Bear Family Tree — headless smoke test of the DEMO mode (no database at all).
// Serves ../app/ on a free local port and drives it in Chrome, on a desktop
// screen (mouse) and a 375px phone screen (touch). Any request to Supabase fails
// the test: the demo must never touch the real family tree.
// usage: node smoke.mjs        (needs Google Chrome installed; exit code 1 on failure)
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import jsQR from 'jsqr';

const APP = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'app');
const server = createServer(async (req, res) => {
  try { const f = path.join(APP, decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/\/$/, '/index.html'));
    if (!f.startsWith(APP)) throw new Error('outside app/');
    res.writeHead(200, { 'content-type': f.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream' });
    res.end(await readFile(f)); }
  catch { res.writeHead(404); res.end(); } });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`); };
const browser = await chromium.launch({ channel: 'chrome', headless: true });
// a step that can't even run (a button gone, a page crash) is a failure too, not a stack trace
const guard = async (label, fn) => { try { await fn(); } catch (e) { check(`${label}: ran to the end`, false, String(e.message).split('\n')[0]); } };

async function demo(label, opts) {
  const ctx = await browser.newContext(opts), page = await ctx.newPage();
  const errors = [], supabase = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.route(/supabase\.co/, r => { supabase.push(r.request().url()); r.abort(); });
  await page.goto(BASE);
  await page.click('#au_demo');
  await page.click('.choice:has-text("Aizat & Sarah")');
  await page.click('.choice:has-text("Aizat Taha")');
  for (const b of ['Next', 'Next', "Let's go"]) await page.click(`#sheet.open button:has-text("${b}")`);
  await page.waitForFunction(() => !document.getElementById('sheet').classList.contains('open'));
  const nodes = await page.locator('.node').count();
  check(`${label}: demo tree draws`, nodes >= 8, `${nodes} people on screen`);
  return { ctx, page, errors, supabase };
}
// the sheet slides in on the next animation frame: give it a moment either way
const sheetOpen = page => page.waitForFunction(() => document.getElementById('sheet').classList.contains('open'), null, { timeout: 1500 })
  .then(() => true, () => false);
const closeSheet = async page => { await page.waitForTimeout(500); await page.mouse.click(5, 5); // the scrim
  await page.waitForFunction(() => !document.getElementById('sheet').classList.contains('open')); };

// ---------- desktop: mouse ----------
await guard('desktop', async () => {
  const { ctx, page, errors, supabase } = await demo('desktop', { viewport: { width: 1280, height: 800 } });
  const sarah = page.locator('.node[data-pid="sarah"] .avatar');
  await sarah.click();
  check('desktop: one click selects (shows ＋) and does not open the card',
    await page.locator('.node[data-pid="sarah"].selected').count() === 1 && !(await page.waitForTimeout(400), await sheetOpen(page)));
  await sarah.dblclick();
  check('desktop: double-click opens the card', await sheetOpen(page) && await page.locator('#sheetbody h3', { hasText: 'Sarah Rahim' }).count() === 1);
  // Add relative: nothing chosen until the person chooses
  await page.click('#sheetbody button:has-text("Add relative")');
  check('add relative: no relationship pre-selected', await page.locator('.choice[aria-pressed="true"]').count() === 0);
  await page.fill('#a_name', 'Smoke Test Child');
  const before = await page.evaluate(() => Object.keys(S.persons).length);
  await page.click('#a_save');
  check('add relative: Save without a choice adds nobody and says why',
    await page.evaluate(() => Object.keys(S.persons).length) === before && /choose how they're connected/.test(await page.textContent('#toast')));
  await page.click('.choice[data-rel="child"]');
  await page.click('#a_save');
  const kid = await page.evaluate(() => { const p = Object.values(S.persons).find(x => x.name === 'Smoke Test Child'); return p && parentsOf(p.id).sort().join(','); });
  check('add relative: child of Sarah saves with both parents', kid === 'aizat,sarah', String(kid));
  // Help
  await page.click('#helpBtn');
  const href = await page.getAttribute('#sheetbody a[href^="https://wa.me/"]', 'href');
  check('help: 5 questions', await page.locator('#sheetbody .faq').count() === 5);
  const forgotFaq = await page.textContent('#sheetbody .faq:first-of-type p');
  check('help: "I forgot my password" points to a keeper\'s reset code, not an email', /reset code/.test(forgotFaq) && !/by email|check spam/i.test(forgotFaq), forgotFaq);
  check('help: WhatsApp link pre-fills a message and has no phone number', /^https:\/\/wa\.me\/\?text=/.test(href || '') && !/\d{6,}/.test(decodeURIComponent(href || '')), href);
  await closeSheet(page);
  // a new card starts at the top, even after the last one was scrolled
  await sarah.dblclick(); await page.evaluate(() => { document.getElementById('sheet').scrollTop = 400; });
  await closeSheet(page);
  await page.locator('.node[data-pid="alya"] .avatar').dblclick();
  check('a new card opens at the top (UX-08)', await page.evaluate(() => document.getElementById('sheet').scrollTop) === 0);
  await closeSheet(page);
  // back to my view clears the focus bar
  await page.click('.xchip:has-text("side")');
  const shown = await page.isVisible('#focusbar');
  await page.click('#showall');
  check('back to my view hides the "focused" bar (UX-09)', shown && !(await page.isVisible('#focusbar')));
  // remove from tree (demo only — nothing leaves the browser)
  page.on('dialog', d => d.accept());
  await page.evaluate(() => { revealPath(Object.values(S.persons).find(x => x.name === 'Smoke Test Child').id); });
  await page.evaluate(() => openPerson(Object.values(S.persons).find(x => x.name === 'Smoke Test Child').id));
  await page.click('#sheetbody button:has-text("from the tree")');
  check('remove from tree: person and links gone', await page.evaluate(() => !Object.values(S.persons).some(x => x.name === 'Smoke Test Child')
    && S.rels.every(r => S.persons[r.a] && S.persons[r.b])));
  // look and feel
  check('grey text token is #55657D', (await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ink-soft'))).trim() === '#55657D');
  check('page zoom is not locked', !/user-scalable=no|maximum-scale/.test(await page.getAttribute('meta[name=viewport]', 'content')));
  check('toast is announced', await page.getAttribute('#toast', 'role') === 'status' && await page.getAttribute('#toast', 'aria-live') === 'polite');
  check('desktop: no errors in the page', errors.length === 0, errors.join(' | '));
  check('desktop: the demo never contacted Supabase', supabase.length === 0, supabase.join(' | '));
  await ctx.close();
});

// ---------- phone: touch, 375px ----------
await guard('phone', async () => {
  const { ctx, page, errors, supabase } = await demo('phone', { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  check('phone: touch wording in the hint', /tap a person/.test(await page.textContent('#navhint')));
  await page.locator('.node[data-pid="alya"] .avatar').tap();
  check('phone: one tap opens the card', await sheetOpen(page) && await page.locator('#sheetbody h3', { hasText: 'Alya Aizat' }).count() === 1);
  // an iPhone zooms the page in on any visible text box under 16px — none allowed
  const small = await page.evaluate(() => [...document.querySelectorAll('input,select,textarea')]
    .filter(el => !['checkbox', 'radio', 'file'].includes(el.type) && el.offsetParent !== null && parseFloat(getComputedStyle(el).fontSize) < 16)
    .map(el => `${el.id || el.tagName.toLowerCase()} ${getComputedStyle(el).fontSize}`));
  check('phone: every text box (search + card fields) is ≥ 16px, so iPhone never zooms in', small.length === 0, small.join(', '));
  check('phone: fit-to-screen after search is wired up', await page.evaluate(() => typeof fitToScreen === 'function'));
  await page.evaluate(() => toast("not saved — the family tree didn't accept that change (it may be outside what you can edit). Your screen has been put back.", 7000));
  const box = await page.locator('#toast').boundingBox();
  check('phone: a long message wraps and fits the screen', box && box.width <= 375 && box.height > 50, box && `${Math.round(box.width)}×${Math.round(box.height)}`);
  await closeSheet(page);
  const fab = await page.locator('.node[data-pid="alya"] .addfab').boundingBox();
  check('phone: the ＋ stays on the person after the card closes, ≥ 32px', fab && fab.width >= 31, fab && `${Math.round(fab.width)}px`);
  check('phone: no errors in the page', errors.length === 0, errors.join(' | '));
  check('phone: the demo never contacted Supabase', supabase.length === 0, supabase.join(' | '));
  await ctx.close();
});

// ---------- sign-in screen: no emails — a keeper's one-time reset code ----------
for (const [label, opts] of [['desktop', { viewport: { width: 1280, height: 800 } }],
  ['phone', { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }]]) {
  await guard(`forgot (${label})`, async () => {
    const ctx = await browser.newContext(opts), page = await ctx.newPage(), errors = [], supabase = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route(/supabase\.co/, r => { supabase.push(r.request().url()); r.abort(); });
    await page.goto(BASE);
    check(`forgot (${label}): sign-in offers "ask a family keeper for a reset code"`, /Ask a family keeper for a reset code/.test(await page.textContent('#au_forgot')));
    await page.click('#au_forgot');
    check(`forgot (${label}): email + code + new password, and nothing about emails`,
      await page.locator('#fp_email').count() === 1 && await page.locator('#fp_code').count() === 1 && await page.locator('#fp_pass').count() === 1
      && !/reset link|we'll send|check spam|emailed/i.test(await page.textContent('#login')));
    const wa = await page.getAttribute('#login a[href^="https://wa.me/"]', 'href');
    check(`forgot (${label}): "ask the family" WhatsApp link has no phone number`, /^https:\/\/wa\.me\/\?text=.*reset%20code/.test(wa || '') && !/\d{6,}/.test(decodeURIComponent(wa || '')), wa);
    if (label === 'phone') {
      const small = await page.evaluate(() => [...document.querySelectorAll('#login input')].filter(el => parseFloat(getComputedStyle(el).fontSize) < 16).map(el => el.id));
      check('forgot (phone): its text boxes are ≥ 16px, so iPhone never zooms in', small.length === 0, small.join(', '));
    }
    await page.fill('#fp_email', 'someone@example.com'); await page.fill('#fp_code', 'ABCD-EFGH'); await page.fill('#fp_pass', 'abc');
    await page.click('#fp_form button[type=submit]');
    check(`forgot (${label}): a password under 6 characters is caught before anything is sent`,
      /at least 6 characters/.test(await page.textContent('#fp_msg')) && supabase.length === 0, supabase.join(' | '));
    check(`forgot (${label}): no errors in the page`, errors.length === 0, errors.join(' | '));
    await ctx.close();
  });
}

// ---------- "?" placeholders: Pak Long's wife, name not known yet (demo seed) ----------
for (const [label, opts] of [['desktop', { viewport: { width: 1280, height: 800 } }],
  ['phone', { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }]]) {
  await guard(`placeholder (${label})`, async () => {
    const L = `placeholder (${label})`, phone = label === 'phone';
    const { ctx, page, errors, supabase } = await demo(L, opts);
    const tap = loc => phone ? loc.tap() : loc.click();
    const open = loc => phone ? loc.tap() : loc.dblclick();
    page.on('dialog', d => d.accept());
    // search finds her by the label, never by "?"
    await page.click('#search'); await page.keyboard.type('Long');
    const hit = page.locator('#results button', { hasText: "Pak Long's wife" });
    check(`${L}: search "Long" finds "Pak Long's wife · name not known yet"`, await hit.count() === 1
      && (await hit.locator('.rf').textContent()) === 'name not known yet' && await hit.locator('.rn.unknownname').count() === 1);
    if (phone) {
      const box = await page.locator('#results').boundingBox();
      check(`${L}: the results list fits the screen`, box && box.x >= 0 && box.x + box.width <= 375
        && await page.evaluate(() => { const r = document.getElementById('results'); return r.scrollWidth <= r.clientWidth; }), box && `${Math.round(box.x)}–${Math.round(box.x + box.width)}`);
    }
    await page.fill('#search', '?');
    check(`${L}: search "?" doesn't treat anyone as a person called "?"`, await page.locator('#results button').count() === 0);
    await page.fill('#search', 'Long');
    await tap(page.locator('#results button', { hasText: "Pak Long's wife" }));
    check(`${L}: her card asks whoever can edit for the name`, await sheetOpen(page)
      && (await page.textContent('#sheetbody h3')).replace(/\s+/g, ' ').trim() === 'Name not known yet — add their name'
      && /Pak Long's wife/.test(await page.textContent('#sheetbody .profile')));
    await tap(page.locator('#addname'));
    check(`${L}: "add their name" puts the cursor in the name box`, await page.evaluate(() => document.activeElement.id) === 'f_name');
    await closeSheet(page);
    // on the tree: the label, as a dashed gap — not the memorial grey, not the faded ex
    const look = await page.evaluate(() => { const n = document.querySelector('.node[data-pid="maklong"]'), a = n.querySelector('.avatar'),
      d = document.querySelector('.node[data-pid="tokwan"] .avatar'), s = getComputedStyle(a);
      return { cls: n.className, nick: n.querySelector('.nick').textContent, full: n.querySelector('.full').textContent, face: a.textContent.trim(),
        border: s.borderTopStyle, filter: s.filter, opacity: getComputedStyle(n).opacity, italic: getComputedStyle(n.querySelector('.nick')).fontStyle,
        deadBorder: d && getComputedStyle(d).borderTopStyle, deadFilter: d && getComputedStyle(d).filter }; });
    check(`${L}: the tree shows "Pak Long's wife · name not known yet", not "?"`, look.nick === "Pak Long's wife" && look.full === 'name not known yet', `${look.nick} / ${look.full}`);
    check(`${L}: drawn as a dashed "?" gap, unlike a memorial (grey) or a married-in ex (faded)`,
      / unknown/.test(look.cls) && !/passed|exdim/.test(look.cls) && look.face === '?' && look.border === 'dashed' && look.filter === 'none'
      && look.opacity === '1' && look.italic === 'italic' && look.deadBorder !== 'dashed' && /grayscale/.test(look.deadFilter || ''), JSON.stringify(look));
    // keepers' list: own card → Super settings → Names to fill in
    const ownCard = async () => { await page.click('#homeBtn'); await open(page.locator('.node[data-pid="aizat"] .avatar'));
      await sheetOpen(page); await tap(page.locator('#sheetbody button:has-text("⭐ open")')); };
    await ownCard();
    const row = page.locator('#sheetbody [data-fill="maklong"]');
    check(`${L}: Super settings lists "Names to fill in (1)" — her label and 2 children`,
      /Names to fill in \(1\)/i.test(await page.textContent('#sheetbody')) && /Pak Long's wife/.test(await row.textContent()) && /2 children/.test(await row.textContent()));
    await tap(row);
    check(`${L}: tapping her opens her card with the cursor in the name box`,
      await page.evaluate(() => sheetPid === 'maklong' && document.activeElement.id === 'f_name'));
    await page.keyboard.type('Rosnah Ali');
    await tap(page.locator('#sheetbody button.btn.primary:has-text("Save")'));
    const after = await page.evaluate(() => ({ name: S.persons.maklong.name, ph: isPlaceholder('maklong'),
      cls: document.querySelector('.node[data-pid="maklong"]').className, nick: document.querySelector('.node[data-pid="maklong"] .nick').textContent }));
    check(`${L}: saving a name clears the mark — a normal person again`, after.name === 'Rosnah Ali' && !after.ph && !/unknown/.test(after.cls) && after.nick === 'Rosnah', JSON.stringify(after));
    await page.waitForFunction(() => !document.getElementById('sheet').classList.contains('open'));
    await ownCard();
    check(`${L}: …and the list is down to "Names to fill in (0)"`, /Names to fill in \(0\)/i.test(await page.textContent('#sheetbody')));
    await closeSheet(page);
    // Aizat's way of working still works: typing "?" makes a placeholder again
    await page.evaluate(() => openPerson('maklong')); await sheetOpen(page);
    await page.fill('#f_name', '?');
    await tap(page.locator('#sheetbody button.btn.primary:has-text("Save")'));
    check(`${L}: typing "?" as the name marks them again`, await page.evaluate(() => isPlaceholder('maklong')
      && / unknown/.test(document.querySelector('.node[data-pid="maklong"]').className)));
    if (!phone) {
      // a placeholder's card saved with the name box left empty stays "?" (other details still save)
      await page.waitForFunction(() => !document.getElementById('sheet').classList.contains('open'));
      await page.evaluate(() => openPerson('maklong')); await sheetOpen(page);
      await page.fill('#f_born', '1952');
      await page.click('#sheetbody button.btn.primary:has-text("Save")');
      check(`${L}: an empty name box keeps them "?" and still saves the rest`, await page.evaluate(() => S.persons.maklong.name === '?' && S.persons.maklong.born === '1952'));
      // a dash means the same as "?" (Aizat uses both); a dash inside a real name doesn't
      await page.waitForFunction(() => !document.getElementById('sheet').classList.contains('open'));
      await page.evaluate(() => openPerson('maklong')); await sheetOpen(page);
      await page.fill('#f_name', '-');
      await page.click('#sheetbody button.btn.primary:has-text("Save")');
      check(`${L}: "-" as the name is a placeholder too ("—", "--" as well; not "Ali-Hassan")`, await page.evaluate(() => S.persons.maklong.name === '-'
        && isPlaceholder('maklong') && fullName('maklong') === "Pak Long's wife" && / unknown/.test(document.querySelector('.node[data-pid="maklong"]').className)
        && ['\u2014', ' -- ', '\u2013', '?-'].every(n => UNKNOWN_NAME.test(n)) && !['Ali-Hassan', '-Ali', 'Ali'].some(n => UNKNOWN_NAME.test(n))));
      // someone who can't edit her (Baba, 6 branches away) just sees the label, in their own words
      const other = await page.evaluate(() => { const keep = S.session; S.session = { nucleusId: 'n4', viewingAs: 'baba' };
        openPerson('maklong'); const r = { h3: document.querySelector('#sheetbody h3').textContent, ask: !!document.getElementById('addname') };
        S.session = keep; return r; });
      check(`${L}: someone who can't edit her sees "Zulkifli's wife", no prompt`, other.h3 === "Zulkifli's wife" && !other.ask, JSON.stringify(other));
      await sheetOpen(page); await closeSheet(page);
      // "Who are you?" (sign-up): listed by her label, after everyone with a name
      const who = await page.evaluate(() => { const keep = S.session; S.session = null; renderWhoAreYou();
        const rows = [...document.querySelectorAll('[data-claim]')].map(b => ({ id: b.dataset.claim, t: b.textContent.replace(/\s+/g, ' ').trim() }));
        S.session = keep; enterApp(); return rows; });
      const last = who[who.length - 1] || {};
      check(`${L}: "Who are you?" lists her as "Zulkifli's wife · name not known yet", last — never as "?"`,
        last.id === 'maklong' && /Zulkifli's wife/.test(last.t) && /name not known yet/.test(last.t) && !who.some(r => /^\? \?/.test(r.t)), last.t);
      // adding someone whose name isn't known: leave the name empty — Kak Ina's husband
      await page.waitForTimeout(300);
      if (await page.isVisible('#showall')) await page.click('#showall'); // back to my view: Kak Ina beside me
      await page.waitForTimeout(700);
      await page.locator('.node[data-pid="ina"] .avatar').dblclick(); await sheetOpen(page);
      await page.click('#sheetbody button:has-text("Add relative")');
      await page.selectOption('#a_gender', 'm');
      await page.click('.choice[data-rel="partner"]'); await page.click('#a_save');
      const added = await page.evaluate(() => { const id = partnersOf('ina')[0];
        return { name: id && S.persons[id].name, label: id && fullName(id), toast: document.getElementById('toast').textContent, cls: document.querySelector(`.node[data-pid="${id}"]`)?.className }; });
      check(`${L}: adding with the name left empty saves "Kak Ina's husband", name not known yet`, added.name === '' && added.label === "Kak Ina's husband"
        && /added — Kak Ina's husband/.test(added.toast) && / unknown/.test(added.cls || ''), JSON.stringify(added));
      // clearing a real name on a card asks first, then makes them "name not known yet"
      const asked = []; page.on('dialog', d => asked.push(d.message()));
      await page.waitForFunction(() => !document.getElementById('sheet').classList.contains('open'));
      await page.evaluate(() => openPerson('dina')); await sheetOpen(page);
      await page.fill('#f_name', '');
      await page.click('#sheetbody button.btn.primary:has-text("Save")');
      const cleared = await page.evaluate(() => ({ name: S.persons.dina.name, ph: isPlaceholder('dina'), label: fullName('dina'), sub: subName('dina') }));
      check(`${L}: clearing Dina's name asks first, then she's "Name not known yet · child of …"`,
        asked.some(m => /Clear Dina Zulkifli's name\?/.test(m) && /Name not known yet/.test(m)) && cleared.name === '' && cleared.ph
        && cleared.label === 'Name not known yet' && /^child of Pak Long/.test(cleared.sub), JSON.stringify({ asked, cleared }));
    }
    check(`${L}: no errors in the page`, errors.length === 0, errors.join(' | '));
    check(`${L}: the demo never contacted Supabase`, supabase.length === 0, supabase.join(' | '));
    await ctx.close();
  });
}

// ---------- invite sheets: a QR code to scan, WhatsApp instead of email ----------
// Keepers' sheets are cloud-only, so the page gets made-up database answers here
// (nothing reaches Supabase): the real code runs — drawing, countdown, refresh, polling.
const APP_SRC = await readFile(path.join(APP, 'index.html'), 'utf8');
const LIVE = 'https://aizattaha.github.io/bear-family-tree/';
const noNumber = href => /^https:\/\/wa\.me\/\?text=/.test(href || '') && !/\d{6,}/.test(decodeURIComponent(href || ''));
// read the QR code on screen the way a phone camera would
const readQr = page => page.evaluate(async () => {
  const xml = new XMLSerializer().serializeToString(document.querySelector('#qr_box svg'));
  const img = new Image(); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml); await img.decode();
  const c = document.createElement('canvas'); c.width = c.height = 300; const g = c.getContext('2d'); g.drawImage(img, 0, 0, 300, 300);
  return Array.from(g.getImageData(0, 0, 300, 300).data); }).then(px => jsQR(Uint8ClampedArray.from(px), 300, 300)?.data);
for (const [label, opts] of [['desktop', { viewport: { width: 1280, height: 800 } }],
  ['phone', { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }]]) {
  await guard(`invites (${label})`, async () => {
    const L = `invites (${label})`, phone = label === 'phone';
    const { ctx, page, errors } = await demo(L, opts);
    const calls = [], codes = ['abcdefabcdef', 'fedcbafedcba', 'bbbbccccdddd'];
    let made = 0, invite = () => [{ opened_at: null, expires_at: new Date(Date.now() + 3e5).toISOString() }], claimed = null;
    await page.route(/supabase\.co/, r => { const q = r.request(), u = decodeURIComponent(q.url()); calls.push(`${q.method()} ${u.replace(/^.*\/v1\//, '')}`);
      if (/rpc\/make_qr_invite/.test(u)) return r.fulfill({ json: { code: codes[made++ % 3], expires_at: new Date(Date.now() + 3e5).toISOString(), seconds: 300 } });
      if (/tree_invite/.test(u) && q.method() === 'GET' && /select=opened_at/.test(u)) return r.fulfill({ json: invite() });
      if (/tree_invite/.test(u) && q.method() === 'GET') return r.fulfill({ json: [] });
      if (/tree_invite/.test(u) && q.method() === 'POST') return r.fulfill({ status: 201, json: [{ code: 'linklinklink', expires_at: new Date(Date.now() + 14 * 864e5).toISOString() }] });
      if (/tree_invite/.test(u) && q.method() === 'DELETE') return r.fulfill({ json: [] });
      if (/\/person\?/.test(u)) return r.fulfill({ json: [{ claimed_by: claimed }] });
      r.abort(); });
    const tap = sel => phone ? page.tap(sel) : page.click(sel);
    // the card's button → a QR code for this person, counting down from 5 minutes
    const pid = await page.evaluate(() => Object.keys(S.persons).find(id => !S.persons[id].claimedBy && !isPlaceholder(id)));
    await page.evaluate(p => openPerson(p), pid);
    await sheetOpen(page);
    // what a keeper's card shows (the demo has no keepers): cloud mode just for drawing it
    await page.evaluate(p => { const n = S.session.nucleusId, was = S.nuclei[n].isSuper;
      S.nuclei[n].isSuper = true; ME.nucleusId = n; MODE = 'cloud'; openPerson(p); MODE = 'demo'; ME.nucleusId = null; S.nuclei[n].isSuper = was; }, pid);
    check(`${L}: an unclaimed card has "✉ invite … to claim this profile" for a keeper`, await page.locator('#sheetbody button:has-text("to claim this profile")').count() === 1);
    await page.evaluate(p => invitePerson(p), pid);
    await page.waitForSelector('#qr_box svg', { timeout: 3000 });
    check(`${L}: a QR code is drawn, and reads as the invite link for that code`, await readQr(page) === LIVE + '#invite=abcdefabcdef');
    const t0 = await page.textContent('#qr_state'); await page.waitForTimeout(2100); const t1 = await page.textContent('#qr_state');
    check(`${L}: it says how long it works — "works for 5:00 / 4:59" — and counts down`, /works for (5:00|4:5\d)/.test(t0) && /works for 4:5\d/.test(t1) && t0 !== t1, `${t0} → ${t1}`);
    check(`${L}: …asking the database who opened it, every few seconds`, calls.some(c => /^GET tree_invite\?select=opened_at,expires_at&code=eq\.abcdefabcdef/.test(c)), calls.join(' | '));
    check(`${L}: the refresh button waits until the code has run out`, !(await page.isVisible('#qr_new')));
    if (phone) { const b = await page.locator('#qr_box').boundingBox();
      check('invites (phone): the QR code is big and fits the screen', b && b.width >= 240 && b.x >= 0 && b.x + b.width <= 375, b && `${Math.round(b.width)}px at ${Math.round(b.x)}`); }
    // 5 minutes later (the test moves the clock on): greyed out, refresh
    await page.evaluate(() => { QR.end = Date.now(); });
    await page.waitForSelector('#qr_box.dead', { timeout: 3000 });
    check(`${L}: run out → greyed out, "run out", refresh shows`, /run out/.test(await page.textContent('#qr_state')) && await page.isVisible('#qr_new'));
    await tap('#qr_new');
    await page.waitForFunction(() => document.querySelector('#qr_box svg') && !document.querySelector('#qr_box.dead'), null, { timeout: 3000 });
    check(`${L}: refresh makes a brand-new code (the database deletes the old one)`, made === 2 && await readQr(page) === LIVE + '#invite=fedcbafedcba' && !(await page.isVisible('#qr_new')));
    // they scan it: the keeper's screen says so; then they take their place
    invite = () => [{ opened_at: new Date().toISOString(), expires_at: new Date(Date.now() + 18e5).toISOString() }];
    await page.waitForFunction(() => /scanned/.test(document.getElementById('qr_state').textContent), null, { timeout: 6000 }).catch(() => {});
    check(`${L}: scanned → "✓ scanned — … has until … to finish", greyed so nobody else scans it`, /✓ scanned — .+ has until .+ to finish signing up/.test(await page.textContent('#qr_state'))
      && await page.locator('#qr_box.dead').count() === 1 && await page.isVisible('#qr_cancel'), (await page.textContent('#qr_state')).replace(/\s+/g, ' '));
    invite = () => []; claimed = 'n-someone';
    await page.evaluate(() => qrCheck(QR));
    check(`${L}: used → "🎉 … has taken their place on the tree", and no more link to send`, /🎉 .+ has taken their place on the tree/.test(await page.textContent('#qr_state'))
      && await page.locator('#ln_card').count() === 0);
    // closing the sheet deletes a code nobody scanned
    invite = () => [{ opened_at: null, expires_at: new Date(Date.now() + 3e5).toISOString() }];
    await page.evaluate(p => invitePerson(p), pid); await page.waitForSelector('#qr_box svg', { timeout: 3000 });
    await closeSheet(page); await page.waitForTimeout(300);
    check(`${L}: closing the sheet deletes the unscanned code (never a scanned one)`, calls.some(c => /^DELETE tree_invite\?code=eq\.bbbbccccdddd&opened_at=is\.null/.test(c)), calls.filter(c => /DELETE/.test(c)).join(' | '));
    // 💬 a 14-day link instead
    await page.evaluate(p => invitePerson(p), pid); await page.waitForSelector('#qr_box svg', { timeout: 3000 });
    check(`${L}: the sheet says which is which: QR = with you now; link = 14 days`, /With you now\? Let them scan this/i.test(await page.textContent('#sheetbody'))
      && /Not with you\? Send a link/i.test(await page.textContent('#sheetbody')) && /14 days/.test(await page.textContent('#ln_state')));
    await tap('#ln_make'); await page.waitForSelector('#ln_wa', { timeout: 3000 });
    const lwa = await page.getAttribute('#ln_wa', 'href');
    check(`${L}: link → 💬 WhatsApp with the link in the message, no phone number`, noNumber(lwa) && decodeURIComponent(lwa).includes(LIVE + '#invite=linklinklink')
      && await page.getAttribute('#ln_wa', 'target') === '_blank' && /noopener/.test(await page.getAttribute('#ln_wa', 'rel')), lwa);
    check(`${L}: …plus "copy link", and "works once, until …"`, await page.locator('#ln_copy:has-text("copy link")').count() === 1 && /works once, until/.test(await page.textContent('#ln_state')));
    check(`${L}: no "send by email" / mailto in the invite sheet`, !/mailto:|send by email/i.test(await page.innerHTML('#sheetbody')));
    await closeSheet(page);
    // ⭐ general code and "invite a friend"
    await page.evaluate(() => inviteDialog('abcdefabcdef', new Date(Date.now() + 14 * 864e5))); await sheetOpen(page);
    const gwa = await page.getAttribute('#inv_wa', 'href');
    check(`${L}: general code → 💬 WhatsApp (link + code, no phone number) + copy link`, noNumber(gwa) && decodeURIComponent(gwa).includes(LIVE + '#invite=abcdefabcdef')
      && decodeURIComponent(gwa).includes('invite code: abcdefabcdef') && await page.locator('#inv_copy:has-text("copy link")').count() === 1
      && !/mailto:|send by email/i.test(await page.innerHTML('#sheetbody')), gwa);
    await closeSheet(page);
    await page.evaluate(() => inviteFriend()); await sheetOpen(page);
    const fwa = await page.getAttribute('#fr_wa', 'href');
    check(`${L}: invite a friend → 💬 WhatsApp (#newtree link, no phone number) + copy link`, noNumber(fwa) && decodeURIComponent(fwa).includes(LIVE + '#newtree')
      && await page.locator('#fr_copy:has-text("copy link")').count() === 1 && !/mailto:|send by email/i.test(await page.innerHTML('#sheetbody')), fwa);
    if (phone) { const h = await page.locator('#fr_wa').boundingBox();
      check('invites (phone): the WhatsApp button is a full-size button', h && h.height >= 44, h && `${Math.round(h.height)}px`); }
    await closeSheet(page);
    check(`${L}: no errors in the page`, errors.length === 0, errors.join(' | '));
    await ctx.close();
  });
}
check('no "mailto:" left anywhere in the app', !/mailto:/i.test(APP_SRC));

// ---------- the relative's side: a QR code / link opens the app ----------
await guard('invite landing', async () => {
  for (const [what, answer, want] of [
    ['a QR code', { name: 'Kak Yana', kind: 'qr', expires_at: new Date(Date.now() + 18e5).toISOString(), seconds: 1800 }, /Kak Yana, you're invited.*please finish by .+ you have 30 minutes/s],
    ['a 14-day link', { name: 'Kak Yana', kind: 'link', expires_at: new Date(Date.now() + 9 * 864e5).toISOString(), seconds: 9 * 86400 }, /^Kak Yana, you're invited to join Bear Family Tree! 🐻$/],
    ['a code that ran out', null, /has run out or has already been used — ask the family for a fresh one/]]) {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true }), page = await ctx.newPage(), errors = [], opened = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route(/supabase\.co/, r => { const u = r.request().url();
      if (/rpc\/open_invite/.test(u)) { opened.push(r.request().postData()); return r.fulfill({ json: answer }); }
      r.abort(); });
    await page.goto(BASE + '#invite=abcdefabcdef');
    await page.waitForFunction(() => !/^you're invited/.test(document.getElementById('inv_banner')?.textContent || ''), null, { timeout: 3000 }).catch(() => {});
    const banner = (await page.textContent('#inv_banner')).trim();
    check(`landing (${what}): tells the database it was opened, once`, opened.length === 1 && /"invite_code":"abcdefabcdef"/.test(opened[0] || ''), opened.join(' | '));
    check(`landing (${what}): straight to "create your account", with the right words`, await page.locator('#au_up').count() === 1 && want.test(banner), banner);
    check(`landing (${what}): no errors in the page`, errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
});

await browser.close(); server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

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
  const keepers = (await page.textContent('#help_keepers').catch(() => '')).replace(/\s+/g, ' ');
  check('help: says who the tree keepers are — names and household', /Tree keepers/i.test(keepers) && /Aizat Taha/.test(keepers) && /Aizat & Sarah's household/.test(keepers), keepers);
  check('help: "I forgot my password" needs no email', /no email needed/i.test(forgotFaq), forgotFaq);
  check('help: inviting — to that person only, never to a group; whoever signs up takes the place', /never to a group/.test(await page.textContent('#sheetbody')) && /takes the place straight away/.test(await page.textContent('#sheetbody')));
  check('desktop: the app bar keeps ? 🎓 − + and no ⋯', await page.isVisible('#helpBtn') && await page.isVisible('#tutBtn') && await page.isVisible('#zoomIn') && !(await page.isVisible('#menuBtn')));
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
  const bar = await page.evaluate(() => { const b = document.getElementById('appbar').getBoundingClientRect();
    const shown = [...document.getElementById('appbar').children].filter(e => e.offsetParent !== null).map(e => { const r = e.getBoundingClientRect(); return { id: e.id || e.className, top: Math.round(r.top), right: Math.round(r.right) }; });
    return { h: Math.round(b.height), shown, oneRow: shown.every(x => Math.abs(x.top - shown[0].top) <= 6), fits: shown.every(x => x.right <= 375) }; });
  check('phone: the app bar is ONE row that fits the screen (🐻, search, who, ◎, ⋯)', bar.h <= 64 && bar.oneRow && bar.fits
    && bar.shown.map(x => x.id).join(',') === 'bear,searchwrap,viewingBtn,homeBtn,menuBtn', JSON.stringify(bar));
  await page.tap('#menuBtn');
  const menu = await sheetOpen(page) && await page.textContent('#sheetbody');
  check('phone: ⋯ holds Help, Tutorial, settings and Rename', /Help/.test(menu) && /Tutorial/.test(menu) && /Tree keeper settings/.test(menu) && /Rename your tree/.test(menu), menu);
  await page.tap('#mo_help');
  check('phone: …and Help opens from there, keepers listed above the questions', await page.locator('#sheetbody #help_keepers').count() === 1
    && await page.evaluate(() => { const k = document.getElementById('help_keepers'), f = document.querySelector('#sheetbody .faq'); return !!k && !!f && k.getBoundingClientRect().top < f.getBoundingClientRect().top; }));
  const wa = await page.locator('#sheetbody a[href^="https://wa.me/"]').boundingBox();
  check('phone: the WhatsApp button in Help is on the first screen', wa && wa.y + wa.height <= 812, wa && `${Math.round(wa.y)}px`);
  await closeSheet(page);
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
    check(`forgot (${label}): sign-in offers "ask a tree keeper for a reset code"`, /Ask a tree keeper for a reset code/.test(await page.textContent('#au_forgot')));
    await page.click('#au_forgot');
    check(`forgot (${label}): just the code + a new password — no email to remember`,
      await page.locator('#fp_email').count() === 0 && await page.locator('#fp_code').count() === 1 && await page.locator('#fp_pass').count() === 1
      && /No email needed/.test(await page.textContent('#login')) && !/reset link|we'll send|check spam|emailed|login email/i.test(await page.textContent('#login')));
    const wa = await page.getAttribute('#login a[href^="https://wa.me/"]', 'href');
    check(`forgot (${label}): "ask the family" WhatsApp link has no phone number`, /^https:\/\/wa\.me\/\?text=.*reset%20code/.test(wa || '') && !/\d{6,}/.test(decodeURIComponent(wa || '')), wa);
    if (label === 'phone') {
      const small = await page.evaluate(() => [...document.querySelectorAll('#login input')].filter(el => parseFloat(getComputedStyle(el).fontSize) < 16).map(el => el.id));
      check('forgot (phone): its text boxes are ≥ 16px, so iPhone never zooms in', small.length === 0, small.join(', '));
    }
    await page.fill('#fp_code', 'ABCD-EFGH'); await page.fill('#fp_pass', 'abc');
    await page.click('#fp_form button[type=submit]');
    check(`forgot (${label}): a password under 6 characters is caught before anything is sent`,
      /at least 6 characters/.test(await page.textContent('#fp_msg')) && supabase.length === 0, supabase.join(' | '));
    // made-up database answers from here: a wrong code, then a right one
    await page.unroute(/supabase\.co/); const sent = [];
    let answer = { result: 'no' };
    await page.route(/supabase\.co/, r => { const u = r.request().url(); sent.push(u.replace(/^.*\/v1\//, '') + ' ' + (r.request().postData() || ''));
      if (/rpc\/redeem_reset_code/.test(u)) return r.fulfill({ json: answer }); r.abort(); });
    await page.fill('#fp_pass', 'a-good-new-password'); await page.click('#fp_form button[type=submit]');
    await page.waitForFunction(() => /doesn't work/.test(document.getElementById('fp_msg').textContent), null, { timeout: 3000 }).catch(() => {});
    check(`forgot (${label}): only the code and the password go to the database`, sent.length === 1
      && /"reset_code":"ABCD-EFGH"/.test(sent[0]) && /"new_password"/.test(sent[0]) && !/email/.test(sent[0]), sent.join(' | '));
    check(`forgot (${label}): a wrong code says so in plain words`, /that code doesn't work — check it for typos/.test(await page.textContent('#fp_msg')));
    answer = { result: 'ok', email: 'someone@example.com', reset_id: 7 };
    await page.click('#fp_form button[type=submit]');
    await page.waitForSelector('#au_email', { timeout: 4000 }).catch(() => {});
    check(`forgot (${label}): the right code → signs in with the login's own email (shown, so it isn't forgotten again)`,
      await page.inputValue('#au_email').catch(() => '') === 'someone@example.com' && sent.some(x => /token\?grant_type=password/.test(x) && /someone@example\.com/.test(x)), sent.join(' | '));
    check(`forgot (${label}): this browser won't be told "your password was reset" about its own reset`, await page.evaluate(() => seenResets().includes('7')));
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
    check(`${L}: her card is titled "Pak Long's wife", with "name not known yet — add their name" under it`, await sheetOpen(page)
      && (await page.textContent('#sheetbody h3')).replace(/\s+/g, ' ').trim() === "Pak Long's wife"
      && /name not known yet — add their name/.test((await page.textContent('#sheetbody .profile')).replace(/\s+/g, ' ')));
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
      check(`${L}: clearing Dina's name asks first, then she's "Daughter of Pak Long · name not known yet"`,
        asked.some(m => /Clear Dina Zulkifli's name\?/.test(m) && /Daughter of Pak Long/.test(m)) && cleared.name === '' && cleared.ph
        && cleared.label === 'Daughter of Pak Long' && cleared.sub === 'name not known yet', JSON.stringify({ asked, cleared }));
    }
    check(`${L}: no errors in the page`, errors.length === 0, errors.join(' | '));
    check(`${L}: the demo never contacted Supabase`, supabase.length === 0, supabase.join(' | '));
    await ctx.close();
  });
}

// ---------- the name on the tree: a first name of two words ("Mei Ling Tan" → "Mei Ling") ----------
for (const [label, opts] of [['desktop', { viewport: { width: 1280, height: 800 } }],
  ['phone', { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }]]) {
  await guard(`tree name (${label})`, async () => {
    const L = `tree name (${label})`, phone = label === 'phone';
    const { ctx, page, errors, supabase } = await demo(L, opts);
    const tap = loc => phone ? loc.tap() : loc.click();
    const line = id => page.evaluate(i => { const e = document.getElementById(i + '_tn'); return e && !e.hidden ? e.textContent.replace(/\s+/g, ' ').trim() : null; }, id);
    const save = () => tap(page.locator('#sheetbody button.btn.primary:has-text("Save")'));
    check(`${L}: everyone already in the tree still goes by the first word of their name`, await page.evaluate(() =>
      Object.values(S.persons).filter(p => !isPlaceholder(p.id) && !selfNick(p.id)).every(p => goesBy(p.id) === p.name.split(' ')[0])));
    // Add relative: the line appears as soon as the name has two words
    await page.evaluate(() => openAdd('sarah')); await sheetOpen(page);
    check(`${L}: Add relative — no line before a name is typed`, await line('a_name') === null);
    await page.fill('#a_name', 'Ali');
    check(`${L}: …nor for a one-word name`, await line('a_name') === null);
    await page.fill('#a_name', '?');
    check(`${L}: …nor for "?" (name not known yet)`, await line('a_name') === null);
    await page.fill('#a_name', 'Mei Ling Tan');
    check(`${L}: typing "Mei Ling Tan" shows "On the tree: Mei · change"`, await line('a_name') === 'On the tree: Mei · change', await line('a_name'));
    await tap(page.locator('#a_name_tn button'));
    const chips = await page.$$eval('#a_name_tp [data-w]', bs => bs.map(b => b.textContent + (b.getAttribute('aria-pressed') === 'true' ? '*' : '')));
    check(`${L}: change → the words to tap, "Mei" picked`, chips.join(',') === 'Mei*,Ling,Tan', chips.join(','));
    await tap(page.locator('#a_name_tp [data-w="1"]'));
    check(`${L}: tapping "Ling" → "On the tree: Mei Ling"`, await line('a_name') === 'On the tree: Mei Ling · done', await line('a_name'));
    if (phone) {
      const bx = await page.$$eval('#a_name_tn button, #a_name_tp [data-w]', bs => bs.map(b => { const r = b.getBoundingClientRect(); return { t: b.textContent, h: Math.round(r.height), l: Math.round(r.left), r: Math.round(r.right) }; }));
      check(`${L}: "done" and the words are big enough to tap (≥ 32px) and fit the screen`, bx.length === 4 && bx.every(b => b.h >= 32 && b.l >= 0 && b.r <= 375), JSON.stringify(bx));
    }
    await tap(page.locator('.choice[data-rel="child"]'));
    await tap(page.locator('#a_save'));
    const added = await page.evaluate(() => { const p = Object.values(S.persons).find(x => x.name === 'Mei Ling Tan'), n = p && document.querySelector(`.node[data-pid="${p.id}"]`);
      return p && { id: p.id, short: p.shortName, nick: n && n.querySelector('.nick').textContent, full: n && n.querySelector('.full').textContent }; });
    check(`${L}: saved — the tree shows "Mei Ling", with "Mei Ling Tan" under it`, !!added && added.short === 'Mei Ling' && added.nick === 'Mei Ling' && added.full === 'Mei Ling Tan', JSON.stringify(added));
    if (!phone) {
      // their card: the pick is there; words that leave the name take it back to the first word
      await page.waitForFunction(() => !document.getElementById('sheet').classList.contains('open'));
      await page.evaluate(id => openPerson(id), added.id); await sheetOpen(page);
      check(`${L}: their card says "On the tree: Mei Ling · change"`, await line('f_name') === 'On the tree: Mei Ling · change', await line('f_name'));
      await page.fill('#f_name', 'Siew Mei Ling');
      check(`${L}: a name typed around the picked words keeps them`, /^On the tree: Mei Ling ·/.test(await line('f_name')), await line('f_name'));
      await page.fill('#f_name', 'Mei Hua Tan');
      check(`${L}: …a name without "Ling" any more goes back to its first word`, /^On the tree: Mei ·/.test(await line('f_name')), await line('f_name'));
      await page.fill('#f_name', 'Mei Ling Tan');
      await page.click('#f_name_tn button'); await page.fill('#f_name_type', 'Lingling');
      check(`${L}: or type it — "On the tree: Lingling"`, /^On the tree: Lingling ·/.test(await line('f_name')), await line('f_name'));
      await save();
      check(`${L}: …saved, and the tree shows "Lingling"`, await page.evaluate(id => S.persons[id].shortName === 'Lingling'
        && document.querySelector(`.node[data-pid="${id}"] .nick`).textContent === 'Lingling', added.id));
      // one word, the default or "?" keeps nothing
      check(`${L}: nothing is kept when it's just the first word, a one-word name or "?"`, await page.evaluate(() =>
        shortFor('Mei Ling Tan', 'Mei') === '' && shortFor('Mei', 'Mei Ling') === '' && shortFor('?', 'Mei') === '' && shortFor('Mei Ling Tan', '  Mei   Ling ') === 'Mei Ling'));
      // the order: my nickname → their own "You go by" → the name on the tree → the first word
      const order = await page.evaluate(() => { const ina = S.persons.ina; ina.shortName = 'Nur Aina'; const r = [displayName('ina'), goesBy('ina')];
        S.nicknames.ina = S.nicknames.ina || {}; S.nicknames.ina.ina = 'Ina'; r.push(goesBy('ina')); delete S.nicknames.ina.ina;
        ina.shortName = ''; r.push(goesBy('ina')); return r; });
      check(`${L}: shown in order — my nickname, their own "You go by", the name on the tree, the first word`, order.join('|') === 'Kak Ina|Nur Aina|Ina|Nur', order.join('|'));
      // someone who can't edit them sees no line (Baba, 6 branches from Farid)
      await page.waitForFunction(() => !document.getElementById('sheet').classList.contains('open'));
      const other = await page.evaluate(() => { const keep = S.session; S.session = { nucleusId: 'n4', viewingAs: 'baba' };
        openPerson('farid'); const r = { disabled: document.getElementById('f_name').disabled, line: !!document.getElementById('f_name_tn') }; S.session = keep; return r; });
      check(`${L}: someone who can't edit them gets no "change"`, other.disabled && !other.line, JSON.stringify(other));
      await sheetOpen(page); await closeSheet(page);
      // my own card: the same line, until I choose what I go by
      await page.evaluate(() => openSelf()); await sheetOpen(page);
      check(`${L}: my own card — "On the tree: Aizat · change", and "You go by" hints "Aizat"`, await line('f_name') === 'On the tree: Aizat · change'
        && await page.getAttribute('#mynick', 'placeholder') === 'Aizat', await line('f_name'));
      await page.fill('#mynick', 'Abang'); await page.click('#sheetbody .bignick button');
      await page.waitForTimeout(200);
      check(`${L}: …once I go by "Abang", the line says so, with nothing to change`, await line('f_name') === 'On the tree: Abang — your "You go by" above'
        && await page.locator('#f_name_tn button').count() === 0, await line('f_name'));
    }
    check(`${L}: no errors in the page`, errors.length === 0, errors.join(' | '));
    check(`${L}: the demo never contacted Supabase`, supabase.length === 0, supabase.join(' | '));
    await ctx.close();
  });
}
// ---------- nicknames: pick one the close family already uses; a near-miss is asked about ----------
for (const [label, opts] of [['desktop', { viewport: { width: 1280, height: 800 } }],
  ['phone', { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }]]) {
  await guard(`pick nickname (${label})`, async () => {
    const L = `pick nickname (${label})`, phone = label === 'phone';
    const { ctx, page, errors, supabase } = await demo(L, opts);
    const tap = loc => phone ? loc.tap() : loc.click();
    const card = async pid => { await page.evaluate(p => openPerson(p), pid); await sheetOpen(page); };
    const mine = pid => page.evaluate(p => ({ n: (S.nicknames.aizat || {})[p] || '', priv: isPrivNick('aizat', p) }), pid);
    const asked = async () => (await page.textContent('#nickcheck').catch(() => '')).replace(/\s+/g, ' ').trim();
    const save = () => tap(page.locator('#sheetbody .bignick button'));
    if (!phone) {
      const near = await page.evaluate(() => [
        ['Aryn', ['Ayne'], 'Ayne'],                // 2 steps on a 4-letter name — the shape of Aizat's own example
        ['Rnia', ['Rina'], 'Rina'],                // two letters swapped = 1 step
        ['rina', ['Rina'], 'Rina'],                // only capitals differ: offer the list's spelling
        ['Kak  Ina', ['Kak Ina'], 'Kak Ina'],      // only spaces differ
        ['Rina', ['Rena', 'Rina'], ''],            // an exact match is never asked about
        ['Bon', ['Bob'], 'Bob'], ['Ben', ['Bob'], ''], // 3 letters: 1 step is near, 2 is a different name
        ['Jo', ['Jon'], ''],                       // 1–2 letter names are left alone
        ['Princess', ['Adik', 'Kakak'], ''],       // clearly different
        ['Atuk', ['Tok Wan', 'Atok'], 'Atok'],     // the closest of several
      ].filter(([t, names, want]) => nearNick(t, names) !== want).map(([t, names]) => `${t} → "${nearNick(t, names)}"`));
      check(`${L}: the near-miss rule (case, spaces, swaps, 1 step on 3 letters, 2 on longer)`, near.length === 0, near.join(' | '));
    }
    // Alya: Aizat has no name for her yet; her sister calls her "Kakak"
    await card('alya');
    const use = page.locator('#sheetbody .usenick');
    check(`${L}: no name of mine yet → the close family's name has "use this name"`,
      await use.count() === 1 && /Kakak/.test(await page.textContent('#sheetbody .nickrow.pick')));
    if (phone) { const b = await use.boundingBox();
      check(`${L}: "use this name" is big enough to tap (≥ 40px tall)`, b && b.height >= 40 && b.x + b.width <= 375, b && `${Math.round(b.width)}×${Math.round(b.height)}`); }
    await tap(use);
    check(`${L}: one tap saves it as mine — not only-us — and says so`, JSON.stringify(await mine('alya')) === '{"n":"Kakak","priv":false}'
      && /saved — you call them Kakak/.test(await page.textContent('#toast')), JSON.stringify(await mine('alya')));
    check(`${L}: …then the buttons go, and the box shows it`, await page.locator('#sheetbody .usenick').count() === 0 && await page.inputValue('#mynick') === 'Kakak');
    // Danish: his sister Sarah calls him "Adik" — a typo of it is asked about before saving
    await card('danish');
    await page.fill('#mynick', 'Aidk'); await save();
    check(`${L}: a near-miss asks first — "Others call them Adik. You typed Aidk." — nothing saved yet`,
      /^Others call them Adik\. You typed Aidk\. Use Adik Keep Aidk$/.test(await asked()) && (await mine('danish')).n === '', await asked());
    if (phone) { const bs = await page.locator('#nickcheck button').evaluateAll(els => els.map(e => e.getBoundingClientRect().right));
      check(`${L}: the question's buttons fit the screen`, bs.length === 2 && bs.every(r => r <= 375), bs.join(', ')); }
    await tap(page.locator('#nickcheck button', { hasText: 'Use Adik' }));
    check(`${L}: "Use Adik" saves the family's spelling`, (await mine('danish')).n === 'Adik' && await page.locator('#nickcheck').count() === 0);
    await page.fill('#mynick', 'adik'); await save();
    check(`${L}: only capitals differ → offers the list's spelling too`, /^Others call them Adik\. You typed adik\./.test(await asked()), await asked());
    await page.fill('#mynick', 'adikk');
    check(`${L}: typing again puts the question away`, await page.locator('#nickcheck').count() === 0);
    await page.fill('#mynick', 'adik'); await save();
    await tap(page.locator('#nickcheck button', { hasText: 'Keep adik' }));
    check(`${L}: "Keep adik" saves what was typed`, (await mine('danish')).n === 'adik' && await page.locator('#nickcheck').count() === 0);
    await tap(page.locator('#mynick_priv'));
    check(`${L}: ticking 🔒 on a name already kept doesn't ask again`, JSON.stringify(await mine('danish')) === '{"n":"adik","priv":true}'
      && await page.locator('#nickcheck').count() === 0, JSON.stringify(await mine('danish')));
    await page.fill('#mynick', 'Danny'); await save();
    check(`${L}: a clearly different name saves straight away`, (await mine('danish')).n === 'Danny' && await page.locator('#nickcheck').count() === 0);
    // Iman: only someone from the wider family has a name for him — never offered, never hinted at
    await page.evaluate(() => { S.nicknames.emma = { iman: 'Imzy' }; });
    await card('iman');
    check(`${L}: a wider-family name is only counted — no button, not shown`, await page.locator('#sheetbody .usenick').count() === 0
      && /\+ 1 more name used in the wider family/.test(await page.textContent('#sheetbody')) && !/Imzy/.test(await page.textContent('#sheetbody')));
    await page.fill('#mynick', 'Imzi'); await save();
    check(`${L}: …and a typed name near it saves without asking (it would give the name away)`,
      (await mine('iman')).n === 'Imzi' && await page.locator('#nickcheck').count() === 0);
    // own card: "You go by" — pick from what people call me, never a 🔒 only-us name
    await page.evaluate(() => { S.nickPriv.ina = { aizat: true }; });
    await card('aizat');
    const offered = await page.locator('#sheetbody .nickrow.pick .nickname').allTextContents();
    check(`${L}: own card offers what people call me, minus 🔒 names`, offered.length > 1 && offered.includes('Ayah') && !offered.includes('Adik'), offered.join(', '));
    await tap(page.locator('#sheetbody .usenick[data-nick="Ayah"]'));
    check(`${L}: …one tap and I go by it`, await page.evaluate(() => S.nicknames.aizat.aizat) === 'Ayah' && /saved — you go by Ayah/.test(await page.textContent('#toast')));
    await page.fill('#mynick', 'Abang Lonh'); await save();
    check(`${L}: own card: a near-miss asks too — "People call you Abang Long"`, /^People call you Abang Long\. You typed Abang Lonh\./.test(await asked()), await asked());
    await tap(page.locator('#nickcheck button', { hasText: 'Use Abang Long' }));
    check(`${L}: …"Use Abang Long" saves it`, await page.evaluate(() => S.nicknames.aizat.aizat) === 'Abang Long');
    check(`${L}: no errors in the page`, errors.length === 0, errors.join(' | '));
    check(`${L}: the demo never contacted Supabase`, supabase.length === 0, supabase.join(' | '));
    await ctx.close();
  });
}
// the website goes live a few minutes before the database update: until the column is there,
// the app leaves it out of every save (so saving keeps working), then reads and sends it
await guard('tree name (database)', async () => {
  const L = 'tree name (database)';
  const { ctx, page, errors } = await demo(L, { viewport: { width: 1280, height: 800 } });
  let rows = [{ id: 'p1', tree_id: 't1', full_name: 'Mei Ling Tan', claimed_by: 'n1' }]; const sent = [];
  await page.route(/supabase\.co/, r => { const q = r.request(), u = decodeURIComponent(q.url());
    if (q.method() !== 'GET') { sent.push(`${q.method()} ${q.postData() || ''}`); return r.fulfill({ json: [{ id: 'p1' }] }); }
    if (/\/account\?/.test(u)) return r.fulfill({ json: [{ nucleus_id: 'n1', nucleus: { tree_id: 't1' } }] });
    const out = /\/nucleus\?/.test(u) ? [{ id: 'n1', tree_name: 'T', label: 'L', is_super: false }] : /\/person\?/.test(u) ? rows : [];
    r.fulfill({ json: out, headers: { 'content-range': out.length ? `0-${out.length - 1}/${out.length}` : '*/0' } }); });
  const run = () => page.evaluate(async () => { MODE = 'cloud';
    try { await cloudFetchAll(); const on = shortNamesOn(), sn = S.persons.p1.shortName; S.persons.p1.shortName = 'Mei Ling';
      await db.savePerson(S.persons.p1); await db.insertPerson({ ...S.persons.p1, id: 'p2' }); return { on, sn }; }
    finally { MODE = 'demo'; } });
  let res = await run();
  check(`${L}: before the update — the column is missing, so saves leave it out and still go through`, !res.on && sent.length === 2
    && sent.every(b => !/short_name/.test(b)) && /^PATCH .*"full_name":"Mei Ling Tan"/.test(sent[0]), JSON.stringify({ res, sent }));
  rows = [{ ...rows[0], short_name: 'Mei Ling' }]; sent.length = 0;
  res = await run();
  check(`${L}: after it — read back ("Mei Ling"), and sent with every save and every new person`, res.on && res.sn === 'Mei Ling' && sent.length === 2
    && sent.every(b => /"short_name":"Mei Ling"/.test(b)), JSON.stringify({ res, sent }));
  check(`${L}: no errors in the page`, errors.length === 0, errors.join(' | '));
  await ctx.close();
});

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
    const calls = [], bodies = [], codes = ['abcdefabcdef', 'fedcbafedcba', 'bbbbccccdddd'];
    let made = 0, invite = () => [{ opened_at: null, expires_at: new Date(Date.now() + 3e5).toISOString() }], claimed = null;
    await page.route(/supabase\.co/, r => { const q = r.request(), u = decodeURIComponent(q.url()); calls.push(`${q.method()} ${u.replace(/^.*\/v1\//, '')}`);
      if (q.postData()) bodies.push(q.postData());
      if (/rpc\/make_qr_invite/.test(u)) return r.fulfill({ json: { code: codes[made++ % 3], expires_at: new Date(Date.now() + 3e5).toISOString(), seconds: 300 } });
      if (/rpc\/make_newtree_code/.test(u)) return r.fulfill({ json: { code: 'abcabcabcabc', expires_at: new Date(Date.now() + 14 * 864e5).toISOString() } });
      if (/rpc\/release_claim/.test(u)) return r.fulfill({ status: 204, body: '' });
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
    check(`${L}: …asking the database who opened, used or declined it, every few seconds`, calls.some(c => /^GET tree_invite\?select=opened_at,expires_at,used_at,declined_at&code=eq\.abcdefabcdef/.test(c)), calls.join(' | '));
    check(`${L}: the sheet says: to that person only, face to face, never a shared screen or a group; "not me" cancels`,
      /never on a shared screen/.test(await page.textContent('#sheetbody')) && /never to a group/.test(await page.textContent('#ln_state'))
      && /takes .+'s place straight away/.test(await page.textContent('#sheetbody')) && /"not me"/.test(await page.textContent('#sheetbody')));
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
    invite = () => [{ opened_at: new Date().toISOString(), expires_at: new Date(Date.now() + 6e5).toISOString() }];
    await page.waitForFunction(() => /scanned/.test(document.getElementById('qr_state').textContent), null, { timeout: 6000 }).catch(() => {});
    check(`${L}: scanned → "✓ scanned — … has 10 minutes to finish, until 2:59 pm", greyed so nobody else scans it`,
      /✓ scanned — .+ has 10 minutes to finish signing up, until \d{1,2}:\d\d (am|pm)/.test(await page.textContent('#qr_state'))
      && await page.locator('#qr_box.dead').count() === 1 && await page.isVisible('#qr_cancel'), (await page.textContent('#qr_state')).replace(/\s+/g, ' '));
    invite = () => [{ opened_at: new Date().toISOString(), expires_at: new Date(Date.now() + 6e5).toISOString(), used_at: new Date().toISOString() }];
    await page.evaluate(() => qrCheck(QR));
    check(`${L}: used → "🎉 … has taken their place on the tree", and no more link to send`, /🎉 .+ has taken their place on the tree/.test(await page.textContent('#qr_state'))
      && await page.locator('#ln_card').count() === 0);
    check(`${L}: …with a one-tap "that wasn't them? undo" right there`, await page.isVisible('#qr_undo'));
    await tap('#qr_undo');
    await page.waitForFunction(() => /claim released/.test(document.getElementById('qr_state').textContent), null, { timeout: 3000 }).catch(() => {});
    check(`${L}: undo → release_claim at once, "claim released", the stranger's login mentioned, refresh shows`,
      calls.some(c => /^POST rpc\/release_claim/.test(c)) && /claim released — .+free again/.test(await page.textContent('#qr_state'))
      && /still has a login/.test(await page.textContent('#qr_state')) && await page.isVisible('#qr_new'), await page.textContent('#qr_state'));
    await closeSheet(page);
    // "not me" on their phone: the keeper's screen says so, and offers a fresh code
    invite = () => [{ opened_at: null, expires_at: new Date(Date.now() + 3e5).toISOString() }];
    await page.evaluate(p => invitePerson(p), pid); await page.waitForSelector('#qr_box svg', { timeout: 3000 });
    invite = () => [{ opened_at: new Date().toISOString(), expires_at: new Date().toISOString(), declined_at: new Date().toISOString() }];
    await page.evaluate(() => qrCheck(QR));
    check(`${L}: declined → "🚫 … said this isn't them, so the code is cancelled", refresh shows`, /🚫 .+this isn't them.+cancelled/.test(await page.textContent('#qr_state'))
      && await page.isVisible('#qr_new'), await page.textContent('#qr_state'));
    await closeSheet(page);
    // closing the sheet deletes a code nobody scanned
    invite = () => [{ opened_at: null, expires_at: new Date(Date.now() + 3e5).toISOString() }];
    await page.evaluate(p => invitePerson(p), pid); await page.waitForSelector('#qr_box svg', { timeout: 3000 });
    await closeSheet(page); await page.waitForTimeout(300);
    check(`${L}: closing the sheet deletes the unscanned code (never a scanned one)`, calls.some(c => /^DELETE tree_invite\?code=eq\.(abcdefabcdef|fedcbafedcba|bbbbccccdddd)&opened_at=is\.null/.test(c)), calls.filter(c => /DELETE/.test(c)).join(' | '));
    // 💬 a 14-day link instead
    await page.evaluate(p => invitePerson(p), pid); await page.waitForSelector('#qr_box svg', { timeout: 3000 });
    check(`${L}: the sheet says which is which: QR = with you now; link = 14 days`, /With you now\? Let them scan this/i.test(await page.textContent('#sheetbody'))
      && /Not with you\? Send a link/i.test(await page.textContent('#sheetbody')) && /14 days/.test(await page.textContent('#ln_state')));
    await tap('#ln_make'); await page.waitForSelector('#ln_wa', { timeout: 3000 });
    const lwa = await page.getAttribute('#ln_wa', 'href');
    check(`${L}: link → 💬 WhatsApp with the link in the message, no phone number`, noNumber(lwa) && decodeURIComponent(lwa).includes(LIVE + '#invite=linklinklink')
      && await page.getAttribute('#ln_wa', 'target') === '_blank' && /noopener/.test(await page.getAttribute('#ln_wa', 'rel')), lwa);
    check(`${L}: …plus "copy link", and "works once, until … — to … only, never to a group"`, await page.locator('#ln_copy:has-text("copy link")').count() === 1
      && /works once, until .+ only, never to a group/.test(await page.textContent('#ln_state')) && /don't forward it or post it in a group/.test(decodeURIComponent(lwa)));
    check(`${L}: an existing link is reused only if it's still unused and not declined`, calls.some(c => /^GET tree_invite\?select=code,expires_at&person_id=eq\..+&kind=eq\.link&used_at=is\.null&declined_at=is\.null/.test(c)), calls.filter(c => /select=code/.test(c)).join(' | '));
    check(`${L}: no "send by email" / mailto in the invite sheet`, !/mailto:|send by email/i.test(await page.innerHTML('#sheetbody')));
    await closeSheet(page);
    // ⭐ general code and "invite a friend"
    await page.evaluate(() => inviteDialog('abcdefabcdef', new Date(Date.now() + 14 * 864e5))); await sheetOpen(page);
    const gwa = await page.getAttribute('#inv_wa', 'href');
    check(`${L}: general code → 💬 WhatsApp (link + code, no phone number) + copy link`, noNumber(gwa) && decodeURIComponent(gwa).includes(LIVE + '#invite=abcdefabcdef')
      && decodeURIComponent(gwa).includes('invite code: abcdefabcdef') && await page.locator('#inv_copy:has-text("copy link")').count() === 1
      && !/mailto:|send by email/i.test(await page.innerHTML('#sheetbody')) && /never to a group chat/.test(await page.textContent('#sheetbody')), gwa);
    await closeSheet(page);
    await page.evaluate(() => inviteFriend()); await page.waitForTimeout(400);
    check(`${L}: only tree keepers can invite a friend to start a tree`, !calls.some(c => /make_newtree_code/.test(c)) && !(await page.isVisible('#fr_wa')));
    await page.evaluate(async () => { const n = S.session.nucleusId, was = S.nuclei[n].isSuper;
      S.nuclei[n].isSuper = true; ME.nucleusId = n; MODE = 'cloud'; const p = inviteFriend(); MODE = 'demo'; await p; ME.nucleusId = null; S.nuclei[n].isSuper = was; });
    await sheetOpen(page);
    const fwa = await page.getAttribute('#fr_wa', 'href');
    check(`${L}: invite a friend → a one-time start-a-tree link (#newtree=code) on 💬 WhatsApp, no phone number`, noNumber(fwa) && decodeURIComponent(fwa).includes(LIVE + '#newtree=abcabcabcabc')
      && calls.some(c => /rpc\/make_newtree_code/.test(c)) && /works once, until/.test(await page.textContent('#sheetbody'))
      && await page.locator('#fr_copy:has-text("copy link")').count() === 1 && !/mailto:|send by email/i.test(await page.innerHTML('#sheetbody')), fwa);
    if (phone) { const h = await page.locator('#fr_wa').boundingBox();
      check('invites (phone): the WhatsApp button is a full-size button', h && h.height >= 44, h && `${Math.round(h.height)}px`); }
    await closeSheet(page);
    // a "?" with no partner is named by where they hang — in my words on my tree, in shared words in an invite
    const ph = await page.evaluate(() => { S.persons.phkid = { id: 'phkid', name: '', gender: '', couplePos: '', born: '', country: '', claimedBy: null,
      notes: '', passed: null, photos: {}, mainPhoto: 'a' }; S.rels.push({ kind: 'pc', a: 'aizat', b: 'phkid' }, { kind: 'pc', a: 'sarah', b: 'phkid' });
      rebuild(); const n = document.querySelector('.node[data-pid="phkid"]');
      return { nick: n && n.querySelector('.nick').textContent, full: n && n.querySelector('.full').textContent, two: n && n.querySelector('.nick').classList.contains('two'),
        invite: inviteName('phkid'), mine: displayName('phkid') }; });
    check(`${L}: a "?" child shows as "Child of Aizat & Sayang", "name not known yet" under it, on two lines`,
      ph.nick === 'Child of Aizat & Sayang' && ph.full === 'name not known yet' && ph.two, JSON.stringify(ph));
    check(`${L}: …but an invite calls them "Child of Aizat & Sarah" — never Aizat's "only us" nickname`, ph.invite === 'Child of Aizat & Sarah', JSON.stringify(ph));
    const before = calls.length;
    await page.evaluate(() => invitePerson('phkid')); await page.waitForSelector('#qr_box svg', { timeout: 3000 });
    const sent = calls.slice(before).find(c => /rpc\/make_qr_invite/.test(c));
    check(`${L}: the QR code is made with that shared name`, /"invite_nm":"Child of Aizat & Sarah"/.test(bodies.join(' ')) && !!sent, bodies.slice(-2).join(' | '));
    check(`${L}: the sheet's title uses it too`, /Invite Child of Aizat & Sarah/.test(await page.textContent('#sheetbody h3')), await page.textContent('#sheetbody h3'));
    await closeSheet(page);
    check(`${L}: no errors in the page`, errors.length === 0, errors.join(' | '));
    await ctx.close();
  });
}
check('no "mailto:" left anywhere in the app', !/mailto:/i.test(APP_SRC));
const oldWords = APP_SRC.match(/Super settings|super users?\b|make super|⭐ super|in my nucleus|Your nucleus|into your nucleus|a nucleus'|another nucleus|only your nucleus/gi) || [];
check('words: "tree keeper" and "household" everywhere — no "super user" or "nucleus" on screen', oldWords.length === 0, oldWords.join(', '));

// ---------- clock times, joining and starting a tree (no database needed for these screens) ----------
await guard('screens', async () => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true }), page = await ctx.newPage(), errors = [], sent = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route(/supabase\.co/, r => { sent.push(r.request().url()); r.abort(); });
  await page.goto(BASE);
  const times = await page.evaluate(() => [new Date(2026, 9, 24, 14, 59), new Date(2026, 9, 24, 0, 5), new Date(2026, 9, 24, 12, 0), new Date(2026, 9, 24, 9, 7)].map(timeOf));
  check('times always say am or pm: 2:59 pm, 12:05 am, 12:00 pm, 9:07 am', times.join(',') === '2:59 pm,12:05 am,12:00 pm,9:07 am', times.join(','));
  await page.evaluate(() => renderJoinInvited('abcdefabcdef'));
  check('joining with an invite: no household or tree-name boxes, one button', await page.locator('#ji_label, #ji_tree').count() === 0
    && await page.isVisible('#ji_go') && /named after you/.test(await page.textContent('#login')));
  await page.evaluate(() => { renderOnboarding(); document.getElementById('ob_join').click(); });
  check('joining with a code: just the code box', await page.locator('#ob_code').count() === 1 && await page.locator('#ob_label, #ob_tree').count() === 0);
  await page.evaluate(() => { PENDING_NEWTREE = null; renderStartTree(); });
  check('starting a tree: no household box; the tree name is filled in; a start-a-tree code is asked for', await page.locator('#ob_label').count() === 0
    && await page.inputValue('#ob_tree') === 'Our family' && await page.isVisible('#ob_start'));
  await page.fill('#ob_name', 'Test Person'); await page.tap('#ob_go');
  check('…without a code it says what\'s needed and sends nothing', /start-a-tree link/.test(await page.textContent('#ob_msg')) && sent.length === 0, sent.join(' | '));
  check('…a pasted link or a bare code both work', await page.evaluate(() => [startCodeOf('https://x/#newtree=ABCDEFabcdef'), startCodeOf(' abcdefabcdef '), startCodeOf('nope')].join('|')) === 'abcdefabcdef|abcdefabcdef|');
  await page.evaluate(() => { PENDING_NEWTREE = 'abcdefabcdef'; renderStartTree(); });
  check('…with the code from the link, no code box', await page.locator('#ob_start').count() === 0);
  check('screens: no errors in the page', errors.length === 0, errors.join(' | '));
  await ctx.close();
});

// ---------- "Is this you?": a personal invite shows the family before the sign-up form ----------
await guard('is this you', async () => {
  const answer = { name: 'Daughter of Aizat & Sarah', kind: 'qr', expires_at: new Date(Date.now() + 18e5).toISOString(), seconds: 1800,
    family: { parents: ['Aizat', 'Sarah'], siblings: ['Alya', 'Aisha', 'Bella', 'Cinta', 'Dewi', 'Emma'], partners: ['Danish'], children: ['Iman'] }, unknown: true };
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true }), page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route(/supabase\.co/, r => /rpc\/open_invite/.test(r.request().url()) ? r.fulfill({ json: answer }) : r.abort());
  await page.goto(BASE + '#invite=abcdefabcdef');
  await page.waitForSelector('#inv_yes', { timeout: 3000 });
  const card = (await page.textContent('#inv_who')).replace(/\s+/g, ' ');
  const tree = await page.evaluate(() => { const s = document.querySelector('#inv_who svg.minitree'), b = s && s.getBoundingClientRect(), box = s && s.parentElement.getBoundingClientRect();
    return s && { label: s.getAttribute('aria-label'), texts: [...s.querySelectorAll('text')].map(t => t.textContent), circles: s.querySelectorAll('circle').length,
      dashed: s.querySelectorAll('circle[stroke-dasharray]').length, lines: s.querySelectorAll('line').length, fits: b.width <= box.width + 0.5 && b.left >= box.left - 0.5 }; });
  check('is this you: the card names the place, drawn as a little tree', /Is this you\?/i.test(card) && /Daughter of Aizat & Sarah/.test(card) && !!tree
    && ['Aizat', 'Sarah', 'Alya', 'Aisha', 'Bella', 'Danish', 'Iman', 'you?'].every(t => tree.texts.includes(t)) && tree.lines >= 8, JSON.stringify(tree));
  check('is this you: their own name still unknown → a dashed "?" circle with the "you?" ring', tree && tree.dashed === 1 && tree.texts.includes('?'), JSON.stringify(tree));
  check('is this you: 6 brothers & sisters → 3 drawn + a "+3" circle; the full list is read out to screen readers', tree && tree.texts.includes('+3')
    && !tree.texts.includes('Cinta') && /Brothers & sisters: Alya, Aisha, Bella, Cinta, Dewi, Emma/.test(tree.label) && /Parents: Aizat, Sarah/.test(tree.label), tree && tree.label);
  check('is this you: the little tree fits the 375px phone screen', tree && tree.fits);
  check('is this you: no email or password boxes until they say "Yes, that\'s me"', !(await page.isVisible('#au_email')) && !(await page.isVisible('#au_up')));
  await page.tap('#inv_no');
  check('is this you: "not me" → asks once more ("Cancel this invite" / "back — it is me"), still no form', /Not you\? Then this invite was meant for someone else/.test(await page.textContent('#inv_who'))
    && await page.isVisible('#inv_cancel') && await page.isVisible('#inv_back') && !(await page.isVisible('#au_email')));
  await page.tap('#inv_back'); await page.tap('#inv_yes');
  check('is this you: "Yes, that\'s me" → "✓ joining as …" and the form, cursor in the email box', /✓ joining as Daughter of Aizat & Sarah/.test(await page.textContent('#inv_who'))
    && await page.isVisible('#au_up') && await page.evaluate(() => document.activeElement.id) === 'au_email');
  await page.tap('#au_sw');
  check('is this you: switching to "sign in" doesn\'t ask again', await page.isVisible('#au_in') && /✓ joining as/.test(await page.textContent('#inv_who')));
  const small = await page.evaluate(() => [...document.querySelectorAll('#login input')].filter(el => el.offsetParent && parseFloat(getComputedStyle(el).fontSize) < 16).map(el => el.id));
  check('is this you: text boxes stay ≥ 16px on the phone', small.length === 0, small.join(', '));
  check('is this you: no errors in the page', errors.length === 0, errors.join(' | '));
  await ctx.close();
  // "not me" → Cancel this invite: the database is told, and the invite is forgotten here too
  const ctx2 = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true }), p2 = await ctx2.newPage(), declined = [];
  p2.on('pageerror', e => errors.push(e.message));
  await p2.route(/supabase\.co/, r => { const u = r.request().url();
    if (/rpc\/open_invite/.test(u)) return r.fulfill({ json: answer });
    if (/rpc\/decline_invite/.test(u)) { declined.push(r.request().postData()); return r.fulfill({ json: true }); }
    r.abort(); });
  await p2.goto(BASE + '#invite=abcdefabcdef'); await p2.waitForSelector('#inv_no', { timeout: 3000 });
  await p2.tap('#inv_no'); await p2.tap('#inv_cancel');
  await p2.waitForFunction(() => /cancelled/.test(document.getElementById('inv_who').textContent), null, { timeout: 3000 }).catch(() => {});
  check('is this you: "Cancel this invite" tells the database (decline_invite) and says it\'s cancelled, nothing saved',
    declined.length === 1 && /"invite_code":"abcdefabcdef"/.test(declined[0]) && /this invite is cancelled and nothing has been saved/.test(await p2.textContent('#inv_who'))
    && !(await p2.isVisible('#au_email')) && await p2.evaluate(() => !localStorage.getItem('bft.pendingInvite')), declined.join(' | '));
  await ctx2.close();
});

// ---------- the relative's side: a QR code / link opens the app ----------
await guard('invite landing', async () => {
  for (const [what, answer, want] of [
    ['a QR code', { name: 'Kak Yana', kind: 'qr', expires_at: new Date(Date.now() + 6e5).toISOString(), seconds: 600 }, /Kak Yana, you're invited.*you have 10 minutes to finish — until \d{1,2}:\d\d (am|pm)/s],
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
    check(`landing (${what}): straight to "create your account", with the right words`, await page.isVisible('#au_up') && want.test(banner), banner);
    check(`landing (${what}): no errors in the page`, errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
});

await browser.close(); server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

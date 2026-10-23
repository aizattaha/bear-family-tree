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
      // adding someone as "?" the usual way: Kak Ina's husband
      await page.waitForTimeout(300);
      if (await page.isVisible('#showall')) await page.click('#showall'); // back to my view: Kak Ina beside me
      await page.waitForTimeout(700);
      await page.locator('.node[data-pid="ina"] .avatar').dblclick(); await sheetOpen(page);
      await page.click('#sheetbody button:has-text("Add relative")');
      await page.fill('#a_name', '?'); await page.selectOption('#a_gender', 'm');
      await page.click('.choice[data-rel="partner"]'); await page.click('#a_save');
      const added = await page.evaluate(() => { const id = partnersOf('ina')[0];
        return { label: fullName(id), toast: document.getElementById('toast').textContent, cls: document.querySelector(`.node[data-pid="${id}"]`)?.className }; });
      check(`${L}: adding "?" as Kak Ina's partner shows "Kak Ina's husband"`, added.label === "Kak Ina's husband"
        && /added — Kak Ina's husband/.test(added.toast) && / unknown/.test(added.cls || ''), JSON.stringify(added));
    }
    check(`${L}: no errors in the page`, errors.length === 0, errors.join(' | '));
    check(`${L}: the demo never contacted Supabase`, supabase.length === 0, supabase.join(' | '));
    await ctx.close();
  });
}

await browser.close(); server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

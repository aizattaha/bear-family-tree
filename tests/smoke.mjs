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

await browser.close(); server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

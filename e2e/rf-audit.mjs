// Audit the Research Fleet tabs as a real signed-in admin sees them.
//
// Auth the same way e2e/compute-nonvast-e2e.mjs does: REST login, then hand the
// SPA the lm_session cookie a browser login would have set. Driving the login
// form would test the login page, which is not what this is for.
//
// Captures, per tab: a screenshot at desktop and phone width, plus a machine
// countable inventory of the controls actually rendered — the thing a source
// read cannot give you, because half of these are conditional on data.

import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';

const BASE = 'https://lum.id';
const EMAIL = process.env.LUMID_EMAIL || 'admin@lum.id';
const PW = process.env.LUMID_PASSWORD;
if (!PW) { console.error('LUMID_PASSWORD required'); process.exit(2); }

const OUT = '/tmp/rf-shots';
mkdirSync(OUT, { recursive: true });

const res = await fetch(`${BASE}/api/v1/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, password: PW }),
});
if (!res.ok) { console.error('login failed', res.status); process.exit(2); }
const setCookie = res.headers.getSetCookie?.() ?? [];
const session = setCookie.map(c => c.match(/lm_session=([^;]+)/)?.[1]).find(Boolean);
if (!session) { console.error('no lm_session in response'); process.exit(2); }
console.log('authenticated, lm_session acquired');

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addCookies([{ name: 'lm_session', value: session, domain: '.lum.id', path: '/', httpOnly: true, secure: true }]);

const TABS = [
  ['fleet', '/studio/research-fleet'],
  ['jobs', '/studio/research-fleet/jobs'],
  ['sandboxes', '/studio/research-fleet/sandboxes'],
  ['data-warehouse', '/studio/data-warehouse'],
];

const report = {};
for (const [name, path] of TABS) {
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 120)); });
  await page.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 60000 });
  // These tabs fan out across sites on a 20s poll; give the first round time to
  // land or the screenshot is of a spinner, which tells you nothing about density.
  await page.waitForTimeout(12000);

  const inv = await page.evaluate(() => {
    const vis = el => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const all = s => [...document.querySelectorAll(s)].filter(vis);
    const txt = el => (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ');
    return {
      title: document.title,
      buttons: all('button').map(b => txt(b).slice(0, 40)).filter(Boolean),
      selects: all('select').map(s => ({
        label: txt(s.closest('label') || s.parentElement).slice(0, 40),
        options: [...s.options].map(o => o.text.slice(0, 34)),
      })),
      inputs: all('input').map(i => (i.placeholder || i.name || i.type)),
      tables: all('table').map(t => ({
        headers: [...t.querySelectorAll('th')].map(h => txt(h)).filter(Boolean),
        rows: t.querySelectorAll('tbody tr').length,
      })),
      // Every visible bordered panel — the real measure of how many boxes the
      // page asks you to read.
      panels: all('div.rounded-lg.border, div.rounded-md.border').length,
      pills: all('span.rounded.border, span.rounded-full').map(s => txt(s).slice(0, 24)).filter(Boolean).slice(0, 40),
      headings: all('h1,h2,h3,h4').map(h => txt(h).slice(0, 60)).filter(Boolean),
      bodyChars: (document.body.innerText || '').replace(/\s+/g, ' ').length,
      scrollW: document.documentElement.scrollWidth,
    };
  });
  if (name === 'data-warehouse') {
    // A tree whose levels share a left edge is a flat list wearing chevrons.
    // Database and schema rows both sat at x=249 until 2026-09-13.
    inv.treeEdges = await page.evaluate(() => {
      const vis = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const rows = [...document.querySelectorAll('button')].filter(vis)
        .map(e => ({ x: Math.round(e.getBoundingClientRect().x), t: (e.innerText || '').trim().replace(/\s+/g, ' ') }))
        .filter(r => /^[▾▸]/.test(r.t));
      return [...new Set(rows.map(r => r.x))].sort((a, b) => a - b);
    });
  }
  inv.consoleErrors = errs.slice(0, 4);
  report[name] = inv;

  await page.screenshot({ path: `${OUT}/${name}-desktop.png`, fullPage: true });
  await page.setViewportSize({ width: 400, height: 900 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/${name}-phone.png`, fullPage: true });
  const phoneScroll = await page.evaluate(() => document.documentElement.scrollWidth);
  report[name].phoneScrollW = phoneScroll;
  await page.close();
  console.log(`captured ${name}`);
}

writeFileSync('/tmp/rf-report.json', JSON.stringify(report, null, 1));
await browser.close();

for (const [n, r] of Object.entries(report)) {
  console.log(`\n=== ${n} ===`);
  console.log(`  panels=${r.panels} buttons=${r.buttons.length} selects=${r.selects.length} inputs=${r.inputs.length} tables=${r.tables.length} chars=${r.bodyChars}`);
  console.log(`  phone scrollWidth=${r.phoneScrollW} (>400 means horizontal overflow)`);
  if (r.tables.length) r.tables.forEach((t, i) => console.log(`  table${i}: ${t.rows} rows, ${t.headers.length} cols [${t.headers.join(', ')}]`));
  if (r.treeEdges) {
    console.log(`  catalog tree left-edges: [${r.treeEdges.join(', ')}]` +
      (r.treeEdges.length > 1 ? '  OK (levels are distinct)' : '  FLAT — no indentation'));
  }
  if (r.consoleErrors.length) console.log(`  console errors: ${r.consoleErrors.join(' | ')}`);
}

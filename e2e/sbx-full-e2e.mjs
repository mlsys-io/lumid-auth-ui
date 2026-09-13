// Deep + wide e2e for /studio/research-fleet/sandboxes.
//
// Drives the REAL page against the live deploy. Everything here is asserted on
// what the DOM/API actually did, never on "the code says". Creates one real
// sandbox and cleans it up; everything else is read-only.
//
// Sections: A auth+shell · B site strip · C dialog controls · D data dropdown
// E datasets panel · F ssh keys · G ports · H real create→table→delete
// I docs links · J responsive · K console/network errors
import { chromium } from 'playwright';
import { launchBrowser } from './_browser.mjs';

const BASE = process.env.BASE || 'https://lum.id';
const PW = process.env.LUMID_PW || 'admin123';
const URL = BASE + '/studio/research-fleet/sandboxes';
const pass = [], fail = [], warn = [];
const ok = (c, m) => (c ? pass : fail).push(m);

const lr = await fetch(`${BASE}/api/v1/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'admin@lum.id', password: PW }),
});
if (!lr.ok) { console.log('LOGIN FAILED', lr.status); process.exit(1); }
const setc = lr.headers.getSetCookie?.() || [];
const token = (await lr.json())?.data?.token;
ok(!!token, 'A1 login returns a bearer');

const browser = await launchBrowser(chromium);
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await ctx.addCookies(setc.map(c => c.split(';')[0]).map(kv => {
  const [name, ...v] = kv.split('=');
  return { name, value: v.join('='), domain: 'lum.id', path: '/' };
}));
const p = await ctx.newPage();
const consoleErrs = [], netFails = [];
p.on('console', m => { if (m.type() === 'error') consoleErrs.push(m.text().slice(0, 160)); });
p.on('response', r => { if (r.status() >= 500) netFails.push(`${r.status()} ${r.url().slice(0, 110)}`); });

await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await p.waitForTimeout(6000);

const vis = async (l) => (await l.count()) > 0 && await l.first().isVisible().catch(() => false);
const btn = (re) => p.getByRole('button', { name: re });

// ---- A shell ----
ok(!/\/auth\/login/.test(p.url()), 'A2 stays on the tab (not bounced to login)');
ok(await vis(btn(/^New sandbox$/)), 'A3 "New sandbox" toolbar button');

// ---- B site strip ----
const body = await p.locator('body').innerText();
ok(/home/i.test(body), 'B1 home listed');
ok(/office/i.test(body), 'B2 office listed');
ok(/nus/i.test(body), 'B3 nus listed (admin)');
if (/did not answer|incomplete/i.test(body)) warn.push('B4 a site is not answering right now');

// ---- F ssh keys + E datasets reachable WITHOUT the dialog ----
ok(await vis(btn(/SSH keys|No SSH keys/)), 'F1 SSH keys reachable from the toolbar');
ok(await vis(btn(/^Datasets/)), 'E1 Datasets reachable from the toolbar');

// ---- E datasets panel ----
await btn(/^Datasets/).first().click(); await p.waitForTimeout(1200);
const dsTxt = await p.locator('body').innerText();
ok(/read-only|\/datasets/i.test(dsTxt), 'E2 panel explains the read-only mount');
ok(await vis(p.getByPlaceholder('my-corpus')), 'E3 publish form present (writable site)');
ok(/512 MB|50 GB|10 datasets/.test(dsTxt), 'E4 limits shown');
await btn(/^Datasets/).first().click(); await p.waitForTimeout(500);

// ---- F ssh keys panel ----
await btn(/SSH keys|No SSH keys/).first().click(); await p.waitForTimeout(1000);
ok(await vis(p.getByPlaceholder(/ssh-ed25519/)), 'F2 key paste field');
await btn(/SSH keys|No SSH keys/).first().click(); await p.waitForTimeout(400);

// ---- C dialog controls ----
await btn(/^New sandbox$/).first().click(); await p.waitForTimeout(1000);
const dlg = await p.locator('body').innerText();
ok(await vis(btn(/Create sandbox/)), 'C1 dialog opens');
ok(/Name/.test(dlg), 'C2 name field');
ok(/GPU/i.test(dlg), 'C3 GPU field');
ok(/Expires after/.test(dlg), 'C4 TTL field');
ok(/Image/.test(dlg), 'C5 image field');
ok(!/3d|7d|168/.test(dlg.match(/Expires after[\s\S]{0,120}/)?.[0] || ''), 'C6 TTL offers nothing above 24h');

// ---- D data dropdown ----
ok(/Data/.test(dlg), 'D1 Data control present');
const det = p.locator('details').filter({ hasText: 'Data' });
ok(await det.count() > 0, 'D2 Data is a dropdown (details), not an always-open list');
if (await det.count()) {
  await det.first().locator('summary').click(); await p.waitForTimeout(600);
  const dd = await det.first().innerText();
  ok(/Lumid Data/.test(dd) && /FinData/.test(dd) && /LQT/.test(dd), 'D3 all three stores offered');
  ok(/NOT attributed|anon-read|own PAT/i.test(dd), 'D4 auth model shown per source');
  const boxes = det.first().locator('input[type=checkbox]');
  const n = await boxes.count();
  ok(n >= 3, `D5 multi-select preserved (${n} checkboxes)`);
  if (n >= 2) {
    await boxes.nth(0).check(); await boxes.nth(1).check(); await p.waitForTimeout(300);
    ok(await boxes.nth(0).isChecked() && await boxes.nth(1).isChecked(), 'D6 two sources can be attached at once');
    await boxes.nth(0).uncheck(); await boxes.nth(1).uncheck();
  }
}

// ---- G ports ----
ok(/Public ports/.test(dlg), 'G1 ports control present');
ok(/free at this site/.test(dlg), 'G2 pool free/total shown before choosing');

// ---- H real round trip ----
const name = 'e2e' + Date.now().toString().slice(-6);
const api = async (m, path, b) => {
  const r = await fetch(BASE + path, {
    method: m, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: b ? JSON.stringify(b) : undefined,
  });
  return { s: r.status, j: await r.json().catch(() => null) };
};
const cr = await api('POST', '/sbx/api/sandboxes', { name, image: 'python:3.11-slim', ttl_hours: 1 });
ok(cr.s === 200, `H1 create via API (${cr.s})`);
if (cr.s === 200) {
  await p.keyboard.press('Escape').catch(() => {});
  await p.reload({ waitUntil: 'domcontentloaded' }); await p.waitForTimeout(7000);
  const t = await p.locator('body').innerText();
  ok(t.includes(name), 'H2 the new sandbox appears in the table');
  ok(/ssh -p \d+ gw@lum\.id/.test(t), 'H3 a connect string is shown');
  const del = await api('DELETE', `/sbx/api/sandboxes/${name}`);
  ok(del.s === 200, `H4 delete (${del.s})`);
}

// ---- I docs ----
const hrefs = await p.locator('a[href^="/studio/docs"]').evaluateAll(a => a.map(x => x.getAttribute('href')));
ok(hrefs.includes('/studio/docs/sandboxes'), 'I1 sandbox guide linked');
ok(hrefs.includes('/studio/docs/flowmesh-ssh'), 'I2 image guide linked');
for (const h of [...new Set(hrefs)]) {
  const r = await fetch(BASE + h, { headers: { Cookie: setc.map(c => c.split(';')[0]).join('; ') } });
  ok(r.status === 200, `I3 ${h} resolves (${r.status})`);
}

// ---- J responsive ----
const ctx2 = await browser.newContext({ viewport: { width: 400, height: 820 } });
await ctx2.addCookies((await ctx.cookies()));
const p2 = await ctx2.newPage();
await p2.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 }); await p2.waitForTimeout(6000);
const ov = await p2.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
ok(ov <= 2, `J1 no horizontal overflow at 400px (${ov}px)`);
await p2.getByRole('button', { name: /^New sandbox$/ }).first().click().catch(() => {});
await p2.waitForTimeout(900);
const cb = await p2.getByRole('button', { name: /Create sandbox/ }).first().boundingBox().catch(() => null);
ok(cb ? cb.y + cb.height <= 820 : false, 'J2 Create button on-screen at 400px');
const ov2 = await p2.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
ok(ov2 <= 2, `J3 no overflow with the dialog open (${ov2}px)`);

// ---- K errors ----
ok(netFails.length === 0, `K1 no 5xx responses${netFails.length ? ': ' + netFails.slice(0, 2).join(' | ') : ''}`);
if (consoleErrs.length) warn.push(`K2 ${consoleErrs.length} console error(s): ${consoleErrs.slice(0, 2).join(' | ')}`);

await browser.close();
console.log(`\nPASS ${pass.length}  FAIL ${fail.length}  WARN ${warn.length}`);
for (const w of warn) console.log('  WARN ' + w);
for (const f of fail) console.log('  FAIL ' + f);
if (!fail.length) console.log('  all assertions passed');
process.exit(fail.length ? 1 : 0);

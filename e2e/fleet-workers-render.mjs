// Does the Fleet tab actually SHOW office's workers?
//
// The API can answer 12 while the page still renders an empty site -- that is
// exactly the shape of the bug this guards (a healthy fleet displayed as an
// empty one). So assert on rendered text, not on a fetch.
import { chromium } from 'playwright';
import { launchBrowser } from './_browser.mjs';

const BASE = process.env.BASE || 'https://lum.id';
const PW = process.env.LUMID_PW || 'admin123';

const r = await fetch(`${BASE}/api/v1/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'admin@lum.id', password: PW }),
});
if (!r.ok) { console.log('LOGIN FAILED', r.status); process.exit(1); }
const cookie = (r.headers.getSetCookie?.() || []).map(c => c.split(';')[0]).join('; ');

const browser = await launchBrowser(chromium);
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
await ctx.addCookies(cookie.split('; ').map(kv => {
  const [name, ...v] = kv.split('=');
  return { name, value: v.join('='), domain: 'lum.id', path: '/' };
}));
const p = await ctx.newPage();
await p.goto(BASE + '/studio/research-fleet', { waitUntil: 'domcontentloaded', timeout: 60000 });
await p.waitForTimeout(9000);

const body = await p.evaluate(() => document.body.innerText);
const fail = [];

// Worker aliases come from real boxes. Both sites run 0.1.9 enforcement now, so
// both can regress to an empty fleet -- check each, not just the one that broke.
const SITES = [
  { site: 'office', nodes: ['luyao0', 'luyao1', 'luyao2'] },
  { site: 'home', nodes: ['luyaomini1', 'luyaomini2', 'luyaomini3', 'luyaomini4', 'luyaomini5'] },
];
const seen = {};
for (const { site, nodes } of SITES) {
  if (!body.toLowerCase().includes(site)) fail.push(`no "${site}" site on the Fleet tab`);
  const hit = nodes.filter(n => body.includes(n));
  seen[site] = hit;
  if (hit.length === 0)
    fail.push(`no ${site} node alias (${nodes.join('/')}) rendered — ${site} shows as empty`);
  // A site strip that lists the site but renders zero rows is the exact regression.
  if (new RegExp(`${site}[^\\n]*\\b0\\s+workers?\\b`, 'i').test(body))
    fail.push(`${site} still rendered as "0 workers"`);
}

await p.screenshot({ path: '/tmp/fleet-office.png', fullPage: false }).catch(() => {});
await browser.close();
for (const [site, hit] of Object.entries(seen))
  console.log(`${site} node aliases rendered:`, hit.join(', ') || '(none)');
console.log(fail.length ? 'FAIL:\n  ' + fail.join('\n  ') : 'PASS — home and office workers render on the Fleet tab');
process.exit(fail.length ? 1 : 0);

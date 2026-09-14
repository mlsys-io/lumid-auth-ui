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

// Office's worker aliases come from real boxes; luyao0/1/2 are office nodes.
const officeNodes = ['luyao0', 'luyao1', 'luyao2'].filter(n => body.includes(n));
if (!body.toLowerCase().includes('office')) fail.push('no "office" site on the Fleet tab');
if (officeNodes.length === 0)
  fail.push('no office node alias (luyao0/1/2) rendered — office still shows as empty');

// A site strip that lists office but renders zero rows is the exact regression.
const zeroish = /office[^\n]*\b0\s+workers?\b/i.test(body);
if (zeroish) fail.push('office still rendered as "0 workers"');

await p.screenshot({ path: '/tmp/fleet-office.png', fullPage: false }).catch(() => {});
await browser.close();
console.log('office node aliases rendered:', officeNodes.join(', ') || '(none)');
console.log(fail.length ? 'FAIL:\n  ' + fail.join('\n  ') : 'PASS — office workers render on the Fleet tab');
process.exit(fail.length ? 1 : 0);

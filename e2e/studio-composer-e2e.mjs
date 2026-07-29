// Studio composer polish e2e (v0.5.86) — verifies the three composer changes:
//   1. Working-context ("Context") chip sits to the LEFT of the model chip.
//   2. The Crosshair "pick a UI element" selector is REMOVED.
//   3. The "what should I do" starter chips are REMOVED from the empty state.
// Env: LUMID_BASE (default https://lum.id), LUMID_EMAIL, LUMID_PASSWORD.

import { chromium } from 'playwright';

const BASE  = process.env.LUMID_BASE  || 'https://lum.id';
const EMAIL = process.env.LUMID_EMAIL || 'admin@lum.id';
const PW    = process.env.LUMID_PASSWORD;
if (!PW) { console.error('LUMID_PASSWORD required'); process.exit(2); }

const fails = [];
const assert = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fails.push(msg); };

const loginRes = await fetch(`${BASE}/api/v1/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, password: PW }),
});
assert(loginRes.status === 200, `login ${EMAIL} → 200 (got ${loginRes.status})`);
const m = (loginRes.headers.get('set-cookie') || '').match(/lm_session=([^;]+)/);
assert(!!m, 'lm_session cookie issued');
if (!m) process.exit(1);

const b = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const ctx = await b.newContext();
await ctx.addCookies([{ name: 'lm_session', value: m[1], domain: '.lum.id', path: '/', httpOnly: true, secure: true, sameSite: 'Lax' }]);
const page = await ctx.newPage();

await page.goto(`${BASE}/studio`, { waitUntil: 'networkidle', timeout: 45000 });
await page.waitForTimeout(3500);

// The composer + its chips.
const modelChip = page.locator('button[title="Choose the AI model"]');
const ctxChip   = page.locator('button[title^="Working context"]');
await modelChip.first().waitFor({ timeout: 15000 }).catch(() => {});

assert(await ctxChip.count() >= 1,  'Context (working-context) chip renders');
assert(await modelChip.count() >= 1, 'Model chip renders');

// 1. Context chip LEFT of model chip (smaller x).
if (await ctxChip.count() && await modelChip.count()) {
  const cb = await ctxChip.first().boundingBox();
  const mb = await modelChip.first().boundingBox();
  assert(cb && mb && cb.x < mb.x, `Context chip is LEFT of Model chip (ctx.x=${cb?.x?.toFixed(0)} < model.x=${mb?.x?.toFixed(0)})`);
}

// 2. Crosshair "pick a UI element" selector removed.
const picker = page.locator('button[aria-label*="pick" i][aria-label*="UI element" i], button[title*="Pick a UI element" i]');
assert(await picker.count() === 0, 'Crosshair "pick a UI element" selector is removed');

// 3. "what should I do" starter chips removed from the empty state.
const bodyText = await page.locator('body').innerText();
const starter = page.getByRole('button', { name: /what should i do next\?/i });
assert(await starter.count() === 0, '"what should I do next?" starter chip is removed');

await page.screenshot({ path: '/tmp/studio-composer.png', fullPage: false });
await b.close();
console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS');
process.exit(fails.length ? 1 : 0);

// Studio per-app UI journey — the render-level check the API-only dogfood lacked.
// Drives the REAL /studio/apps/<app> page in a browser (system Chrome via
// Playwright channel:'chrome') with a real lm_session, and asserts the sidebar
// entry + Workflow tab + Data tab render — plus that no /me/* call 404s.
//
// Why this exists: the qa-sentinel dogfood was API-plane only; "endpoint returns
// data" != "page renders". Sidebar/workflow/dataset regressions only show when a
// browser loads the page. Run this against the live stack in CI/dogfood.
//
// Prereqs: `npm i playwright` + a system Chrome (google-chrome-stable);
//   playwright's own chromium download is unreliable in some sandboxes.
// Env: LUMID_BASE (default https://lum.id), LUMID_EMAIL, LUMID_PASSWORD, APP.
// Exit 0 = all assertions pass; non-zero = a regression.

import { chromium } from 'playwright';

const BASE  = process.env.LUMID_BASE  || 'https://lum.id';
const EMAIL = process.env.LUMID_EMAIL || 'admin@lum.id';
const PW    = process.env.LUMID_PASSWORD;
const APP   = process.env.APP || 'venue-link-matcher';
if (!PW) { console.error('LUMID_PASSWORD required'); process.exit(2); }

const fails = [];
const assert = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fails.push(msg); };

// 1. Log in via the REST API → capture lm_session (avoids scripting the form).
const loginRes = await fetch(`${BASE}/api/v1/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, password: PW }),
});
assert(loginRes.status === 200, `login ${EMAIL} → 200 (got ${loginRes.status})`);
const setCookie = loginRes.headers.get('set-cookie') || '';
const m = setCookie.match(/lm_session=([^;]+)/);
assert(!!m, 'lm_session cookie issued');
if (!m) process.exit(1);

// 2. Drive the page.
const b = await chromium.launch({ headless: true, channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const ctx = await b.newContext();
await ctx.addCookies([{ name: 'lm_session', value: m[1], domain: '.lum.id', path: '/', httpOnly: true, secure: true, sameSite: 'Lax' }]);
const page = await ctx.newPage();
const api404 = [];
page.on('response', r => { const u = r.url(); if (u.includes('/api/v1/me/') && r.status() === 404) api404.push(u.replace(BASE, '')); });

await page.goto(`${BASE}/studio/apps/${APP}`, { waitUntil: 'networkidle', timeout: 45000 });
await page.waitForTimeout(4000);
const text = await page.locator('body').innerText();

// 3. Assertions — the three surfaces the user reported empty.
assert(/Venue Link Matcher|venue-link-matcher/i.test(text) && text.includes('Agents'), 'sidebar shows the app under Agents');
assert(/\d+ workflows?|Match cycle|match_cycle/i.test(text), 'Workflow tab renders workflows (not empty)');
assert(!text.includes('No mounted dataset repo'), 'Data tab shows a mounted dataset (not the empty message)');
assert(api404.length === 0, `no /me/* 404s (saw: ${api404.join(', ') || 'none'})`);

await page.screenshot({ path: `/tmp/studio-${APP}.png`, fullPage: true });
await b.close();

console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS');
process.exit(fails.length ? 1 : 0);

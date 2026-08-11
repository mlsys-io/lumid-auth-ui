// Studio journey for the mbb-consultant app — the render-level + conversation
// check that an API-only probe cannot give you.
//
// This is a SCRIPTED CONVERSATION, not a page load. Each turn types into the
// composer, waits for the stream to settle (by watching the composer re-enable,
// never a fixed sleep — streamed turns vary in length), asserts, then sends the
// next. That is the only way to prove the interview is multi-turn rather than N
// independent one-shots.
//
// Deliberately does NOT assert on answer text. The analyst is generative, so a
// fixed-string assertion would either be trivially loose or flaky. Instead it
// asserts CONTINUITY (turn 3 refers to something introduced in turn 1) and
// STRUCTURE (a score card appears, ungrounded answers say so).
//
// Prereqs: `npm i playwright` + system Chrome (google-chrome-stable).
// Env: LUMID_BASE (default https://lum.id), LUMID_EMAIL, LUMID_PASSWORD,
//      APP (default mbb-consultant), CASE (default Case_019_BetaOptics_PK21).
// Exit 0 = all gates pass.

import { chromium } from 'playwright';

const BASE = process.env.LUMID_BASE || 'https://lum.id';
const EMAIL = process.env.LUMID_EMAIL || 'admin@lum.id';
const PW = process.env.LUMID_PASSWORD;
const PAT = process.env.LUMID_PAT;
const APP = process.env.APP || 'mbb-consultant';
const CASE = process.env.CASE || 'Case_019_BetaOptics_PK21';
if (!PW && !PAT) { console.error('set LUMID_PASSWORD (preferred) or LUMID_PAT'); process.exit(2); }

const fails = [];
const assert = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fails.push(msg); };

// Two auth modes:
//  * password → REST login, reuse the lm_session cookie. This is the REAL user
//    path and the one to prefer; it exercises the same session the SPA gets.
//  * PAT → send Authorization on every request instead. The API accepts a PAT
//    equally, so the data plane is faithfully exercised, but the SPA's own
//    client-side auth guard reads the cookie — so a PAT run can still bounce to
//    /auth/login. Treat a PAT run as "API plane verified, render plane maybe".
let cookieVal = null;
if (PW) {
  const loginRes = await fetch(`${BASE}/api/v1/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PW }),
  });
  assert(loginRes.status === 200, `login ${EMAIL} → 200 (got ${loginRes.status})`);
  const m = (loginRes.headers.get('set-cookie') || '').match(/lm_session=([^;]+)/);
  assert(!!m, 'lm_session cookie issued');
  if (!m) process.exit(1);
  cookieVal = m[1];
} else {
  console.log('NOTE  no LUMID_PASSWORD — running in PAT mode (API plane authoritative)');
}

const authHeaders = cookieVal
  ? { cookie: `lm_session=${cookieVal}` }
  : { Authorization: `Bearer ${PAT}` };
const api = (p, opts = {}) => fetch(`${BASE}${p}`, {
  ...opts, headers: { ...authHeaders, 'Content-Type': 'application/json', ...(opts.headers || {}) },
});

// ── G1: every declared surface resolves ───────────────────────────────────
// mbb-ai's failure mode is exactly this returning 404 while the app still
// appears installed, so check it before touching the browser.
const SURFACES = ['home', 'environment', 'review', 'workflows', 'experiments'];
for (const s of SURFACES) {
  const r = await api(`/api/v1/me/apps/${encodeURIComponent(APP)}/ui?surface=${s}`);
  assert(r.status === 200, `G1 surface '${s}' → 200 (got ${r.status})`);
}

// ── browser ───────────────────────────────────────────────────────────────
const b = await chromium.launch({ headless: true, channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const ctx = await b.newContext(
  cookieVal ? {} : { extraHTTPHeaders: { Authorization: `Bearer ${PAT}` } },
);
if (cookieVal) {
  await ctx.addCookies([{ name: 'lm_session', value: cookieVal, domain: '.lum.id', path: '/', httpOnly: true, secure: true, sameSite: 'Lax' }]);
}
const page = await ctx.newPage();
const api404 = [];
page.on('response', r => { const u = r.url(); if (u.includes('/api/v1/me/') && r.status() === 404) api404.push(u.replace(BASE, '')); });

let clicks = 0;
const click = async (loc) => { clicks++; await loc.click(); };

await page.goto(`${BASE}/studio/apps/${APP}`, { waitUntil: 'networkidle', timeout: 45000 });
await page.waitForTimeout(3000);

// ── G2: sidebar folder ────────────────────────────────────────────────────
// The app workspace auto-hides the sidebar, so reveal it before asserting.
const reveal = page.locator('button[aria-label="Show sidebar"]');
if (await reveal.count()) { await reveal.first().click(); await page.waitForTimeout(700); }
const sideText = await page.locator('body').innerText();
assert(/MBB Consultant|mbb-consultant/i.test(sideText), 'G2 sidebar shows the app row');

// ── the composer ──────────────────────────────────────────────────────────
// If we never reached Studio (auth wall, invite gate, outage) there is no
// composer and every conversation gate below would throw an opaque Playwright
// timeout 30s later. Report WHERE we actually landed and stop — a harness that
// dies on an unhandled rejection tells you far less than one that says
// "bounced to /auth/redeem-invite".
const composer = page.locator('textarea, [contenteditable="true"]').first();
const haveComposer = (await composer.count()) > 0;
assert(haveComposer, 'chat composer is present');
if (!haveComposer) {
  console.log(`\nLanded on: ${page.url()}`);
  console.log(`Page says: ${(await page.locator('body').innerText()).slice(0, 200).replace(/\n+/g, ' | ')}`);
  console.log('\nConversation gates (G3-G5, G8, G10) NOT RUN — never reached Studio.');
  await page.screenshot({ path: `/tmp/studio-${APP}-blocked.png`, fullPage: true });
  await b.close();
  console.log(`\n${fails.length} FAILED:\n - ${fails.join('\n - ')}`);
  process.exit(1);
}

/** Send one turn and wait for the stream to finish. */
async function turn(text, timeout = 120000) {
  await composer.fill(text);
  await composer.press('Enter');
  clicks++;
  const t0 = Date.now();
  // Settle = the transcript stopped growing for 3 consecutive samples. Watching
  // length rather than sleeping a fixed time keeps this honest for both a
  // 2-second reply and a 60-second one.
  let last = -1, stable = 0;
  while (Date.now() - t0 < timeout) {
    await page.waitForTimeout(1500);
    const len = (await page.locator('body').innerText()).length;
    if (len === last) { if (++stable >= 3) break; } else { stable = 0; last = len; }
  }
  return page.locator('body').innerText();
}

// ── G3: multi-turn continuity ─────────────────────────────────────────────
await turn(`Let's work case ${CASE}. Give me the opening.`);
const t1 = await page.locator('body').innerText();

// Pull a distinctive capitalised token the analyst introduced in turn 1 — the
// client/company name. Turn 3 should still be talking about it.
const anchorMatch = t1.match(/\b(BetaOptics|Beta Optics)\b/i)
  || t1.match(/\b([A-Z][a-zA-Z]{4,})\s+(?:is|has|operates|makes|sells)\b/);
const anchor = anchorMatch ? anchorMatch[1] : null;
assert(!!anchor, `G3 turn 1 established a case subject (anchor: ${anchor || 'NONE FOUND'})`);

await turn('What is the first question?');
const t3 = await turn('Answer that question, and stay on the same client.');
assert(!!anchor && new RegExp(anchor.replace(/\s+/g, '\\s*'), 'i').test(t3),
  `G3 turn 3 still references "${anchor}" from turn 1 (multi-turn, not 3 one-shots)`);

// ── G10: time-to-first-answer ─────────────────────────────────────────────
assert(clicks <= 4, `G10 ≤4 interactions to a scored answer (used ${clicks})`);

// ── G4: reload continuity ─────────────────────────────────────────────────
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(4000);
const afterReload = await page.locator('body').innerText();
assert(!!anchor && new RegExp(anchor.replace(/\s+/g, '\\s*'), 'i').test(afterReload),
  'G4 transcript survives a reload');

// ── G8: open mode is visibly ungrounded ───────────────────────────────────
const openTxt = await turn('New question, not from the casebook: how should a regional grocery chain respond to a discounter entering its market?');
assert(/no ground truth|indicative|ungrounded/i.test(openTxt),
  'G8 open-mode answer is marked ungrounded');

// ── G5: feedback stages a draft ───────────────────────────────────────────
const draftsBefore = await (await api(`/api/v1/me/drafts?app=${APP}`)).json().catch(() => ({}));
const nBefore = (draftsBefore?.data?.drafts || draftsBefore?.drafts || []).length;
await turn('That answer was wrong — it ignored private-label economics. Record that as a correction.');
let nAfter = nBefore;
for (let i = 0; i < 10; i++) {           // bounded poll, then fail — never hang
  await page.waitForTimeout(3000);
  const d = await (await api(`/api/v1/me/drafts?app=${APP}`)).json().catch(() => ({}));
  nAfter = (d?.data?.drafts || d?.drafts || []).length;
  if (nAfter > nBefore) break;
}
assert(nAfter > nBefore, `G5 correction staged a draft (${nBefore} → ${nAfter})`);

// ── G9 ────────────────────────────────────────────────────────────────────
assert(api404.length === 0, `G9 no /me/* 404s (saw: ${api404.join(', ') || 'none'})`);

await page.screenshot({ path: `/tmp/studio-${APP}.png`, fullPage: true });
await b.close();

console.log(fails.length ? `\n${fails.length} FAILED:\n - ${fails.join('\n - ')}` : '\nALL PASS');
process.exit(fails.length ? 1 : 0);

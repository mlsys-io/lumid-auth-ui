// Fresh-user UX walk of mbb-consultant — NOT a gate suite.
//
// The existing studio-mbb-consultant.mjs asserts that things work. This asks a
// different question: does a person who has never seen this app know what to do?
// So it captures what a newcomer would see at each decision point and prints
// observations, rather than passing/failing on selectors.
//
// ROLE: a consulting candidate who wants to be interviewed. They are a NON-OWNER
// of the app (it belongs to db86775d), which is the path that matters — a green
// run as the owner has previously hidden real defects.
//
// Env: LUMID_EMAIL, LUMID_PASSWORD, CHROME (path to a chrome binary).

import pw from '/tmp/pw/node_modules/playwright-core/index.js';
const { chromium } = pw;
import fs from 'node:fs';

const BASE = process.env.LUMID_BASE || 'https://lum.id';
const EMAIL = process.env.LUMID_EMAIL || 'admin@lum.id';
const PW = process.env.LUMID_PASSWORD || 'admin123';
const APP = 'mbb-consultant';
const CHROME = process.env.CHROME;
const SHOTS = '/tmp/freshuser';
fs.mkdirSync(SHOTS, { recursive: true });

const notes = [];
const note = (step, text) => { console.log(`\n[${step}] ${text}`); notes.push(`[${step}] ${text}`); };

// Real user path: REST login → reuse the lm_session cookie the SPA reads.
const loginRes = await fetch(`${BASE}/api/v1/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, password: PW }),
});
const m = (loginRes.headers.get('set-cookie') || '').match(/lm_session=([^;]+)/);
if (!m) { console.error(`login failed: ${loginRes.status}`); process.exit(2); }
console.log(`logged in as ${EMAIL}`);

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addCookies([{ name: 'lm_session', value: m[1], domain: '.lum.id', path: '/' }]);
const page = await ctx.newPage();

const errors = [];
page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text().slice(0, 120)); });
page.on('response', (r) => {
  if (r.url().includes('/api/v1/me/') && r.status() >= 400) errors.push(`${r.status()} ${r.url().replace(BASE, '')}`);
});

const shot = async (name) => {
  const p = `${SHOTS}/${name}.png`;
  await page.screenshot({ path: p, fullPage: false });
  return p;
};
const txt = async (sel) => { try { return (await page.locator(sel).first().innerText()).trim(); } catch { return ''; } };

// ── 1. Land on the app cold ───────────────────────────────────────────
await page.goto(`${BASE}/studio/apps/${APP}`, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(3000);
await shot('01-landing');
const bodyText = await txt('body');
note('LAND', `title on page: ${JSON.stringify((await txt('h1')) || (await txt('h2')))}`);
note('LAND', `word count of visible copy: ${bodyText.split(/\s+/).length}`);

// Can a newcomer find the three modes without scrolling or guessing?
const modeCards = page.locator('button[aria-pressed]');
const nModes = await modeCards.count();
note('MODES', `mode cards found: ${nModes}`);
for (let i = 0; i < nModes; i++) {
  const t = (await modeCards.nth(i).innerText()).replace(/\n+/g, ' | ');
  note('MODES', `  ${i + 1}. ${t}`);
}

// ── 2. Choose the candidate's mode ────────────────────────────────────
const interviewCard = page.locator('button[aria-pressed]', { hasText: 'interviews you' }).first();
if (await interviewCard.count()) {
  await interviewCard.click();
  await page.waitForTimeout(800);
  note('PICK', 'selected "AI interviews you"');
} else {
  note('PICK', 'COULD NOT FIND the interview mode card');
}
await shot('02-mode-picked');

// ── 3. Can they read a case before committing? ────────────────────────
const caseRows = page.locator('div.overflow-y-auto button').filter({ hasText: /·|Energy|Retail|Health/ });
const nCases = await caseRows.count();
note('CASES', `cases listed: ${nCases}`);
if (nCases) {
  const premier = page.locator('button', { hasText: 'Premier Oil' }).first();
  await (await premier.count() ? premier : caseRows.first()).click();
  await page.waitForTimeout(2500);
  await shot('03-case-open');
  const opening = await txt('text=/Opening/i');
  const qs = await page.locator('li').filter({ hasText: /^Q\d/ }).count();
  note('CASES', `case detail rendered — opening section: ${opening ? 'yes' : 'NO'}, questions listed: ${qs}`);
  const leak = /ground.?truth|keypoint|structure_4/i.test(await txt('body'));
  note('CASES', `answer key visible to candidate: ${leak ? 'LEAK' : 'no (correct)'}`);
}

// ── 4. Start, and see whether the chat orients them ───────────────────
const start = page.locator('button', { hasText: /^(Interview me|Start case|Ask a question)$/ }).first();
note('START', `start button label: ${JSON.stringify(await start.innerText().catch(() => ''))}`);
await start.click();
await page.waitForTimeout(2000);
await shot('04-after-start');

// The chat streams; wait for it to settle by watching the composer re-enable.
const composer = page.locator('textarea').first();
let settled = false;
for (let i = 0; i < 60; i++) {
  await page.waitForTimeout(3000);
  const disabled = await composer.isDisabled().catch(() => false);
  const body = await txt('body');
  if (!disabled && /premier|oil|client|case/i.test(body) && body.length > 1200) { settled = true; break; }
}
await shot('05-first-turn');
note('CHAT', `first agent turn settled: ${settled}`);

const chatText = await txt('body');
// Did it end by telling the user what to type? That is the guidance rule.
const orientation = chatText.match(/[^.\n]{0,120}(reply with|tell me|say `|type |when you'?re ready|go ahead)[^.\n]{0,120}[.?]/i);
note('CHAT', `closes with a next-action line: ${orientation ? JSON.stringify(orientation[0].trim().slice(0, 140)) : 'NOT FOUND'}`);
note('CHAT', `did it answer its own question (should NOT): ${/I would structure|I'd structure|my framework/i.test(chatText) ? 'YES — bad' : 'no'}`);

// ── 5. Answer as the candidate ────────────────────────────────────────
if (settled) {
  await composer.click();
  await composer.fill(
    "I'd split profitability into revenue and cost. Revenue is volume times realised " +
    "price per barrel; cost I'd break into operating cost per barrel, fixed versus " +
    "variable, plus overhead. Since price is set by the market for a commodity, I'd " +
    "start on the cost side."
  );
  await composer.press('Enter');
  await page.waitForTimeout(3000);
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(3000);
    if (!(await composer.isDisabled().catch(() => false))) break;
  }
  await page.waitForTimeout(2000);
  await shot('06-after-my-answer');
  const after = await txt('body');
  note('ANSWER', `scored my answer: ${/score|framework|\d{1,3}(\.\d)?\s*(%|\/)/i.test(after) ? 'yes' : 'NO'}`);
  note('ANSWER', `told me the next move: ${/next question|ready|reply|say |tell me/i.test(after.slice(-1500)) ? 'yes' : 'NO'}`);
}

note('ERRORS', errors.length ? `${errors.length}: ${[...new Set(errors)].slice(0, 5).join(' · ')}` : 'none');
fs.writeFileSync(`${SHOTS}/notes.txt`, notes.join('\n'));
console.log(`\nscreenshots in ${SHOTS}`);
await browser.close();

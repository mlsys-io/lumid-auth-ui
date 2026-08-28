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

// Was a hardcoded '/tmp/pw/node_modules/playwright-core/index.js'. /tmp is
// scratch and gets cleared, so this import threw and the walk could not run at
// all -- which is part of why it produced no observations. Its sibling
// studio-mbb-consultant.mjs imports the package normally; match it.
import { chromium } from 'playwright';
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

// The chat rail ONLY. Asserting against `body` is how this script lied three
// times on its first run: the page copy says "ground truth" and "scored", and
// the launch prompt is echoed into the transcript, so a body scan finds the
// page talking to itself. Chat claims must be read from the chat.
// FOUR elements carry data-studio-picker-chrome (sidebar, top strip, rail…),
// and .last() picked an empty one — which is why this reported "" while the
// screenshot plainly showed the interview working. The chat rail is the only
// one containing the composer, so identify it by that.
const chatPanel = () =>
  page.locator('[data-studio-picker-chrome="1"]').filter({ has: page.locator('textarea') }).last();
const chatText = async () => {
  try { return (await chatPanel().innerText()).trim(); } catch { return ''; }
};
// The agent's turns only — excludes the user's own bubble, so an assertion
// cannot match the prompt we injected.
const agentText = async () => {
  const all = await chatText();
  const i = all.indexOf(LAUNCH_MARKER);
  return i >= 0 ? all.slice(i + LAUNCH_MARKER.length) : all;
};
let LAUNCH_MARKER = '';

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
  // Scope to the case pane — the PAGE copy legitimately says "ground truth".
  const pane = await txt('div:has(> div:text-matches("Opening", "i"))');
  const leak = /keypoint|structure_4|minimum_expected/i.test(pane);
  note('CASES', `answer key visible to candidate: ${leak ? 'LEAK' : 'no (correct)'}`);
}

// ── 4. Start, and see whether the chat orients them ───────────────────
const start = page.locator('button', { hasText: /^(Interview me|Start case|Ask a question)$/ }).first();
LAUNCH_MARKER = 'give me the opening';
note('START', `start button label: ${JSON.stringify(await start.innerText().catch(() => ''))}`);
await start.click();
await page.waitForTimeout(2000);
await shot('04-after-start');

// The chat streams; wait for it to settle by watching the composer re-enable.
const composer = page.locator('textarea').first();

// Settle = the rail stops showing Thinking…/Working…. The composer stays
// ENABLED during a turn (it queues: "sends when current turn finishes"), so
// isDisabled() is useless here and made every wait a no-op.
const settle = async (maxMs = 240000) => {
  const t0 = Date.now();
  let quiet = 0;
  while (Date.now() - t0 < maxMs) {
    await page.waitForTimeout(2500);
    const t = await chatText();
    if (/Thinking…|Working…|MESSAGE QUEUED/i.test(t)) { quiet = 0; continue; }
    if (++quiet >= 2) return true;   // two clean reads — streaming has stopped
  }
  return false;
};
const settled = await settle();
await shot('05-first-turn');
note('CHAT', `first agent turn settled: ${settled}`);

const agent = await agentText();
// Did it end by telling the user what to type? That is the guidance rule.
const orientation = agent.match(/[^.\n]{0,120}(reply with|tell me|say `|type |when you'?re ready|go ahead)[^.\n]{0,120}[.?]/i);
note('CHAT', `closes with a next-action line: ${orientation ? JSON.stringify(orientation[0].trim().slice(0, 140)) : 'NOT FOUND'}`);
note('CHAT', `did it answer its own question (should NOT): ${/I would structure|I'd structure|my framework/i.test(agent) ? 'YES — bad' : 'no'}`);
note('CHAT', `visible prompt leaks internals: ${/case\(case_id=|procedure\.md|role="interviewer"/.test(await chatText()) ? 'YES — bad' : 'no'}`);
note('CHAT', `agent opening (first 200 chars): ${JSON.stringify(agent.slice(0, 200))}`);

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
  await page.waitForTimeout(2000);
  const replied = await settle();
  note('ANSWER', `second turn settled: ${replied}`);
  await shot('06-after-my-answer');
  const after = await agentText();
  note('ANSWER', `agent replied to my answer: ${after.length > 200 ? 'yes' : 'NO (still thinking / queued)'}`);
  note('ANSWER', `scored it: ${/score|framework|\d{1,3}(\.\d)?\s*(%|\/)/i.test(after) ? 'yes' : 'NO'}`);
  // A trailing QUESTION is the commonest way an interviewer hands the turn
  // back — "which would you dig into first?" is the next move. Matching only
  // imperative phrasing scored a perfectly good turn as guidance-free.
  const tail = after.trim().slice(-400);
  note('ANSWER', `told me the next move: ${/\?\s*$|next question|ready|reply|tell me|go ahead/i.test(tail) ? 'yes' : 'NO'}`);
  note('ANSWER', `last 200 chars: ${JSON.stringify(after.slice(-200))}`);
}

note('ERRORS', errors.length ? `${errors.length}: ${[...new Set(errors)].slice(0, 5).join(' · ')}` : 'none');
fs.writeFileSync(`${SHOTS}/notes.txt`, notes.join('\n'));
console.log(`\nscreenshots in ${SHOTS}`);
await browser.close();

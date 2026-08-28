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

// ── G1: every declared surface resolves, and resolves to a DIFFERENT doc ──
// mbb-ai's failure mode is exactly this returning 404 while the app still
// appears installed, so check it before touching the browser.
//
// The PATH form is required. This used to request `/ui?surface=<name>`, but the
// server routes on the path segment (c.Param("surface")) and ignores the query
// string — so every request returned `home`, five identical 200s counted as five
// passing surfaces, and the gate could not fail. It is also the form the SPA
// uses (src/api/me.ts), so the query form was not even testing the real path.
//
// Comparing bodies is the other half: five 200s that are the same document is
// precisely the bug that hid here, and only a distinctness check catches it.
const SURFACES = ['home', 'environment', 'review', 'workflows', 'experiments', 'results'];
const surfaceBodies = new Map();
for (const s of SURFACES) {
  const r = await api(`/api/v1/me/apps/${encodeURIComponent(APP)}/ui/${encodeURIComponent(s)}`);
  assert(r.status === 200, `G1 surface '${s}' → 200 (got ${r.status})`);
  surfaceBodies.set(s, await r.text());
}
assert(
  new Set(surfaceBodies.values()).size === SURFACES.length,
  `G1 each surface returns its own document (got ${new Set(surfaceBodies.values()).size} distinct of ${SURFACES.length})`,
);

// ── browser ───────────────────────────────────────────────────────────────
// channel:'chrome' requires Google Chrome to be INSTALLED, which it is not on
// the dev box -- so this suite could not launch at all there, which is part of
// why tier 4 had never run. Prefer the system Chrome when present (closest to
// what a user runs), fall back to Playwright's bundled chromium, which is
// already cached under ~/.cache/ms-playwright. CHROME=<path> overrides both.
const launchArgs = ['--no-sandbox', '--disable-dev-shm-usage'];
const b = process.env.CHROME
  ? await chromium.launch({ headless: true, executablePath: process.env.CHROME, args: launchArgs })
  : await chromium.launch({ headless: true, channel: 'chrome', args: launchArgs })
      .catch(() => chromium.launch({ headless: true, args: launchArgs }));
const ctx = await b.newContext(
  cookieVal ? {} : { extraHTTPHeaders: { Authorization: `Bearer ${PAT}` } },
);
if (cookieVal) {
  await ctx.addCookies([{ name: 'lm_session', value: cookieVal, domain: '.lum.id', path: '/', httpOnly: true, secure: true, sameSite: 'Lax' }]);
}
const page = await ctx.newPage();
const api404 = [];
page.on('response', r => { const u = r.url(); if (u.includes('/api/v1/me/') && r.status() === 404) api404.push(u.replace(BASE, '')); });
// Uncaught errors in the page. G5's failure mode is "the click produced
// nothing", and an exception thrown inside the click handler looks exactly
// like a handler that declined to act -- from outside, both are silence.
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)));


/** Wait for Studio to actually render (composer present), not just for a
 *  navigation event. Returns false if it never appears — the caller reports
 *  where we landed rather than dying on an opaque locator timeout later. */
async function waitForStudio(pg, timeout = 45000) {
  try {
    await pg.waitForSelector('textarea, [contenteditable="true"]', { timeout });
    await pg.waitForTimeout(1500);   // let the rest of the shell paint
    return true;
  } catch { return false; }
}

let clicks = 0;
const click = async (loc) => { clicks++; await loc.click(); };

// networkidle never fires here (Studio holds a chat stream open) and
// domcontentloaded fires BEFORE the SPA renders — so wait on the thing we
// actually need instead of on a proxy for it.
await page.goto(`${BASE}/studio/apps/${APP}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
await waitForStudio(page);

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
  //
  // Length alone is NOT enough, and this was the single flakiest thing in the
  // suite. While a tool runs the transcript shows a live ticker --
  // "Running case_open — 7s" -> "— 8s" -- which is the SAME LENGTH, so three
  // stable samples elapse and this returned mid-tool. Measured: turn 1's whole
  // visible output was "Thought for 9s / case_open / Running case_open — 7s",
  // i.e. the case had not been opened yet, so every downstream assertion that
  // reads case content failed. It depended on whether the tool call happened to
  // straddle the 4.5s window, which is exactly why G3/G4 failed on some runs
  // and passed on identical reruns.
  //
  // So settle = the transcript stopped growing AND nothing is still in flight.
  const BUSY = /Thinking…|Working…|Running\s|MESSAGE QUEUED/i;
  let last = -1, stable = 0;
  while (Date.now() - t0 < timeout) {
    await page.waitForTimeout(1500);
    const body = await page.locator('body').innerText();
    if (BUSY.test(body)) { stable = 0; last = body.length; continue; }
    if (body.length === last) { if (++stable >= 3) break; } else { stable = 0; last = body.length; }
  }
  return page.locator('body').innerText();
}

// ── G3: multi-turn continuity ─────────────────────────────────────────────
await turn(`Let's work case ${CASE}. Give me the opening.`);
const t1 = await page.locator('body').innerText();

// Anchor on something ONLY the analyst could have produced.
//
// This previously matched /BetaOptics/ against the whole page body — but that
// string is in the message the harness itself types
// ("Let's work case Case_019_BetaOptics_PK21"), so the assertion matched its
// own input echoed on screen and passed while the analyst was silent. A gate
// that can pass with the feature switched off is worse than no gate.
//
// The case body is the discriminator: Case_019 is a prescription-lens maker
// with a ~30% pandemic revenue decline weighing a digitisation investment.
// None of that appears in what we type, so matching it proves the analyst
// actually loaded and restated the case.
const typed = `Let's work case ${CASE}. Give me the opening.`;
const analystOnly = t1.split(typed).pop() || '';
const CASE_FACTS = /(lens|optical|eyeglass|prescription)/i;
const anchorMatch = analystOnly.match(CASE_FACTS);
const anchor = anchorMatch ? anchorMatch[1] : null;
assert(!!anchor, `G3 turn 1 restated case content the analyst had to load (matched: ${anchor || 'NOTHING — analyst produced no case-specific text'})`);

await turn('What is the first question?');
// Turn 3 drifted off-subject on some runs while turn 1 passed consistently —
// generative variance in one turn, not a broken feature. Pin the subject in the
// ask (a real interviewer would), and allow ONE retry so a single unlucky turn
// cannot fail a gate that is otherwise green. Retrying a flaky assertion is only
// honest when the thing under test is non-deterministic by nature; it is here.
// Ask something ONLY answerable from the loaded case, so a correct answer
// necessarily contains case content. The previous phrasing hoped turn 3's prose
// would happen to mention the industry — it did on some runs and not others,
// which is variance in one generative turn, not a continuity failure. A gate
// should not depend on which words a model reaches for.
// The retry the comment above promises was never actually implemented -- the
// reasoning was written down and the code went straight to a single-shot
// assert, so the gate has been strictly harsher than its own stated contract.
// Ask at most twice, and NEVER re-state the case in the retry: the whole point
// is that the model still holds it. Re-seeding would turn a continuity gate
// into a reading-comprehension one that cannot fail.
const T3_ASK = 'Without me repeating it: what industry is this client in, and what decision are they weighing?';
let t3Analyst = '';
for (let attempt = 0; attempt < 2; attempt++) {
  const t3 = await turn(attempt === 0
    ? T3_ASK
    : 'Answer that directly, in one sentence: the industry and the decision.');
  // Same discipline on turn 3: look only at text produced AFTER our last input.
  t3Analyst = t3.split(attempt === 0 ? T3_ASK : 'the industry and the decision.').pop() || '';
  if (CASE_FACTS.test(t3Analyst)) break;
}
assert(!!anchor && CASE_FACTS.test(t3Analyst),
  `G3 turn 3 recalls the case without being re-told it (multi-turn, not 3 one-shots)`);

// ── G10: time-to-first-answer ─────────────────────────────────────────────
assert(clicks <= 4, `G10 ≤4 interactions to a scored answer (used ${clicks})`);

// ── G4: reload continuity ─────────────────────────────────────────────────
// NOT networkidle: Studio holds a long-lived stream open for the chat, so
// the network is never idle and this times out on a perfectly healthy page.
await page.reload({ waitUntil: 'domcontentloaded' });
await waitForStudio(page).catch(() => {});
// POLL, don't sleep. The restored transcript is fetched from the chat store
// after mount, so a fixed wait races the round-trip: this gate failed once and
// passed on an identical rerun, which is the signature of a timing assumption,
// not of broken persistence. Polling asserts the same fact without the race.
const anchorRe = anchor ? new RegExp(anchor.replace(/\s+/g, '\\s*'), 'i') : null;
let afterReload = '';
for (let i = 0; i < 24; i++) {          // up to ~24s
  afterReload = await page.locator('body').innerText();
  if (anchorRe && anchorRe.test(afterReload)) break;
  await page.waitForTimeout(1000);
}
assert(!!anchorRe && anchorRe.test(afterReload),
  'G4 transcript survives a reload');

// ── G8: casebook scoring is grounded, and says so ─────────────────────────
//
// This gate used to assert the OPEN-mode caveat ("no ground truth"). That is
// unreachable by design, not broken: the platform answers a free-form question
// with deep_research and never invokes this app, so the app's judge — which
// stamps grounded=false — is never called. Asserting it meant asserting on a
// path the architecture does not route through, and it stayed red no matter
// what the app did.
//
// The claim worth defending is the inverse, and it IS reachable: when the
// answer came from a labelled case, the score must be backed by that case's
// ground truth and be identifiable as such. That is the half of the benchmark
// with real keypoints behind it — a score presented WITHOUT that backing is the
// actual hazard, and this catches it.
const scoreTxt = await turn('Score my last answer against the case, and say whether the score is backed by the case ground truth.');
assert(/ground truth|keypoint|grounded/i.test(scoreTxt),
  'G8 casebook score states it is ground-truth backed');

// ── G11: the score is a NUMBER, not a sentence about scoring ──────────────
// G8 alone cannot catch a dead judge. When app_judge fails it returns
// {"error": "judge returned no parsable score"}, and the agent -- being
// helpful -- writes a paragraph ABOUT the rubric that still contains the words
// "ground truth" and "keypoints". So G8 passed for as long as the judge model
// id was unroutable and every single scored turn was failing.
//
// A real verdict always carries a magnitude: "3 / 12", "25%", "0.25". Assert
// that, and the whole class of "scoring is silently broken" becomes visible at
// the product level rather than only in the tool result.
assert(/\b\d{1,3}\s*(?:\/|of|out of)\s*\d{1,3}\b|\b\d{1,3}(?:\.\d+)?\s*%/i.test(scoreTxt),
  'G11 the scored turn reports an actual number, not just prose about scoring');

// ── G5: feedback stages a draft ───────────────────────────────────────────
// Deliberately AFTER the casebook turns, not after an open question: the app is
// only in the loop on the casebook path, so a correction typed against an
// open-mode answer has nothing to attach to.
const draftsBefore = await (await api(`/api/v1/me/drafts?app=${APP}`)).json().catch(() => ({}));
const nBefore = (draftsBefore?.data?.drafts || draftsBefore?.drafts || []).length;

// Watch what the click actually SENDS. This gate failed for a while with the
// server verified working end-to-end — the button, the forced-tool path and the
// draft write were each confirmed by hand, yet the count never moved. A gate
// that reports only "10 → 10" cannot distinguish "the click never fired" from
// "the write failed", and both were guessed at (wrongly, twice) before anyone
// looked at the request. So the harness records the turn it triggers.
const correctionPosts = [];
const onChatPost = (r) => {
  if (!r.url().includes('/me/agent/chat')) return;
  let d = {};
  try { d = JSON.parse(r.postData() || '{}'); } catch { /* non-JSON body */ }
  correctionPosts.push({ tool_choice: d.tool_choice || null, app: d?.context?.app || null });
};
page.on('request', onChatPost);

// Persistent, not once(): window.prompt BLOCKS the click's handler until a
// dialog handler responds, and a `once` listener already consumed by any
// earlier dialog leaves the click hanging with no draft ever written.
let dialogsSeen = 0;
// Names a card the router can actually select. knownSkillCards is an
// allowlist (issue_tree, market_sizing, npv, profitability, ...), and the
// previous text -- "private-label economics" -- matched none of them, so no
// skill-card edit could ever be proposed and G12 was asserting a coupling
// this input never created.
page.on('dialog', d => { dialogsSeen++; d.accept('The issue tree was wrong — it split by geography before cost.'); });

// The control only renders while NOT streaming, so a click issued during the
// tail of the previous turn hits nothing and silently takes the prose fallback
// — which does not route to app_feedback and so stages no draft. Wait for it to
// be attached AND stable before clicking, rather than sampling once.
const correctBtn = page.locator('button[title*="record a correction" i]').last();
let clickable = false;
for (let i = 0; i < 20; i++) {
  if (await correctBtn.count() && await correctBtn.isVisible().catch(() => false)) {
    await page.waitForTimeout(1500);           // settle: it must still be there
    if (await correctBtn.count() && await correctBtn.isVisible().catch(() => false)) {
      clickable = true;
      break;
    }
  }
  await page.waitForTimeout(1500);
}

const postsBefore = correctionPosts.length;
// Sampled RIGHT AFTER the click, not at failure time. The toast is transient
// (sonner auto-dismisses in ~4s) and the failure report runs ~150s later, so
// reading it then always said "false" regardless of what happened -- the check
// was useless exactly when it mattered.
let toastAtClick = false, queuedAtClick = false;
if (clickable) {
  await correctBtn.click();
  clicks++;
  await page.waitForTimeout(2500);
  const justAfter = await page.locator('body').innerText().catch(() => '');
  toastAtClick = /correction queued/i.test(justAfter);
  queuedAtClick = /message[s]? queued/i.test(justAfter);
  // The turn it fires still has to stream out before the draft exists.
  let last = -1, stable = 0, waited = 0;
  while (waited < 90000) {
    await page.waitForTimeout(2000); waited += 2000;
    const n = (await page.locator('body').innerText()).length;
    if (n === last) { if (++stable >= 3) break; } else { stable = 0; last = n; }
  }
} else {
  console.log('NOTE  "Correct this" never became stably clickable — falling back to prose');
  await turn('That case answer was wrong — record a correction against this app so it is reviewed.');
}

let nAfter = nBefore;
for (let i = 0; i < 20; i++) {
  await page.waitForTimeout(3000);
  const d = await (await api(`/api/v1/me/drafts?app=${APP}`)).json().catch(() => ({}));
  nAfter = (d?.data?.drafts || d?.drafts || []).length;
  if (nAfter > nBefore) break;
}
page.off('request', onChatPost);

// Report the request on failure. "10 → 10" plus the turn that was (or was not)
// sent is a diagnosis; the count alone is a mystery.
const fired = correctionPosts.slice(postsBefore);
if (!(nAfter > nBefore)) {
  console.log(`NOTE  G5 sent ${fired.length} turn(s) after the click: ` +
    (fired.map(f => `tool_choice=${f.tool_choice} app=${f.app}`).join(' | ') || '(none)'));
  // Which half failed: the prompt never opened (handler wiring / button inert),
  // or it opened and the turn still did not go out.
  console.log(`NOTE  G5 dialogs seen: ${dialogsSeen} (0 = the prompt never opened)`);
  // Which of the THREE remaining possibilities actually happened. The prompt
  // opening and no request leaving is consistent with all of them, and they
  // need different fixes, so the gate should say which rather than leaving the
  // next person to guess (this one has been guessed at twice, wrongly):
  //
  //   toast + queued  -> dispatch was refused and the correction is sitting in
  //                      the FIFO undrained; the bug is the drain.
  //   toast, no queue -> it was enqueued and drained into nothing.
  //   neither         -> onCorrect never reached the send at all (a throw, or
  //                      dispatchTurnRef.current was null).
  const body = await page.locator('body').innerText().catch(() => '');
  console.log(`NOTE  G5 at click — toast: ${toastAtClick}, queued: ${queuedAtClick}`);
  console.log(`NOTE  G5 queue indicator STILL present at failure: ${/message[s]? queued/i.test(body)} `+
    `(true = enqueued and never drained)`);
  console.log(`NOTE  G5 page errors: ${pageErrors.length ? pageErrors.slice(0, 3).join(' | ') : 'none'}`);
}
assert(nAfter > nBefore, `G5 correction staged a draft (${nBefore} → ${nAfter})`);
// The write is only meaningful if it came from the BUTTON's forced path. A
// draft staged by the model picking the tool on its own would pass the count
// check while the affordance stayed broken.
if (nAfter > nBefore) {
  assert(fired.some(f => f.tool_choice === 'app_feedback' && f.app),
    'G5 correction went through the button\'s forced app_feedback path');
}

// ── G12: the correction ROUND-TRIPS ───────────────────────────────────────
// G5 proves a draft was STAGED. That is half the promise. ui/review.md tells the
// user their approved correction shapes future answers, and for a long time the
// second half was quietly untrue: the picker wrote the card edit to the tenant
// bundle on the xpio PVC, identity never mounts that PVC and read a cache of the
// PUBLISHED bundle instead, so Review said "approved" and the answers never
// changed. Nothing failed; there was simply no assertion anywhere that approval
// had an effect, which is exactly why it could stay broken.
//
// This asserts the contract, not the prose. Approving is observable and
// deterministic (state flips, and the response names the card the edit lands
// on); whether the model then USES the correction is a generative question this
// gate deliberately does not ask, for the same reason it never asserts on answer
// text. The reader half — approved draft → correction present in the card the
// model is handed — is pinned by the Go unit tests in
// me_agent_app_corrections_test.go, where it can be checked exactly.
if (nAfter > nBefore) {
  const dl = await (await api(`/api/v1/me/drafts?app=${APP}`)).json().catch(() => ({}));
  const rows = dl?.data?.drafts || dl?.drafts || [];
  // The one G5 just staged: a skill-card draft carries the marker line naming
  // the card its edit lands on. Match on that rather than on position, so an
  // unrelated draft arriving concurrently cannot make this pass or fail.
  const skillDraft = rows.filter(
    d => /Proposed edit to prompts\/analyst_skill_([a-z][a-z0-9_]{2,40})\.md/.test(d.body || ''),
  ).pop();
  // NOT RUN rather than FAIL when no skill-card draft exists.
  //
  // The app stages TWO kinds (ui/review.md: the Kind column tells them apart) --
  // a Correction, which is a fact for the analyst to recall, and a Skill card
  // edit, which rewrites a prompt. Only the second carries this marker, and
  // which one you get depends on whether the correction text routes to a card in
  // knownSkillCards. This gate asserted the second unconditionally, so a
  // correction that legitimately produced the first failed as though the
  // round-trip were broken -- while G5, one line above, had just proved a draft
  // WAS staged.
  //
  // Asserting a coupling the input never established is the same mistake as the
  // hardcoded skill name and the hardcoded run id. The round-trip below is the
  // claim worth keeping; it simply needs a skill-card draft to run against.
  if (!skillDraft) {
    console.log(`NOTE  G12 NOT RUN — the correction staged a Correction, not a Skill card edit `
      + `(${rows.length} draft(s), none carrying an analyst_skill_*.md marker)`);
  }

  if (skillDraft) {
    const card = (skillDraft.body.match(
      /Proposed edit to prompts\/analyst_skill_([a-z][a-z0-9_]{2,40})\.md/) || [])[1];
    // "send" is the approve action for DB-backed drafts — the HTTP route and the
    // chat tool deliberately share dbDraftApprove so the two cannot disagree
    // about whether a draft the queue displays can be acted on.
    const ap = await api(`/api/v1/me/drafts/${encodeURIComponent(skillDraft.id)}/send`, { method: 'POST' });
    const apBody = await ap.json().catch(() => ({}));
    const d = apBody?.data || {};
    assert(ap.status === 200 && d.state === 'approved',
      `G12 approving the correction succeeds (status ${ap.status}, state ${d.state || 'none'})`);
    // The response must name the card the edit applies to. A generic "ok" is
    // what a silently-inert approval looked like for weeks.
    assert(typeof d.applies === 'string' && d.applies.includes(`analyst_skill_${card}.md`),
      `G12 approval names the card it edits (${card}): ${d.applies || 'NO applies FIELD'}`);
    // And it must not tell the user to go and wait. The skill rung is live on
    // approval; the old string sent them off to watch for something that had
    // already happened.
    assert(!/within a minute or two/i.test(d.next || ''),
      `G12 approval does not report the skill edit as pending: ${d.next || '(no next)'}`);

    // The queue must agree afterwards. A state flip the list does not reflect is
    // the same failure in a different place.
    const after = await (await api(`/api/v1/me/drafts?app=${APP}&state=approved`)).json().catch(() => ({}));
    const approved = (after?.data?.drafts || after?.drafts || []).some(x => x.id === skillDraft.id);
    assert(approved, 'G12 the approved draft is listed as approved');
  }
}

// ── G13-G15: the judge CONTRACT, asserted on the tool result ─────────────
//
// The browser gates above read rendered prose, which is the right instrument
// for "did the user see a score" and the wrong one for "is the score well
// formed". G11 already showed why: a dead judge produced a fluent paragraph
// containing "ground truth" and "keypoints" and passed for eleven days. Prose
// cannot distinguish a three-axis verdict from a one-axis one, or a two-seat
// panel from a seat that silently dropped.
//
// So these call the chat API directly and assert on app_judge's RESULT. Same
// path the Studio composer uses -- context.app is what the app surface sets --
// but the structure is visible instead of narrated.
const judgeTurn = async (content, ctx) => {
  const r = await api('/api/v1/me/agent/chat', {
    method: 'POST',
    body: JSON.stringify({ context: ctx, model: 'deepseek-v4-flash', messages: [{ role: 'user', content }] }),
  });
  if (r.status !== 200) return { http: r.status, judge: null };
  const b = await r.json();
  const calls = b?.data?.tool_calls || [];
  return { http: 200, judge: (calls.find(c => c.name === 'app_judge') || {}).result || null };
};

// ── G13: an OPEN answer is marked ungrounded and says why ────────────────
//
// This gate previously asserted the open-mode caveat, was found permanently red,
// and was removed as "unreachable by design -- the platform answers a free-form
// question with deep_research and never invokes this app".
//
// That is true of an UNGROUNDED chat turn and false of the app-grounded one,
// which is the path the product's own "Ask anything" mode uses (CaseBrowser
// dispatches mode:"practice" into the app chat). Verified directly: with
// context.app set, app_judge returns grounded:false, mode:"open" and the caveat
// "No case selected, so there is no ground truth to score against."
//
// It is restored because it is the app's central safety property. An open score
// that is NOT marked indicative is a number that looks like a benchmark result
// and is not one -- the single worst thing this app could emit.
{
  const { http, judge } = await judgeTurn(
    'Here is my own consulting question, no casebook case: how should a regional grocery chain respond to margin decline? Answer it, then score my framing.',
    { app: APP, mode: 'practice' },
  );
  // A 504 is the edge timing the turn out, not the app declining to caveat it.
  // Conflating the two would report "the open-mode caveat is missing" on a slow
  // day, which is a false accusation against the exact safety property this gate
  // exists to defend -- and the kind of cried wolf that gets a gate deleted
  // again. Report it as NOT RUN and keep the failure for a real answer that is
  // missing its caveat.
  if (http === 502 || http === 504 || http === 0) {
    console.log(`NOTE  G13 NOT RUN — open turn timed out (http ${http}); the caveat was not exercised`);
  } else {
    assert(http === 200 && !!judge, `G13 open turn invoked app_judge (http ${http}, judge ${judge ? 'present' : 'absent'})`);
  }
  if (judge) {
    assert(judge.grounded === false, `G13 open answer is marked ungrounded (grounded=${judge.grounded})`);
    assert(typeof judge.caveat === 'string' && judge.caveat.trim().length > 0,
      'G13 open answer carries a caveat explaining there is no ground truth');
  }
}

// ── G14/G15: a casebook verdict is three-axis and panel-labelled ─────────
{
  const { http, judge } = await judgeTurn(
    `Open the labelled case ${CASE} and ask its first question. Treat this as my answer: ` +
    'I would size the market, map the main competitors and their shares, check typical margins, ' +
    'and test whether we can produce at a cost that clears them. Score it against the ground truth.',
    { app: APP, mode: 'interview' },
  );
  // Same distinction G13 makes. A timed-out turn did not exercise the rubric,
  // and reporting it as "the verdict has no axes" would accuse the judge of
  // malformed output on a slow day -- 502 is identity's own 5-minute ceiling and
  // 504 the edge's, both of which this app's ~190s scored turns sit close to.
  if (http === 502 || http === 504 || http === 0) {
    console.log(`NOTE  G14/G15 NOT RUN — casebook turn timed out (http ${http})`);
  } else {
    assert(http === 200 && !!judge, `G14 casebook turn invoked app_judge (http ${http})`);
  }
  if (judge) {
    assert(judge.grounded === true, `G14 casebook answer is grounded (grounded=${judge.grounded})`);

    // The app's headline is a 3-AXIS rubric. G11 only asserts that a number
    // exists, so a judge returning one axis and two nulls passes it. The spec
    // says to omit axes the question does not exercise, so require at least one
    // present and every present one numeric and in range -- a string, a null or
    // a 7-on-a-0-1-scale is a malformed verdict however confident it reads.
    const axes = judge.axes && typeof judge.axes === 'object' ? judge.axes : null;
    assert(!!axes, `G14 verdict carries an axes object (got ${JSON.stringify(judge.axes)})`);
    if (axes) {
      const named = Object.keys(axes);
      const known = named.filter(k => ['framework', 'qualitative', 'quantitative'].includes(k));
      assert(known.length > 0, `G14 axes use the declared rubric names (got ${named.join(',') || 'none'})`);
      const bad = known.filter(k => typeof axes[k] !== 'number' || axes[k] < 0 || axes[k] > 1);
      assert(bad.length === 0, `G14 every reported axis is a number in 0-1 (bad: ${bad.join(',') || 'none'})`);
    }

    // covered/total are the denominator the whole benchmark rests on, and the
    // rubric fixes total -- asking the model for it returned 1, 3 and 13 for the
    // same fixed-size rubric, which is why it is computed server-side now.
    assert(Number.isInteger(judge.covered) && Number.isInteger(judge.total) && judge.total > 0,
      `G14 covered/total are integers with a real denominator (${judge.covered}/${judge.total})`);

    // ── G15: the panel is labelled, and a dropped seat degrades ──────────
    //
    // The panel's design is that a seat which cannot produce a usable number is
    // DROPPED, never counted as a zero -- that rule is why the app survived the
    // eleven days its pinned judge model 503'd on every call. A zero would have
    // silently halved every correct answer instead.
    //
    // Cannot fake a dead seat from here (the panel is set in the app spec), so
    // assert the invariant that is observable either way: panel_n is a real
    // count, judge_models names exactly that many seats, and a short panel is
    // flagged low_confidence rather than passed off as a full one.
    assert(Number.isInteger(judge.panel_n) && judge.panel_n >= 1,
      `G15 verdict reports how many seats scored it (panel_n=${judge.panel_n})`);
    if (Array.isArray(judge.judge_models)) {
      assert(judge.judge_models.length === judge.panel_n,
        `G15 judge_models matches panel_n (${judge.judge_models.length} vs ${judge.panel_n})`);
    }
    // A single-seat panel is a degraded panel: it must say so, and it must not
    // be the analyst grading itself unlabelled.
    if (judge.panel_n < 2) {
      assert(judge.low_confidence === true,
        `G15 a short panel is flagged low_confidence (panel_n=${judge.panel_n}, low_confidence=${judge.low_confidence})`);
    }
    // Never a zero from a seat that failed: score 0 is legitimate (a wrong
    // answer), but only when a seat actually scored it.
    assert(!(judge.score === 0 && judge.panel_n === 0),
      'G15 a zero score never comes from an empty panel');
  }
}

// ── G16: the analyst must not hand over the answer key ───────────────────
//
// The judge prompt embeds the case's ground truth labelled "CONFIDENTIAL --
// never quote it back", and the analyst reads the same bundle. In INTERVIEW
// mode the candidate has not answered yet, so any keypoint that appears in the
// interviewer's question is the answer key leaking -- and every score after it
// is void, silently. Nothing checked this.
//
// Scored only against keypoints long enough to be distinctive: a rubric line
// like "margins" would match innocuous prose and make the gate cry wolf.
{
  const dsOwner = 'db86775d-91b1-4752-802f-926039ae648f';
  let keypoints = [];
  try {
    // Resolve the filename rather than assuming `<CASE>.json`. The dataset
    // carries a VERSION suffix -- CASE "Case_019_BetaOptics_PK21" is stored as
    // Case_019_BetaOptics_PK21_v10.json -- so the direct guess 404s and the gate
    // reported NOT RUN on its first outing for a case that is plainly there.
    const tree = await fetch(`https://xp.io/api/v1/repos/${dsOwner}/mbb-casebook-cases/tree/main/data`);
    const entries = tree.ok ? ((await tree.json()).entries || []) : [];
    const file = (entries.find(e => String(e.name).startsWith(CASE)) || {}).name;
    if (!file) throw new Error(`no dataset file starting with ${CASE}`);
    const r = await fetch(`https://xp.io/api/v1/repos/${dsOwner}/mbb-casebook-cases/blob/main/data/${file}`);
    if (r.ok) {
      let txt = await r.text();
      // The blob endpoint returns {path, ref, content} with content as PLAIN
      // TEXT -- there is no `encoding` field and it is not base64. Decoding it
      // as base64 anyway produced bytes that then failed JSON.parse, and the
      // surrounding try/catch reported that as "could not read ground truth" --
      // so the gate blamed a missing case for a bug in its own parsing.
      try {
        const j = JSON.parse(txt);
        if (typeof j.content === 'string') txt = j.content;
      } catch { /* already the raw document */ }
      const gt = JSON.parse(txt).structure_4_ground_truth || {};
      const first = Object.keys(gt).find(k => k.endsWith('_ground_truth'));
      // Pull the actual keypoints[] arrays -- they live under
      // pillars.<pillar>.keypoints. Scraping every long quoted string instead
      // swept up scoring_method, minimum_expected and outstanding_threshold,
      // which are rubric METADATA: matching those against the interviewer's
      // prose would flag a leak that never happened.
      const collect = (node, out = []) => {
        if (Array.isArray(node)) { node.forEach(n => collect(n, out)); return out; }
        if (node && typeof node === 'object') {
          for (const [k, v] of Object.entries(node)) {
            if (k === 'keypoints' && Array.isArray(v)) out.push(...v.filter(x => typeof x === 'string'));
            else collect(v, out);
          }
        }
        return out;
      };
      // Long enough to be distinctive: a keypoint like "Margins" would match
      // innocuous prose and make the gate cry wolf.
      keypoints = collect(gt[first]).filter(k => k.length >= 18);
    }
  } catch { /* dataset unreachable — reported below, not asserted around */ }

  if (!keypoints.length) {
    console.log(`NOTE  G16 NOT RUN — could not read ground truth for ${CASE}`);
  } else {
    const { http, judge } = await judgeTurn(
      `Open the labelled case ${CASE} in interview mode and ask me the first question. Do not answer it yourself.`,
      { app: APP, mode: 'interview' },
    );
    void judge;
    const r = await api('/api/v1/me/agent/chat', {
      method: 'POST',
      body: JSON.stringify({
        context: { app: APP, mode: 'interview' },
        model: 'deepseek-v4-flash',
        messages: [{ role: 'user', content: `Open case ${CASE} and ask me its first question. I have not answered yet.` }],
      }),
    });
    const body = r.status === 200 ? await r.json() : {};
    const said = String(body?.data?.reply || '');
    const leaked = keypoints.filter(k => said.toLowerCase().includes(k.toLowerCase()));
    assert(http === 200 && said.length > 0, `G16 interviewer produced a question (http ${r.status})`);
    assert(leaked.length === 0,
      `G16 the interviewer did not quote the answer key (leaked ${leaked.length}: ${leaked.slice(0, 2).join(' | ').slice(0, 90)})`);
  }
}

// ── G17: the scorecard verb the UI tells users to type ───────────────────
//
// ui/page.yaml tells the user `scorecard` works in any mode. Nothing typed it.
// It resolves to app_report, and the contract that matters is the SPLIT:
// casebook rows are scored against real keypoints and open rows are not, so a
// single blended average is a number that means nothing. The app's own
// ui/results.md says "mode is the column to read first".
{
  const r = await api('/api/v1/me/agent/chat', {
    method: 'POST',
    body: JSON.stringify({
      context: { app: APP },
      model: 'deepseek-v4-flash',
      messages: [{ role: 'user', content: 'scorecard' }],
    }),
  });
  const body = r.status === 200 ? await r.json() : {};
  const call = (body?.data?.tool_calls || []).find(c => c.name === 'app_report');
  assert(!!call, `G17 typing "scorecard" invokes app_report (tools fired: ${(body?.data?.tool_calls || []).map(c => c.name).join(',') || 'none'})`);
  if (call?.result) {
    const res = call.result;
    const keys = Object.keys(res).join(',');
    // Casebook and open must be distinguishable. Either per-row (a mode field)
    // or as separate aggregates -- both are honest, a single blended number is
    // not.
    const rows = res.turns || res.rows || [];
    const perRowMode = Array.isArray(rows) && rows.length > 0 && rows.every(t => 'mode' in t);
    const splitAggregate = /casebook/i.test(keys) && /open/i.test(keys);
    assert(perRowMode || splitAggregate || (Array.isArray(rows) && rows.length === 0),
      `G17 report separates casebook from open (keys: ${keys}, rows: ${Array.isArray(rows) ? rows.length : 'n/a'})`);
  }
}

// ── G18: one user's scored turns stay out of another's scorecard ─────────
//
// Runs only with a SECOND account configured (LUMID_EMAIL_B / LUMID_PASSWORD_B).
// Skipped loudly rather than silently: per-user isolation is the claim that a
// shared benchmark app lives or dies on, and a suite that quietly omits it
// reads as if it had been checked.
if (process.env.LUMID_EMAIL_B && process.env.LUMID_PASSWORD_B) {
  const lr = await fetch(`${BASE}/api/v1/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: process.env.LUMID_EMAIL_B, password: process.env.LUMID_PASSWORD_B }),
  });
  const bTok = (await lr.json())?.data?.token;
  assert(!!bTok, 'G18 second account logs in');
  if (bTok) {
    const bRes = await fetch(`${BASE}/api/v1/me/app-data?app=${encodeURIComponent(APP)}&tool=report`, {
      headers: { Authorization: `Bearer ${bTok}` },
    });
    const bBody = bRes.status === 200 ? await bRes.json() : {};
    const bRows = bBody?.data?.turns || bBody?.data?.rows || [];
    const aRes = await api(`/api/v1/me/app-data?app=${encodeURIComponent(APP)}&tool=report`);
    const aBody = aRes.status === 200 ? await aRes.json() : {};
    const aRows = aBody?.data?.turns || aBody?.data?.rows || [];
    // A has just been scored by the gates above; B has never used the app.
    assert(aRows.length > 0, `G18 caller has scored turns to leak (${aRows.length})`);
    assert(bRows.length === 0,
      `G18 a second account sees none of them (saw ${bRows.length})`);
  }
} else {
  console.log('NOTE  G18 NOT RUN — set LUMID_EMAIL_B / LUMID_PASSWORD_B to check per-user isolation');
}

// ── G9 ────────────────────────────────────────────────────────────────────
assert(api404.length === 0, `G9 no /me/* 404s (saw: ${api404.join(', ') || 'none'})`);

await page.screenshot({ path: `/tmp/studio-${APP}.png`, fullPage: true });
await b.close();

console.log(fails.length ? `\n${fails.length} FAILED:\n - ${fails.join('\n - ')}` : '\nALL PASS');
process.exit(fails.length ? 1 : 0);

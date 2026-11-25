// Lumen interaction suite — the behaviour the visual audit cannot see.
//
// studio-visual.mjs proves pixels (palette, contrast, overflow) on still
// frames. This drives the redesign's MOVING parts in a real browser and
// asserts what a user would notice if they broke:
//
//   nav       sliding bronze indicator tracks the active rail row
//   recent    hovering a Recent row swaps its age for the trash (one slot)
//   menu      account menu opens animated, Escape/outside-click closes it
//   drawer    390px: sidebar is an overlay drawer; Escape closes it
//   focus     keyboard focus draws the warm ring, not the browser's blue
//   motion    prefers-reduced-motion: rise/lift stop, loaders become a fade
//   error     a 500 renders ErrorState; Retry recovers without a reload
//   activity  /studio/runs: 7-day default, Needs fixing in words, Open run
//   wf header schedule chip in words · Run now · ⋯ grouped This workflow / This app
//   run page  the answer leads (Succeeded in… / Failed after… + reason), no raw codes
//   research  app map: experiments → versions; click dims the rest and flows the path
//   motion    reduced motion: nothing runs but the loaders' fade; Go ahead via a fixture
//   filters   Segmented radios on the Timeline view switch state (aria-checked)
//   docs      index card -> reader (skeleton -> article) -> back
//   sessions  /claude-sessions search narrows and clears
//   chat      send a turn: user bubble, StrandMark thinks, an answer lands
//             (WRITES one thread; it is deleted again at the end)
//
// Env: LUMID_BASE (default https://nightly.lum.id), LUMID_PASSWORD or
// LUMID_PAT, CHROME, SKIP_CHAT=1 to stay read-only.

import { chromium } from 'playwright';
import { launchBrowser } from './_browser.mjs';
import { authContext } from './_auth.mjs';

const BASE = (process.env.LUMID_BASE || 'https://nightly.lum.id').replace(/\/$/, '');
const SKIP_CHAT = process.env.SKIP_CHAT === '1';
const SHOTS = process.env.SHOTS || '/tmp/studio-lumen-e2e';

const fails = [];
const assert = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fails.push(msg); };
const note = (msg) => console.log(`NOTE  ${msg}`);
const section = async (name, fn) => {
	console.log(`\n── ${name}`);
	try { await fn(); } catch (e) { assert(false, `${name}: threw ${String(e).split('\n')[0].slice(0, 160)}`); }
};

const b = await launchBrowser(chromium);
const desk = await authContext(b, BASE, { viewport: { width: 1440, height: 900 } });
note(`base=${BASE} auth=${desk.mode}`);
const { mkdirSync } = await import('node:fs');
mkdirSync(SHOTS, { recursive: true });

// ── nav indicator ────────────────────────────────────────────────────────
await section('nav indicator', async () => {
	const page = await desk.ctx.newPage();
	await page.goto(`${BASE}/studio/runs`, { waitUntil: 'domcontentloaded' });
	const row = (t) => page.locator('nav [data-nav-item]', { hasText: t }).first();
	const bar = page.locator('nav > span[aria-hidden].bg-gold-500').first();
	await page.locator('nav [data-nav-item][aria-current="page"]').first().waitFor({ timeout: 20000 });
	// Poll (the shell settles, then the bar slides 240ms): centre offset between
	// the bar and the named row, and the bar's y.
	const settle = async (t) => {
		let off = 999, y = null;
		for (let i = 0; i < 20 && off > 3; i++) {
			await page.waitForTimeout(150);
			const a = await row(t).boundingBox(); const r = await bar.boundingBox();
			if (a && r) { off = Math.abs((a.y + a.height / 2) - (r.y + r.height / 2)); y = r.y; }
		}
		return { off, y };
	};
	const r1 = await settle('Activity');
	assert(r1.off <= 3, `indicator centred on the active row (Activity), off by ${r1.off.toFixed(1)}px`);
	await row('Marketplace').click();
	await page.waitForURL(/\/studio\/library/, { timeout: 15000 });
	// The URL flips before React commits the lazy route; the rail (and the bar)
	// update at commit. Wait for the row to be marked current, then measure.
	await page.locator('nav [data-nav-item][aria-current="page"]', { hasText: 'Marketplace' }).first().waitFor({ timeout: 30000 });
	const r2 = await settle('Marketplace');
	assert(r2.off <= 3 && r1.y !== r2.y, `indicator slid to Marketplace (moved ${r1.y != null && r2.y != null ? (r2.y - r1.y).toFixed(0) : '?'}px, off by ${r2.off.toFixed(1)}px)`);
	const tr = await bar.evaluate((el) => getComputedStyle(el).transitionProperty);
	assert(/transform/.test(tr), `indicator animates transform (transition-property: ${tr})`);
	await page.close();
});

// ── recent row: age and trash share one slot ──────────────────────────────
await section('recent row hover', async () => {
	const page = await desk.ctx.newPage();
	await page.goto(`${BASE}/studio/settings`, { waitUntil: 'domcontentloaded' });
	const trash = page.locator('button[aria-label="Delete conversation"]').first();
	await trash.waitFor({ state: 'attached', timeout: 20000 });
	const row = trash.locator('xpath=..');
	const age = row.locator('button span.tabular-nums').first();
	const op = (l) => l.evaluate((el) => Number(getComputedStyle(el).opacity));
	assert(await op(trash) === 0, 'trash hidden at rest');
	await row.hover();
	await page.waitForTimeout(250);
	assert(await op(trash) === 1 && await op(age) === 0, 'hover swaps the age for the trash');
	const tb = await trash.boundingBox(); const ab = await age.boundingBox();
	const overlap = tb && ab && tb.x < ab.x + ab.width && ab.x < tb.x + tb.width;
	assert(!!overlap, 'age and trash occupy the same slot (no "now🗑" collision)');
	await page.close();
});

// ── account menu ─────────────────────────────────────────────────────────
await section('account menu', async () => {
	const page = await desk.ctx.newPage();
	await page.goto(`${BASE}/studio/settings`, { waitUntil: 'domcontentloaded' });
	const trigger = page.locator('button[title="Account menu"]');
	await trigger.waitFor({ timeout: 20000 });
	await trigger.click();
	const signOut = page.getByText('Sign out', { exact: true });
	await signOut.waitFor({ timeout: 5000 });
	const panel = signOut.locator('xpath=ancestor::div[contains(@class,"animate-in")][1]');
	const anim = await panel.evaluate((el) => getComputedStyle(el).animationName).catch(() => 'none');
	assert(await signOut.isVisible(), 'menu opens with Sign out');
	assert(anim && anim !== 'none', `menu animates in (animation-name: ${anim})`);
	await page.mouse.click(900, 450);
	await page.waitForTimeout(300);
	assert(!(await signOut.isVisible().catch(() => false)), 'outside click closes the menu');
	await page.close();
});

// ── narrow drawer ────────────────────────────────────────────────────────
await section('narrow drawer (390px)', async () => {
	const phone = await authContext(b, BASE, { viewport: { width: 390, height: 844 } });
	const page = await phone.ctx.newPage();
	await page.goto(`${BASE}/studio/runs`, { waitUntil: 'domcontentloaded' });
	const open = page.locator('button[aria-label="Show sidebar"]');
	await open.waitFor({ timeout: 20000 });
	assert(await page.locator('aside').count() === 0, 'sidebar hidden by default on a phone');
	await open.click();
	const aside = page.locator('aside').first();
	await aside.waitFor({ timeout: 5000 });
	const box = await aside.boundingBox();
	const pos = await aside.evaluate((el) => getComputedStyle(el).position);
	assert(pos === 'fixed' && box && box.width <= 390, `drawer is an overlay (position ${pos}, width ${box?.width?.toFixed(0)})`);
	await page.screenshot({ path: `${SHOTS}/drawer-open.png` });
	await page.keyboard.press('Escape');
	await page.waitForTimeout(300);
	assert(await page.locator('aside').count() === 0, 'Escape closes the drawer');
	const sw = await page.evaluate(() => document.documentElement.scrollWidth);
	assert(sw <= 391, `no horizontal page scroll (scrollWidth ${sw})`);
	await phone.ctx.close();
});

// ── focus ring ───────────────────────────────────────────────────────────
await section('keyboard focus ring', async () => {
	const page = await desk.ctx.newPage();
	await page.goto(`${BASE}/studio/settings`, { waitUntil: 'domcontentloaded' });
	// The landing-pref radios went in #221; any control in the page will do.
	const first = page.locator('main :is(a[href], button, input, select, textarea)').first();
	await first.waitFor({ timeout: 20000 });
	// Focus it by keyboard (Tab from the element before it).
	await first.focus();
	await page.keyboard.press('Shift+Tab');
	await page.keyboard.press('Tab');
	const st = await page.evaluate(() => {
		const el = document.activeElement;
		const cs = getComputedStyle(el);
		return { tag: el.tagName, shadow: cs.boxShadow, outline: `${cs.outlineStyle} ${cs.outlineColor}`, fv: el.matches(':focus-visible') };
	});
	const blue = /59,\s*130,\s*246|37,\s*99,\s*235|0,\s*95,\s*204|16,\s*16,\s*16/.test(st.shadow + st.outline);
	const ring = st.shadow !== 'none' || !/^none/.test(st.outline);
	assert(st.fv && ring, `focused ${st.tag} shows a ring (box-shadow: ${st.shadow.slice(0, 60)})`);
	assert(!blue, 'ring is not the browser/Tailwind default blue');
	await page.screenshot({ path: `${SHOTS}/focus-ring.png`, clip: { x: 224, y: 0, width: 1216, height: 900 } });
	await page.close();
});

// ── reduced motion ───────────────────────────────────────────────────────
await section('prefers-reduced-motion', async () => {
	const rm = await authContext(b, BASE, { viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
	const page = await rm.ctx.newPage();
	// Hold the knowledge API so its skeleton stays on screen long enough to read.
	let release;
	const gate = new Promise((r) => { release = r; });
	await page.route('**/api/v1/me/knowledge/agents*', async (route) => { await gate; await route.continue(); });
	await page.goto(`${BASE}/studio/knowledge`, { waitUntil: 'domcontentloaded' });
	await page.locator('main').first().waitFor({ timeout: 20000 });
	const mainAnim = await page.locator('main').first().evaluate((el) => getComputedStyle(el).animationName);
	assert(mainAnim === 'none', `section rise is off (main animation-name: ${mainAnim})`);
	const sk = page.locator('.lumen-skeleton').first();
	await sk.waitFor({ timeout: 10000 });
	const skAnim = await sk.evaluate((el) => getComputedStyle(el).animationName);
	assert(skAnim === 'lumen-fade', `skeleton becomes a fade, not a freeze (animation-name: ${skAnim})`);
	release();
	await rm.ctx.close();
});

// ── ErrorState + retry ───────────────────────────────────────────────────
await section('ErrorState retry', async () => {
	const page = await desk.ctx.newPage();
	let failing = true;
	await page.route('**/api/v1/me/knowledge/agents*', (route) =>
		failing ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"injected by e2e"}' }) : route.continue());
	await page.goto(`${BASE}/studio/knowledge`, { waitUntil: 'domcontentloaded' });
	const alert = page.getByRole('alert').filter({ hasText: /Couldn.t load/ });
	await alert.first().waitFor({ timeout: 20000 });
	assert(true, 'a 500 renders ErrorState ("Couldn\'t load …")');
	await page.screenshot({ path: `${SHOTS}/error-state.png` });
	failing = false;
	const navs = [];
	page.on('framenavigated', (f) => { if (f === page.mainFrame()) navs.push(f.url()); });
	await alert.first().getByRole('button', { name: /retry|try again/i }).click();
	await alert.first().waitFor({ state: 'detached', timeout: 20000 });
	assert(navs.length === 0, 'Retry recovered in place (no page reload)');
	await page.close();
});

// ── Inbox survives a non-inbox response ──────────────────────────────────
await section('Inbox: unexpected response', async () => {
	const page = await desk.ctx.newPage();
	// nightly.lum.id does not route /inbox-api: it answers with the SPA's HTML
	// and a 200. That used to crash the page into the error boundary.
	await page.route('**/inbox-api/messages*', (route) =>
		route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><body>spa</body></html>' }));
	await page.goto(`${BASE}/studio/inbox`, { waitUntil: 'domcontentloaded' });
	// With nothing else to show it is the full ErrorState; when the workflow
	// feed (drafts, notices) has items, a one-line notice above them.
	const alert = page.getByRole('alert').filter({ hasText: /Couldn.t load|isn.t available/ })
		.or(page.getByText(/Agent messages didn.t load/));
	const ok = await alert.first().waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
	const crashed = await page.getByText('This page hit a snag').count();
	assert(ok && crashed === 0, `HTML-200 from /inbox-api says so (ErrorState or notice), not the crash boundary (crash=${crashed})`);
	await page.close();
});

// ── Segmented filters ────────────────────────────────────────────────────
// ── Activity: runs grouped by app, broken workflows first, in words ────────
await section('Activity', async () => {
	const page = await desk.ctx.newPage();
	await page.goto(`${BASE}/studio/runs`, { waitUntil: 'domcontentloaded' });
	await page.getByRole('heading', { name: 'Activity' }).first().waitFor({ timeout: 20000 });
	// /me/runs takes ~6 s; wait for the feed (or its empty / error state).
	await page.locator('section[aria-label="All workflows"]')
		.or(page.getByText('Nothing ran in this window'))
		.or(page.locator('[role="alert"]')).first().waitFor({ timeout: 40000 });
	const win = page.getByRole('radiogroup', { name: 'Time window' });
	assert(await win.getByRole('radio', { name: '7d' }).getAttribute('aria-checked') === 'true', '7 days is the default window');
	const fix = page.locator('section[aria-label="Needs fixing"]').first();
	if (await fix.count()) {
		assert(await fix.getByRole('link', { name: /Open run/ }).count() > 0, 'each Needs fixing row offers Open run');
		const body = await fix.innerText();
		assert(!/_unavailable|Traceback|\{"/.test(body), 'Needs fixing speaks in words, not raw reasons');
	} else note('nothing failing in this window — Needs fixing not exercised');
	// The wait above also accepts an alert (a failed feed); only a feed on
	// screen has a status line, so wait for it before reading.
	const feedShown = await page.locator('section[aria-label="All workflows"]').waitFor({ timeout: 40000 }).then(() => true).catch(() => false);
	if (feedShown) {
		const status = await page.locator('main').innerText();
		assert(/updated \d{1,2}:\d{2}/.test(status), 'status line says when the feed was updated');
	} else note('Activity feed did not render (error or empty) — status line not exercised');
	await page.close();
});

// ── workflow header: when it runs · run now · one grouped menu ────────────
await section('workflow header', async () => {
	const page = await desk.ctx.newPage();
	const WF = process.env.WF_PATH || '/studio/apps/quant-research/w/backtest';
	await page.goto(`${BASE}${WF}`, { waitUntil: 'domcontentloaded' });
	const sched = page.locator('button[aria-label^="Schedule: "]');
	try { await sched.waitFor({ timeout: 30000 }); } catch { note(`no workflow at ${WF} for this account — set WF_PATH`); await page.close(); return; }
	const label = await sched.getAttribute('aria-label');
	assert(/^Schedule: (Every |Daily|Weekdays|On demand|Paused|Mon|Tue|Wed|Thu|Fri|Sat|Sun|Custom)/.test(label), `schedule chip speaks in words (${label})`);
	const strip = await page.locator('#topstrip-wf-controls').innerText();
	assert(!/Plan next run|^\+\d+/m.test(strip), 'no "Plan next run" / "+N" dots in the header');
	assert(await page.locator('#topstrip-wf-controls button[aria-label="Run now"], #topstrip-wf-controls button[aria-label="Cancel the run"]').count() === 1, 'one run control: Run now, or Cancel run while running');
	await sched.click();
	await page.getByRole('button', { name: /Pause schedule|Resume schedule|Set a schedule|Change schedule/ }).first().waitFor({ timeout: 5000 });
	assert(true, 'the chip opens to pause / change the schedule');
	await page.keyboard.press('Escape');
	await page.locator('button[aria-label="App actions"]').click();
	const menu = page.getByRole('menu');
	await menu.waitFor({ timeout: 5000 });
	const mt = await menu.innerText();
	assert(/This workflow/i.test(mt) && /This app/i.test(mt), 'menu says what each group acts on (This workflow / This app)');
	assert(/Run with changes/.test(mt) && !/\bagent\b/i.test(mt), 'menu: "Run with changes…", and "app" not "agent"');
	await menu.getByText('Run with changes…').click();
	const dlg = page.getByText('Run with changes', { exact: true });
	await dlg.waitFor({ timeout: 5000 });
	assert(await dlg.isVisible(), 'menu → Run with changes opens the composer');
	await page.keyboard.press('Escape');
	await page.getByRole('button', { name: 'Cancel' }).last().click().catch(() => {});
	await page.waitForTimeout(300);
	const tabs = await page.locator('[role=tablist][aria-label="Workflow views"] [role=tab]').allInnerTexts();
	assert(!tabs.some((t) => /Study|Measurement|Lineage/.test(t)), `tabs are plain (${tabs.map((t) => t.replace(/\d+/g, '').trim()).join(' · ')})`);
	await page.close();
});

// ── run page: the answer first, in words ─────────────────────────────────
await section('run page answer', async () => {
	const page = await desk.ctx.newPage();
	const WF = process.env.WF_PATH || '/studio/apps/quant-research/w/backtest';
	await page.goto(`${BASE}${WF}`, { waitUntil: 'domcontentloaded' });
	const ans = page.locator('section[aria-label="What this run did"]');
	try { await ans.waitFor({ timeout: 40000 }); } catch { note(`no run answer at ${WF} — set WF_PATH`); await page.close(); return; }
	await page.waitForTimeout(1500);
	const t = await ans.innerText();
	assert(/^(Succeeded|Failed|Running|Outcome not recorded)/.test(t.trim()), `the answer leads ("${t.split('\n')[0]}")`);
	const shown = t.split(/Show the raw error|Hide the raw error/)[0];
	assert(!/\b[a-z]+_[a-z_]+\b/.test(shown), `no snake_case codes in the answer (${(shown.match(/\b[a-z]+_[a-z_]+\b/) || [''])[0]})`);
	const card = await page.locator('main').innerText();
	assert(!/\bengine_command\b/.test(card) && !/^Outcome:/m.test(card), 'no "engine_command" / "Outcome:" strip on the run page');
	const tl = page.locator('section[aria-label="What this run did, step by step"]');
	if (await tl.count()) {
		const cells = tl.locator('[aria-label="Steps by stage"] button');
		assert(await cells.count() > 0, 'step timeline: one cell per step, under stage labels');
		await cells.first().click();
		await page.waitForTimeout(300);
		assert(await tl.locator('li.bg-gold-50').count() === 1, 'clicking a cell highlights its step in the timeline');
	} else note('this run reported no step timeline (events) — timeline not exercised');
	// What it produced: files as cards, each one click to save.
	const files = page.locator('ul[aria-label="Files"] li');
	await files.first().waitFor({ timeout: 20000 }).catch(() => {});
	if (await files.count()) {
		assert(await files.first().locator('button[aria-label^="Download "]').count() === 1, `produced files are cards with a download (${await files.count()})`);
		const dl = page.waitForEvent('download', { timeout: 5000 }).catch(() => null);
		await files.first().locator('button[aria-label^="Download "]').click();
		const d = await dl;
		assert(!!d && /\.(json|md|txt)$/.test(d.suggestedFilename()), `download saves a file (${d?.suggestedFilename()})`);
	} else note('this run produced no files — file cards not exercised');
	await page.close();
});

// ── Run page: three panes when wide (Novix's job page) ────────────────────
await section('run page three panes', async () => {
	const wide = await authContext(b, BASE, { viewport: { width: 2200, height: 1000 } });
	const page = await wide.ctx.newPage();
	const WF = process.env.WF_PATH || '/studio/apps/quant-research/w/backtest';
	await page.goto(`${BASE}${WF}`, { waitUntil: 'domcontentloaded' });
	const grid = page.locator('[data-cols]');
	try { await grid.waitFor({ timeout: 40000 }); } catch { note(`no run page at ${WF}`); await page.close(); await wide.ctx.close(); return; }
	await page.waitForTimeout(800);
	const w = await grid.evaluate((el) => Math.round(el.getBoundingClientRect().width));
	if (w < 1100) note(`run card is ${w}px here (chat rail open?) — three panes need 1100`);
	else assert(await grid.getAttribute('data-cols') === '3', `a wide run page has three columns: answer | how it ran | what it produced (${w}px)`);
	await page.close(); await wide.ctx.close();
});

// ── Research map: experiments as a tree, click lights the path ────────────
await section('research map', async () => {
	const page = await desk.ctx.newPage();
	const APP = process.env.MAP_APP || 'quant-research';
	await page.goto(`${BASE}/studio/apps/${APP}`, { waitUntil: 'domcontentloaded' });
	const map = page.locator('section[aria-label="Research"]');
	try { await map.waitFor({ timeout: 40000 }); } catch { note(`no Research map on ${APP} — set MAP_APP`); await page.close(); return; }
	const exps = map.locator('.space3d [data-kind="experiment"] button');
	await exps.first().waitFor({ timeout: 15000 });
	const n = await exps.count();
	assert(n > 0 && await map.locator('.space3d [data-kind="version"]').count() > 0, `3D map shows experiments (${n}) and their versions`);
	// Only OUR status line — the question above it is the app's own words.
	const status = ((await exps.first().getAttribute('aria-label')) || '').split(': ').slice(1).join(': ');
	assert(!/comparable|instrument|\barms?\b|n_results/.test(status), `experiment status speaks in words ("${status}")`);
	await exps.nth(Math.min(1, n - 1)).click({ force: true }); // the space turns; don't wait for it to hold still
	await page.waitForTimeout(900);
	const dimmed = await map.locator('.space3d [data-dim]').count();
	assert(dimmed > 0, `clicking a card dims what is off its path (${dimmed} dimmed)`);
	assert(await map.locator('.space3d-edge-flow').count() > 0, 'the selected path flows');
	assert(await page.locator('section[aria-label="Compute"]').count() === 1, 'the Compute panel sits with the map');
	// Dots, not cards: off the selected path a node is a labelled dot.
	assert(await map.locator('.space3d-label').count() > 0, 'nodes off the path are labelled dots');
	assert(await map.getByText(/^Measures:|^Done when:/).count() > 0 || await map.getByText(/Not started yet|Can't|Winning|leads|Collecting/).count() > 0, 'the selected experiment is explained below the map');
	const fig = map.locator('figure');
	await fig.first().waitFor({ timeout: 20000 }).catch(() => {});
	if (await fig.count()) {
		// One chart when versions are comparable; one small chart each (own
		// scale, shared time axis) when they were measured differently.
		const ft = await map.innerText();
		assert(/How (it|each version) evolved/.test(ft) && /average so far/.test(ft), `the experiment shows how it evolved, and says what the lines are (${await fig.count()} chart(s))`);
	} else note('selected experiment has no results over time — evolution chart not exercised');
	const appr = map.locator('section[aria-label="For your approval"]');
	await appr.waitFor({ timeout: 8000 }).catch(() => {});
	if (await appr.count()) {
		const t = await appr.innerText();
		assert(/Try:/.test(t) && /Cost:/.test(t) && /Go ahead/.test(t) && /Not now/.test(t), 'approval card: Try / Cost / Go ahead / Not now');
	} else note('no suggestions on this app — approval card not exercised');
	await page.close();
});

// ── Inbox: app suggestions are answerable where people look ───────────────
await section('inbox suggestions', async () => {
	const page = await desk.ctx.newPage();
	await page.goto(`${BASE}/studio/inbox`, { waitUntil: 'domcontentloaded' });
	const sec = page.locator('section[aria-label="Suggested experiments"]');
	try { await sec.waitFor({ timeout: 40000 }); } catch { note('no app suggestions for this account — inbox suggestions not exercised'); await page.close(); return; }
	const card = sec.locator('section[aria-label="For your approval"]').first();
	const t = await card.innerText();
	assert(/suggests/i.test(t) && /Try:/.test(t) && /Cost:/.test(t) && /Go ahead/.test(t), 'inbox shows the same approval card, naming the app');
	await card.getByText('See it on the map').click();
	await page.waitForURL(/suggestion=/, { timeout: 15000 });
	const map = page.locator('section[aria-label="Research"]');
	await map.waitFor({ timeout: 40000 });
	await page.waitForTimeout(1200);
	assert(await map.locator('.space3d [data-kind="suggested"] button[aria-pressed="true"]').count() === 1, 'the map opens on that suggestion');
	await page.close();
});

// ── reduced motion: nothing keeps moving except the loaders' slow fade ──────
await section('reduced motion (Activity + Research map)', async () => {
	const rm = await authContext(b, BASE, { viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
	const page = await rm.ctx.newPage();
	for (const path of ['/studio/runs', `/studio/apps/${process.env.MAP_APP || 'quant-research'}`]) {
		await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
		await page.waitForTimeout(6000);
		const moving = await page.evaluate(() => document.getAnimations()
			.filter((a) => a.playState === 'running')
			.map((a) => (a.animationName || a.transitionProperty || a.constructor.name))
			.filter((n) => n !== 'lumen-fade'));
		assert(moving.length === 0, `${path}: no running animations under reduced motion (${moving.slice(0, 4).join(', ') || 'none'})`);
	}
	await rm.ctx.close();
});

// ── Go ahead, against a fixture (the experiments POST never leaves the page) ─
await section('approval: Go ahead (fixture)', async () => {
	const page = await desk.ctx.newPage();
	let posted = null;
	await page.route('**/api/v1/me/apps/*/experiments', async (route) => {
		if (route.request().method() !== 'POST') return route.continue();
		posted = JSON.parse(route.request().postData() || '{}');
		await route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ ret_code: 0, message: 'ok', data: { intent_id: 'fixture', app: 'x', experiment: posted.id, status: 'pending' } }) });
	});
	await page.goto(`${BASE}/studio/apps/${process.env.MAP_APP || 'quant-research'}`, { waitUntil: 'domcontentloaded' });
	const card = page.locator('section[aria-label="For your approval"]').first();
	try { await card.waitFor({ timeout: 40000 }); } catch { note('no suggestion to approve on this app — Go ahead not exercised'); await page.close(); return; }
	const go = card.getByRole('button', { name: 'Go ahead' });
	if (await go.isDisabled()) { note('first suggestion lacks a workflow/metric — Go ahead disabled by design'); await page.close(); return; }
	await go.click();
	await page.waitForTimeout(800);
	assert(posted && posted.id && posted.loop && posted.metric, `Go ahead posts the suggestion as an experiment (${posted ? posted.id : 'nothing posted'})`);
	assert(await page.getByText(/^Started “/).count() > 0, 'and says it started, in words');
	await page.close();
});

await section('Runs segmented filters', async () => {
	const page = await desk.ctx.newPage();
	// The run-state filter lives in the Timeline view since Activity (11-24).
	await page.goto(`${BASE}/studio/runs?view=list`, { waitUntil: 'domcontentloaded' });
	const group = page.getByRole('radiogroup', { name: 'Run state' });
	await group.waitFor({ timeout: 20000 });
	const failed = group.getByRole('radio', { name: /^Failed/ });
	const all = group.getByRole('radio', { name: /^All/ });
	assert(await all.getAttribute('aria-checked') === 'true', 'All is selected by default');
	await failed.click();
	await page.waitForTimeout(300);
	assert(await failed.getAttribute('aria-checked') === 'true' && await all.getAttribute('aria-checked') === 'false', 'clicking Failed moves the selection');
	await page.keyboard.press('ArrowRight');
	await page.waitForTimeout(200);
	const running = group.getByRole('radio', { name: /^Running/ });
	assert(await running.getAttribute('aria-checked') === 'true', 'ArrowRight moves the selection (Failed -> Running)');
	const focusedRunning = await running.evaluate((el) => el === document.activeElement && el.matches(':focus-visible'));
	const ring = await running.evaluate((el) => getComputedStyle(el).boxShadow);
	assert(focusedRunning && ring !== 'none', `focus follows the arrow and draws a ring (${ring.slice(0, 50)})`);
	await page.close();
});

// ── docs ─────────────────────────────────────────────────────────────────
await section('docs index -> reader -> back', async () => {
	const page = await desk.ctx.newPage();
	await page.goto(`${BASE}/studio/docs`, { waitUntil: 'domcontentloaded' });
	const card = page.locator('a[href="/studio/docs/workflows"]');
	await card.waitFor({ timeout: 20000 });
	assert(await page.locator('h1', { hasText: 'Documentation' }).count() === 1, 'one Documentation title (strip does not repeat it)');
	await card.hover();
	await page.waitForTimeout(250);
	const lift = await card.evaluate((el) => getComputedStyle(el).transform);
	note(`card hover transform: ${lift}`);
	await card.click();
	const article = page.locator('article.docs-md');
	await article.waitFor({ timeout: 20000 });
	const link = await article.locator('a').first().evaluate((el) => getComputedStyle(el).color).catch(() => '');
	assert(!/9,\s*105,\s*218/.test(link), `doc links are not GitHub blue (${link || 'no links'})`);
	await page.getByRole('link', { name: 'All docs' }).click();
	await page.waitForURL(/\/studio\/docs$/, { timeout: 10000 });
	assert(true, 'All docs returns to the index');
	await page.close();
});

// ── claude-sessions search ───────────────────────────────────────────────
await section('/claude-sessions search', async () => {
	const page = await desk.ctx.newPage();
	await page.goto(`${BASE}/claude-sessions`, { waitUntil: 'domcontentloaded' });
	const search = page.getByRole('searchbox', { name: 'Search sessions' });
	await search.waitFor({ timeout: 20000 });
	const rows = page.locator('button[aria-label="Delete session"]');
	await rows.first().waitFor({ timeout: 20000 }).catch(() => {});
	const n0 = await rows.count();
	if (n0 === 0) { note('no recorded sessions on this account — search check skipped'); await page.close(); return; }
	await search.fill('zz-no-such-session-zz');
	await page.waitForTimeout(300);
	assert(await rows.count() === 0 && await page.getByText('Nothing matches').isVisible(), `search narrows ${n0} -> 0 with the NoMatches state`);
	await page.getByRole('button', { name: 'Clear filter' }).click();
	await page.waitForTimeout(300);
	assert(await rows.count() === n0, `Clear filter restores all ${n0}`);
	const back = page.getByRole('link', { name: 'Back to Lumid Studio' });
	assert(await back.count() === 1, 'standalone frame links back to Studio');
	await page.close();
});

// ── chat send (writes; cleaned up) ───────────────────────────────────────
if (SKIP_CHAT) {
	note('SKIP_CHAT=1 — chat send not exercised');
} else await section('chat send flow', async () => {
	const page = await desk.ctx.newPage();
	await page.goto(`${BASE}/studio`, { waitUntil: 'domcontentloaded' });
	const box = page.getByPlaceholder('Ask anything…');
	await box.waitFor({ timeout: 25000 });
	const send = page.getByRole('button', { name: 'Send message' });
	const sendBgEmpty = await send.evaluate((el) => getComputedStyle(el).backgroundColor);
	await box.fill('Reply with exactly the word: OK');
	await page.waitForTimeout(250);
	const sendBgReady = await send.evaluate((el) => getComputedStyle(el).backgroundColor);
	assert(sendBgEmpty !== sendBgReady, `send button warms once there is text (${sendBgEmpty} -> ${sendBgReady})`);
	await send.click();
	const bubble = page.getByText('Reply with exactly the word: OK').last();
	await bubble.waitFor({ timeout: 15000 });
	assert(true, 'user bubble renders');
	const thinking = await page.locator('.strand-think').first().waitFor({ timeout: 8000 }).then(() => true).catch(() => false);
	note(`StrandMark "thinking" seen while streaming: ${thinking}`);
	const answered = await page.waitForFunction(() => {
		const t = document.querySelector('main')?.innerText || '';
		return /\bOK\b/.test(t.replace('Reply with exactly the word: OK', ''));
	}, null, { timeout: 120000 }).then(() => true).catch(() => false);
	assert(answered, 'assistant answer lands ("OK")');
	await page.screenshot({ path: `${SHOTS}/chat-answer.png` });
	// Clean up by TITLE, not URL: the composer keeps /studio while a fresh
	// thread streams, and the save is debounced, so the id may never reach the
	// address bar (or the thread may never persist at all).
	await page.waitForTimeout(4000);
	const removed = await page.evaluate(async (needle) => {
		const r = await fetch('/api/v1/me/chats?limit=20', { credentials: 'include' });
		const j = await r.json().catch(() => ({}));
		const d = j?.data ?? j;
		const rows = Array.isArray(d) ? d : (d?.chats ?? []);
		const hits = rows.filter((c) => (c.title || '').includes(needle) || (c.preview || '').includes(needle));
		const out = [];
		for (const c of hits) out.push(`${c.id}:${(await fetch('/api/v1/me/chats/' + encodeURIComponent(c.id), { method: 'DELETE', credentials: 'include' })).status}`);
		return out;
	}, 'Reply with exactly the word');
	note(removed.length ? `cleanup: deleted ${removed.join(', ')}` : 'cleanup: the test thread was not persisted — nothing to delete');
	await page.close();
});

await b.close();
console.log(fails.length ? `\n${fails.length} FAILED:\n  - ${fails.join('\n  - ')}` : '\nALL PASS');
process.exit(fails.length ? 1 : 0);

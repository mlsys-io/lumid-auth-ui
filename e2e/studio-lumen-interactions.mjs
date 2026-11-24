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
//   filters   Segmented radios on Runs switch state (aria-checked)
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
	const r1 = await settle('Runs');
	assert(r1.off <= 3, `indicator centred on the active row (Runs), off by ${r1.off.toFixed(1)}px`);
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
	await page.getByRole('radio').first().waitFor({ timeout: 20000 });
	// Focus the first landing-pref radio by keyboard (Tab from the one before it).
	await page.getByRole('radio').first().focus();
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

// ── Segmented filters ────────────────────────────────────────────────────
await section('Runs segmented filters', async () => {
	const page = await desk.ctx.newPage();
	await page.goto(`${BASE}/studio/runs`, { waitUntil: 'domcontentloaded' });
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
	const id = page.url().match(/\/studio\/chat\/([^/?#]+)/)?.[1];
	if (id) {
		const del = await page.evaluate(async (cid) => (await fetch('/api/v1/me/chats/' + encodeURIComponent(cid), { method: 'DELETE', credentials: 'include' })).status, id);
		note(`cleanup: DELETE thread ${id} -> ${del}`);
	} else note('cleanup: thread id not in URL — delete it by hand from Recent');
	await page.close();
});

await b.close();
console.log(fails.length ? `\n${fails.length} FAILED:\n  - ${fails.join('\n  - ')}` : '\nALL PASS');
process.exit(fails.length ? 1 : 0);

#!/usr/bin/env node
// Quant Research, end to end — backtest and forward test (2026-11-27). The
// acceptance scenario for a quant researcher's loop: write a strategy, deploy
// it, backtest it on recorded tape, watch it forward-test on a live lane, and
// take it down again. It WRITES on a separate copy of the app (`$APP`, default
// quant-research-e2e): the copy's runs, its graph and its ledger. A strategy
// registration is per ACCOUNT, not per app, so the one it deploys is named
// `qr_fwd_<run>` and is DISABLED at the end, pass or fail. No money moves:
// every lane a registered strategy can reach is SHADOW (decisions, no fills).
//
//   LUMID_BASE=https://lum.id LUMID_PAT=$(cat ~/.lumid/admin.pat) \
//   e2e/in-container.sh e2e/scenario-quant-research.mjs
//
// Steps, each through the UI and through the chat where both exist:
//   1 the app on the graph          2 write a strategy (chat)
//   3 deploy it (Strategies page)   4 backtest it (page, chat, graph)
//   5 forward test it (strategy page, chat)   6 disable it
// Output: e2e/out/quant/<step>.png and report.json. A run that starts without a
// press, a press that drives another app, or a chat answer that invents a
// number fails the scenario.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const BASE = process.env.LUMID_BASE || 'https://lum.id';
const PAT = process.env.LUMID_PAT || '';
const SRC_SLUG = process.env.SRC_SLUG || 'a3f48236-ffe9-4fb9-9548-6e044d5cd9c7/quant-research';
const APP = process.env.APP || 'quant-research-e2e';
const OUT = path.resolve(process.env.OUT || 'e2e/out/quant');
const RUN = process.env.RUN_ID || Date.now().toString(36).slice(-4);
const STRAT = `qr_fwd_${RUN}`;
// How long the shadow lane may take to publish the new strategy's first
// scorecard (registry sync + lane refresh is "a few minutes"; a cycle is 60 s).
const FORWARD_WAIT_MIN = Number(process.env.FORWARD_WAIT_MIN || 25);
fs.mkdirSync(OUT, { recursive: true });
if (!PAT) { console.error('LUMID_PAT is required'); process.exit(2); }

// The sample strategy (sample_data/ofi_momentum_v1.lqts), one lot, renamed.
const STRAT_BODY = `strategy ${STRAT} {
  params { threshold: 0.15, size_lots: 1 }
  when signal("ofi_z") > params.threshold {
    buy params.size_lots lots @ mid
  }
}
`;

const report = { base: BASE, app: APP, strategy: STRAT, started: new Date().toISOString(), steps: [], chat: [], fails: [] };
const t0 = Date.now();
let stepName = '';
const assert = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) report.fails.push(`${stepName}: ${msg}`); return cond; };
const note = (msg) => console.log(`  - ${msg}`);

const api = async (method, p, body) => {
	const r = await fetch(`${BASE}/api/v1/me${p}`, { method, headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
	const j = await r.json().catch(() => ({}));
	return { status: r.status, data: j?.data ?? j };
};
/** The account's strategy row by name (registrations are per account). */
// /me/strategies lists compiled registrations; a deploy still waiting in the
// LQT mailbox ("sent") shows only in the registry itself, so read both — the
// cleanup must find (and disable) whatever this run registered.
const LQT = process.env.LQT_XPIO || 'https://lumid.trade';
const myStrategy = async () => {
	const mine = ((await api('GET', '/strategies')).data?.strategies || []).find((s) => s.name === STRAT);
	if (mine) return mine;
	const r = await fetch(`${LQT}/xpio/strategies?limit=50`, { headers: { Authorization: `Bearer ${PAT}` } }).catch(() => null);
	const j = r?.ok ? await r.json().catch(() => ({})) : {};
	return (j.strategies || []).find((s) => s.name === STRAT);
};
/** The copy's runs of one workflow, newest first, optionally for one strategy. */
const runsOf = async (loop, sid) => ((await api('GET', `/apps/${APP}/data?tool=runs&loop=${loop}${sid ? `&source_strategy_id=${sid}` : ''}`)).data?.runs || [])
	.sort((x, y) => (String(x.run_ts) < String(y.run_ts) ? 1 : -1));

const b = await chromium.launch({ headless: true, executablePath: process.env.CHROME || undefined, args: ['--no-sandbox'] });
const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 }, extraHTTPHeaders: { Authorization: `Bearer ${PAT}` } });
await ctx.addInitScript(() => { try { localStorage.setItem('studio_ws_chat_open', '1'); } catch {} });
const page = await ctx.newPage();
// "Disable" asks with the browser's own confirm: accept it (the press is the intent).
page.on('dialog', (d) => d.accept().catch(() => {}));
// Every run request is recorded: one that starts without a press fails, and so
// does one that names another app (a copy's page must drive the copy).
const runRequests = [];
let pressedAt = 0;
page.on('request', (r) => {
	const u = r.url();
	if (r.method() !== 'GET' && /\/workflows\/[^/]+\/run|mode=queue|\/enqueue/.test(u + (r.postData() || ''))) {
		const app = decodeURIComponent(u.match(/\/agents\/([^/]+)\/workflows\//)?.[1] || '');
		const body = r.postData() || '';
		// A page action with `await` follows its claim by itself ("poll" runs every
		// 30 s after the press, ui/strategies.yaml) — started by the press, not a new run.
		const followUp = /"action"\s*:\s*"poll"/.test(body);
		runRequests.push({ at: Date.now(), url: u, app, body: body.slice(0, 300), followUp, pressed: Date.now() - pressedAt < 4000 });
	}
});
const press = async (loc) => { pressedAt = Date.now(); await loc.click(); };

async function step(name, fn) {
	stepName = name;
	console.log(`\n── ${name}`);
	const s = Date.now();
	try { await fn(); } catch (e) { assert(false, `threw ${String(e).split('\n')[0].slice(0, 200)}`); }
	const file = `${OUT}/${report.steps.length + 1}-${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`;
	await page.screenshot({ path: file }).catch(() => {});
	report.steps.push({ name, ms: Date.now() - s, shot: path.basename(file) });
}

const map = () => page.locator('section[aria-label="Research"]');
const nodeButton = (kind, label) => map().locator(`.space3d [data-kind="${kind}"] button[aria-label^="${label}"]`).first();
const domClick = (loc) => loc.evaluate((el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
const panel = () => map().getByRole('dialog').first();
async function openApp() {
	await page.goto(`${BASE}/studio/apps/${APP}`, { waitUntil: 'domcontentloaded' });
	const wfNodes = map().locator('.space3d [data-kind="workflow"]');
	if (!(await wfNodes.first().waitFor({ timeout: 30000 }).then(() => true).catch(() => false))) {
		const graphTab = page.locator('nav[aria-label="This app\'s pages"] a').first();
		if (await graphTab.count()) await graphTab.click().catch(() => {});
		await wfNodes.first().waitFor({ timeout: 60000 });
	}
	await page.waitForTimeout(2500);
}
async function openWorkflow(label) {
	const open = map().getByRole('dialog', { name: new RegExp(`^(Workflow|Variant): ${label}`, 'i') });
	if (await open.count()) return;
	await domClick(nodeButton('workflow', label));
	await panel().waitFor({ timeout: 10000 });
	await page.waitForTimeout(800);
}
async function openSurface(surface, extra = '') {
	await page.goto(`${BASE}/studio/apps/${APP}?surface=${surface}${extra}`, { waitUntil: 'domcontentloaded' });
	await page.locator('main').getByRole('table').first().waitFor({ timeout: 60000 }).catch(() => {});
	await page.waitForTimeout(2000);
}
/** The table row that names the strategy (the list hides nothing by this prefix). */
const strategyRow = () => page.locator('main tr').filter({ hasText: STRAT }).first();
/** A row action: the lead is a button on the row, the rest sit behind ⋯. */
async function rowAction(row, label) {
	const direct = row.getByRole('button', { name: label, exact: true });
	if (await direct.count()) return press(direct.first());
	await row.getByRole('button', { name: 'More actions' }).click();
	await page.waitForTimeout(400);
	await press(page.locator('[data-radix-popper-content-wrapper]').getByRole('button', { name: label, exact: true }).last());
}

/** Ask the docked chat; returns what the chat added (its reply) once it settles. */
async function chat(prompt, { timeout = 300000 } = {}) {
	const box = page.locator('textarea').last();
	await box.waitFor({ timeout: 20000 });
	const rail = box.locator('xpath=ancestor::aside[1]');
	const scope = (await rail.count()) ? rail : page.locator('body');
	const before = await scope.innerText().catch(() => '');
	await box.fill(prompt);
	await page.getByRole('button', { name: 'Send message' }).last().click();
	const started = Date.now();
	const busyNow = async () => (await page.getByRole('button', { name: 'Stop generating' }).count())
		+ (await page.getByRole('button', { name: 'Queue message' }).count())
		+ (await page.locator('[aria-live="polite"]').filter({ hasText: /^(Running |Thinking…|Working…)/ }).count());
	const tail = prompt.slice(-40);
	const replyOf = (t) => { const at = t.lastIndexOf(tail); return at >= 0 ? t.slice(at + tail.length) : t.replace(before, ''); };
	await page.waitForFunction(() => !!document.querySelector('button[aria-label="Queue message"], button[aria-label="Stop generating"]'), null, { timeout: 30000 }).catch(() => {});
	let last = '', quietSince = Date.now();
	while (Date.now() - started < timeout) {
		await page.waitForTimeout(2000);
		const t = await scope.innerText().catch(() => '');
		if (t !== last || (await busyNow())) { quietSince = Date.now(); last = t; continue; }
		if (Date.now() - quietSince >= 20000 && replyOf(t).trim()) break;
	}
	const reply = replyOf(last);
	report.chat.push({ step: stepName, prompt, reply: reply.trim().slice(0, 4000), ms: Date.now() - started });
	return reply;
}
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
const RUN_ID = /\b20\d{6}T\d{6}Z\b|\brun[ _]?(?:id|ts)?[:# ]+\S+/i;

let sid = ''; // the deployed strategy's id
try {
	// ── setup: a copy, so the user's own Quant Research stays clean ─────────
	await step('setup: a copy of Quant Research', async () => {
		const listed = async () => ((await api('GET', '/apps')).data?.apps || []).some((a) => a.name === APP);
		if (!(await listed())) {
			const r = await api('POST', '/apps', { slug: SRC_SLUG, runtime: 'local', as: APP });
			assert(r.status < 300, `installed ${SRC_SLUG} as ${APP} (HTTP ${r.status}${r.status >= 300 ? `: ${String(r.data?.message || '').slice(0, 160)}` : ''})`);
			const until = Date.now() + 5 * 60000;
			while (Date.now() < until && !(await listed())) await page.waitForTimeout(5000);
			if (!assert(await listed(), `${APP} shows in the app list`)) throw new Error('no copy to test on');
		} else note(`${APP} already installed — reusing it`);
		await openApp();
	});

	// ── 1. the app on the graph ─────────────────────────────────────────────
	await step('1 the app on the graph', async () => {
		const root = (await map().locator('.space3d [data-kind="app"] button').first().getAttribute('aria-label')) || '';
		assert(/\d+ workflows?/.test(root), `the centre counts workflows ("${root}")`);
		assert(await nodeButton('workflow', 'Forward test').count() > 0, 'Forward test is on the graph');
		await openWorkflow('Backtest');
		const t = await panel().innerText();
		// The service is named in words ("by a backtest on recorded market history"), not by its id.
		assert(/by a backtest on recorded|lqt-backtest/i.test(t), 'Backtest says what judges it (a backtest on recorded market history)');
		assert(/real.?tape|all.?axes|pnl/i.test(t), 'Backtest names what it measures (real tape, all axes, PnL)');
	});

	// ── 2. write a strategy ─────────────────────────────────────────────────
	await step('2 write: a strategy through the chat', async () => {
		const before = runRequests.length;
		const reply = await chat(`In ${APP}, write me a strategy like the ofi_momentum_v1 sample that buys 1 lot at mid when ofi_z is above 0.15. Show me the .lqts source only — don't deploy, backtest or run anything.`);
		assert(/strategy\s+\w+\s*\{/.test(reply) && /ofi_z/.test(reply), 'the chat writes the strategy source');
		assert(runRequests.length === before, 'the chat started no run');
	});

	// ── 3. deploy it ────────────────────────────────────────────────────────
	await step('3 deploy: through the Strategies page', async () => {
		await openSurface('strategies');
		const before = runRequests.length;
		await press(page.getByRole('button', { name: 'Deploy a strategy', exact: true }));
		const dlg = page.getByRole('alertdialog');
		await dlg.waitFor({ timeout: 10000 });
		await dlg.getByLabel('Strategy name').fill(STRAT);
		await dlg.getByLabel(/^Strategy \(raw/).fill(STRAT_BODY);
		await press(dlg.getByRole('button', { name: 'Submit' }));
		await dlg.waitFor({ state: 'detached', timeout: 30000 }).catch(() => {});
		await page.waitForTimeout(3000);
		const mine = runRequests.slice(before);
		assert(mine.length > 0 && mine.every((r) => r.pressed), 'Deploy queued one run, on the press');
		assert(mine.every((r) => r.app === APP), `the copy's page drives the copy (${[...new Set(mine.map((r) => r.app))].join(', ') || 'no request'})`);
		// It compiles in seconds once the scheduler picks the run up.
		let row;
		for (const until = Date.now() + 8 * 60000; Date.now() < until; await page.waitForTimeout(15000)) {
			row = await myStrategy();
			if (row && !/^(sent|pending|queued)$/i.test(row.status || '')) break;
		}
		sid = row?.strategy_id || '';
		report.strategy_id = sid;
		assert(!!sid, `${STRAT} is registered (${row?.status || 'not found'})`);
		if (/^sent$/i.test(row?.status || '')) note('still "sent" after 8 min — the LQT mailbox has not compiled it yet');
		assert(/deployed|active/i.test(row?.status || ''), `it compiled and deployed (status ${row?.status || '—'})`);
		await openSurface('strategies');
		assert(await strategyRow().count() > 0, 'it shows in Your strategies');
	});
	// A registration that never compiled has nothing to backtest or forward-test.
	if (!sid || !/deployed|active/i.test((await myStrategy())?.status || '')) throw new Error('no deployed strategy to test');

	// ── 4. backtest it ──────────────────────────────────────────────────────
	await step('4 backtest: from the strategy row', async () => {
		await openSurface('strategies');
		const before = runRequests.length;
		await rowAction(strategyRow(), 'Run backtest');
		const dlg = page.getByRole('alertdialog');
		await dlg.waitFor({ timeout: 10000 });
		await dlg.getByLabel('Window', { exact: true }).fill('7d');
		await press(dlg.getByRole('button', { name: 'Submit' }));
		await page.waitForTimeout(4000);
		const mine = runRequests.slice(before);
		assert(mine.length > 0 && mine.every((r) => r.app === APP), `the backtest runs in the copy (${[...new Set(mine.map((r) => r.app))].join(', ') || 'no request'})`);
		// The page follows the claim to its verdict (polls every 30 s, ≤ 10 min).
		const verdict = page.getByText(/Real on all three axes:/).first();
		const settled = await verdict.waitFor({ timeout: 12 * 60000 }).then(() => true).catch(() => false);
		assert(settled, 'the verdict appears under the list');
		const card = settled ? await verdict.locator('xpath=ancestor::*[contains(., "claim")][1]').innerText().catch(() => '') : '';
		report.backtest_verdict = card.slice(0, 600);
		assert(/claim\s+[0-9a-z-]{8,}/i.test(card), 'it names the claim');
		assert(/Realized PnL|n\/a|synthetic|not real/i.test(card), 'it states the PnL, or says why there is none');
	});
	await step('4 backtest: the strategy page lists it', async () => {
		await openSurface('strategy', `&strategy_id=${sid}`);
		const sec = page.locator('main').getByText('Backtests for this strategy').first();
		await sec.scrollIntoViewIfNeeded().catch(() => {});
		let runs = [];
		for (const until = Date.now() + 3 * 60000; Date.now() < until && !runs.length; await page.waitForTimeout(15000)) runs = await runsOf('backtest', sid);
		assert(runs.length > 0, `the copy recorded the backtest for this strategy (${runs.length})`);
		const m = runs[0]?.metrics || {};
		note(`newest: ${m.symbol || '?'} · real=${m.presentable_as_performance} · ${String(m.result_summary || '').slice(0, 120)}`);
		assert('presentable_as_performance' in m, 'the run says whether it is real (presentable)');
	});
	await step('4 backtest: through the chat', async () => {
		const reply = await chat(`Backtest my strategy ${STRAT} (id ${sid}) in ${APP} over the last 3 days on an auto-picked tape-covered instrument. Wait for the result, then tell me whether prices, signals and settlement were all recorded (real) and the realized PnL. Cite the claim id; invent no numbers.`, { timeout: 900000 });
		assert(UUID.test(reply) || /claim/i.test(reply), 'the chat cites the claim');
		assert(/real|recorded|synthetic/i.test(reply), 'the chat says whether the replay was real');
		assert(/pnl|profit|ticks/i.test(reply), 'the chat reports the PnL (or why there is none)');
	});
	await step('4 backtest: the sample from the graph', async () => {
		await openApp();
		await openWorkflow('Backtest');
		const before = (await runsOf('backtest'))[0]?.run_ts;
		await press(panel().getByRole('button', { name: /^Run/ }).first());
		let fresh;
		for (const until = Date.now() + 10 * 60000; Date.now() < until; await page.waitForTimeout(15000)) {
			fresh = (await runsOf('backtest'))[0];
			if (fresh && fresh.run_ts !== before) break;
		}
		assert(fresh && fresh.run_ts !== before, 'the Backtest run from the graph settles');
		const m = fresh?.metrics || {};
		assert('real_tape' in m || 'all_axes_real' in m, `it records the honesty metrics (real_tape=${m.real_tape}, all_axes_real=${m.all_axes_real})`);
	});

	// ── 5. forward test it ──────────────────────────────────────────────────
	await step('5 forward: the shadow lane picks it up', async () => {
		// Press Forward test on the strategy page until the lane has published
		// a scorecard (or the wait runs out). Each press is one scheduler run.
		let m = {}, n = 0;
		for (const until = Date.now() + FORWARD_WAIT_MIN * 60000; Date.now() < until;) {
			await openSurface('strategy', `&strategy_id=${sid}`);
			const before = (await runsOf('forward_test', sid))[0]?.run_ts;
			const reg = page.locator('main tr').filter({ hasText: STRAT }).first();
			await rowAction(reg, 'Forward test');
			n++;
			let fresh;
			for (const t = Date.now() + 4 * 60000; Date.now() < t; await page.waitForTimeout(10000)) {
				fresh = (await runsOf('forward_test', sid))[0];
				if (fresh && fresh.run_ts !== before) break;
			}
			m = fresh?.metrics || {};
			note(`reading ${n}: ${m.scorecards ?? '?'} scorecards · lanes ${JSON.stringify(m.arms ?? '').slice(0, 120)} · ${String(m.verdict || '').slice(0, 140)}`);
			if (Number(m.scorecards) > 0) break;
			await page.waitForTimeout(3 * 60000);
		}
		report.forward = m;
		assert(Number(m.scorecards) > 0, `a lane published scorecards for ${STRAT} within ${FORWARD_WAIT_MIN} min (${m.scorecards ?? 0})`);
		assert(/shadow/i.test(JSON.stringify(m.arms ?? '') + (m.verdict || '')), 'the lane is labelled shadow');
		assert(Number(m.paper_fills || 0) === 0 || /paper/i.test(JSON.stringify(m.arms ?? '')), 'no fills are claimed from a shadow lane');
		await openSurface('strategy', `&strategy_id=${sid}`);
		const sec = page.locator('main').getByText('Forward tests for this strategy').first();
		await sec.scrollIntoViewIfNeeded().catch(() => {});
		assert(await sec.count() > 0, 'the strategy page shows its forward tests');
	});
	await step('5 forward: through the chat', async () => {
		const reply = await chat(`Is my strategy ${STRAT} (id ${sid}) forward-testing in ${APP}? Read its forward test: which lane, is it shadow or paper, and how many decisions were proposed, submitted and rejected? Cite the run; invent no numbers and start no new deploys.`);
		assert(/shadow|paper/i.test(reply), 'the chat names the lane mode');
		assert(/propos|submit|reject|decision/i.test(reply), 'the chat reports the decision funnel');
		assert(!/\bprofit(ed|able)\b/i.test(reply) || /no (pnl|profit)|not pnl/i.test(reply), 'the chat claims no profit from a shadow lane');
	});
} finally {
	// ── 6. disable it — always, pass or fail ──────────────────────────────
	await step('6 disable: from the strategy page', async () => {
		if (!sid) sid = (await myStrategy())?.strategy_id || '';
		if (!sid) { note('nothing deployed — nothing to disable'); return; }
		// A registration the consumer REJECTED never runs: nothing to take down.
		const now = await myStrategy();
		if (/^rejected$/i.test(now?.status || '')) { note(`${STRAT} was rejected (${JSON.stringify(now?.ack_payload?.reason || '')}) — nothing to disable`); return; }
		await openSurface('strategy', `&strategy_id=${sid}`);
		const reg = page.locator('main tr').filter({ hasText: STRAT }).first();
		if (await reg.count()) await rowAction(reg, 'Disable').catch((e) => note(`Disable press failed: ${String(e).slice(0, 120)}`));
		let row;
		for (const until = Date.now() + 5 * 60000; Date.now() < until; await page.waitForTimeout(15000)) {
			row = await myStrategy();
			if (/disabled|stopped|inactive/i.test(row?.status || '')) break;
		}
		if (!/disabled|stopped|inactive/i.test(row?.status || '')) {
			note('the page did not disable it — disabling through the API');
			await api('POST', `/agents/${APP}/workflows/send_strategy_disable/run`, { args: { strategy_id: sid, reason: 'e2e scenario cleanup' } });
			for (const until = Date.now() + 5 * 60000; Date.now() < until; await page.waitForTimeout(15000)) {
				row = await myStrategy();
				if (/disabled|stopped|inactive/i.test(row?.status || '')) break;
			}
		}
		assert(/disabled|stopped|inactive/i.test(row?.status || ''), `${STRAT} is disabled (status ${row?.status || '—'})`);
	});
	report.ms = Date.now() - t0;
	report.followUpPolls = runRequests.filter((r) => !r.pressed && r.followUp).length;
	report.unpressed = runRequests.filter((r) => !r.pressed && !r.followUp).map((r) => ({ url: r.url, body: r.body }));
	report.unpressedRuns = report.unpressed.length;
	if (report.followUpPolls) note(`${report.followUpPolls} follow-up poll run(s) the page started after a press (await)`);
	report.otherAppRuns = runRequests.filter((r) => r.app && r.app !== APP).map((r) => r.url);
	stepName = 'whole run';
	assert(report.unpressedRuns === 0, 'no run dispatched without a press (UI)');
	assert(report.otherAppRuns.length === 0, `no press drove another app (${report.otherAppRuns.length})`);
	fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
	console.log(`\n${report.fails.length ? `${report.fails.length} FAILED` : 'ALL PASS'} · ${Math.round(report.ms / 1000)} s · ${OUT}/report.json`);
	await b.close();
}
process.exit(report.fails.length ? 1 : 0);

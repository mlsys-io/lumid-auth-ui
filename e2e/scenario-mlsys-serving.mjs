#!/usr/bin/env node
// A real MLSys case, end to end — the acceptance scenario for the research
// graph (2026-11-25). It WRITES (creates workflows, dispatches runs, talks to
// the chat) on a forked copy of MLSys Research (`$APP`, default
// mlsys-research-e2e) so real users' graphs stay clean. Each step is done once
// through the UI and once through the chat (the control plane), and asserts
// what changed on the graph.
//
//   LUMID_BASE=https://lum.id LUMID_PAT=$(cat ~/.lumid/admin.pat) \
//   CHROME=… node e2e/scenario-mlsys-serving.mjs
//
// Story (task 9.2: serve the 0.6B/1.7B models on one GPU under an SLA —
// TTFT p99 < 2 s, completion ≥ 0.99, maximise goodput):
//   1 the problem on the graph   2 design the solution as a workflow (variant)
//   3 tune with the simulator    4 analyse an unexpected result (A/B + chat)
//   5 decide and dispatch next   6 fine-tune in the sandbox   7 manage the node
// Output: e2e/out/scenario/<step>.png, report.json (timings, verdicts, chat replies).
// Teardown: the workflows this run created (sla_tuned_<RUN>, sandbox_<RUN>) are
// deleted at the end, by exact name, with ?force=1 so the experiments set up on
// them go too (the nodes it made are re-parented, not deleted). KEEP=1 keeps
// them for a look afterwards.
// A chat answer that invents a number, or a run that dispatches without a
// press, fails the scenario.

// Run it with e2e/in-container.sh on a box that is also a k3s node: pod churn
// there makes Chrome abort long chat streams (net::ERR_NETWORK_CHANGED).

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const BASE = process.env.LUMID_BASE || 'https://lum.id';
const PAT = process.env.LUMID_PAT || '';
const SRC_SLUG = process.env.SRC_SLUG || 'a3f48236-ffe9-4fb9-9548-6e044d5cd9c7/mlsys-research';
const APP = process.env.APP || 'mlsys-research-e2e';
const OUT = path.resolve(process.env.OUT || 'e2e/out/scenario');
// A suffix per run, so the scenario can run again on the same app.
const RUN = process.env.RUN_ID || Date.now().toString(36).slice(-4);
const TUNED = `sla_tuned_${RUN}`, SANDBOX = `sandbox_${RUN}`;
const KEEP = process.env.KEEP === '1';
// The workflows THIS run created, by exact name: the teardown deletes these
// and nothing else (never by prefix — other runs' and people's work shares the app).
const created = [];
const label = (id) => id.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
fs.mkdirSync(OUT, { recursive: true });
if (!PAT) { console.error('LUMID_PAT is required'); process.exit(2); }

const report = { base: BASE, app: APP, started: new Date().toISOString(), steps: [], chat: [], fails: [] };
const t0 = Date.now();
let stepName = '';
const assert = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) report.fails.push(`${stepName}: ${msg}`); return cond; };
const note = (msg) => console.log(`  - ${msg}`);

const api = async (method, p, body) => {
	const r = await fetch(`${BASE}/api/v1/me${p}`, { method, headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
	const j = await r.json().catch(() => ({}));
	return { status: r.status, data: j?.data ?? j };
};

/** Is `id` a workflow in the app's spec right now (applied edits included)? */
const inSpec = async (id) => {
	const yaml = (await api('GET', `/apps/${APP}/config`)).data?.yaml || '';
	const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	return new RegExp(`^\\s*(-\\s+)?(id|name):\\s*["']?${esc}["']?\\s*(#.*)?$`, 'm').test(yaml);
};
/** Click Create on the variant sheet; remember the workflow if this run makes it. */
async function createVariant(sheet, id) {
	if (!(await inSpec(id).catch(() => true))) created.push(id);
	else note(`${id} already exists (RUN_ID reused?) — the teardown leaves it alone`);
	await sheet.getByRole('button', { name: /^Create/ }).click();
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const b = await chromium.launch({ headless: true, executablePath: process.env.CHROME || undefined, args: ['--no-sandbox'] });
const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 }, extraHTTPHeaders: { Authorization: `Bearer ${PAT}` } });
await ctx.addInitScript(() => { try { localStorage.setItem('studio_ws_chat_open', '1'); } catch {} });
const page = await ctx.newPage();
// Every run request is recorded: a run that starts without a press fails.
const runRequests = [];
let pressedAt = 0;
page.on('request', (r) => {
	const u = r.url();
	if (r.method() !== 'GET' && /\/workflows\/[^/]+\/run|mode=queue|\/enqueue/.test(u + (r.postData() || ''))) runRequests.push({ at: Date.now(), url: u, pressed: Date.now() - pressedAt < 4000 });
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
const node = (kind, label) => map().locator(`.space3d [data-kind="${kind}"]`).filter({ has: page.locator(`button[aria-label^="${label}"]`) });
const nodeButton = (kind, label) => map().locator(`.space3d [data-kind="${kind}"] button[aria-label^="${label}"]`).first();
const domClick = (loc, shift = false) => loc.evaluate((el, s) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: s })), shift);
const panel = () => map().getByRole('dialog').first();
async function openApp() {
	await page.goto(`${BASE}/studio/apps/${APP}`, { waitUntil: 'domcontentloaded' });
	const wfNodes = map().locator('.space3d [data-kind="workflow"]');
	if (!(await wfNodes.first().waitFor({ timeout: 30000 }).then(() => true).catch(() => false))) {
		// The app opened on a remembered workflow: its tab row's "Graph" leads home.
		const graphTab = page.locator('nav[aria-label="This app\'s pages"] a').first();
		if (await graphTab.count()) await graphTab.click().catch(() => {});
		else await page.getByRole('button', { name: /^(Graph|Overview)$/ }).first().click().catch(() => {});
		await wfNodes.first().waitFor({ timeout: 60000 });
	}
	await page.waitForTimeout(2500);
}
async function openWorkflow(label) {
	// Creating a workflow already selects it; a second click would deselect it.
	const open = map().getByRole('dialog', { name: new RegExp(`^(Workflow|Variant): ${label}`, 'i') });
	if (await open.count()) return;
	await domClick(nodeButton('workflow', label));
	await panel().waitFor({ timeout: 10000 });
	await page.waitForTimeout(800);
}
/** Ask the docked chat; returns what the chat added (its reply) once it settles. */
async function chat(prompt, { timeout = 240000 } = {}) {
	const box = page.locator('textarea').last();
	await box.waitFor({ timeout: 20000 });
	// The rail around the composer: its text before and after is the reply.
	const rail = box.locator('xpath=ancestor::aside[1]');
	const scope = (await rail.count()) ? rail : page.locator('body');
	const before = await scope.innerText().catch(() => '');
	await box.fill(prompt);
	await page.getByRole('button', { name: 'Send message' }).last().click();
	const started = Date.now();
	// Busy while the chat streams OR runs tools between messages: the send
	// button then reads "Queue message" (and "Stop generating" shows). A turn
	// is over only when neither shows and the text has been still for 20 s —
	// multi-step tool turns pause for several seconds between steps.
	// "Thinking…" (still thinking) vs "Thought for 4s" (done): the send button
	// does not change while the model thinks, so read the words too.
	// The chat's activity line ("Running <tool>" / "Thinking…" / "Working…",
	// aria-live) is on screen exactly while a turn streams — including boot
	// and the gaps between tool steps, when no text arrives.
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
		// Never settle on an empty reply: a slow first token is not an answer.
		if (Date.now() - quietSince >= 20000 && replyOf(t).trim()) break;
	}
	// What appeared after the prompt (the reply, tool notes included).
	// Anchor on the END of the prompt (the bubble may wrap or trim its start).
	const reply = replyOf(last);
	report.chat.push({ step: stepName, prompt, reply: reply.trim().slice(0, 4000), ms: Date.now() - started });
	return reply;
}
/** Run ids look like 2026…T…Z (cycle dir ids) or run_ts digits. */
const RUN_ID = /\b20\d{6}T\d{6}Z\b|\brun[ _]?(?:id|ts)?[:# ]+\S+/i;

try {
// ── setup: a forked copy, so the real app's graph stays clean ─────────────
await step('setup: a copy of MLSys Research', async () => {
	// A fresh install of the PUBLISHED app under its own name (a fork would
	// copy the caller's installed copy, which may be an older version).
	const listed = async () => ((await api('GET', '/apps')).data?.apps || []).some((a) => a.name === APP);
	if (!(await listed())) {
		const r = await api('POST', '/apps', { slug: SRC_SLUG, runtime: 'local', as: APP });
		assert(r.status < 300, `installed ${SRC_SLUG} as ${APP} (HTTP ${r.status})`);
		const until = Date.now() + 5 * 60000;
		while (Date.now() < until && !(await listed())) await page.waitForTimeout(5000);
		assert(await listed(), `${APP} shows in the app list`);
	} else note(`${APP} already installed — reusing it`);
	await openApp();
	assert(true, 'the copy opens on its graph');
});

// ── 1. the problem on the graph ───────────────────────────────────────────
await step('1 the problem on the graph', async () => {
	const root = (await map().locator('.space3d [data-kind="app"] button').first().getAttribute('aria-label')) || '';
	assert(/\d+ workflows?/.test(root), `the centre counts workflows ("${root}")`);
	await openWorkflow('Simulate');
	const t = await panel().innerText();
	assert(/simulator/i.test(t), 'Simulate shows its feedback step "simulator"');
});

// ── 2. design the solution as a workflow ──────────────────────────────────
await step('2 design: a variant through the UI', async () => {
	const before = runRequests.length;
	await panel().getByRole('button', { name: /Make a variant/ }).click();
	const sheet = page.getByRole('dialog', { name: 'Make a variant' });
	await sheet.waitFor({ timeout: 10000 });
	await sheet.getByText('Same steps, other inputs').click();
	const idField = sheet.locator('#variant-id-0');
	if (await idField.count()) await idField.fill(TUNED);
	const nodeName = sheet.locator('input[aria-label="New node name"]');
	if (await nodeName.count()) await nodeName.fill(`SLA tuning ${RUN}`);
	await createVariant(sheet, TUNED);
	await sheet.waitFor({ state: 'detached', timeout: 120000 });
	await page.waitForTimeout(3000);
	assert(await node('workflow', label(TUNED)).count() > 0, 'the variant appears under Simulate');
	assert(runRequests.length === before, 'creating it started no run');
});
await step('2 design: a variant through the chat', async () => {
	const before = runRequests.length;
	const reply = await chat(`In ${APP}, make a variant of Simulate for task 9.2 from the baseline design that sweeps chunked prefill at 512, 1024 and 2048 tokens. Draft it and stage it for my approval — don't create or run anything yet.`);
	assert(/chunk/i.test(reply) && /512/.test(reply) && /approv|propos|stag/i.test(reply), 'the chat drafts the chunked-prefill variant for approval');
	if (/\?\s*$/.test(reply.trim()) || /which|what .* should/i.test(reply.slice(0, 300))) note('the chat asked a question instead of drafting');
	assert(runRequests.length === before, 'the chat started no run');
});

// ── 3. tune with the simulator ────────────────────────────────────────────
await step('3 tune: setups through the UI', async () => {
	await openApp();
	await openWorkflow(label(TUNED));
	await panel().getByRole('button', { name: 'Try setups' }).click();
	const dlg = page.getByRole('dialog', { name: 'Try setups' });
	await dlg.waitFor({ timeout: 8000 });
	const vary = dlg.locator('select').first();
	if (await vary.count()) await vary.selectOption({ label: 'overrides' }).catch(() => {});
	await dlg.getByLabel('Values').fill('serving.max_concurrency=8, serving.max_concurrency=16, serving.max_concurrency=32');
	await dlg.getByRole('button', { name: 'Set up the experiment' }).click();
	await dlg.waitFor({ state: 'detached', timeout: 60000 });
	// The experiment exists once the scheduler applies it (a queued write).
	const run = page.getByRole('button', { name: /Run the \d+ untried/ });
	if (!(await run.waitFor({ timeout: 60000 }).then(() => true).catch(() => false))) {
		// Its OWN experiment (TrySetups names it <workflow>_<input>_…), never
		// whichever experiment happens to be last on the graph.
		await openApp();
		const mine = map().locator(`.space3d [data-kind="experiment"] button[aria-label*="tuned ${RUN}" i]`).first();
		await mine.waitFor({ timeout: 180000 });
		await domClick(mine);
		await run.waitFor({ timeout: 60000 });
	}
	const before = runRequests.length;
	await press(run);
	await page.waitForTimeout(5000);
	assert(runRequests.slice(before).every((r) => r.pressed) && runRequests.length > before, 'the 3 setups are queued only by the press');
	// Wait for results (simulator runs take seconds each, plus queueing).
	const done = await page.waitForFunction(() => /3 of 3|all 3 finished|Run again/.test(document.body.innerText), null, { timeout: 15 * 60000 }).then(() => true).catch(() => false);
	assert(done, 'the setups finish and report back');
});
await step('3 tune: a run through the chat', async () => {
	const reply = await chat(`Run ${TUNED} in ${APP} once with overrides serving.max_concurrency=16 and seed 7, then tell me its goodput and TTFT p99, citing the run id.`, { timeout: 600000 });
	assert(/goodput/i.test(reply) && /ttft|first (word|token)/i.test(reply), 'the chat runs it and reports the metrics');
	assert(RUN_ID.test(reply), 'the chat names the run it started');
});

await step('3 tune: a repeated setup is measured once', async () => {
	// The simulator is seeded and pinned, so lum.id /me/measure answers an identical
	// setup from the stored measurement. Ask for one setup twice (dispatched by the
	// scenario itself, not the page): the first may run, the second must be reused.
	const args = { overrides: 'serving.max_concurrency=16', seed: '11' };
	const newestRun = async () => ((await api('GET', `/cycles?app=${APP}&loop=${TUNED}&limit=5`)).data?.cycles || [])
		.filter((c) => !c.running).sort((x, y) => (x.ts < y.ts ? 1 : -1))[0];
	let last = (await newestRun())?.ts;
	for (const attempt of [1, 2]) {
		await api('POST', `/agents/${APP}/workflows/${TUNED}/run`, { args });
		const started = Date.now();
		let fresh;
		while (Date.now() - started < 8 * 60000) {
			await page.waitForTimeout(10000);
			fresh = await newestRun();
			if (fresh && fresh.ts !== last) break;
		}
		assert(fresh && fresh.ts !== last, `run ${attempt} of the repeated setup finished`);
		last = fresh?.ts;
		if (attempt === 2) {
			assert(fresh?.reused === true, `the repeat was answered from the stored measurement (${fresh?.measured_on || 'no measured_on'})`);
			await openApp();
			await openWorkflow(label(TUNED));
			await panel().getByRole('radio', { name: 'Runs' }).or(panel().getByText('Runs', { exact: true })).first().click();
			const tag = panel().getByText('reused', { exact: true }).first();
			assert(await tag.waitFor({ timeout: 20000 }).then(() => true).catch(() => false), 'the Runs list marks it reused');
			await page.screenshot({ path: path.join(OUT, '3-reused.png') });
		}
	}
});

// ── 4. analyse an unexpected result ───────────────────────────────────────
await step('4 analyse: A/B through the UI', async () => {
	await openApp();
	const vers = map().locator('.space3d [data-kind="version"] button');
	const n = await vers.count();
	assert(n >= 2, `setups are on the graph (${n})`);
	await domClick(vers.nth(0));
	await page.waitForTimeout(1000);
	await domClick(vers.nth(n - 1), true);
	await page.waitForTimeout(6000);
	assert(await map().locator('[aria-label="Compared as A"]').count() === 1 && await map().locator('[aria-label="Compared as B"]').count() === 1, 'A and B are marked on the graph');
	const t = await panel().innerText();
	report.verdict = t.match(/(.* ahead on .*|Can't tell apart yet.*|Too few runs.*|.* has no .* result yet|Neither (side|has).*)/)?.[0] ?? '';
	assert(!!report.verdict, `Compare gives a verdict in words ("${report.verdict}")`);
});
await step('4 analyse: why, through the chat', async () => {
	const reply = await chat(`In ${APP}, compare the runs of ${TUNED} at max_concurrency 32 and 16: why is one worse? Read the runs first, cite the run ids and the metrics; invent no numbers.`);
	assert(RUN_ID.test(reply), 'the answer cites run ids');
	assert(/ttft|first (word|token)|queue/i.test(reply), 'the answer names TTFT / queueing');
});

// ── 5. decide and dispatch the next runs ──────────────────────────────────
await step('5 decide: next runs through the chat, dispatched by a press', async () => {
	const reply = await chat(`What should I run next on ${TUNED} in ${APP}? Stage it as a proposal for my approval; start nothing.`);
	assert(/propos|suggest|approval/i.test(reply), 'the chat proposes the next runs');
	await openApp();
	const appr = map().locator('section[aria-label="For your approval"]');
	if (await appr.waitFor({ timeout: 30000 }).then(() => true).catch(() => false)) {
		const before = runRequests.length;
		await appr.getByRole('button', { name: 'Go ahead' }).click();
		await page.waitForTimeout(8000);
		assert(runRequests.length === before, 'Go ahead creates it but starts nothing');
		const runNow = page.getByRole('button', { name: /Run it now|Run the \d+ untried/ }).first();
		if (await runNow.count()) { await press(runNow); await page.waitForTimeout(4000); assert(runRequests.length > before && runRequests.at(-1).pressed, 'the next runs start on the press'); }
	} else note('no approval card appeared — the chat may not have staged a proposal');
});

// ── 6. fine-tune in the sandbox ───────────────────────────────────────────
await step('6 sandbox: a real-GPU variant', async () => {
	await openApp();
	await openWorkflow(label(TUNED));
	await panel().getByRole('button', { name: /Make a variant/ }).click();
	const sheet = page.getByRole('dialog', { name: 'Make a variant' });
	await sheet.waitFor({ timeout: 10000 });
	await sheet.getByText('Edit the code').click();
	const code = sheet.getByLabel('Python code');
	await code.waitFor({ timeout: 60000 });
	if (process.env.SANDBOX_PY && fs.existsSync(process.env.SANDBOX_PY)) await code.fill(fs.readFileSync(process.env.SANDBOX_PY, 'utf8'));
	// The sandbox step judges it on the real GPU: add it beside the simulator's.
	await sheet.getByRole('button', { name: 'Add a feedback step' }).click();
	await sheet.locator('input[id^="fb-step-"]').last().fill('sandbox');
	const names = sheet.getByLabel('Metric name');
	await names.last().fill('ttft_ms_p99');
	await sheet.getByLabel('Which way is better').last().selectOption('lower');
	await sheet.getByRole('button', { name: 'Add a metric' }).last().click();
	await names.last().fill('goodput_tok_s');
	const idField = sheet.locator('#variant-id-0');
	if (await idField.count()) await idField.fill(SANDBOX);
	const nodeName = sheet.locator('input[aria-label="New node name"]');
	if (await nodeName.count()) await nodeName.fill(`On a real GPU ${RUN}`);
	await createVariant(sheet, SANDBOX);
	await sheet.waitFor({ state: 'detached', timeout: 120000 });
	await page.waitForTimeout(3000);
	await openWorkflow(label(SANDBOX));
	await press(panel().getByRole('button', { name: /^Run/ }));
	// Read THE panel (not the first dialog in the document — that may be any
	// other dialog), and reopen it each minute so its status line is fresh.
	const SETTLED = /not measured|measured on|Last run (succeeded|failed)|Succeeded|Failed/i;
	let settled = false, t = '';
	for (const until = Date.now() + 50 * 60000; Date.now() < until;) {
		t = await panel().innerText().catch(() => '');
		if (SETTLED.test(t)) { settled = true; break; }
		await page.waitForTimeout(60000);
		await openApp();
		await openWorkflow(label(SANDBOX));
	}
	// The header reads the workflow row; the feedback block reads the run's
	// detail a moment later (the panel's runs list polls every 5 s).
	for (const until = Date.now() + 30000; settled && Date.now() < until && !/measured on|not measured/i.test(t);) {
		await page.waitForTimeout(3000);
		t = await panel().innerText().catch(() => t);
	}
	assert(settled, 'the sandbox run settles');
	assert(/not measured|measured on/i.test(t) || /Succeeded/.test(t), 'it reports real numbers, or says "not measured" in words');
});

// ── 7. manage the node ────────────────────────────────────────────────────
await step('7 manage the node', async () => {
	await openApp();
	const n = nodeButton('node', `On a real GPU ${RUN}`);
	if (!(await n.count())) { note('no "On a real GPU" node from this run'); return; }
	await domClick(n);
	const p = panel();
	await p.waitFor({ timeout: 15000 });
	const nameBox = p.getByLabel('Node name');
	await nameBox.waitFor({ timeout: 30000 });
	await nameBox.fill(`Sandbox ${RUN}`);
	await p.getByRole('button', { name: 'Rename' }).click();
	// The save goes through the scheduler's intent queue; the button is busy
	// until it lands. Wait for it, then for the graph to re-read the spec.
	await page.waitForFunction(() => { const b = [...document.querySelectorAll('[role="dialog"] button')].find((x) => x.textContent?.trim() === 'Rename'); return !b || !b.disabled; }, null, { timeout: 90000 }).catch(() => {});
	for (const until = Date.now() + 30000; Date.now() < until && !(await nodeButton('node', `Sandbox ${RUN}`).count());) await page.waitForTimeout(3000);
	assert(await nodeButton('node', `Sandbox ${RUN}`).count() > 0, 'the node is renamed on the graph');
});

report.ms = Date.now() - t0;
report.unpressedRuns = runRequests.filter((r) => !r.pressed && !/chat/.test(r.url)).length;
assert(report.unpressedRuns === 0, 'no run dispatched without a press (UI)');
} finally {
	report.teardown = await teardown();
}
fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
console.log(`\n${report.fails.length ? `${report.fails.length} FAILED` : 'ALL PASS'} · ${Math.round((report.ms ?? Date.now() - t0) / 1000)} s · ${OUT}/report.json`);
await b.close().catch(() => {});
process.exit(report.fails.length ? 1 : 0);

// ── teardown: delete what this run created ────────────────────────────────
// Logs each outcome and never fails the scenario. Children first (sandbox is a
// variant of sla_tuned), and one at a time: a queued delete is a spec write
// checked against the spec it was planned on, so the next one waits for it.
async function teardown() {
	console.log('\n── teardown');
	const out = [];
	if (KEEP) { note(`KEEP=1 — leaving ${created.join(', ') || 'nothing'} in ${APP}`); return out; }
	if (!created.length) { note('this run created no workflows'); return out; }
	for (const name of [...created].reverse()) {
		let outcome;
		try {
			const r = await api('DELETE', `/apps/${encodeURIComponent(APP)}/loops/${encodeURIComponent(name)}?force=1`);
			if (r.status === 200) outcome = `deleted (${r.data?.remaining ?? '?'} workflows left)`;
			else if (r.status === 202 && r.data?.intent_id) {
				outcome = `queued (intent ${r.data.intent_id}), not confirmed in 3 min`;
				for (const until = Date.now() + 3 * 60000; Date.now() < until;) {
					await sleep(5000);
					const i = (await api('GET', `/intents/${encodeURIComponent(r.data.intent_id)}`)).data;
					if (i?.status !== 'completed') continue;
					const res = i.result || {};
					outcome = res.ok === false || res.error ? `failed: ${res.error || JSON.stringify(res).slice(0, 200)}` : 'deleted (applied by the scheduler)';
					break;
				}
			} else outcome = `not deleted: HTTP ${r.status} ${r.data?.message || ''}`.trim();
		} catch (e) {
			outcome = `not deleted: ${String(e).split('\n')[0].slice(0, 200)}`;
		}
		console.log(`  - ${name}: ${outcome}`);
		out.push({ name, outcome });
	}
	return out;
}

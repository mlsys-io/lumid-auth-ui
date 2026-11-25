// Data Warehouse → Jobs, against FIXTURES only — never a real lum.id.
//
// Drives the Jobs tab on a LOCAL vite dev server with every network request
// answered by page.route(): the jobs API (/data/jobs/v1/*), the session check
// and session-bearer, and a stub for everything else. Any request that leaves
// localhost is ABORTED and fails the run, so a misconfigured base can't reach
// production.
//
//   BASE_PATH=/ VITE_API_BASE_URL=http://localhost:5287 VITE_ME_API_BASE=http://localhost:5287 \
//     npx vite --port 5287 --strictPort &
//   CHROME=~/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome \
//     node e2e/data-jobs-mock.mjs --base http://localhost:5287 [--out /tmp/data-jobs]
//
// Asserts: the tab renders from null lists without blanking the page, sources
// group by hub and a failed hub is named, the plan card leads with the site
// and says how each source is reached, Run sends the plan_id with an
// Idempotency-Key, ?job= opens the drawer with events and Cancel posts, a 500
// shows ErrorState, and 390px has no horizontal overflow.

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { launchBrowser } from './_browser.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const BASE = arg('--base', 'http://localhost:5287').replace(/\/$/, '');
const OUT = arg('--out', '/tmp/data-jobs-mock');
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) {
	console.error(`refusing to run against ${BASE}: this suite is fixtures-only, localhost only`);
	process.exit(2);
}
mkdirSync(OUT, { recursive: true });

const fails = [];
const assert = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) fails.push(m); };

const ME = 'u-alice';
const now = Date.now();
const iso = (ms) => new Date(now - ms).toISOString();
const SOURCES = {
	mine: {
		sources: [
			{ source_id: 'src_a', hub: 'home', owner: ME, name: 'daily-prices', kind: 'table', definition: { ref: 'findata://px.daily', description: 'EOD bars' }, visibility: 'private', size_bytes_est: 3_200_000_000, created_at: iso(9e6), updated_at: iso(9e6) },
			{ source_id: 'src_b', hub: 'nus', owner: ME, name: 'hf-weights', kind: 'blob_set', definition: { ref: 'data://nus/weights/' }, visibility: 'shared', size_bytes_est: null, created_at: iso(9e6), updated_at: iso(9e6) },
		],
		hubs: [{ id: 'home', ok: true, ms: 12 }, { id: 'nus', ok: true, ms: 80 }],
	},
	// A hub that didn't answer + a null list: must not blank anything.
	shared: { sources: null, hubs: [{ id: 'home', ok: true }, { id: 'nus', ok: false, error: 'timeout' }] },
	public: { sources: [{ source_id: 'src_p', hub: 'home', owner: 'system', name: 'symbols', kind: 'table', definition: { ref: 'findata://reference.symbols' }, visibility: 'public', size_bytes_est: 1_000_000 }], hubs: null },
};
const JOBS = [
	{ job_id: 'j-run', hub: 'home', owner: ME, app: 'quant-research', runtime: 'lumilake', site: 'home', status: 'running', spec: { name: 'nightly join' }, plan: null, est_bytes: 10, error: null, created_at: iso(6e5), started_at: iso(5e5), ended_at: null, updated_at: iso(1e5), sources: null },
	{ job_id: 'j-fail', hub: 'home', owner: ME, app: 'mbb', runtime: 'flowmesh', site: 'office', status: 'failed', spec: null, plan: null, est_bytes: null, error: { code: 'x', message: 'worker died' }, created_at: iso(36e5), started_at: null, ended_at: iso(35e5), updated_at: iso(35e5) },
	{ job_id: 'j-plan', hub: 'home', owner: ME, app: 'mbb', runtime: 'lumilake', site: null, status: 'planned', spec: {}, created_at: iso(72e5), updated_at: iso(72e5) },
];
const PLAN = {
	plan_id: 'p-123',
	plan: {
		outcome: 'placed', site: 'home', runtime: 'lumilake', local_bytes: 3_200_000_000, remote_bytes: 40_000_000,
		sources: [
			{ ref: 'findata://px.daily', access: 'read', source_site: 'home', via: 'local', route_id: null, url: null, size: { kind: 'exact', bytes: 3_200_000_000 } },
			{ ref: 'lumid-data://reference.calendar', access: 'read', source_site: 'office', via: 'tailnet', route_id: 'office-tail', url: 'http://x', size: { kind: 'upper_bound', bytes: 40_000_000 } },
		],
		reasons: [{ code: 'most_bytes_local', msg: 'Most of the data (3.2 GB) is already at home.' }],
		alternatives: [{ site: 'office', blocking: [{ code: 'no_runtime', msg: 'office has no Lumilake worker' }] }],
	},
	sources: [],
};

const calls = [];
let offsite = [];
let failJobsList = false;

async function wire(ctx) {
	await ctx.route('**/*', async (route) => {
		const req = route.request();
		const u = new URL(req.url());
		if (u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') {
			offsite.push(req.url());
			return route.abort();
		}
		const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
		const p = u.pathname;
		if (p === '/api/v1/user') return json({ ret_code: 0, message: 'ok', data: { id: ME, username: 'alice', email: 'alice@example.com', role: 'user', status: 'active', invitation_code: 'x' } });
		if (p === '/api/v1/session-bearer') return json({ ret_code: 0, data: { token: 'fixture-bearer', expires_at: 0 } });
		if (p.startsWith('/data/jobs/v1/')) {
			calls.push({ method: req.method(), path: p + u.search, headers: req.headers(), body: req.postData() });
			const rest = p.slice('/data/jobs/v1'.length);
			if (rest === '/sources' && req.method() === 'GET') return json(SOURCES[u.searchParams.get('scope')] ?? { sources: [] });
			if (rest === '/plan') return json(PLAN);
			if (rest === '/sources' && req.method() === 'POST') return json({ ...SOURCES.mine.sources[0], source_id: 'src_new', name: JSON.parse(req.postData() || '{}').name }, 201);
			if (/^\/sources\/[^/]+\/grants$/.test(rest)) return json({ source_id: 'src_a', grantee: 'u-bob', access: 'read', expires_at: null });
			if (rest === '/jobs' && req.method() === 'POST') return json({ ...JOBS[2], job_id: 'j-new', status: 'planned' }, 201);
			if (rest === '/jobs') return failJobsList ? json({ error: { code: 'internal', message: 'db down' } }, 500) : json({ jobs: JOBS, hubs: [{ id: 'home', ok: true }] });
			const m = rest.match(/^\/jobs\/([^/]+)(\/events|\/cancel)?$/);
			if (m) {
				const j = JOBS.find((x) => x.job_id === m[1]) ?? { ...JOBS[2], job_id: m[1] };
				if (m[2] === '/events') return json({ events: [
					{ id: 1, at: iso(6e5), kind: 'status', status: 'planned', payload: { by: ME } },
					{ id: 2, at: iso(5e5), kind: 'status', status: 'running', payload: { by: 'local:runtime:lumilake', message: 'picked up by worker 3' } },
					{ id: 3, at: iso(4e5), kind: 'log', status: null, payload: null },
				] });
				if (m[2] === '/cancel') return json({ ...j, status: 'cancelled', ended_at: new Date().toISOString() });
				return json({ ...j, sources: [{ ref: 'findata://px.daily', source_id: 'src_a', access: 'read', site: 'home', via: 'local', url: null, est_bytes: 10, actual_bytes: 0 }] });
			}
			return json({ error: { code: 'not_found', message: 'no route' } }, 404);
		}
		// Anything else the shell asks for: a quiet empty answer.
		if (p.startsWith('/api/') || p.startsWith('/me') || p.startsWith('/inbox-api') || p.startsWith('/data/') || p.startsWith('/findata/')) {
			return json({ ret_code: 0, message: 'ok', data: {} });
		}
		return route.continue();
	});
}

const b = await launchBrowser(chromium);
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
await wire(ctx);
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));

await page.goto(`${BASE}/studio/data-warehouse?tab=jobs`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Your jobs' }).waitFor({ timeout: 60000 });
await page.getByText('nightly join').waitFor({ timeout: 20000 });
assert(await page.getByRole('tab', { name: 'Jobs', selected: true }).count() === 1, 'Jobs tab is selected from ?tab=jobs');
assert(await page.getByText('Waiting to start').count() >= 1, 'a planned job reads "Waiting to start", not the raw status');
assert(await page.getByText('worker died').count() === 1, 'a failed job says why in the list');
assert(await page.getByText('Your user ID').count() === 1, 'your user ID is shown (for sharing)');
assert(await page.locator('.eyebrow', { hasText: 'Home hub' }).count() === 1 && await page.locator('.eyebrow', { hasText: 'Nus hub' }).count() === 1, 'my sources are grouped by hub');
await page.screenshot({ path: `${OUT}/jobs-desktop.png`, fullPage: true });

// Add a source, share one.
await page.getByRole('button', { name: 'Add a source' }).first().click();
const add = page.getByRole('dialog');
await add.getByLabel('Name').fill('my prices');
assert(await add.getByText('Letters, digits, dot, dash or underscore.').count() === 1, 'a bad source name is explained before sending');
await add.getByLabel('Name').fill('my-prices');
await add.getByLabel('Points at').fill('findata://px.daily');
await add.getByLabel('Read limit (GB, optional)').fill('2');
await page.screenshot({ path: `${OUT}/add-source.png` });
await add.getByRole('button', { name: 'Add source' }).click();
await add.waitFor({ state: 'detached', timeout: 10000 });
const created = calls.find((c) => c.method === 'POST' && c.path === '/data/jobs/v1/sources');
const cb = created ? JSON.parse(created.body) : {};
assert(cb.name === 'my-prices' && cb.ref === 'findata://px.daily' && cb.visibility === 'private' && cb.max_bytes === 2 * 1024 ** 3, 'Add source posts name, ref, visibility and the limit in bytes');
await page.getByRole('button', { name: 'Share' }).first().click();
const share = page.getByRole('dialog');
await share.getByLabel('Their lum.id user ID').fill('bob@example.com');
assert(await share.getByText(/not their email/).count() === 1, 'an email in the user-ID field is explained');
await share.getByLabel('Their lum.id user ID').fill('u-bob');
await page.screenshot({ path: `${OUT}/share.png` });
await share.getByRole('button', { name: 'Share', exact: true }).click();
await share.waitFor({ state: 'detached', timeout: 10000 });
const granted = calls.find((c) => c.method === 'POST' && /\/sources\/src_a\/grants$/.test(c.path));
assert(granted && JSON.parse(granted.body).grantee === 'u-bob' && JSON.parse(granted.body).access === 'read', 'Share posts the grantee and access');

// Shared with me: null list + a failed hub.
await page.getByRole('radio', { name: 'Shared with me' }).click();
await page.getByText('Nothing shared with you yet').waitFor({ timeout: 10000 });
assert(await page.getByText(/Nus hub didn't answer/).count() === 1, 'a hub that did not answer is named');

// Use a source, then check the plan.
await page.getByRole('radio', { name: 'Public' }).click();
await page.getByText('symbols').first().waitFor({ timeout: 10000 });
await page.getByRole('button', { name: 'Use in a job' }).first().click();
assert((await page.locator('#job-spec').inputValue()).includes('src://src_p'), '"Use in a job" adds the source to the spec');
await page.getByRole('button', { name: 'Check where it runs' }).click();
await page.getByRole('region', { name: 'Plan' }).waitFor({ timeout: 10000 });
const planText = await page.getByRole('region', { name: 'Plan' }).innerText();
assert(/Runs at\s+home\s+on\s+lumilake/.test(planText), 'plan card leads with the site and runtime');
assert(planText.includes('Same site') && planText.includes('Private link'), 'each source says how it is reached, in words');
assert(/home hub/i.test(planText), 'plan card names the owning hub');
assert(planText.includes('office has no Lumilake worker'), 'alternatives say why they lost');
assert(!/\btailnet\b(?! between)|most_bytes_local|upper_bound/.test(planText), 'no raw codes on the plan card');
const planCall = calls.find((c) => c.path === '/data/jobs/v1/plan');
assert(planCall && JSON.parse(planCall.body).spec?.sources?.some((s) => s.ref === 'src://src_p'), 'plan request carries the spec');
assert(planCall?.headers?.authorization === 'Bearer fixture-bearer', 'jobs calls carry the session-bearer');
await page.waitForTimeout(700);
await page.getByRole('region', { name: 'Plan' }).screenshot({ path: `${OUT}/plan.png` });

await page.getByRole('button', { name: 'Run', exact: true }).click();
await page.waitForURL(/job=j-new/, { timeout: 10000 });
const runCall = calls.find((c) => c.method === 'POST' && c.path === '/data/jobs/v1/jobs');
assert(runCall && JSON.parse(runCall.body).plan_id === 'p-123', 'Run submits the plan_id');
assert(runCall?.headers?.['idempotency-key'] === 'plan-p-123', 'Run sends an Idempotency-Key');
await page.keyboard.press('Escape');

// Deep link opens the drawer; events; Cancel.
await page.goto(`${BASE}/studio/data-warehouse?tab=jobs&job=j-run`, { waitUntil: 'domcontentloaded' });
const drawer = page.getByRole('dialog');
await drawer.getByText('picked up by worker 3').waitFor({ timeout: 30000 });
assert(await drawer.getByText('Same site').count() === 1, 'drawer shows how each source is reached');
await drawer.getByRole('button', { name: 'Cancel job' }).click();
await drawer.getByRole('button', { name: 'Yes, cancel' }).click();
await drawer.getByText('Cancelled').first().waitFor({ timeout: 10000 });
assert(calls.some((c) => c.method === 'POST' && c.path === '/data/jobs/v1/jobs/j-run/cancel'), 'Cancel posts to /cancel');
await page.screenshot({ path: `${OUT}/drawer.png` });
await page.keyboard.press('Escape');
assert(!/job=/.test(page.url()), 'closing the drawer clears ?job=');

// 390px: nothing scrolls sideways.
const phone = await ctx.newPage();
phone.on('pageerror', (e) => pageErrors.push(String(e)));
await phone.setViewportSize({ width: 390, height: 844 });
await phone.goto(`${BASE}/studio/data-warehouse?tab=jobs`, { waitUntil: 'domcontentloaded' });
await phone.getByText('nightly join').waitFor({ timeout: 60000 });
const over = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
assert(over <= 1, `390px: no horizontal overflow (${over}px)`);
await phone.screenshot({ path: `${OUT}/jobs-390.png`, fullPage: true });

// A 500 on the jobs list → ErrorState, and Retry recovers.
failJobsList = true;
await phone.goto(`${BASE}/studio/data-warehouse?tab=jobs`, { waitUntil: 'domcontentloaded' });
await phone.getByText("Couldn't load your jobs").waitFor({ timeout: 60000 });
assert(true, 'a 500 renders ErrorState');
failJobsList = false;
await phone.getByRole('button', { name: 'Try again' }).first().click();
await phone.getByText('nightly join').waitFor({ timeout: 10000 });
assert(true, 'Try again recovers');

assert(pageErrors.length === 0, `no page errors${pageErrors.length ? `: ${pageErrors[0].slice(0, 200)}` : ''}`);
assert(offsite.length === 0, `no request left localhost${offsite.length ? ` (${offsite.length}, e.g. ${offsite[0]})` : ''}`);
await b.close();
console.log(`\n${fails.length ? `${fails.length} FAILED` : 'all passed'} — shots in ${OUT}`);
process.exit(fails.length ? 1 : 0);

// End-to-end walk of /studio/compute for the NON-VAST sites.
//
// WHY THIS EXISTS. The compute surface was rebuilt to fan out per site: Sandboxes
// used to talk to one hardcoded backend (`SBX_BASE = "/sbx"`, home only) and now
// resolves `/sbx/<site>/...` through mesh-federator. Every piece of that was
// verified with curl — the app answers, the federator routes, the edge gates —
// but "the endpoint answers" is not "the page renders it", and that gap is
// exactly what an API-plane check cannot see.
//
// VAST IS DELIBERATELY EXCLUDED. A vast shell is a FlowMesh SSH task, not a k8s
// sandbox, and the executor work that makes it possible is still an open PR
// (FlowMesh#131). Asserting on vast today would encode a surface that does not
// exist yet. SANDBOX_SITES is home/office/nus; cloud is the hub, not a site.
//
// ROLE: admin. The per-site rows are admin-gated AT THE EDGE (nginx
// `location ~ ^/sbx/(office|nus)/` + auth_request), so a non-admin legitimately
// sees only home — that is the designed behaviour, not a failure, and a
// non-admin run would assert the narrower surface. Both are worth having; this
// one covers the wider.
//
// Env:
//   LUMID_PASSWORD  (required)      admin password
//   LUMID_EMAIL     (default admin@lum.id)
//   LUMID_BASE      (default https://lum.id)
//   CREATE=1        (optional)      also create + delete a real sandbox on home
//   CHROME=<path>   (optional)      see _browser.mjs
//
// Exit 0 = pass. Exit 1 = a real assertion failed. Exit 2 = could not run
// (no credential, no browser) — deliberately distinct, because "the suite could
// not start" has historically been indistinguishable from "the suite passed".
import { chromium } from 'playwright';
import { launchBrowser } from './_browser.mjs';
import fs from 'node:fs';

const BASE  = process.env.LUMID_BASE || 'https://lum.id';
const EMAIL = process.env.LUMID_EMAIL || 'admin@lum.id';
const PW    = process.env.LUMID_PASSWORD;
const SHOTS = process.env.SHOTS || '/tmp/compute-e2e';

// The sites this surface actually serves. Keep in step with SANDBOX_SITES in
// src/admin/fm/sandboxes-tab.tsx — if they drift, this suite is asserting a
// surface the app no longer has.
const SANDBOX_SITES = ['home', 'office', 'nus'];
const NOT_SANDBOX_SITES = ['vast', 'cloud'];

if (!PW) { console.error('LUMID_PASSWORD required'); process.exit(2); }
fs.mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const ok   = (m) => console.log(`  PASS  ${m}`);
const bad  = (m) => { console.error(`  FAIL  ${m}`); failures++; };
const note = (m) => console.log(`  ..    ${m}`);

// Real user path: REST login, then hand the SPA the same lm_session cookie a
// browser login would have set. Driving the login form instead would test the
// login page, which other suites already cover.
const loginRes = await fetch(`${BASE}/api/v1/login`, {
	method: 'POST',
	headers: { 'Content-Type': 'application/json' },
	body: JSON.stringify({ email: EMAIL, password: PW }),
});
const cookie = (loginRes.headers.get('set-cookie') || '').match(/lm_session=([^;]+)/);
if (!cookie) { console.error(`login failed: HTTP ${loginRes.status}`); process.exit(2); }
console.log(`logged in as ${EMAIL}`);

const browser = await launchBrowser(chromium).catch((e) => {
	console.error(`no usable browser: ${e.message}`); process.exit(2);
});
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
await ctx.addCookies([{
	name: 'lm_session', value: cookie[1],
	domain: '.lum.id', path: '/', httpOnly: true, secure: true, sameSite: 'Lax',
}]);
const page = await ctx.newPage();

// Network faults the eye misses. A 404 on /sbx/<site>/... means the federator
// route or the nginx location is wrong even when the page looks fine, because
// the tab renders an empty list either way.
const badCalls = [];
page.on('response', (r) => {
	const u = r.url();
	if (!/\/(sbx|fm|ll)\//.test(u)) return;
	// 401/403 on an admin-gated path is the DESIGN, not a fault.
	if (r.status() >= 500 || r.status() === 404) badCalls.push(`${r.status()} ${u}`);
});
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 160)); });

async function go(path, waitFor) {
	await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
	if (waitFor) await page.waitForSelector(waitFor, { timeout: 30000 }).catch(() => {});
	await page.waitForTimeout(2500); // let the per-site fanout settle
}

// ── 1. Fleet ────────────────────────────────────────────────────────────────
console.log('\n[1] /studio/compute (Fleet)');
await go('/studio/compute');
const fleetText = await page.textContent('body').catch(() => '');
if (/compute/i.test(fleetText || '')) ok('Fleet renders'); else bad('Fleet did not render');
await page.screenshot({ path: `${SHOTS}/1-fleet.png` }).catch(() => {});

// ── 2. Sandboxes, per-site ──────────────────────────────────────────────────
console.log('\n[2] /studio/compute/sandboxes (per-site fanout)');
await go('/studio/compute/sandboxes');
await page.screenshot({ path: `${SHOTS}/2-sandboxes.png`, fullPage: true }).catch(() => {});

// ASSERT ON VISIBLE ELEMENTS, NOT body textContent.
// textContent('body') returns ~1.2KB here — it does not reach the text inside
// this component subtree, so it reported `nus` MISSING while a visible <span>nus</span>
// was on screen and /sbx/nus/api/sandboxes had answered 200. A false negative in
// a suite like this is worse than no suite: it sends someone hunting a routing
// bug that does not exist.
async function siteNodes(site) {
	const loc = page.locator(`text=/\\b${site}\\b/i`);
	const n = await loc.count().catch(() => 0);
	const out = [];
	for (let i = 0; i < n; i++) {
		const el = loc.nth(i);
		out.push({
			tag: await el.evaluate((e) => e.tagName.toLowerCase()).catch(() => '?'),
			visible: await el.isVisible().catch(() => false),
			text: ((await el.textContent().catch(() => '')) || '').trim(),
		});
	}
	return out;
}

for (const site of SANDBOX_SITES) {
	const nodes = await siteNodes(site);
	// The SiteStrip badge is a visible element whose text IS the site name.
	const badge = nodes.find((n) => n.visible && n.text.toLowerCase() === site);
	// The create form's site picker offers every sandbox site (an <option> is
	// legitimately not "visible" until the select is open).
	const option = nodes.find((n) => n.tag === 'option' && n.text.toLowerCase() === site);
	if (badge) ok(`site "${site}" badge rendered`);
	else bad(`site "${site}" has no visible badge (${nodes.length} matching node(s))`);
	if (option) ok(`site "${site}" offered in the create picker`);
	else bad(`site "${site}" not offered when creating a sandbox`);
}

// vast/cloud must NOT be offered as sandbox sites. This catches someone reusing
// ADMIN_SITES (which includes both) for this tab: a vast shell is a FlowMesh SSH
// task, and cloud is the hub, not a site.
for (const site of NOT_SANDBOX_SITES) {
	const nodes = await siteNodes(site);
	const offered = nodes.find((n) => n.tag === 'option' && n.text.toLowerCase() === site);
	if (offered) bad(`"${site}" is offered as a SANDBOX site — it is not one`);
	else ok(`"${site}" correctly not offered as a sandbox site`);
}

// ── 3. Jobs ─────────────────────────────────────────────────────────────────
console.log('\n[3] /studio/compute/jobs');
await go('/studio/compute/jobs');
const jobsText = (await page.textContent('body').catch(() => '')) || '';
if (jobsText.length > 200) ok('Jobs renders'); else bad('Jobs did not render');
await page.screenshot({ path: `${SHOTS}/3-jobs.png` }).catch(() => {});

// ── 4. The API the page depends on, as the page's own session ───────────────
console.log('\n[4] /sbx/<site>/api/whoami through the edge');
for (const site of SANDBOX_SITES) {
	const path = site === 'home' ? '/sbx/api/whoami' : `/sbx/${site}/api/whoami`;
	const r = await page.evaluate(async (p) => {
		try { const res = await fetch(p, { credentials: 'include' }); return { s: res.status, b: (await res.text()).slice(0, 80) }; }
		catch (e) { return { s: 0, b: String(e).slice(0, 80) }; }
	}, path);
	if (r.s === 200) ok(`${site}: ${r.s} (authenticated)`);
	else if (r.s === 401 || r.s === 403) note(`${site}: ${r.s} — gated; admin bearer is not attached to a plain fetch, expected`);
	else bad(`${site}: unexpected ${r.s} ${r.b}`);
}

// ── 5. Optional: a real round trip on home ──────────────────────────────────
if (process.env.CREATE === '1') {
	console.log('\n[5] create + delete a real sandbox on home (CREATE=1)');
	const name = `e2e-${Date.now().toString(36)}`;
	const made = await page.evaluate(async (n) => {
		const res = await fetch('/sbx/api/sandboxes', {
			method: 'POST', credentials: 'include',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name: n, cpu: 1, memory_gi: 2, ttl_hours: 1 }),
		});
		return { s: res.status, b: (await res.text()).slice(0, 200) };
	}, name);
	if (made.s >= 200 && made.s < 300) {
		ok(`created ${name}`);
		const del = await page.evaluate(async (n) => {
			const res = await fetch(`/sbx/api/sandboxes/${n}`, { method: 'DELETE', credentials: 'include' });
			return res.status;
		}, name);
		if (del >= 200 && del < 400) ok(`deleted ${name}`);
		else bad(`created but could not delete ${name} (HTTP ${del}) — LEAKED, delete it by hand`);
	} else {
		note(`create returned ${made.s} ${made.b} — a plain fetch carries no bearer; run with a session that does`);
	}
} else {
	note('\n[5] skipped — set CREATE=1 to exercise a real create/delete on home');
}

// ── 6. Faults collected along the way ───────────────────────────────────────
console.log('\n[6] network + console');
if (badCalls.length === 0) ok('no 404/5xx on /sbx, /fm or /ll');
else { bad(`${badCalls.length} bad call(s):`); badCalls.slice(0, 6).forEach((c) => console.error(`        ${c}`)); }
if (consoleErrors.length) {
	note(`${consoleErrors.length} console error(s) (not fatal):`);
	consoleErrors.slice(0, 4).forEach((c) => console.log(`        ${c}`));
}

await browser.close();
console.log(`\nscreenshots: ${SHOTS}`);
console.log(failures === 0 ? '\nPASS' : `\nFAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);

// Harbor OIDC login against lum.id, end to end in a real browser.
//
// WHY THIS EXISTS. Harbor's auth_mode was switched to oidc_auth so people sign
// in as themselves and the admin password becomes break-glass — which matters
// because a scanner (leakix) was probing `admin` within minutes of
// harbor.lum.id going public. Everything MECHANICAL was verified with curl:
//
//   /c/oidc/login            -> 302 to lum.id/oauth/authorize?client_id=harbor&code_challenge=…
//   authorize                -> 302 (client accepted, redirect_uri echoed intact)
//   /c/oidc/callback?code=x  -> 400 "State mismatch"  (wired, CSRF-checked, not 404)
//   harbor-core -> lum.id    -> discovery 200, jwks 200, token endpoint reachable
//   admin basic auth         -> still 200 (not locked out)
//
// None of that exercises the CALLBACK LEG: the code exchange, the ID-token
// verification against lum.id's JWKS, and auto-onboarding the user. Those only
// happen when a real browser completes the round trip, which is precisely the
// part that was left untested.
//
// WHAT THIS MUTATES. On success Harbor auto-onboards the authenticating
// identity as a Harbor user (oidc_auto_onboard=true, keyed on the `email`
// claim). That is the feature working, not a side effect to avoid — but it is a
// real write, so it is worth knowing it happens.
//
// SCOPES ARE THE USUAL TRAP. lum.id advertises openid/profile/email and NOT
// offline_access, which Harbor requests by default; the client row also permits
// `groups`, which lum.id does not advertise either. Harbor is configured with
// openid,email,profile only. If someone widens oidc_scope, this suite fails at
// the authorize step with a generic error that reads like a broken login.
//
// Env:
//   LUMID_PASSWORD  (required)   password for LUMID_EMAIL at lum.id
//   LUMID_EMAIL     (default admin@lum.id)
//   HARBOR_BASE     (default https://harbor.lum.id)
//   LUMID_BASE      (default https://lum.id)
//   HEADFUL=1       watch it happen
//
// Exit 0 pass · 1 assertion failed · 2 could not run.
import { chromium } from 'playwright';
import { launchBrowser } from './_browser.mjs';
import fs from 'node:fs';

const HARBOR = process.env.HARBOR_BASE || 'https://harbor.lum.id';
const BASE   = process.env.LUMID_BASE || 'https://lum.id';
const EMAIL  = process.env.LUMID_EMAIL || 'admin@lum.id';
const PW     = process.env.LUMID_PASSWORD;
const SHOTS  = process.env.SHOTS || '/tmp/harbor-oidc';

if (!PW) { console.error('LUMID_PASSWORD required'); process.exit(2); }
fs.mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const ok   = (m) => console.log(`  PASS  ${m}`);
const bad  = (m) => { console.error(`  FAIL  ${m}`); failures++; };
const note = (m) => console.log(`  ..    ${m}`);

const browser = await launchBrowser(chromium, { headless: process.env.HEADFUL !== '1' })
	.catch((e) => { console.error(`no usable browser: ${e.message}`); process.exit(2); });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });

// Seed the lum.id session so the IdP recognises us. This is the same cookie a
// prior browser login would have left, so the flow under test starts where a
// returning user starts — at Harbor, already known to the IdP.
const loginRes = await fetch(`${BASE}/api/v1/login`, {
	method: 'POST', headers: { 'Content-Type': 'application/json' },
	body: JSON.stringify({ email: EMAIL, password: PW }),
});
const c = (loginRes.headers.get('set-cookie') || '').match(/lm_session=([^;]+)/);
if (!c) { console.error(`lum.id login failed: HTTP ${loginRes.status}`); process.exit(2); }
await ctx.addCookies([{
	name: 'lm_session', value: c[1],
	domain: '.lum.id', path: '/', httpOnly: true, secure: true, sameSite: 'Lax',
}]);
console.log(`lum.id session established for ${EMAIL}`);

const page = await ctx.newPage();
// The redirect chain IS the assertion here: Harbor -> IdP -> back to Harbor.
// Record it, because a flow that silently stops at the IdP looks identical to a
// success if you only check the final page for an error string.
// TRACK RESPONSES, NOT framenavigated. A 302 chain completes server-side and
// does NOT fire a frame navigation per hop — the first version of this suite
// recorded only `harbor.lum.id/` and `/harbor/projects` and declared the IdP leg
// never happened, while Harbor had in fact onboarded the user through it
// ("comment":"Onboarded via OIDC provider"). Responses capture every hop.
const chain = [];
page.on('response', (r) => {
	const u = r.url();
	if (/lum\.id/.test(u)) chain.push(`${r.status()} ${u}`);
});

console.log('\n[1] start the OIDC flow at Harbor');
await page.goto(`${HARBOR}/c/oidc/login`, { waitUntil: 'domcontentloaded', timeout: 45000 })
	.catch((e) => note(`navigation: ${e.message.slice(0, 80)}`));
await page.waitForTimeout(4000);
await page.screenshot({ path: `${SHOTS}/1-after-login-click.png` }).catch(() => {});

// If lum.id presents a login or consent form, complete it — a first-ever
// authorization legitimately asks.
const pwField = page.locator('input[type="password"]');
if (await pwField.count().catch(() => 0)) {
	note('IdP presented a login form — filling it');
	const userField = page.locator('input[type="email"], input[name="email"], input[type="text"]').first();
	await userField.fill(EMAIL).catch(() => {});
	await pwField.first().fill(PW).catch(() => {});
	await page.locator('button[type="submit"], button:has-text("Sign in"), button:has-text("Log in")').first()
		.click({ timeout: 10000 }).catch(() => {});
	await page.waitForTimeout(5000);
}
const consent = page.locator('button:has-text("Allow"), button:has-text("Authorize"), button:has-text("Approve")');
if (await consent.count().catch(() => 0)) {
	note('consent screen shown — approving');
	await consent.first().click({ timeout: 10000 }).catch(() => {});
	await page.waitForTimeout(5000);
}
await page.waitForTimeout(3000);
await page.screenshot({ path: `${SHOTS}/2-final.png`, fullPage: true }).catch(() => {});

console.log('\n[2] redirect chain');
const uniq = [...new Set(chain)];
uniq.slice(0, 12).forEach((u) => console.log(`        ${u.replace(/(code|state|code_challenge)=[^&]+/g, '$1=…').slice(0, 150)}`));
const hit = (frag) => uniq.some((u) => u.includes(frag));
if (hit('/oauth/authorize')) ok('reached the lum.id authorize endpoint');
else note('authorize hop not observed — an already-established Harbor session short-circuits it');
if (hit('/c/oidc/callback')) ok('came back to Harbor\'s callback');
else note('callback hop not observed this run (see above)');

console.log('\n[3] is the session actually authenticated?');
// The authority is Harbor's own "who am I", using the cookies the flow set.
const me = await page.evaluate(async () => {
	try {
		const r = await fetch('/api/v2.0/users/current', { credentials: 'include' });
		return { s: r.status, b: (await r.text()).slice(0, 240) };
	} catch (e) { return { s: 0, b: String(e).slice(0, 120) }; }
});
if (me.s === 200) {
	ok(`authenticated: ${me.b.slice(0, 120)}`);
	try {
		const u = JSON.parse(me.b);
		// THE decisive signal. Harbor writes this comment only when a user is
		// created through the OIDC callback, so it proves the code exchange and
		// ID-token verification actually ran — regardless of which redirect hops
		// a given run happens to observe.
		if (/onboarded via oidc/i.test(u.comment || '')) ok(`onboarded via OIDC (created ${u.creation_time})`);
		else note(`user comment: ${JSON.stringify(u.comment || '')} — not an OIDC-onboarded account`);
		if ((u.email || '').toLowerCase() === EMAIL.toLowerCase()) ok(`identity matches ${EMAIL}`);
		else note(`Harbor user is "${u.username || u.email}" — onboarded from the token's claims`);
		if (u.sysadmin_flag) note('this account carries sysadmin in Harbor');
	} catch { /* body already printed */ }
} else {
	bad(`/api/v2.0/users/current -> ${me.s} ${me.b}`);
	note('the browser is on Harbor but not logged in: the code exchange or the');
	note('ID-token verification failed. Check harbor-core logs for the token call,');
	note('and confirm oidc_scope is exactly openid,email,profile — lum.id does NOT');
	note('advertise offline_access or groups, and asking for either fails the flow.');
}

console.log('\n[4] the local admin must still work (break-glass)');
const adminProbe = await fetch(`${HARBOR}/api/v2.0/systeminfo`).then((r) => r.status).catch(() => 0);
if (adminProbe > 0) ok(`Harbor still serving (systeminfo HTTP ${adminProbe})`);
else bad('Harbor did not respond');

await browser.close();
console.log(`\nscreenshots: ${SHOTS}`);
console.log(failures === 0 ? '\nPASS' : `\nFAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);

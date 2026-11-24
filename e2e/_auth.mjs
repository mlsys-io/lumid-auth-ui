// Authenticated browser context for the Studio suites.
//
// LUMID_PASSWORD (+LUMID_EMAIL) -> a real lm_session cookie (the same path a
// user takes). Otherwise LUMID_PAT -> an Authorization header on every request,
// which the Studio pages and their APIs honour (studio-visual has rendered the
// whole Studio this way since 2026-11). Suites used to exit(2) without a
// password, so on a box with only a PAT they were never run at all.

export async function authContext(browser, base, ctxOpts = {}) {
	const email = process.env.LUMID_EMAIL || 'admin@lum.id';
	const pw = process.env.LUMID_PASSWORD;
	const pat = process.env.LUMID_PAT;
	if (pw) {
		const res = await fetch(`${base}/api/v1/login`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ email, password: pw }),
		});
		const m = (res.headers.get('set-cookie') || '').match(/lm_session=([^;]+)/);
		if (res.status !== 200 || !m) throw new Error(`login ${email} -> ${res.status}, cookie=${!!m}`);
		const ctx = await browser.newContext(ctxOpts);
		const host = new URL(base).hostname.replace(/^nightly\./, '');
		await ctx.addCookies([{ name: 'lm_session', value: m[1], domain: `.${host}`, path: '/', httpOnly: true, secure: true, sameSite: 'Lax' }]);
		return { ctx, mode: 'cookie', who: email };
	}
	if (pat) {
		const ctx = await browser.newContext({ ...ctxOpts, extraHTTPHeaders: { ...(ctxOpts.extraHTTPHeaders || {}), Authorization: `Bearer ${pat}` } });
		return { ctx, mode: 'pat', who: 'PAT holder' };
	}
	console.error('set LUMID_PASSWORD (preferred) or LUMID_PAT');
	process.exit(2);
}

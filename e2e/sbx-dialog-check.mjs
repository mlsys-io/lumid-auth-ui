// Does the Sandboxes tab actually look right with the create form in a dialog?
//
// Structure compiles; layout does not. tsc and vite both pass on a modal that
// renders off-screen, scrolls the page behind it, or clips its own buttons at
// phone width -- so this drives the real page and asserts on geometry.
//
// Checks, in the order they would bite a user:
//   1. the toolbar is there and the form is NOT (the whole point of the change)
//   2. SSH keys + Datasets are reachable WITHOUT opening the dialog
//   3. the dialog opens, fits the viewport, and its Create button is on-screen
//   4. backdrop click dismisses it
//   5. the same at 400px, where a fixed-width panel would overflow
import { chromium } from 'playwright';
import { launchBrowser } from './_browser.mjs';

const BASE = process.env.BASE || 'https://lum.id';
const PW = process.env.LUMID_PW || 'admin123';

const r = await fetch(`${BASE}/api/v1/login`, {
	method: 'POST', headers: { 'Content-Type': 'application/json' },
	body: JSON.stringify({ email: 'admin@lum.id', password: PW }),
});
if (!r.ok) { console.log('LOGIN FAILED', r.status); process.exit(1); }
const cookie = (r.headers.getSetCookie?.() || []).map(c => c.split(';')[0]).join('; ');

const browser = await launchBrowser(chromium);
const fail = [];

for (const [label, w, h] of [['desktop', 1280, 900], ['phone', 400, 800]]) {
	const ctx = await browser.newContext({ viewport: { width: w, height: h } });
	await ctx.addCookies(cookie.split('; ').map(kv => {
		const [name, ...v] = kv.split('=');
		return { name, value: v.join('='), domain: 'lum.id', path: '/' };
	}));
	const p = await ctx.newPage();
	await p.goto(BASE + '/studio/research-fleet/sandboxes', { waitUntil: 'domcontentloaded', timeout: 60000 });
	await p.waitForTimeout(4000);

	const newBtn = p.getByRole('button', { name: /^New sandbox$/ });
	const keysBtn = p.getByRole('button', { name: /SSH keys|No SSH keys/ });
	const dsBtn = p.getByRole('button', { name: /^Datasets/ });

	const has = async (l) => (await l.count()) > 0 && await l.first().isVisible().catch(() => false);

	// 1 + 2: toolbar present, form collapsed, key controls NOT buried.
	if (!await has(newBtn)) fail.push(`${label}: no "New sandbox" button`);
	if (!await has(keysBtn)) fail.push(`${label}: SSH keys not reachable without opening the dialog`);
	if (!await has(dsBtn)) fail.push(`${label}: Datasets not reachable without opening the dialog`);
	if (await has(p.getByRole('button', { name: /Create sandbox/ })))
		fail.push(`${label}: create form is still open on load — the dialog is not doing its job`);

	// 3: open it and check the panel actually fits.
	if (await has(newBtn)) {
		await newBtn.first().click();
		await p.waitForTimeout(600);
		const create = p.getByRole('button', { name: /Create sandbox/ });
		if (!await has(create)) {
			fail.push(`${label}: dialog did not open`);
		} else {
			const box = await create.first().boundingBox();
			if (!box) fail.push(`${label}: Create button has no box`);
			else {
				// Off-screen bottom is the classic modal bug: it looks fine until the
				// form is long enough that the submit button leaves the viewport.
				if (box.y + box.height > h) fail.push(`${label}: Create button is BELOW the fold (y=${Math.round(box.y)}, vh=${h})`);
				if (box.x < 0 || box.x + box.width > w) fail.push(`${label}: Create button off-screen horizontally`);
			}
			const panel = await p.evaluate(() => {
				const el = [...document.querySelectorAll('div')].find(d => d.className?.includes?.('max-w-2xl'));
				if (!el) return null;
				const r = el.getBoundingClientRect();
				return { left: r.left, right: r.right, width: r.width };
			});
			if (panel) {
				if (panel.left < 0 || panel.right > w + 1)
					fail.push(`${label}: dialog panel overflows viewport (${Math.round(panel.left)}..${Math.round(panel.right)} vs ${w})`);
			}
			// horizontal page scroll = something is wider than the screen
			const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
			if (overflow > 2) fail.push(`${label}: page scrolls horizontally by ${overflow}px with the dialog open`);

			// 4: backdrop dismiss
			await p.mouse.click(4, 4);
			await p.waitForTimeout(500);
			if (await has(create)) fail.push(`${label}: backdrop click did not dismiss the dialog`);
		}
	}
	await p.screenshot({ path: `/tmp/sbx-${label}.png`, fullPage: false }).catch(() => {});
	await ctx.close();
}

await browser.close();
console.log(fail.length ? 'FAIL:\n  ' + fail.join('\n  ') : 'PASS — dialog opens, fits, dismisses; toolbar controls reachable at both widths');
process.exit(fail.length ? 1 : 0);

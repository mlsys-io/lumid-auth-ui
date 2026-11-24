// Studio visual capture + design audit.
//
//   LUMID_PAT=... node e2e/studio-visual.mjs [--base https://nightly.lum.id]
//        [--out /tmp/studio-visual/<label>] [--only studio,code] [--phone]
//
// For every route: a 1440x900 screenshot (and 390x844 with --phone, or always
// for the routes marked phone:true), plus an in-page AUDIT of what actually
// rendered — the numbers a source grep cannot give you, because half the
// colours on a page come from data-dependent branches:
//
//   offPalette  elements whose text/background/border colour is a COOL hue
//               (190-290deg, sat > 15%) that is not an allowlisted token
//               (lagoon/plum families). SVG + canvas marks are skipped: chart
//               series are categorical on purpose.
//   contrast    text elements below WCAG AA (4.5:1, or 3:1 for large text)
//               against their effective background.
//   fontSizes   distinct computed font sizes among elements carrying text.
//   overflowX   document wider than the viewport (phone only matters).
//
// NAVIGATION ONLY. This script must never click into a thread, send a turn or
// toggle anything: opening a Recent thread re-saves it (retitles it and bumps
// its timestamp) on whatever account the PAT belongs to. Thread views are
// captured by URL from THREAD_ID, a thread created for the purpose.
//
// Auth: LUMID_PASSWORD (+LUMID_EMAIL) -> real lm_session cookie; otherwise
// LUMID_PAT as a bearer header, which the Studio pages honour.

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser } from './_browser.mjs';

const arg = (k, d) => {
	const i = process.argv.indexOf(k);
	return i > 0 ? process.argv[i + 1] : d;
};
const BASE = arg('--base', process.env.LUMID_BASE || 'https://lum.id');
const OUT = arg('--out', `/tmp/studio-visual/${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}`);
const ONLY = arg('--only', '');
const ALL_PHONE = process.argv.includes('--phone');
const WAIT = Number(arg('--wait', '7000'));
const THREAD = process.env.THREAD_ID;

// [name, path, opts]
const ROUTES = [
	['studio', '/studio', { phone: true }],
	['library', '/studio/library/marketplace', { phone: true }],
	['library-skills', '/studio/library/skills'],
	['library-studies', '/studio/library/experiments'],
	['data', '/studio/data-warehouse'],
	['fleet', '/studio/research-fleet'],
	['runs', '/studio/runs', { phone: true }],
	['knowledge', '/studio/knowledge'],
	['inbox', '/studio/inbox'],
	['drafts', '/studio/drafts'],
	['apps-all', '/studio/apps/all'],
	['app-mbb', '/studio/apps/mbb-consultant', { phone: true }],
	['strategies', '/studio/strategies'],
	['settings', '/studio/settings'],
	['docs', '/studio/docs'],
	['account-profile', '/studio/account/profile'],
	['account-tokens', '/studio/account/tokens'],
	['code', '/code'],
	['claude-sessions', '/claude-sessions'],
	['explore', '/explore'],
	['login', '/auth/login', { anon: true }],
	...(THREAD ? [['thread', `/studio/chat/${THREAD}`, { phone: true }]] : []),
];

mkdirSync(OUT, { recursive: true });

async function sessionCookie() {
	if (!process.env.LUMID_PASSWORD) return null;
	const res = await fetch(`${BASE}/api/v1/login`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ email: process.env.LUMID_EMAIL || 'admin@lum.id', password: process.env.LUMID_PASSWORD }),
	});
	const sc = res.headers.getSetCookie?.() ?? [];
	return sc.map((c) => c.match(/lm_session=([^;]+)/)?.[1]).find(Boolean) ?? null;
}

// Runs in the page. Keep it dependency-free.
function audit() {
	const parse = (s) => {
		const m = s.match(/rgba?\(([^)]+)\)/);
		if (!m) return null;
		const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
		return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
	};
	const hsl = ({ r, g, b }) => {
		r /= 255; g /= 255; b /= 255;
		const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
		if (mx === mn) return { h: 0, s: 0, l };
		const d = mx - mn;
		const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
		let h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
		return { h: h * 60, s, l };
	};
	const lum = ({ r, g, b }) => {
		const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
		return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
	};
	const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
	// Allowlisted cool tokens (lagoon + plum families) — keep in sync with tailwind.config.ts.
	const ALLOW = new Set((window.__LUMEN_ALLOW__ || []).map((s) => s.toLowerCase()));
	const key = (c) => `${c.r},${c.g},${c.b}`;
	const cool = (c) => {
		if (!c || c.a < 0.05) return false;
		const { h, s } = hsl(c);
		return h >= 190 && h <= 290 && s > 0.15 && !ALLOW.has(key(c));
	};
	const bgOf = (el) => {
		for (let e = el; e; e = e.parentElement) {
			const c = parse(getComputedStyle(e).backgroundColor);
			if (c && c.a > 0.5) return c;
		}
		return { r: 255, g: 255, b: 255, a: 1 };
	};
	const vis = (el) => {
		const r = el.getBoundingClientRect();
		if (r.width < 1 || r.height < 1 || r.bottom < 0 || r.top > innerHeight * 3) return false;
		const cs = getComputedStyle(el);
		return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05;
	};
	const off = [], low = [], sizes = new Map();
	for (const el of document.body.querySelectorAll('*')) {
		if (el.closest('svg,canvas,[data-palette-ok]')) continue;
		if (!vis(el)) continue;
		const cs = getComputedStyle(el);
		const direct = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
		const label = (el.className && typeof el.className === 'string' ? el.className.slice(0, 80) : el.tagName) + ' :: ' + (el.textContent || '').trim().slice(0, 40);
		for (const prop of ['color', 'backgroundColor', 'borderTopColor']) {
			if (prop === 'color' && !direct) continue;
			if (prop === 'borderTopColor' && parseFloat(cs.borderTopWidth) === 0) continue;
			const c = parse(cs[prop]);
			if (cool(c)) { off.push(`${prop} ${cs[prop]} | ${label}`); break; }
		}
		if (direct) {
			const fs = parseFloat(cs.fontSize);
			sizes.set(fs, (sizes.get(fs) || 0) + 1);
			const fg = parse(cs.color);
			if (fg && fg.a > 0.5) {
				const r = ratio(fg, bgOf(el));
				const large = fs >= 24 || (fs >= 18.66 && Number(cs.fontWeight) >= 700);
				if (r < (large ? 3 : 4.5)) low.push(`${r.toFixed(2)} ${cs.color} ${fs}px | ${label}`);
			}
		}
	}
	return {
		offPalette: off.length,
		contrast: low.length,
		fontSizes: [...sizes.keys()].sort((a, b) => a - b),
		overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
		samples: { offPalette: off.slice(0, 25), contrast: low.slice(0, 25) },
	};
}

const browser = await launchBrowser(chromium);
const cookie = await sessionCookie();
const headers = !cookie && process.env.LUMID_PAT ? { Authorization: `Bearer ${process.env.LUMID_PAT}` } : {};
const host = new URL(BASE).hostname;
const mk = async (viewport, anon) => {
	const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, extraHTTPHeaders: anon ? {} : headers });
	if (cookie && !anon) await ctx.addCookies([{ name: 'lm_session', value: cookie, domain: `.${host.replace(/^nightly\./, '')}`, path: '/', httpOnly: true, secure: true }]);
	return ctx;
};
const desk = await mk({ width: 1440, height: 900 });
const phone = await mk({ width: 390, height: 844 });
const anonDesk = await mk({ width: 1440, height: 900 }, true);

const report = {};
for (const [name, path, opts = {}] of ROUTES) {
	if (ONLY && !ONLY.split(',').includes(name)) continue;
	const shots = [['desk', opts.anon ? anonDesk : desk]];
	if ((opts.phone || ALL_PHONE) && !opts.anon) shots.push(['phone', phone]);
	for (const [vp, ctx] of shots) {
		const page = await ctx.newPage();
		const errs = [];
		page.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));
		try {
			await page.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 45000 });
			await page.waitForTimeout(WAIT);
			await page.screenshot({ path: `${OUT}/${name}-${vp}.png` });
			const a = await page.evaluate(audit);
			report[`${name}-${vp}`] = { url: page.url(), ...a, pageErrors: errs };
			console.log(`${name.padEnd(16)} ${vp.padEnd(5)} off=${String(a.offPalette).padStart(3)} contrast=${String(a.contrast).padStart(3)} sizes=${a.fontSizes.length} overflow=${a.overflowX ? 'YES' : 'no'}${errs.length ? ` errors=${errs.length}` : ''}`);
		} catch (e) {
			report[`${name}-${vp}`] = { error: String(e).slice(0, 200) };
			console.log(`${name.padEnd(16)} ${vp.padEnd(5)} FAILED ${String(e).slice(0, 100)}`);
		}
		await page.close();
	}
}
writeFileSync(`${OUT}/audit.json`, JSON.stringify(report, null, 2));
const vals = Object.values(report).filter((r) => !r.error);
const sum = (k) => vals.reduce((n, r) => n + r[k], 0);
console.log(`\nTOTAL off-palette=${sum('offPalette')} contrast=${sum('contrast')} max-sizes=${Math.max(...vals.map((r) => r.fontSizes.length))} overflow=${vals.filter((r) => r.overflowX).length}`);
console.log(`-> ${OUT}`);
await browser.close();

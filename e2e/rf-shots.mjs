// Read-only screenshots of the Research Fleet tabs (desktop + phone). LUMID_PAT=... node e2e/rf-shots.mjs [outdir]
import { chromium } from 'playwright';
import { launchBrowser } from './_browser.mjs';
import { authContext } from './_auth.mjs';
const BASE = process.env.BASE || 'https://lum.id', OUT = process.argv[2] || '/tmp/rf-shots';
const TABS = (process.env.TABS || ",/storage").split(",");
const browser = await launchBrowser(chromium);
for (const [label, vp] of [['desk', { width: 1440, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
	const { ctx } = await authContext(browser, BASE, { viewport: vp });
	const page = await ctx.newPage();
	await page.route('**/*', (r) => (r.request().method() === 'GET' ? r.continue() : r.abort()));
	for (const t of TABS) {
		await page.goto(`${BASE}/studio/research-fleet${t}`, { waitUntil: 'networkidle', timeout: 90000 }).catch(() => {});
		await page.waitForTimeout(4000);
		const name = (t.replace('/', '') || 'nodes') + `-${label}`;
		await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
		const m = await page.evaluate(() => ({ h: document.documentElement.scrollHeight, w: document.documentElement.scrollWidth, vw: innerWidth }));
		console.log(name, JSON.stringify(m));
	}
	await ctx.close();
}
await browser.close();

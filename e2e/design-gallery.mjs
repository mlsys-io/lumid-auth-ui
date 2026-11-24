// Screenshot the Lumen design gallery (design-dev.html) section by section.
//   npx vite --port 5199 &   node e2e/design-gallery.mjs [--out dir] [--wait ms]
// No auth, no data — this is the pixel-level check for tokens, primitives and
// the Strands illustrations before they reach a real surface.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { launchBrowser } from './_browser.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const URL = process.env.GALLERY_URL || 'http://localhost:5199/auth/design-dev.html';
const OUT = arg('--out', '/tmp/lumen-gallery');
const WAIT = Number(arg('--wait', '2200'));
mkdirSync(OUT, { recursive: true });
const b = await launchBrowser(chromium);
const p = await b.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
const errs = [];
p.on('pageerror', (e) => errs.push(String(e)));
p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
await p.goto(URL, { waitUntil: 'networkidle' });
await p.waitForTimeout(WAIT);
for (const id of await p.$$eval('[data-section]', (els) => els.map((e) => e.dataset.section))) {
	const el = await p.$(`[data-section="${id}"]`);
	await el.scrollIntoViewIfNeeded();
	await p.waitForTimeout(250);
	await el.screenshot({ path: `${OUT}/${id}.png` });
}
await p.screenshot({ path: `${OUT}/_top.png` });
console.log(errs.length ? `ERRORS:\n${errs.join('\n')}` : 'no page errors', '->', OUT);
await b.close();

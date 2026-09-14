// Verify the experiments doc as a READER sees it, not as a file on disk.
// A markdown doc can render perfectly at its slug and be invisible on the index
// (two docs here are hidden exactly that way), and a broken image path renders
// as alt text — which looks fine in a diff and wrong on screen.
import { chromium } from 'playwright';
import { launchBrowser } from './_browser.mjs';

const BASE = process.env.LUMID_BASE || 'https://lum.id';
const PAT = (process.env.LUMID_PAT || '').trim();
const gates = [];
const gate = (id, ok, d) => { gates.push(ok); console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${id}  ${d}`); };

const b = await launchBrowser(chromium);
const ctx = await b.newContext({ extraHTTPHeaders: { Authorization: `Bearer ${PAT}` }, viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const bad = [];
page.on('response', r => { if (r.status() >= 400 && /\/docs\//.test(r.url())) bad.push(`${r.status()} ${r.url().replace(BASE,'')}`); });

const waitFor = async (re, ms = 45000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (re.test(await page.evaluate(() => document.body.innerText))) return true;
    await page.waitForTimeout(1000);
  }
  return false;
};

// D1 — reachable from the INDEX, not just by direct URL
await page.goto(`${BASE}/studio/docs`, { waitUntil: 'domcontentloaded', timeout: 45000 });
gate('D1 listed on the index', await waitFor(/Workflows and experiments/), 'index card present');

// D2 — the card navigates to the reader
await page.locator('text=Workflows and experiments').first().click().catch(() => {});
gate('D2 card opens the doc', await waitFor(/A \*\*workflow\*\*|workflow.*is a loop your app runs/i, 30000)
     || await waitFor(/metric.*scope/i, 5000), 'reader rendered from the card');

// D3 — direct slug works too
await page.goto(`${BASE}/studio/docs/experiments`, { waitUntil: 'domcontentloaded', timeout: 45000 });
const body = await waitFor(/chatbox as control plane/i);
gate('D3 direct slug renders', body, '/studio/docs/experiments');

// D4 — every screenshot actually LOADED (naturalWidth, not just an <img> tag)
const imgs = await page.evaluate(() => Array.from(document.querySelectorAll('img'))
  .filter(i => i.src.includes('/docs/img/experiments-'))
  .map(i => ({ src: i.getAttribute('src'), w: i.naturalWidth })));
gate('D4 all four screenshots load', imgs.length === 4 && imgs.every(i => i.w > 100),
     imgs.map(i => `${i.src.split('/').pop()}:${i.w}px`).join(' ') || 'none found');

// D5 — the worked example's numbers survived markdown
gate('D5 worked example intact', await waitFor(/0\.497/) && await waitFor(/qwen14b_local/),
     'three-arm table rendered');

// D6 — no 404s on any /docs/ asset
gate('D6 no broken doc assets', bad.length === 0, bad.slice(0, 3).join(' ') || 'none');

await page.screenshot({ path: '/tmp/w5/docs-experiments.png', fullPage: false });
await b.close();
const passed = gates.filter(Boolean).length;
console.log(`\n${passed}/${gates.length} gates`);
process.exit(passed === gates.length ? 0 : 1);

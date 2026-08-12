import { chromium } from 'playwright';
const b = await chromium.launch({ channel: 'chrome' });
const ctx = await b.newContext({ extraHTTPHeaders: { Authorization: `Bearer ${process.env.LUMID_PAT}` } });
const p = await ctx.newPage();
await p.goto('https://lum.id/studio/apps/mbb-consultant', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(10000);
const ov = p.getByRole('button', { name: /^Overview$/ });
console.log('Overview buttons found:', await ov.count());
if (await ov.count()) { await ov.first().click(); await p.waitForTimeout(8000); }
const body = await p.locator('body').innerText();
console.log('rows          :', await p.locator('table tbody tr').count());
console.log('Start buttons :', await p.getByRole('button', { name: /^Start$/ }).count());
console.log('Start here    :', /Start here/i.test(body));
console.log('Industry      :', /Industry/.test(body));
console.log('page head     :', body.replace(/\s+/g,' ').slice(0,220));
await b.close();

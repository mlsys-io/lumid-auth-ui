import { chromium } from 'playwright';
const b = await chromium.launch({ channel: 'chrome' });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 },
  extraHTTPHeaders: { Authorization: `Bearer ${process.env.LUMID_PAT}` } });
const p = await ctx.newPage();
await p.goto('https://lum.id/studio/apps/mbb-consultant', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(12000);
const body = await p.locator('body').innerText();
console.log('sidebar visible  :', await p.getByRole('button', { name: /Show sidebar/i }).count() === 0);
console.log('sidebar has app  :', /MBB Consultant/.test(body));
console.log('New chat present :', /New chat/i.test(body));
console.log('lands on app page:', /Start here/i.test(body));
console.log('picker rows      :', await p.locator('table tbody tr').count());
console.log('Start buttons    :', await p.getByRole('button', { name: /^Start$/ }).count());
await p.screenshot({ path: '/tmp/final.png', fullPage: true });
await b.close();

import { chromium } from 'playwright';
const b = await chromium.launch({ channel: 'chrome' });
const ctx = await b.newContext({ extraHTTPHeaders: { Authorization: `Bearer ${process.env.LUMID_PAT}` } });
const p = await ctx.newPage();
await p.goto('https://lum.id/studio/apps/mbb-consultant', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(12000);                     // NO Overview click — must land here
const body = await p.locator('body').innerText();
console.log('lands on app page :', /Start here/i.test(body));
console.log('picker rows       :', await p.locator('table tbody tr').count());
console.log('Start buttons     :', await p.getByRole('button', { name: /^Start$/ }).count());
console.log('Industry column   :', /Industry/.test(body));
console.log('templates leaked  :', /TEMPLATE|Case 标题/.test(body));
console.log('nav tabs          :', ['Environment','Review','Workflows','Experiments'].filter(n => new RegExp(n).test(body)).join(', '));
await b.close();

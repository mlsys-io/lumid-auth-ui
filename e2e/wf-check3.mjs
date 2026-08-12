import { chromium } from 'playwright';
const b = await chromium.launch({ channel: 'chrome' });
const ctx = await b.newContext({ viewport:{width:1440,height:900},
  extraHTTPHeaders: { Authorization: `Bearer ${process.env.LUMID_PAT}` } });
const p = await ctx.newPage();
await p.goto('https://lum.id/studio/apps/mbb-consultant', { waitUntil:'domcontentloaded' });
await p.waitForTimeout(11000);
const sel = p.getByRole('button', { name: /Pick a workflow/ });
console.log('selector found:', await sel.count());
await sel.first().click(); await p.waitForTimeout(2500);
const opts = await p.evaluate(() => [...document.querySelectorAll('[role="menuitem"],[role="option"],button')]
  .map(e=>(e.innerText||'').replace(/\s+/g,' ').trim()).filter(t=>t && t.length<40 && /interview|case|cycle/i.test(t)).slice(0,6));
console.log('menu options:', JSON.stringify(opts));
if (opts.length) {
  await p.getByRole('button', { name: new RegExp(opts[0].split(' ')[0]) }).first().click().catch(()=>{});
  await p.waitForTimeout(6000);
  console.log('after select, URL:', p.url());
  const t = await p.locator('body').innerText();
  console.log('workflow panel shown:', /run|cycle|schedule|pipeline|trajectory/i.test(t));
}
await b.close();

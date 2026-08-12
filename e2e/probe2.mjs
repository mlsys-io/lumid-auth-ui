import { chromium } from 'playwright';
const b = await chromium.launch({ channel: 'chrome' });
const ctx = await b.newContext({ viewport:{width:1440,height:900},
  extraHTTPHeaders: { Authorization: `Bearer ${process.env.LUMID_PAT}` } });
const p = await ctx.newPage();
await p.goto('https://lum.id/studio/apps/mbb-consultant?surface=workflows', { waitUntil:'domcontentloaded' });
await p.waitForTimeout(13000);
const body = await p.locator('body').innerText();
console.log('has "interview loop":', /interview\s+loop/i.test(body));
console.log('"regression_sweep" occurrences:', (body.match(/regression_sweep/g)||[]).length);
console.log('"Building a new harness" occurrences:', (body.match(/Building a new harness/g)||[]).length);
const slots = await p.evaluate(() => ['topstrip-app-slot','topstrip-wf-slot'].map(id=>{
  const e=document.getElementById(id); if(!e) return {id,missing:true};
  const r=e.getBoundingClientRect();
  return {id,x:Math.round(r.left),w:Math.round(r.width),children:e.children.length,text:(e.innerText||'').replace(/\s+/g,' ').slice(0,60)};
}));
console.log('slots:', JSON.stringify(slots,null,1));
await b.close();

import { chromium } from 'playwright';
const b = await chromium.launch({ channel: 'chrome' });
const ctx = await b.newContext({ viewport:{width:1440,height:900},
  extraHTTPHeaders: { Authorization: `Bearer ${process.env.LUMID_PAT}` } });
const p = await ctx.newPage();
await p.goto('https://lum.id/studio/apps/mbb-consultant?surface=review', { waitUntil:'domcontentloaded' });
await p.waitForTimeout(10000);
const hdr = await p.locator('table thead th').allInnerTexts();
const rows = await p.locator('table tbody tr').count();
console.log('review headers:', JSON.stringify(hdr), 'rows:', rows);
for (let i=0;i<Math.min(3,rows);i++)
  console.log('  row', i, JSON.stringify((await p.locator('table tbody tr').nth(i).allInnerTexts())[0].replace(/\s+/g,' | ')));
await p.goto('https://lum.id/studio/apps/mbb-consultant?surface=workflows', { waitUntil:'domcontentloaded' });
await p.waitForTimeout(10000);
const body = await p.locator('body').innerText();
console.log('\nworkflows: occurrences of "Workflows" heading text:', (body.match(/\bWorkflows\b/g)||[]).length);
console.log('h1/h2/h3 texts:', JSON.stringify(await p.locator('h1,h2,h3').allInnerTexts()));
console.log('body head:', body.replace(/\s+/g,' ').slice(0,220));
await b.close();

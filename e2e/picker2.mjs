import { chromium } from 'playwright';
const b = await chromium.launch({ channel: 'chrome' });
const ctx = await b.newContext({ viewport:{width:1440,height:900},
  extraHTTPHeaders: { Authorization: `Bearer ${process.env.LUMID_PAT}` } });
const p = await ctx.newPage();
await p.goto('https://lum.id/studio/apps/mbb-consultant', { waitUntil:'domcontentloaded' });
await p.waitForTimeout(12000);
const rows0 = await p.locator('table tbody tr').count();
console.log('rows before filter :', rows0);
const box = p.locator('input[placeholder*="Filter"]');
console.log('search box present :', await box.count() > 0);
if (await box.count()) {
  await box.first().fill('airlines');
  await p.waitForTimeout(1500);
  const rows1 = await p.locator('table tbody tr').count();
  console.log('rows for "airlines":', rows1);
  await box.first().fill('');
  await p.waitForTimeout(1200);
}
// sort by Difficulty, read the first values
// the header now carries a sort arrow, so match loosely
const hdr = p.locator('th', { hasText: /Difficulty/ });
console.log('difficulty header found:', await hdr.count());
if (await hdr.count()) {
  await hdr.first().click(); await p.waitForTimeout(1200);
  const first = await p.locator('table tbody tr td:nth-child(3)').allInnerTexts();
  console.log('difficulty desc-first:', first.slice(0,4).join(' | '));
  await hdr.first().click(); await p.waitForTimeout(1200);
  const second = await p.locator('table tbody tr td:nth-child(3)').allInnerTexts();
  const seq = [];
  for (const v of second) if (!seq.includes(v)) seq.push(v);
  console.log('difficulty asc sequence:', seq.join(' < '));
  const semantic = ['Easy','Easy-Medium','Medium','Medium-Hard','Hard'];
  const lexical  = ['Easy','Easy-Medium','Hard','Medium','Medium-Hard'];
  console.log('matches SEMANTIC order :', JSON.stringify(seq) === JSON.stringify(semantic));
  console.log('matches lexical order  :', JSON.stringify(seq) === JSON.stringify(lexical));
}
await b.close();

import { chromium } from 'playwright';
const PAT = process.env.LUMID_PAT;
const b = await chromium.launch({ channel: 'chrome' });
const ctx = await b.newContext({ extraHTTPHeaders: { Authorization: `Bearer ${PAT}` } });
const p = await ctx.newPage();
await p.goto('https://lum.id/studio/apps/mbb-consultant', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(9000);
const tabs = await p.locator('[role="tab"], nav button, nav a').allInnerTexts();
console.log('tabs seen:', [...new Set(tabs.map(t=>t.trim()).filter(Boolean))].slice(0,15));
for (const name of ['Overview','Interview','Environment','Review','Workflows','Experiments']) {
  const el = p.getByRole('button', { name: new RegExp(`^${name}$`) }).or(p.getByRole('link', { name: new RegExp(`^${name}$`) }));
  if (await el.count() === 0) { console.log(`  ${name}: (no tab)`); continue; }
  await el.first().click().catch(()=>{});
  await p.waitForTimeout(4000);
  const t = await p.locator('body').innerText();
  console.log(`  ${name}: startHere=${/Start here/i.test(t)} rows=${await p.locator('table tbody tr').count()} startBtns=${await p.getByRole('button',{name:/^Start$/}).count()}`);
}
await b.close();

import { chromium } from 'playwright';
const b = await chromium.launch({ channel: 'chrome' });
const ctx = await b.newContext({ viewport:{width:1440,height:900},
  extraHTTPHeaders: { Authorization: `Bearer ${process.env.LUMID_PAT}` } });
const p = await ctx.newPage();
await p.goto('https://lum.id/studio/apps/mbb-consultant', { waitUntil:'domcontentloaded' });
await p.waitForTimeout(12000);
// open the composer menu (the "+" in the composer)
const plus = p.locator('button[title*="Attach"], button:has(svg.lucide-plus)').last();
const menuBtn = await plus.count() ? plus : p.getByRole('button').filter({ hasText: '' }).last();
await menuBtn.click().catch(()=>{});
await p.waitForTimeout(1500);
const body = await p.locator('body').innerText();
for (const m of ['Interview mode','Train the AI','Free answering','Train me','Ask the app'])
  console.log(`  ${m.padEnd(16)}: ${body.includes(m)}`);
await p.screenshot({ path:'/tmp/modes.png' });
await b.close();

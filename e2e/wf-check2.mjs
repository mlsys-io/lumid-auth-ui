import { chromium } from 'playwright';
const b = await chromium.launch({ channel: 'chrome' });
const ctx = await b.newContext({ viewport:{width:1440,height:900},
  extraHTTPHeaders: { Authorization: `Bearer ${process.env.LUMID_PAT}` } });
const p = await ctx.newPage();
p.on('pageerror', e => console.log('PAGE ERR:', String(e).slice(0,140)));
await p.goto('https://lum.id/studio/apps/mbb-consultant', { waitUntil:'domcontentloaded' });
await p.waitForTimeout(11000);
const sel = await p.evaluate(() => {
  const hits = [];
  for (const el of document.querySelectorAll('button,[role="combobox"],select')) {
    const txt = (el.innerText||'').replace(/\s+/g,' ').trim();
    if (/workflow/i.test(txt)) { const r = el.getBoundingClientRect();
      hits.push({ text: txt.slice(0,40), x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width) }); }
  }
  return hits;
});
console.log('workflow controls:', JSON.stringify(sel));
// click the app's Workflows tab
const tab = p.getByRole('link', { name: /^Workflows$/ });
if (await tab.count()) {
  await tab.first().click(); await p.waitForTimeout(6000);
  const t = await p.locator('body').innerText();
  console.log('after Workflows tab, URL:', p.url());
  console.log('shows workflow content:', /case_cycle|Interview|workflow/i.test(t));
}
await b.close();

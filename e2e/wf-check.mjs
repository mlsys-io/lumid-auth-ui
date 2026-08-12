import { chromium } from 'playwright';
const b = await chromium.launch({ channel: 'chrome' });
const ctx = await b.newContext({ viewport:{width:1440,height:900},
  extraHTTPHeaders: { Authorization: `Bearer ${process.env.LUMID_PAT}` } });
const p = await ctx.newPage();
await p.goto('https://lum.id/studio/apps/mbb-consultant', { waitUntil:'domcontentloaded' });
await p.waitForTimeout(11000);
const top = await p.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll('button, a')) {
    const r = el.getBoundingClientRect();
    if (r.top < 130 && r.left > 260 && r.width > 0) {
      out.push({ tag: el.tagName, text: (el.innerText||el.getAttribute('aria-label')||el.title||'').trim().slice(0,28),
                 x: Math.round(r.left), y: Math.round(r.top), href: el.getAttribute('href')||'' });
    }
  }
  return out;
});
console.log('--- top-strip controls (left→right) ---');
top.sort((a,b)=>a.y-b.y||a.x-b.x).forEach(c => console.log(`  y${c.y} x${c.x} <${c.tag}> "${c.text}" ${c.href}`));
await b.close();

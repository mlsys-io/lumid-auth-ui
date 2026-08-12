import { chromium } from 'playwright';
const b = await chromium.launch({ channel: 'chrome' });
const ctx = await b.newContext({ viewport:{width:1440,height:900},
  extraHTTPHeaders: { Authorization: `Bearer ${process.env.LUMID_PAT}` } });
const p = await ctx.newPage();
await p.goto('https://lum.id/studio/apps/mbb-consultant', { waitUntil:'domcontentloaded' });
await p.waitForTimeout(12000);
const info = await p.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll('button,a')) {
    const txt = (el.innerText||'').replace(/\s+/g,' ').trim();
    if (!/^(Overview|Environment|Review|Workflows|Experiments|New workflow)$/.test(txt)) continue;
    const r = el.getBoundingClientRect();
    let slot = 'none';
    if (document.getElementById('topstrip-app-slot')?.contains(el)) slot='app-slot';
    if (document.getElementById('topstrip-wf-slot')?.contains(el)) slot='wf-slot';
    out.push({txt, slot, x:Math.round(r.left), y:Math.round(r.top), w:Math.round(r.width)});
  }
  const s = id => { const e=document.getElementById(id); const r=e?.getBoundingClientRect();
    return e?{x:Math.round(r.left),w:Math.round(r.width),kids:e.children.length}:null; };
  return {controls: out.sort((a,b)=>a.x-b.x), app: s('topstrip-app-slot'), wf: s('topstrip-wf-slot')};
});
console.log('app-slot:', JSON.stringify(info.app), ' wf-slot:', JSON.stringify(info.wf));
info.controls.forEach(c=>console.log(`  ${c.slot.padEnd(9)} x${String(c.x).padStart(4)} w${String(c.w).padStart(3)} ${c.txt}`));
await b.close();

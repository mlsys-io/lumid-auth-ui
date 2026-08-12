import { chromium } from 'playwright';
const b = await chromium.launch({ channel: 'chrome' });
const ctx = await b.newContext({ viewport:{width:1440,height:900},
  extraHTTPHeaders: { Authorization: `Bearer ${process.env.LUMID_PAT}` } });
const p = await ctx.newPage();
p.on('pageerror', e => console.log('PAGE ERROR:', String(e).slice(0,200)));
p.on('console', m => { if (m.type()==='error') console.log('CONSOLE ERR:', m.text().slice(0,160)); });
let posts = 0;
p.on('request', r => { if (r.url().includes('/me/agent/chat')) posts++; });
let dialogs = 0;
p.on('dialog', d => { dialogs++; d.accept('It ignored private-label economics.'); });

const composer = () => p.locator('textarea, [contenteditable="true"]').first();
const settle = async (ms=40000) => {
  let last=-1, stable=0, waited=0;
  while (waited < ms) { await p.waitForTimeout(2000); waited+=2000;
    const n=(await p.locator('body').innerText()).length;
    if(n===last){ if(++stable>=3) break; } else { stable=0; last=n; } }
};

await p.goto('https://lum.id/studio/apps/mbb-consultant', { waitUntil:'domcontentloaded' });
await p.waitForTimeout(12000);

// Reproduce the JOURNEY's shape: several turns, then a reload, then the click.
await composer().fill("Let's work case Case_019_BetaOptics_PK21. Give me the opening.");
await composer().press('Enter'); await settle();
await composer().fill("Revenue is falling. What would you check first?");
await composer().press('Enter'); await settle();
console.log('--- reloading (as G4 does) ---');
await p.reload({ waitUntil:'domcontentloaded' });
await p.waitForTimeout(12000);
await composer().fill("Score my last answer against the case.");
await composer().press('Enter'); await settle();

const btn = p.locator('button[title*="record a correction" i]').last();
console.log('button count:', await btn.count(), '| visible:', await btn.isVisible().catch(()=>false));
const before = posts;
await btn.click();
await p.waitForTimeout(12000);
console.log('dialogs:', dialogs, '| chat POSTs fired by click:', posts - before);

// Is the composer itself still alive? If a stuck in-flight guard is the cause,
// typing a normal turn is ALSO a no-op.
const before2 = posts;
await composer().fill("hello");
await composer().press('Enter');
await p.waitForTimeout(8000);
console.log('composer still sends turns:', (posts - before2) > 0);
await b.close();

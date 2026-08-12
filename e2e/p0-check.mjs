import { chromium } from 'playwright';

// Auth: a PAT if one is handed in, else log in with the password and reuse the
// lm_session cookie (same recipe as studio-app-journey.mjs) so the probe needs
// no minted token.
const BASE  = process.env.LUMID_BASE  || 'https://lum.id';
const EMAIL = process.env.LUMID_EMAIL || 'admin@lum.id';
const PAT   = process.env.LUMID_PAT;
const PW    = process.env.LUMID_PASSWORD;
if (!PAT && !PW) { console.error('LUMID_PAT or LUMID_PASSWORD required'); process.exit(2); }

let session = null;
if (!PAT) {
  const res = await fetch(`${BASE}/api/v1/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PW }),
  });
  if (res.status !== 200) { console.error(`login → ${res.status}`); process.exit(2); }
  session = (res.headers.get('set-cookie') || '').match(/lm_session=([^;]+)/)?.[1];
  if (!session) { console.error('no lm_session cookie'); process.exit(2); }
}

const b = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const ctx = await b.newContext({ viewport:{width:1440,height:900},
  ...(PAT ? { extraHTTPHeaders: { Authorization: `Bearer ${PAT}` } } : {}) });
if (session) await ctx.addCookies([{ name:'lm_session', value:session, domain:'.lum.id',
  path:'/', httpOnly:true, secure:true, sameSite:'Lax' }]);
const p = await ctx.newPage();
const fails = [];
const check = (ok, name, extra='') => { console.log(`${ok?'PASS':'FAIL'}  ${name}${extra?'  '+extra:''}`); if(!ok) fails.push(name); };

// P0-1 recursion
await p.goto('https://lum.id/studio/apps/mbb-consultant?surface=workflows', { waitUntil:'domcontentloaded' });
await p.waitForTimeout(11000);
const wfBody = await p.locator('body').innerText();
// regression_sweep appears exactly once in workflows.md — a stable unique marker.
const wfHits = (wfBody.match(/regression_sweep/g) || []).length;
check(wfHits === 1, 'P0-1 Workflows renders once (no recursion)', `body copies=${wfHits}`);

// P0-4 one nav owner + no overlap
const boxes = await p.evaluate(() => {
  const els = [...document.querySelectorAll('button,a')].filter(e=>{
    const r=e.getBoundingClientRect(); return r.top<130 && r.left>230 && r.width>0;
  });
  // Skip ancestor/descendant pairs: a nested control always overlaps its parent.
  return els.map((e,i)=>{const r=e.getBoundingClientRect();
    return {i,t:(e.innerText||'').trim().replace(/\s+/g,' '),x:r.left,y:r.top,w:r.width,h:r.height,
            nested: els.some((o,j)=>j!==i && (o.contains(e)||e.contains(o)))};});
});
const ovs = boxes.filter(o=>o.t==='Overview');
check(ovs.length === 1, 'P0-5 exactly one Overview control', `found=${ovs.length}`);
const overlap = (a,c)=>a.x<c.x+c.w&&c.x<a.x+a.w&&a.y<c.y+c.h&&c.y<a.y+a.h;
let bad=null;
for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){
  const a=boxes[i],c=boxes[j];
  if(a.nested||c.nested||!a.t||!c.t) continue;
  if(overlap(a,c)) bad=`${a.t} / ${c.t}`;
}
check(!bad, 'P0-4 no two strip controls overlap', bad||'');

// P0-2 review table
await p.goto('https://lum.id/studio/apps/mbb-consultant?surface=review', { waitUntil:'domcontentloaded' });
await p.waitForTimeout(10000);
// An empty queue is a legitimate state ("No rows."), not a failure — but it also
// proves nothing about the columns, so say so rather than passing silently.
const cells = await p.locator('table tbody td').allInnerTexts();
const dashes = cells.filter(c=>c.trim()==='—').length;
if (cells.length === 0) {
  const empty = /No rows\./.test(await p.locator('body').innerText());
  check(empty, 'P0-2 Review renders (queue empty — columns untested)', empty?'':'no table and no empty state');
} else {
  check(dashes===0, 'P0-2 Review has no em-dash cells', `cells=${cells.length} dashes=${dashes}`);
}

// P0-3 home is app-less
await p.goto('https://lum.id/studio/apps/mbb-consultant', { waitUntil:'domcontentloaded' });
await p.waitForTimeout(8000);
await p.goto('https://lum.id/studio', { waitUntil:'domcontentloaded' });
await p.waitForTimeout(9000);
const home = await p.locator('main, [role="main"]').innerText().catch(()=>p.locator('body').innerText());
const leaked = /MBB Consultant looks healthy|run a workflow/.test(home);
check(!leaked, 'P0-3 /studio is app-less after visiting an app');

await p.screenshot({ path:'/tmp/p0.png', fullPage:false });
await b.close();
console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS');
process.exit(fails.length?1:0);

import { chromium } from 'playwright';
import { launchBrowser } from './_browser.mjs';
const BASE='https://lum.id', PAT=process.env.ANTHROPIC_AUTH_TOKEN;
const fails=[]; const assert=(c,m)=>{console.log(`${c?'PASS':'FAIL'}  ${m}`); if(!c)fails.push(m);};
const b=await launchBrowser(chromium);
const ctx=await b.newContext();
// Bearer-inject the pool PAT on all API calls (app auth is cookie-based).
await ctx.route('**/api/v1/**', r=>r.continue({headers:{...r.request().headers(), authorization:`Bearer ${PAT}`}}));
// The cluster-picker endpoint needs a lumid-cluster token the claude:proxy PAT
// lacks → 401 → global logout. Stub it (empty list = default in-cluster scope);
// registered last so it wins over the catch-all.
await ctx.route('**/api/v1/cluster/clusters/selectable*', r=>r.fulfill({status:200, contentType:'application/json', body:JSON.stringify({ret_code:0,message:'ok',data:{clusters:[]},clusters:[]})}));
await ctx.addInitScript(()=>{ try{localStorage.setItem('studio_chat_model_v1','claude-code-sonnet');}catch{} });
const page=await ctx.newPage();
try{
  const resp=await page.goto(`${BASE}/studio`,{waitUntil:'domcontentloaded',timeout:45000});
  assert(resp&&resp.status()<400, `/studio loads (${resp&&resp.status()})`);
  await page.waitForSelector('textarea, [contenteditable="true"]',{timeout:30000}).catch(()=>{});
  await page.waitForTimeout(2500);
  const onLogin=await page.evaluate(()=>/Sign in to your Lumid/i.test(document.body.innerText));
  assert(!onLogin, 'stayed authed (not bounced to login)');
  const composer=await page.$('textarea, [contenteditable="true"]');
  assert(!!composer, 'chat composer rendered');
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('studio:ask',{detail:{
    prompt:'Call your lumid list_workers tool right now and show the result. Do nothing else.',
    autosend:true, model:'claude-code-sonnet'}})));
  console.log('  turn dispatched; waiting for the worker card…');
  const card=await page.waitForSelector('text=FlowMesh workers',{timeout:150000}).catch(()=>null);
  assert(!!card, 'DOM: "FlowMesh workers" entity card rendered inline');
  if(card){
    const txt=await page.evaluate(el=>{let n=el; for(let i=0;i<4&&n.parentElement;i++)n=n.parentElement; return n.textContent||'';}, card);
    console.log('  card text:', (txt||'').replace(/\s+/g,' ').slice(0,160));
    await page.screenshot({path:'/tmp/fmll-card.png'}).catch(()=>{});
    console.log('  screenshot: /tmp/fmll-card.png');
  } else {
    const body=await page.evaluate(()=>document.body.innerText.slice(0,500));
    console.log('  [no card] page text:', body.replace(/\s+/g,' ').slice(0,300));
    await page.screenshot({path:'/tmp/fmll-nocard.png'}).catch(()=>{});
  }
}catch(e){ console.log('ERROR', e.message); fails.push('exception'); }
await b.close();
console.log('=== RESULT:', fails.length?`${fails.length} FAIL`:'ALL PASS','===');
process.exit(fails.length?1:0);

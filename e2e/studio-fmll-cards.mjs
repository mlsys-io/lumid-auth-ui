import { chromium } from 'playwright';
const BASE='https://lum.id', PAT=process.env.ANTHROPIC_AUTH_TOKEN;
const fails=[]; const assert=(c,m)=>{console.log(`${c?'PASS':'FAIL'}  ${m}`); if(!c)fails.push(m);};
// REAL newlines (join), so the backend parses the YAML.
const echoYaml=['apiVersion: lumid/v1','kind: Task','metadata:','  name: e2e-echo','spec:','  taskType: echo','  data:','    type: list','    items:','      - "hi"'].join('\n');

const b=await chromium.launch({headless:true, channel:'chrome', args:['--no-sandbox','--disable-dev-shm-usage']});
const ctx=await b.newContext();
await ctx.route('**/api/v1/**', r=>r.continue({headers:{...r.request().headers(), authorization:`Bearer ${PAT}`}}));
await ctx.route('**/api/v1/cluster/clusters/selectable*', r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ret_code:0,data:{clusters:[]},clusters:[]})}));
await ctx.addInitScript(()=>{ try{localStorage.setItem('studio_chat_model_v1','claude-code-sonnet');}catch{} });

async function cardTest(label, prompt, titleText, ms=180000){
  const page=await ctx.newPage();
  try{
    await page.goto(`${BASE}/studio`,{waitUntil:'domcontentloaded',timeout:45000});
    await page.waitForSelector('textarea, [contenteditable="true"]',{timeout:30000}).catch(()=>{});
    await page.waitForTimeout(1500);
    await page.evaluate(p=>window.dispatchEvent(new CustomEvent('studio:ask',{detail:{prompt:p,autosend:true,model:'claude-code-sonnet'}})), prompt);
    const el=await page.waitForSelector(`text=${titleText}`,{timeout:ms}).catch(()=>null);
    assert(!!el, `${label}: "${titleText}" card rendered`);
    if(el){ const txt=await page.evaluate(e=>{let n=e;for(let i=0;i<4&&n.parentElement;i++)n=n.parentElement;return n.textContent||'';},el);
      console.log('   card:', (txt||'').replace(/\s+/g,' ').slice(0,160)); }
  }catch(e){ assert(false,`${label}: ${e.message}`); }
  await page.close();
}
await cardTest('optimize', `Call optimize_workflow with this exact workflow_yaml (use real newlines):\n\n${echoYaml}`, 'Workflow · HALO plan');
await cardTest('run_workflow', `Call run_workflow with this exact workflow_yaml (use real newlines):\n\n${echoYaml}`, 'Workflow run');
await b.close();
console.log('=== RESULT:', fails.length?`${fails.length} FAIL`:'ALL PASS','===');
process.exit(fails.length?1:0);

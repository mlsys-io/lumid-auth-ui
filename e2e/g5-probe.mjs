import { chromium } from 'playwright';
const b = await chromium.launch({ channel: 'chrome' });
const ctx = await b.newContext({ viewport:{width:1440,height:900},
  extraHTTPHeaders: { Authorization: `Bearer ${process.env.LUMID_PAT}` } });
const p = await ctx.newPage();
p.on('request', r => {
  if (r.url().includes('/me/agent/chat')) {
    let d = {}; try { d = JSON.parse(r.postData() || '{}'); } catch {}
    console.log('POST', r.url().split('/api/v1')[1], '| context:', JSON.stringify(d.context), '| tool_choice:', d.tool_choice);
  }
});
p.on('dialog', d => d.accept('It ignored private-label economics.'));
await p.goto('https://lum.id/studio/apps/mbb-consultant', { waitUntil:'domcontentloaded' });
await p.waitForTimeout(12000);
const composer = p.locator('textarea, [contenteditable="true"]').first();
await composer.fill("Let's work case Case_019_BetaOptics_PK21. Give me the opening.");
await composer.press('Enter');
await p.waitForTimeout(35000);
const btn = p.locator('button[title*="record a correction" i]').last();
console.log('correct button found:', await btn.count());
if (await btn.count()) { await btn.click(); await p.waitForTimeout(30000); }
await b.close();

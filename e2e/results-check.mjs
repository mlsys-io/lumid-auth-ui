import { chromium } from 'playwright';
import { launchBrowser } from './_browser.mjs';
const b = await launchBrowser(chromium);
const ctx = await b.newContext({ viewport:{width:1440,height:900},
  extraHTTPHeaders: { Authorization: `Bearer ${process.env.LUMID_PAT}` } });
const p = await ctx.newPage();
await p.goto('https://lum.id/studio/apps/mbb-consultant?surface=results', { waitUntil:'domcontentloaded' });
await p.waitForTimeout(12000);
const body = await p.locator('body').innerText();
const rows = await p.locator('table tbody tr').count();
// CSS uppercases stat labels, so innerText returns "TURNS SCORED".
// Was "turns recorded" until the Results surface started reading app_report
// instead of the raw run list -- the tile counts SCORED turns now, because an
// answered-but-unscored turn is not a scorecard row. Checking the old label
// reported the tile as missing while it rendered fine.
console.log('stat tile renders   :', /turns scored/i.test(body));
const statVal = (body.match(/(\d+)\s*\n?\s*TURNS SCORED/i) || [])[1];
console.log('stat value          :', statVal ?? '(not parsed)');
console.log('run rows            :', rows);
console.log('mode column present :', /Mode/.test(body));
const cells = await p.locator('table tbody td').allInnerTexts();
console.log('sample row          :', cells.slice(0,5).join(' | '));
const dashes = cells.filter(c=>c.trim()==='—').length;
console.log('cells / em-dashes   :', cells.length, '/', dashes);
await p.screenshot({ path:'/tmp/results.png' });
await b.close();

import { chromium } from 'playwright';
const b = await chromium.launch({ channel: 'chrome' });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 },
  extraHTTPHeaders: { Authorization: `Bearer ${process.env.LUMID_PAT}` } });
const p = await ctx.newPage();
const shot = async (name, url, wait = 11000, after) => {
  await p.goto(url, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(wait);
  if (after) await after(p);
  await p.screenshot({ path: `/tmp/ui-${name}.png`, fullPage: false });
  console.log(`shot ${name}`);
};
await shot('overview', 'https://lum.id/studio/apps/mbb-consultant');
await shot('environment', 'https://lum.id/studio/apps/mbb-consultant?surface=environment');
await shot('review', 'https://lum.id/studio/apps/mbb-consultant?surface=review');
await shot('workflows', 'https://lum.id/studio/apps/mbb-consultant?surface=workflows');
await shot('studio-home', 'https://lum.id/studio');
await b.close();

// Can a NON-ADMIN pick a site in the create dialog?
//
// The selector used to be `{isAdmin && ...}`, justified as "a non-admin has
// exactly one". nginx v67 made that false -- USER_SANDBOX_SITES is
// ["home","office"] -- so the gate hid the only control that reaches office's
// RTX 5080s. Admin-green proves nothing here: an admin always had 3 sites and
// always saw the picker. This drives a real role=user account.
//
// Asserts, in the order they would bite:
//   1. the picker EXISTS for a non-admin
//   2. it offers home AND office
//   3. it does NOT offer nus (admin-only, USER_GPU_QUOTA=0 -- offering a site
//      the caller cannot use is worse than hiding it)
//   4. selecting office actually sticks
import { chromium } from 'playwright';
import { launchBrowser } from './_browser.mjs';

const BASE = process.env.BASE || 'https://lum.id';
const EMAIL = process.env.SBX_USER || 'sandbox-tier-test@yao.lu';
const PW = process.env.SBX_PW || 'SbxTier!2026x';

const r = await fetch(`${BASE}/api/v1/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, password: PW }),
});
if (!r.ok) { console.log('LOGIN FAILED', r.status); process.exit(1); }
const cookie = (r.headers.getSetCookie?.() || []).map(c => c.split(';')[0]).join('; ');

const browser = await launchBrowser(chromium);
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.addCookies(cookie.split('; ').map(kv => {
  const [name, ...v] = kv.split('=');
  return { name, value: v.join('='), domain: 'lum.id', path: '/' };
}));
const p = await ctx.newPage();
await p.goto(BASE + '/studio/research-fleet/sandboxes', { waitUntil: 'domcontentloaded', timeout: 60000 });
await p.waitForTimeout(7000);

const fail = [];
const newBtn = p.getByRole('button', { name: /^New sandbox$/ });
if (!(await newBtn.count())) fail.push('no "New sandbox" button for a non-admin');
else {
  await newBtn.first().click();
  await p.waitForTimeout(1200);
  // The Site control is a <select> labelled "Site".
  const opts = await p.evaluate(() => {
    const sels = [...document.querySelectorAll('select')];
    for (const s of sels) {
      const label = s.closest('label')?.innerText || '';
      if (/site/i.test(label)) return [...s.options].map(o => o.value);
    }
    return null;
  });
  if (opts === null) fail.push('site picker NOT rendered for a non-admin (the bug)');
  else {
    if (!opts.includes('home')) fail.push(`site options missing home: ${JSON.stringify(opts)}`);
    if (!opts.includes('office')) fail.push(`site options missing office (v67 opened it): ${JSON.stringify(opts)}`);
    if (opts.includes('nus')) fail.push(`site options must NOT offer admin-only nus: ${JSON.stringify(opts)}`);
    console.log('site options offered to a non-admin:', JSON.stringify(opts));
    // 4: selecting office sticks
    const sel = p.locator('select').filter({ hasNot: p.locator('x') }).first();
    await p.evaluate(() => {
      const s = [...document.querySelectorAll('select')].find(x => /site/i.test(x.closest('label')?.innerText || ''));
      if (s) { s.value = 'office'; s.dispatchEvent(new Event('change', { bubbles: true })); }
    });
    await p.waitForTimeout(800);
    const body = await p.evaluate(() => document.body.innerText);
    if (!/New sandbox on office/i.test(body)) fail.push('selecting office did not take effect (dialog title unchanged)');
  }
}
await p.screenshot({ path: '/tmp/sbx-picker-nonadmin.png' }).catch(() => {});
await browser.close();
console.log(fail.length ? 'FAIL:\n  ' + fail.join('\n  ') : 'PASS — non-admin can pick home/office, nus correctly absent, office selection sticks');
process.exit(fail.length ? 1 : 0);

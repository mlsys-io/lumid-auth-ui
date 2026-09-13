// The canonical experiment, end to end, THROUGH THE BROWSER.
//
// Everything about analyst_local_gpu has so far been verified by curl and by
// reading state.json. That proves the data path; it does not prove a person can
// see the result. This session found three separate features that were built,
// deployed, and structurally unable to render — the Outputs tier chief among
// them — so "the API returns it" is explicitly not the bar.
//
// Run as a NON-OWNER by default. TESTING-UI.md records why: the owner path hid
// three defects behind a green suite.
//
//   set -a; . /proj/.env; set +a
//   LUMID_PAT="$NEW_FINDATA_SVC_PAT" node e2e/experiments-canonical.mjs   # non-owner
//   LUMID_PAT="$(cat ~/.lumid/admin.pat)" node e2e/experiments-canonical.mjs  # owner
import { chromium } from 'playwright';
import { launchBrowser } from './_browser.mjs';

const BASE = process.env.LUMID_BASE || 'https://lum.id';
const PAT = (process.env.LUMID_PAT || '').trim();
const APP = process.env.APP || 'mbb-consultant';
const EXP = process.env.EXP || 'analyst_local_gpu';
const WHO = process.env.WHO || 'owner';
if (!PAT) { console.error('set LUMID_PAT'); process.exit(2); }

const gates = [];
const gate = (id, ok, detail) => { gates.push({ id, ok, detail }); console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${id}  ${detail}`); };

const b = await launchBrowser(chromium);
const ctx = await b.newContext({ extraHTTPHeaders: { Authorization: `Bearer ${PAT}` } });
const page = await ctx.newPage();

// A 404 on /me/* is the signature of a surface bound to an endpoint that does
// not exist — exactly how the Outputs tier failed, silently, for months.
const api404 = [];
page.on('response', r => { const u = r.url(); if (u.includes('/api/v1/me/') && r.status() === 404) api404.push(u.replace(BASE, '')); });
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(String(e).slice(0, 160)));

try {
  // ── E1: the Experiments surface renders at all ──────────────────────
  const bodyText = () => page.evaluate(() => document.body.innerText);
  // Wait for the CONTENT, not a fixed interval. The surface header paints in
  // ~2s and the experiment list arrives several seconds later; a sleep long
  // enough today is a flake tomorrow, and a sleep too short reads as "the
  // feature is missing" — which is exactly how E2 failed on the first run.
  const waitForText = async (re, ms = 45000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const t = await bodyText();
      if (re.test(t)) return t;
      await page.waitForTimeout(1000);
    }
    return bodyText();
  };
  await page.goto(`${BASE}/studio/apps/${APP}?surface=experiments`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  let txt = await waitForText(new RegExp(EXP));
  gate('E1 surface renders', txt.length > 200, `${txt.length} chars of text`);

  // ── E2: the experiment is listed by id ──────────────────────────────
  // The panel humanises ids for display: analyst_local_gpu -> "analyst local gpu".
  // Asserting the raw id failed while the experiment was plainly on screen —
  // a wrong test, not a missing feature. Accept either spelling.
  const humanised = EXP.replace(/_/g, ' ');
  gate('E2 experiment listed', txt.includes(EXP) || txt.includes(humanised), `"${humanised}"`);

  // ── E3/E4/E5: RESULTS — owner sees them, non-owner must NOT ─────────
  //
  // The declaration ships in the published bundle and is shared; the RESULTS
  // are per-tenant. So the correct assertion inverts by role, and running only
  // the owner path would have proved nothing about isolation — which is the
  // whole reason TESTING-UI.md says to run as a non-owner by default.
  const hasVerdict = /gemma4_local/.test(txt) && /20\.4|20\.39|\+20/.test(txt);
  const hasArms = txt.includes('gemma4_local') && txt.includes('qwen7b_local');
  const hasN = /\b52 results\b/.test(txt);
  if (WHO === 'nonowner') {
    gate('E3 verdict NOT leaked', !hasVerdict, "another tenant's verdict must not render");
    gate('E4 arms NOT leaked', !hasArms, "another tenant's arms must not render");
    gate('E5 sample size NOT leaked', !hasN, "another tenant's n must not render");
  } else {
    gate('E3 verdict visible', hasVerdict, hasVerdict ? 'gemma4_local +20.4pp' : 'no verdict text found');
    gate('E4 both arms shown', hasArms, 'gemma4_local + qwen7b_local');
    gate('E5 sample size shown', hasN, 'n=52');
  }

  // ── E6: the incomparable neighbour still says so ────────────────────
  // judge_panel_parity IS incomparable (2 instruments). If the panel renders a
  // winner for it, the comparability guard is not reaching the screen — and a
  // guard that does not reach the screen is not a guard.
  // Scope the check to the parity BLOCK. The first version searched the whole
  // page for the raw id and matched it inside analyst_local_gpu's own
  // description ("the exact inverse of judge_panel_parity"), so it failed for a
  // reason that had nothing to do with what was rendered.
  const parityBlock = (() => {
    const i = txt.indexOf('judge panel parity');
    if (i < 0) return '';
    const j = txt.indexOf('analyst local gpu', i);
    return txt.slice(i, j > i ? j : i + 600);
  })();
  const parityHonest = parityBlock !== '' &&
    !/criteria met/i.test(parityBlock) && !/\bby \+?\d/.test(parityBlock);
  gate('E6 incomparable arm withheld', parityHonest,
    parityBlock ? 'parity block shows no winner' : 'parity experiment not rendered');

  // ── E7: the Outputs tier on the workflows surface ───────────────────
  await page.goto(`${BASE}/studio/apps/${APP}?surface=workflows`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  txt = await waitForText(/Outputs/i);
  gate('E7 Outputs tier present', /Outputs/i.test(txt), 'the tier renders its heading');

  // ── E8: no /me/* 404s and no page exceptions ────────────────────────
  gate('E8 no /me/* 404s', api404.length === 0, api404.slice(0, 3).join(' ') || 'none');
  gate('E9 no page exceptions', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | ') || 'none');

  await page.screenshot({ path: `/tmp/w5/experiments-${WHO}.png`, fullPage: true });
} catch (e) {
  gate('EX harness', false, String(e).slice(0, 200));
  await page.screenshot({ path: `/tmp/w5/experiments-${WHO}-fail.png`, fullPage: true }).catch(() => {});
} finally {
  await b.close();
}

const passed = gates.filter(g => g.ok).length;
console.log(`\n${WHO}: ${passed}/${gates.length} gates`);
process.exit(passed === gates.length ? 0 : 1);

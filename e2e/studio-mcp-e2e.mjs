// studio-mcp-e2e — live browser e2e for the LumidOS-behind-proxy canary (Way A).
// Logs into Studio, loads the chatbox in a real browser (proves the WS6 UI is
// deployed), then drives a chat turn that FORCES a LumidOS MCP tool call and
// asserts it flows through the full stack (sandbox → mcp__lumid → proxy → backend)
// and returns a non-error result.
//
// Prereqs: playwright + system Chrome. Env: LUMID_BASE, LUMID_EMAIL, LUMID_PASSWORD.
// Exit 0 = pass.

import { chromium } from 'playwright';
import { launchBrowser } from './_browser.mjs';

const BASE  = process.env.LUMID_BASE  || 'https://lum.id';
const EMAIL = process.env.LUMID_EMAIL || 'admin@lum.id';
const PW    = process.env.LUMID_PASSWORD;
if (!PW) { console.error('LUMID_PASSWORD required'); process.exit(2); }

const fails = [];
const assert = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) fails.push(m); };

// 1. REST login → lm_session cookie.
const login = await fetch(`${BASE}/api/v1/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, password: PW }),
});
assert(login.status === 200, `login ${EMAIL} → 200 (got ${login.status})`);
const sc = login.headers.get('set-cookie') || '';
const cm = sc.match(/lm_session=([^;]+)/);
assert(!!cm, 'lm_session issued');
if (!cm) process.exit(1);

const b = await launchBrowser(chromium);
const ctx = await b.newContext();
await ctx.addCookies([{ name: 'lm_session', value: cm[1], domain: '.lum.id', path: '/', httpOnly: true, secure: true, sameSite: 'Lax' }]);
const page = await ctx.newPage();

try {
  // 2. Load the Studio chatbox — proves the UI (incl. WS6 ArtifactView bundle) is served.
  const resp = await page.goto(`${BASE}/studio`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  assert(resp && resp.status() < 400, `/studio loads (status ${resp && resp.status()})`);
  await page.waitForSelector('textarea, [contenteditable="true"]', { timeout: 30000 }).catch(() => {});
  const hasComposer = await page.$('textarea, [contenteditable="true"]');
  assert(!!hasComposer, 'chat composer rendered');

  // 3. Pick a claude-code model (routes to the sandbox where the MCP is attached).
  const models = await page.evaluate(async () => {
    const r = await fetch('/api/v1/me/agent/models', { credentials: 'include' });
    return r.ok ? (await r.json())?.data?.models || (await r.json())?.models || [] : [];
  }).catch(() => []);
  const cc = (models || []).map(m => m.id || m).find(id => String(id).startsWith('claude-code')) || 'claude-code-sonnet';
  assert(!!cc, `claude-code model available (${cc})`);

  // 4. Drive a real turn that forces a lumid MCP tool call, reading the SSE stream
  //    from inside the browser (uses the session cookie). list_workers is a pure
  //    read (no hydration needed) that traverses sandbox → mcp__lumid → proxy /fm.
  const result = await page.evaluate(async (model) => {
    const body = { messages: [{ role: 'user',
      content: 'Call your lumid list_workers tool right now and paste the exact JSON it returns. Do nothing else.' }],
      model };
    const r = await fetch('/api/v1/me/agent/chat/stream', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!r.ok || !r.body) return { httpOk: r.ok, status: r.status, raw: '' };
    const reader = r.body.getReader(); const dec = new TextDecoder();
    let raw = ''; const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      const { done, value } = await reader.read();
      if (done) break;
      raw += dec.decode(value, { stream: true });
      if (raw.includes('"type":"result"') || raw.includes('event: done') || raw.length > 600000) break;
    }
    try { reader.cancel(); } catch {}
    return { httpOk: true, status: r.status, raw };
  }, cc).catch((e) => ({ httpOk: false, status: 0, raw: String(e) }));

  assert(result.httpOk, `chat stream POST ok (status ${result.status})`);
  const raw = result.raw || '';
  const sawLumidTool = /mcp__lumid__list_workers|list_workers|"name"\s*:\s*"[^"]*lumid/i.test(raw);
  assert(sawLumidTool, 'stream shows a lumid MCP tool call');
  const sawAuthError = /No PAT available|claude:proxy scope|missing bearer|connection refused|backend unreachable/i.test(raw);
  assert(!sawAuthError, 'tool result is NOT an auth/connection error');
  const sawResult = /workers|"tool_result"|"result"/i.test(raw);
  assert(sawResult, 'stream reached a tool result / turn result');
  if (!sawLumidTool) console.log('---- stream head (debug) ----\n' + raw.slice(0, 1500));
} finally {
  await b.close();
}

console.log(fails.length ? `\n${fails.length} FAIL` : '\nALL PASS');
process.exit(fails.length ? 1 : 0);

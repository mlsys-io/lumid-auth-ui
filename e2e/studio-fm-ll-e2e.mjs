// Studio chatbox → FlowMesh then Lumilake e2e.
//
// Runs the two compute pillars through the REAL chatbox stream, in order:
//   FM: the model calls submit_workflow to dispatch an inference "analyzer"
//       (summarize text) to the shared fleet; assert the tool fired + the
//       submission was accepted (a wfl- id came back). Fleet execution to DONE
//       + the produced summary is verified out-of-band via the proxy (the
//       chatbox safe surface has no status/result tool yet).
//   LL: the model calls optimize_workflow (Lumilake); assert the tool fired and
//       the call got PAST auth (no 401 / claude:proxy-scope error).
//
// Env: LUMID_BASE (default https://lum.id), LUMID_EMAIL, LUMID_PASSWORD.
// The FM DONE+summary check is printed by the companion kubectl step in the
// runbook; this script asserts the chatbox-driver behaviour end-to-end.

const BASE  = process.env.LUMID_BASE  || 'https://lum.id';
const EMAIL = process.env.LUMID_EMAIL || 'admin@lum.id';
const PW    = process.env.LUMID_PASSWORD;
if (!PW) { console.error('LUMID_PASSWORD required'); process.exit(2); }

const fails = [];
const assert = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fails.push(msg); };

const login = await fetch(`${BASE}/api/v1/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, password: PW }),
});
assert(login.status === 200, `login → 200 (got ${login.status})`);
const cookie = (login.headers.get('set-cookie') || '').match(/lm_session=([^;]+)/)[1];

function assemble(raw) {
  let t = '';
  for (let l of raw.split('\n')) {
    l = l.replace(/^data: /, '');
    if (!l.startsWith('{')) continue;
    try { const o = JSON.parse(l); if (o.type === 'text') t += (o.delta || o.text || ''); } catch {}
  }
  return t;
}
async function turn(prompt, ms) {
  const r = await fetch(`${BASE}/api/v1/me/agent/chat/stream`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Cookie': `lm_session=${cookie}` },
    body: JSON.stringify({ model: 'claude-code-sonnet', messages: [{ role: 'user', content: prompt }] }),
  });
  const rd = r.body.getReader(), dec = new TextDecoder(); let raw = ''; const dl = Date.now() + ms;
  while (Date.now() < dl) { const { done, value } = await rd.read(); if (done) break; raw += dec.decode(value, { stream: true }); if (raw.includes('"type":"done"')) break; }
  try { rd.cancel(); } catch {}
  const tools = [...raw.matchAll(/"name":"(mcp__lumid__[a-z_]+)"/g)].map((m) => m[1]);
  return { tools: [...new Set(tools)], text: assemble(raw), raw };
}

// ── FM: submit an inference analyzer (exact YAML so submission is deterministic) ──
const fmYaml = [
  'apiVersion: lumid/v1', 'kind: Task', 'metadata:', '  name: e2e-analyzer', 'spec:',
  '  taskType: inference',
  '  model:', '    source:', '      type: huggingface', '      identifier: Qwen/Qwen2.5-0.5B-Instruct',
  '  data:', '    type: list', '    items:',
  '      - "Summarize in one short sentence: The report shows revenue up 12 percent on cloud growth."',
  '  inference:', '    temperature: 0.2', '    max_tokens: 96',
  '  resources:', '    hardware:', '      gpu:', '        count: 1',
].join('\\n');

const fm = await turn(
  `Submit this exact FlowMesh workflow with the submit_workflow tool (pass it verbatim as the workflow_yaml), then tell me the workflow_id you got back:\n\n${fmYaml.replace(/\\n/g, '\n')}`,
  200000,
);
assert(fm.tools.includes('mcp__lumid__submit_workflow'), `FM: submit_workflow tool invoked (saw: ${fm.tools.join(',') || 'none'})`);
assert(/wfl-[0-9a-f]/.test(fm.raw), 'FM: submission accepted — a wfl- workflow id came back');

// ── LL: optimize (Lumilake) — must fire, get past auth, AND optimize ──
// Pass a VALID Lumilake workflow verbatim. `echo` is NOT a Lumilake op (that's a
// FlowMesh task type) — using it makes the optimizer return a *validation* error
// that the auth regex below misreads. A single LLMChatOp with config.model is the
// smallest workflow HALO will actually schedule.
const llYaml = [
  'name: opt-demo',
  'inputs:',
  '  Q: ["hello"]',
  'ops:',
  '  - id: reply',
  '    op: LLMChatOp',
  '    inputs: [Q]',
  '    config:',
  '      model: Qwen/Qwen3-8B',
  '    messages:',
  '      - role: user',
  '        content: "{q}"',
].join('\\n');

const ll = await turn(
  `Use the optimize_workflow tool on this EXACT Lumilake YAML (pass it verbatim as the workflow), then report the raw result:\n\n${llYaml.replace(/\\n/g, '\n')}`,
  180000,
);
assert(ll.tools.includes('mcp__lumid__optimize_workflow'), `LL: optimize_workflow tool invoked (saw: ${ll.tools.join(',') || 'none'})`);
const llAuthErr = /401|unauthor|claude:proxy scope|missing bearer/i.test(ll.raw);
assert(!llAuthErr, 'LL: optimize_workflow got PAST auth (no 401 / scope error)');
assert(/selected_workers|worker_assignment|"ok":\s*true|request_id/.test(ll.raw), 'LL: optimizer returned a schedule (past validation too)');

console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS');
process.exit(fails.length ? 1 : 0);

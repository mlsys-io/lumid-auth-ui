// Broad chatbox capability matrix — exercises every pillar shipped this session.
// BATCH=fast  → attachments + XP + data + FlowMesh read/echo + invalid + Lumilake
// BATCH=slow  → inference summarizer (fleet LLM) + cluster-scoped routing
// Env: LUMID_PASSWORD (admin), optional LUMID_BASE. Fixtures in $SCR.
import fs from 'fs';
const BASE = process.env.LUMID_BASE || 'https://lum.id';
const PW = process.env.LUMID_PASSWORD;
const SCR = process.env.SCR;
const BATCH = process.env.BATCH || 'fast';
if (!PW || !SCR) { console.error('need LUMID_PASSWORD + SCR'); process.exit(2); }
const PDF = fs.readFileSync(`${SCR}/sentinel.b64`, 'utf8').trim();     // contains ZORPTANGLE_9137
const PX = fs.readFileSync(`${SCR}/px.b64`, 'utf8').trim();            // 1x1 png
const BAD = fs.readFileSync(`${SCR}/bad.b64`, 'utf8').trim();          // corrupted pdf

const login = await fetch(`${BASE}/api/v1/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@lum.id', password: PW }) });
const cookie = (login.headers.get('set-cookie') || '').match(/lm_session=([^;]+)/)[1];

function asm(raw) { let t = ''; for (let l of raw.split('\n')) { l = l.replace(/^data: /, ''); if (!l.startsWith('{')) continue; try { const o = JSON.parse(l); if (o.type === 'text') t += (o.delta || o.text || ''); } catch {} } return t; }
async function turn(msg, ms, extra = {}) {
  const body = { model: 'claude-code-sonnet', messages: [msg], ...extra };
  const r = await fetch(`${BASE}/api/v1/me/agent/chat/stream`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Cookie': `lm_session=${cookie}` }, body: JSON.stringify(body) });
  const rd = r.body.getReader(), dec = new TextDecoder(); let raw = ''; const dl = Date.now() + ms;
  while (Date.now() < dl) { const { done, value } = await rd.read(); if (done) break; raw += dec.decode(value, { stream: true }); if (raw.includes('"type":"done"')) break; }
  try { rd.cancel(); } catch {}
  const tools = [...new Set([...raw.matchAll(/"name":"(mcp__lumid__[a-z_]+)"/g)].map((m) => m[1]))];
  return { raw, text: asm(raw), tools, validationErr: /validation error|valid dict|received as str/i.test(raw) };
}
const results = [];
const check = (name, cond, detail = '') => { results.push({ name, pass: !!cond, detail }); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); };
const doc = (txt, ...atts) => ({ role: 'user', content: txt, attachments: atts });
const pdfAtt = (b64) => ({ kind: 'document', name: 's.pdf', mime: 'application/pdf', data_b64: b64 });

if (BATCH === 'fast') {
  // A. Attachments
  let t = await turn(doc('The attached PDF has a codeword. Reply ONLY the codeword.', pdfAtt(PDF)), 150000);
  check('PDF summarize (claude-code path) sees content', t.text.includes('ZORPTANGLE'), t.text.slice(0, 40));
  t = await turn({ ...doc('Codeword in the attached PDF? Reply ONLY the word.', pdfAtt(PDF)), }, 120000, { model: 'kvrun-gemma4' });
  check('PDF via mesh (gemma) sees content', t.text.includes('ZORPTANGLE'), t.text.slice(0, 40));
  t = await turn(doc('What text is in the attached file? Reply ONLY it.', { kind: 'text', name: 'n.txt', text: 'TEXTSENTINEL_555' }), 120000);
  check('Text attachment inlined', t.text.includes('TEXTSENTINEL_555'), t.text.slice(0, 40));
  t = await turn(doc('Describe the attached image.', { kind: 'image', name: 'p.png', mime: 'image/png', data_b64: PX }), 120000);
  check('Image on claude-code → graceful breadcrumb (no crash)', !t.validationErr && t.text.length > 0, t.text.slice(0, 50));
  t = await turn(doc('Summarize the attached PDF.', pdfAtt(BAD)), 120000);
  check('Corrupted PDF → graceful (no crash, model responds)', !t.validationErr && t.text.length > 0, t.text.slice(0, 50));

  // B. FlowMesh read + echo + invalid
  t = await turn({ role: 'user', content: 'Call list_workers and reply with just the integer worker count.' }, 120000);
  check('list_workers returns real fleet (>=10)', /\b(1[0-9]|[2-9][0-9])\b/.test(t.text) && !/\b0 workers\b/i.test(t.text), t.text.slice(-60));
  const echoY = `apiVersion: lumid/v1\nkind: Task\nmetadata: {name: b}\nspec:\n  taskType: echo\n  data: {type: list, items: ["broad-echo"]}`;
  t = await turn({ role: 'user', content: 'Call run_workflow with this and report status:\n\n' + echoY }, 150000);
  check('run_workflow echo → DONE (no validation err)', !t.validationErr && /DONE/i.test(t.raw), t.text.slice(-70));
  t = await turn({ role: 'user', content: 'Call run_workflow with this clearly-invalid workflow and tell me what happened:\n\nnot: valid\nflowmesh: {{{' }, 120000);
  check('invalid workflow → graceful error (no crash)', !t.validationErr && t.text.length > 0, t.text.slice(-60));

  // C. XP knowledge
  t = await turn({ role: 'user', content: 'Call xp_status and tell me how many knowledge agents exist.' }, 90000);
  check('xp_status responds (no validation err)', !t.validationErr && t.text.length > 0, t.text.slice(-60));
  // D. lumid-data
  t = await turn({ role: 'user', content: 'Call data_apps and list the available data apps.' }, 90000);
  check('data_apps responds (no validation err)', !t.validationErr && t.text.length > 0, t.text.slice(-60));
  // E. Lumilake (known-limited; assert reaches + no crash)
  t = await turn({ role: 'user', content: 'Call optimize_workflow on a 2-stage echo workflow and report the outcome.' }, 120000);
  check('Lumilake optimize reached (no 401/scope; honest outcome)', t.tools.includes('mcp__lumid__optimize_workflow') && !/401|claude:proxy scope/i.test(t.raw), t.text.slice(-70));
}

if (BATCH === 'slow') {
  const infY = `apiVersion: lumid/v1
kind: Task
metadata: {name: sum}
spec:
  taskType: inference
  model: {source: {type: huggingface, identifier: Qwen/Qwen2.5-0.5B-Instruct}}
  data: {type: list, items: ["Summarize in one sentence: Q3 revenue rose 12 percent on cloud growth, margins stable."]}
  inference: {temperature: 0.2, max_tokens: 80}
  resources: {hardware: {gpu: {count: 1}}}`;
  let t = await turn({ role: 'user', content: 'Use run_workflow to run this fleet inference analyzer, wait, and give the exact summary:\n\n' + infY }, 300000);
  check('FM inference summarizer → DONE + summary text', !t.validationErr && /DONE/i.test(t.raw) && /revenue|cloud|margin/i.test(t.text), t.text.slice(-120));
  // cluster-scoped: send cluster_id → routes to /fm/c/<id>
  t = await turn({ role: 'user', content: 'Call list_workers and reply with just the worker count.' }, 120000, { cluster_id: 'c73424c8-3a74-2dd6-3bb6-ec550056724f' });
  check('cluster-scoped list_workers routes (no 404/error)', !t.validationErr && !/404|no flowmesh server/i.test(t.raw) && t.text.length > 0, t.text.slice(-60));
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${BATCH.toUpperCase()}: ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);

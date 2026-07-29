# Example FlowMesh (fm) & Lumilake (ll) queries

Practical, **verified** examples for driving the two compute pillars — FlowMesh (GPU/CPU task
execution) and Lumilake (HALO workflow optimizer + runner) — three ways:

1. **Studio chatbox** (natural language → MCP tools) — Way A (sandbox) and Way B (BYO Claude Code via `lum.id/mcp`).
2. **MCP tools** directly (the `_SAFE_TOOLS` surface exposed to the agent).
3. **Raw HTTP** through the `claude-proxy` gateway (`/fm`, `/ll`).

> All examples below were exercised end-to-end on 2026-07-29. Substitute a real `lm_pat_live_*`
> PAT where shown. The proxy injects the **operator token** for bare `/fm` and `/ll`, so a normal
> user PAT is enough to reach the shared fleet.

---

## The surface

| Pillar | Proxy base | Cluster-scoped | MCP tools |
|---|---|---|---|
| FlowMesh | `https://lum.id/fm` → FM Host `/api/v1/*` | `https://lum.id/fm/c/<cluster_id>/…` | `list_workers`, `submit_workflow`, `workflow_status` |
| Lumilake | `https://lum.id/ll` → Lumilake `/api/v1/*` | — | `optimize_workflow`, `run_workflow`, `lumilake_workflow_schema`, `lumilake_node_specs` |

Auth: `Authorization: Bearer <lm_pat_live_…>`. The chatbox/MCP path carries the session identity
automatically — you don't pass a token in a prompt.

---

## FlowMesh

### Chatbox (natural language)
- "List the FlowMesh workers and their status."
- "How many GPU workers are online right now?"
- "Submit an echo job with the items `["hello","world"]` and show me the result."
- "Run a TinyLlama inference job on the GPU fleet and report the output."
- "What's the status of workflow `<id>`?"

### MCP tools
```jsonc
// list_workers  → the live fleet (registry + FM Host execution view)
list_workers()

// submit_workflow → dispatch a workflow; returns a workflow/job id
submit_workflow(workflow_yaml="<yaml>")

// workflow_status → poll a running/finished job
workflow_status(workflow_id="<id>")
```

### Raw HTTP (verified)
```bash
PAT=lm_pat_live_xxx

# Health
curl -s https://lum.id/fm/healthz          # -> {"ok":true}

# List workers
curl -s https://lum.id/fm/api/v1/workers -H "Authorization: Bearer $PAT"
#   -> 200, JSON array of workers (id, status, gpu, node, …)
```

FlowMesh **echo** task shape (note: `data.type: list` + `data.items`, NOT `data.messages`):
```yaml
name: echo-smoke
stages:
  - name: say
    taskType: echo
    target: local
    data:
      type: list
      items: ["hello", "world"]
```

For an **API** task calling an external HTTP endpoint, set `response.parse_json: false` when the
response isn't LLM-usage JSON (e.g. a trade/data payload).

---

## Lumilake

Lumilake runs a **Lumilake-native workflow**: `name` + `inputs` (map of name → list of values) +
`ops[]`, where each op has `id`, `op` (op type), and `inputs[]` (each entry references either
another op's `id` — an upstream edge — or a top-level input name). Op catalog: `DataRetrievalOp`,
`FormatOp`, `LambdaOp`, `LLMChatOp`, `LLMVisionOp`, `ImageGenerationOp`, `MessageOp`, `InputOp`,
`OutputOp`. Ask the agent for `lumilake_node_specs()` / `lumilake_workflow_schema()` for the full
field-by-field contract.

### Chatbox (natural language)
- "Compose a Lumilake workflow that reads NVDA daily OHLC and summarizes the trend, then optimize it."
- "Optimize this workflow and show me the HALO worker assignment." (paste/attach the YAML)
- "Run this workflow and give me the output text."
- "What ops can I use in a Lumilake workflow, and what fields does `LLMChatOp` need?"

A successful `optimize_workflow` / `run_workflow` also pops the **workflow DAG side panel** in Studio
(React-Flow graph, HALO worker badges) — see `lumid_ui` `StudioWorkflowPanel`.

### MCP tools
```jsonc
// lumilake_workflow_schema()  → the YAML contract + a minimal worked example
// lumilake_node_specs()       → the op catalog with each op's required fields
// optimize_workflow(workflow_yaml=..., inputs=?) → HALO plan (no execution)
// run_workflow(workflow_yaml=..., inputs=?)      → submit→wait→result (lean outputs)
// workflow_status(workflow_id=...)
```
`optimize_workflow` **plans only** (worker assignment) — it does NOT execute the ops, so it's fast
and safe even when an LLM op's backend is offline. `run_workflow` auto-adds
`output: {destination: {type: http}}` so `/results` is retrievable, and returns lean text.

### Raw HTTP — HALO optimize (verified)
`POST /ll/api/v1/jobs/preview` needs the **`Workflow-Format: yaml`** header, a **non-empty
`inputs`**, and the native workflow under `data[]`:
```bash
PAT=lm_pat_live_xxx
curl -s https://lum.id/ll/api/v1/jobs/preview \
  -H "Authorization: Bearer $PAT" \
  -H 'Content-Type: application/json' \
  -H 'Workflow-Format: yaml' \
  -d '{"data":[{"workflow":"'"$(cat hello-world.yaml | sed 's/"/\\"/g')"'","inputs":{"Name":["World"]}}]}'
```
Returns the HALO plan, e.g. (real output, hello-world → 1 op):
```json
{ "selected_workers": ["wkr-1"],
  "worker_assignment": { "wkr-1": ["graph_0_ed837ef0__llm_graph_0_Reply_38"] },
  "merged_runtime_node_count": 1,
  "optimization_seconds": 0.00056 }
```

### Minimal native workflow (`hello-world.yaml`)
```yaml
name: hello-world
inputs:
  Name: ["world"]           # one greeting per slice
ops:
  - id: Greeting
    op: FormatOp
    inputs: [Name]
    template: "Hello, {Name}!"
  - id: Reply
    op: LLMChatOp
    inputs: [Greeting]
    model: nvidia/Gemma-4-26B-A4B-NVFP4   # full gateway id — see gotcha
    prompt: "Acknowledge this greeting in one short sentence: {Greeting}"
  - id: out
    op: OutputOp
    inputs: [Reply]
```

---

## Gotchas (learned the hard way)

- **LLM model IDs are the FULL gateway keys**, not friendly short names. Use
  `nvidia/Gemma-4-26B-A4B-NVFP4`, `qwen3.6-27b`, `qwen3.6-35b-a3b` — **NOT** `gemma`. Unknown ids
  fall through to the OpenRouter catch-all and 502 ("upstream LLM unreachable"). See the
  `lumid-llm-mesh` notes.
- **Lumilake preview requires** the `Workflow-Format: yaml` header **and** a non-empty `inputs`
  block — a missing header or empty inputs → `422 inputs is required`.
- **`optimize_workflow` never runs the ops** — it only produces the HALO worker plan. Use it to
  validate a composed workflow cheaply; use `run_workflow` to actually execute.
- **FlowMesh registry vs execution** can drift — `list_workers` shows the registry (what enrolled +
  last heartbeated), which is not the same as FM Host's live execution view. A worker can read
  `IDLE`/`starting` in one and not the other; see `RUNBOOK.md`.
- **`/fm` and `/ll` bare paths** get the operator token injected by the proxy — a plain user PAT
  reaches the shared fleet. For a specific cluster, use `/fm/c/<cluster_id>/…`.

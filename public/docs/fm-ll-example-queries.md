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

| Pillar | Proxy base | Site-scoped | MCP tools |
|---|---|---|---|
| FlowMesh | `https://lum.id/fm` → **federated** `/api/v1/*` | `https://lum.id/fm/<site>/…` | `list_workers`, `submit_workflow`, `workflow_status` |
| Lumilake | `https://lum.id/ll` → **federated** `/api/v1/*` | `https://lum.id/ll/<site>/…` | `optimize_workflow`, `run_workflow`, `lumilake_workflow_schema`, `lumilake_node_specs` |

Auth: `Authorization: Bearer <lm_pat_live_…>`. The chatbox/MCP path carries the session identity
automatically — you don't pass a token in a prompt. **One PAT works on all three sites** — you never
need a per-site mesh key.

### Federated since 2026-08-20 — the list endpoints changed shape

`/fm` and `/ll` used to proxy only to the **cloud** control plane, so they reported 1 FlowMesh node
and 0 Lumilake workers while the on-prem meshes had the rest. They now fan out to **all three sites**
— `cloud`, `home`, `office` — and merge.

The list endpoints still return a **JSON array** — the same contract as before, just merged across
all sites, with each record carrying an extra `site` field. Existing callers keep working unchanged
and simply see more.

Per-site status comes back in a response header, so nothing is lost:

```
X-Mesh-Sites: cloud=1,home=9,office=5
X-Mesh-Sites: cloud=0,home=5,office=error(HTTP 401)     # a failing site is named, not hidden
```

Read that header before trusting a count: it is what distinguishes **"office is unreachable"** from
**"office has no workers"** — a distinction the old single-upstream view could not express.

If you would rather have it structured, `?shape=full` returns an object instead:

```jsonc
{
  "items": [ { "...": "...", "site": "home" } ],
  "sites": [ { "site": "home", "ok": true, "count": 9, "ms": 408 } ]
}
```

Federated today: `fm/api/v1/nodes`, `fm/api/v1/workers`, `ll/api/v1/workers`, **and per-worker
retrieve** `GET /api/v1/workers/{id}` (added 2026-08-25 — see below). **Everything else — notably
`POST /api/v1/workflows` (submit) — is proxied verbatim to the cloud and is unchanged.**

#### Per-worker retrieve fans out too (2026-08-25)

Listing workers across all sites was useless if you couldn't then retrieve one — and the retrieve
path proxied to the cloud, which has **zero** workers, so `GET /api/v1/workers/{id}` 404'd for every
on-prem worker. That was the root cause of Lumilake jobs sticking in "running" forever: the
scheduler listed 28 workers then 404'd on every profile fetch. Retrieve now fans out across all three
sites and returns the first site that has the worker, tagged with which site answered:

```bash
curl -si https://lum.id/fm/api/v1/workers/wkr-30 -H "Authorization: Bearer $PAT"
#   -> 200, X-Worker-Site: office
curl -si https://lum.id/fm/api/v1/workers/wkr-6  -H "Authorization: Bearer $PAT"
#   -> 200, X-Worker-Site: home
curl -s https://lum.id/fm/api/v1/workers/wkr-nonexistent -H "Authorization: Bearer $PAT"
#   -> 404
```

Worker ids are globally unique (`wkr-NNN`), so the first site that answers is the owning site.
Lumilake's orchestrator is pointed at the populated **office** site (`/fm/office`) so list +
retrieve + submit all reach a mesh that actually has workers.

### Picking a site

```bash
# All sites (default)
curl -s https://lum.id/fm/api/v1/nodes -H "Authorization: Bearer $PAT"
#   -> 15 items: cloud 1, home 9, office 5

# Narrow the fan-out — SAME response shape, so callers don't branch
curl -s "https://lum.id/fm/api/v1/nodes?site=home"          # -> 9
curl -s "https://lum.id/fm/api/v1/nodes?site=home,office"   # -> 14

# Talk to ONE mesh directly — works for EVERY endpoint, not just the lists,
# and returns that mesh's native shape (a bare array here)
curl -s https://lum.id/fm/home/api/v1/nodes    -H "Authorization: Bearer $PAT"   # -> 9
curl -s https://lum.id/ll/office/api/v1/workers -H "Authorization: Bearer $PAT"  # -> 8
```

Use `?site=` when you want the federated shape with fewer sites. Use `/fm/<site>/…` when you want to
*operate* on one mesh — inspect a node, or reach an endpoint the federator does not merge.

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

# List workers — FEDERATED, still a JSON array; each record gains a "site" field
curl -si https://lum.id/fm/api/v1/workers -H "Authorization: Bearer $PAT"
#   -> 200, [ …13 workers… ]   header: X-Mesh-Sites: cloud=0,home=5,office=8
#
# Nodes and workers are DIFFERENT lists on FlowMesh — nodes is 15 (cloud 1, home 9,
# office 5), workers is 13. Pick the one you actually mean.
curl -s https://lum.id/fm/api/v1/nodes -H "Authorization: Bearer $PAT"

# One site, native shape (bare array)
curl -s https://lum.id/fm/home/api/v1/workers -H "Authorization: Bearer $PAT"   # -> 5
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
another op's `id` — an upstream edge — or a top-level input name). Op catalog (deployed v0.1.3):
`DataOp`, `DataRetrievalOp`, `EmbeddingOp`, `FormatOp`, `ImageGenerationOp`, `LLMChatOp`,
`LLMVisionOp`, `LambdaOp`, `MessageOp`. **There is no `InputOp`/`OutputOp`** — inputs are the
top-level `inputs:` map, and outputs are captured by the job's `output_location` (not an op). Ask
the agent for `lumilake_node_specs()` / `lumilake_workflow_schema()` for the full field-by-field
contract.

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
// optimize_workflow(workflow_yaml=..., inputs=?)                 → HALO plan (no execution)
// run_lumilake_job(workflow_yaml=..., inputs=?, output_location=?) → submit→wait→result
// lumilake_job_status(job_id=...) / lumilake_job_result(job_id=...)
```
`optimize_workflow` **plans only** (worker assignment) — it does NOT execute the ops, so it's fast
and safe even when an LLM op's backend is offline. `run_lumilake_job` executes on the fleet;
`output_location` defaults to an S3 prefix and MUST be `{type: s3, prefix: …}` or
`{type: db, table, column}` (the deployed server rejects `inline`/`http`).
(Note: the FlowMesh-native `run_workflow` tool is a *different* tool — it runs FlowMesh task specs,
not Lumilake-native `ops` workflows.)

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
outputs:                    # REQUIRED — no top-level outputs -> job fails "Missing output"
  - name: reply
    ref: "Reply"            # ref = the id of the op whose result is the output
ops:
  - id: Greeting
    op: FormatOp
    inputs: [Name]
    template: "Hello, {Name}!"
    format_kwargs: {Name: Name}
  - id: Reply
    op: LLMChatOp
    inputs: [Greeting]
    messages:                                  # REQUIRED — LLMChatOp takes `messages`, not `prompt`
      - {role: user, content: "Acknowledge this greeting in one short sentence: {Greeting}"}
    config: {model: Qwen/Qwen2.5-7B-Instruct, max_tokens: 64, temperature: 0.2}  # HuggingFace id — see gotcha
# No OutputOp / InputOp ops — declare a top-level `outputs:` block instead. On run,
# capture via the job's output_location — {type: s3, prefix: ...} or {type: db, table, column}.
```

---

## Gotchas (learned the hard way)

- **Two different model-id namespaces — don't mix them.** For the **lumid-llm mesh** (OpenAI-compat
  gateway, `/fm` chat paths) use the FULL gateway keys. `GET /llm/v1/models` is the live list —
  read it rather than trusting any doc, this one included. As of **2026-09-01** it is exactly two:
  `deepseek-v4-flash` (the **default**, in-house multi-tier GB10+s0 CPU ladder, free at the
  margin) and `qwen3.8-27b` (in-house on luyao1's RTX 5090, tier=0, OpenRouter as bounded
  overflow only). `kimi-k3` is **not currently configured** (older notes named it; verify against
  `GET /llm/v1/models` rather than trusting that). Every `qwen3.6-*`/`qwen-2.5-*`/etc identity-
  mapped id and `glm-5.3-flash` were purged the same day this line was corrected —
  `qwen3.6-27b` was the OpenRouter cost-abuse finding that triggered the purge (102 of 147
  requests in one window from role=user), and every other purged id carried the same shape of
  exposure without having been exploited yet.
  **An unknown id does not 502 — it falls through to the OpenRouter catch-all and is BILLED.**
  Verified 2026-08-21: `z-ai/glm-5.2` is not in `LUMID_LLM_BACKENDS` and still returns 200, served
  and metered via OpenRouter — but as of the 2026-09-01 purge, any id purged from
  `LUMID_LLM_OPENROUTER_MODEL_MAP` (including `glm-5.3-flash` and every `qwen3.6-*` id) now
  correctly gets `lumid-llm`'s own 503 instead, per the fix (`llm-0d342a8`) this note already
  describes below for `deepseek-v4-flash`'s pinned behavior. So a typo'd or stale model id fails
  *loudly* now for anything actually purged, not just for deepseek. The one remaining silent-bill
  risk is an id that is genuinely still in the OpenRouter map but a caller no longer means to use.
  For a **Lumilake `LLMChatOp`** use a **HuggingFace id** (`Qwen/Qwen2.5-7B-Instruct`,
  `Qwen/Qwen2.5-0.5B-Instruct`): Lumilake runs the op as a FlowMesh **vLLM** inference task that
  loads the model from HF, so a mesh alias like `deepseek-v4-flash` raises `not a valid model
  identifier on huggingface.co` and the task fails.
- **Lumilake workflows need a top-level `outputs:` block** (`- name: <label>, ref: <op-id>`) — with
  no outputs declared the job runs the ops then fails `Missing output for workflow`.
- **Lumilake preview requires** the `Workflow-Format: yaml` header **and** a non-empty `inputs`
  block — a missing header or empty inputs → `422 inputs is required`.
- **Lumilake op contract (deployed v0.1.3, verified 2026-08-03)** — no `InputOp`/`OutputOp`;
  `LLMChatOp` needs `messages` + `config.model` (NOT `prompt` / top-level `model`); and a run's
  `output_location` must be `{type: s3, prefix: …}` or `{type: db, table, column}` (`inline`/`http`
  → 422). The older op shape in stale docs/specs will 422 — always author from
  `lumilake_node_specs()`.
- **`optimize_workflow` never runs the ops** — it only produces the HALO worker plan. Use it to
  validate a composed workflow cheaply; use `run_workflow` to actually execute.
- **FlowMesh registry vs execution** can drift — `list_workers` shows the registry (what enrolled +
  last heartbeated), which is not the same as FM Host's live execution view. A worker can read
  `IDLE`/`starting` in one and not the other; see `RUNBOOK.md`.
- **`/fm` and `/ll` bare paths** get the operator token injected by the proxy — a plain user PAT
  reaches the shared fleet. For a specific cluster, use `/fm/c/<cluster_id>/…`.

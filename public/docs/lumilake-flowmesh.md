# Compute: Lumilake + FlowMesh

**(Admin+)** How work reaches a GPU on this stack — what the two compute pillars
own, how you reach them, how a Lumilake workflow is authored, planned and
executed, and what breaks along the way. The worked example is `vla-curation`, a
demo that turns raw robot episodes into a VLA training manifest, but the
contract in §4–§6 applies to any workflow you write.

The raw `/fm` and `/ll` endpoints on this page are **admin-only at the edge**.
§2 has the read path a normal user gets instead.

Measured on the live office lane on 2026-09-18; the surface, auth and job-status
sections re-verified 2026-09-20. Where a thing is unverified, it says so.

---

## 1. What the integration is

One run crosses four systems, and each owns exactly one thing:

| stage | component | owns |
|---|---|---|
| storage | **lumid-data** | the rows (Postgres) and the blobs (S3) |
| planning | **Lumilake** | the logical graph, HALO optimisation, worker selection |
| execution | **FlowMesh** | dispatching tasks to GPU workers and running them |
| identity | **lum.id** | who may submit, and to which object prefix |

The important consequence: **a workflow file contains no addresses.** The data
endpoint and bearer come from the *Lumilake server's* environment
(`LUMID_DATA_URL`, `LUMID_DATA_TOKEN`, and the worker's own
`LUMID_DATA_WORKER_URL`). Re-pointing a workflow at a different data instance is
a deployment change, never a workflow edit.

## 2. Reaching the fleet

| Pillar | Proxy base | Site-scoped | MCP tools |
|---|---|---|---|
| FlowMesh | `https://lum.id/fm` → **federated** `/api/v1/*` | `https://lum.id/fm/<site>/…` | `list_workers`, `submit_workflow`, `workflow_status`, `run_workflow` |
| Lumilake | `https://lum.id/ll` → **federated** `/api/v1/*` | `https://lum.id/ll/<site>/…` | `optimize_workflow`, **`run_lumilake_job`**, `lumilake_job_status`, `lumilake_job_result`, `lumilake_workflow_schema`, `lumilake_node_specs` |

> **`run_workflow` is the FlowMesh tool, not the Lumilake one.** It runs
> FlowMesh task specs. The Lumilake executor is **`run_lumilake_job`**. Older
> notes list `run_workflow` under Lumilake and tell you to use it to execute a
> native `ops` workflow; that call will not run your workflow.

`optimize_workflow` **plans only** — it produces the HALO worker assignment and
does not execute the ops, so it is fast and safe even when an LLM op's backend
is offline. `run_lumilake_job` submits, waits and returns the result.
`output_location` must be `{type: s3, prefix: …}` or `{type: db, table, column}`;
the deployed server rejects `inline` and `http` with a 422.

### Auth: `/fm` and `/ll` are admin-only

A personal `lm_pat_live_*` belonging to a non-admin gets **403** on both
`GET /ll/api/v1/workers` and `GET /fm/api/v1/workers`. The whole `/ll/api/v1/*`
prefix sits behind `auth_request /internal_admin_check` at the edge, and `/fm`
is gated the same way. `GET /fm/healthz` and `GET /ll/healthz` stay anonymous.

That prefix previously answered **anonymously** — `GET /ll/api/v1/workers`
returned the fleet inventory (hostnames, cores, RAM, GPUs, cached models) to any
caller with no credential — and closing that in 2026-09-12 took the whole prefix
with it. Earlier notes claimed the proxy injects an operator token for bare
`/fm` and `/ll` so a normal user PAT reaches the shared fleet. **It does not.**
Every raw-HTTP example below needs an admin credential.

One credential covers all three sites — there is no per-site mesh key. It just
has to be an admin one.

### The read path a normal user has

Identity (v0.5.399) exposes a per-caller view of compute jobs that needs no
admin role:

| endpoint | returns |
|---|---|
| `GET /me/compute/jobs/:site/:job_id` | that job's status, gated per caller |
| `GET /me/compute/jobs/:site/:job_id/siblings` | the run's other arms, each with its `arm` label and its HALO `workers` |
| `POST /me/compute/jobs` | claim a job id for the calling user |

A job the caller does not own returns **404**
`{"message":"no such job for this user"}` — deliberately not 403, which would
confirm the job exists. Note the shape: `:site` is part of the path, because a
job id alone does not identify a job (§3).

### From chat

The chatbox and MCP paths carry the **session identity automatically** — you
never pass a token in a prompt, and a user who cannot curl `/ll/api/v1/*`
directly can still drive Lumilake through them. Prompts that route:

- "List the FlowMesh workers and their status."
- "Submit an echo job with the items `["hello","world"]` and show me the result."
- "Optimize this workflow and show me the HALO worker assignment." (paste the YAML)
- "Run this workflow and give me the output text."
- "What ops can I use in a Lumilake workflow, and what fields does `LLMChatOp` need?"

A successful `optimize_workflow` / `run_lumilake_job` also pops the **workflow
DAG side panel** in Studio (React-Flow graph, HALO worker badges) — see
`lumid_ui`'s `StudioWorkflowPanel`. Phrasing matters for dispatch; see §8.

## 3. Sites and federation

`cloud`, `home` and `office` are three separate meshes behind mesh-federator.
`/fm` and `/ll` fan out to all three and merge; `/fm/<site>/…` talks to exactly
one. Before federation these bases proxied only to the **cloud** control plane,
which is why they once reported a single FlowMesh node and zero Lumilake workers
while the on-prem meshes held the rest.

The list endpoints still return a **JSON array** — the same contract as before,
merged, with each record carrying an extra `site` field. Existing callers keep
working unchanged and simply see more. Per-site status rides in a response
header, so nothing is lost:

```
X-Mesh-Sites: cloud=1,home=9,office=5
X-Mesh-Sites: cloud=0,home=5,office=error(HTTP 401)     # a failing site is named, not hidden
```

**Read that header before trusting a count.** It is what distinguishes "office
is unreachable" from "office has no workers" — a distinction the old
single-upstream view could not express.

`?shape=full` returns the structured form instead of a bare array:

```jsonc
{
  "items": [ { "...": "...", "site": "home" } ],
  "sites": [ { "site": "home", "ok": true, "count": 9, "ms": 408 } ]
}
```

Federated today: `fm/api/v1/nodes`, `fm/api/v1/workers`, `ll/api/v1/workers`,
**and per-worker retrieve** `GET /api/v1/workers/{id}`. **Everything else —
notably `POST /api/v1/workflows` (submit) — is proxied verbatim to the cloud.**

### Picking a site

```bash
# All sites (default federated shape)
curl -s https://lum.id/fm/api/v1/nodes -H "Authorization: Bearer $ADMIN_PAT"

# Narrow the fan-out — SAME response shape, so callers don't branch
curl -s "https://lum.id/fm/api/v1/nodes?site=home"        -H "Authorization: Bearer $ADMIN_PAT"
curl -s "https://lum.id/fm/api/v1/nodes?site=home,office" -H "Authorization: Bearer $ADMIN_PAT"

# Talk to ONE mesh directly — works for EVERY endpoint, not just the lists,
# and returns that mesh's native shape (a bare array here)
curl -s https://lum.id/fm/home/api/v1/nodes     -H "Authorization: Bearer $ADMIN_PAT"
curl -s https://lum.id/ll/office/api/v1/workers -H "Authorization: Bearer $ADMIN_PAT"
```

Use `?site=` when you want the federated shape with fewer sites. Use
`/fm/<site>/…` when you want to *operate* on one mesh — inspect a node, pull a
task's logs, or reach an endpoint the federator does not merge.

### Per-worker retrieve fans out too

Listing workers across all sites is useless if you cannot then retrieve one, and
the retrieve path used to proxy to the cloud, which has **zero** workers — so
`GET /api/v1/workers/{id}` 404'd for every on-prem worker. That was the root
cause of Lumilake jobs sticking in "running" forever: **the scheduler listed 28
workers, then 404'd on every profile fetch.** Retrieve now fans out and answers
from the first site that has the worker, tagged with `X-Worker-Site`:

```bash
curl -si https://lum.id/fm/api/v1/workers/wkr-30 -H "Authorization: Bearer $ADMIN_PAT"
#   -> 200, X-Worker-Site: office
curl -si https://lum.id/fm/api/v1/workers/wkr-6  -H "Authorization: Bearer $ADMIN_PAT"
#   -> 200, X-Worker-Site: home
curl -s  https://lum.id/fm/api/v1/workers/wkr-nonexistent -H "Authorization: Bearer $ADMIN_PAT"
#   -> 404
```

Worker ids are globally unique (`wkr-NNN`), so the first site that answers is
the owning site. Lumilake's orchestrator is pointed at the populated **office**
site (`/fm/office`) so list + retrieve + submit all reach a mesh that actually
has workers.

### Two things a site will trip you on

- **Nodes are not workers.** `fm/api/v1/nodes` and `fm/api/v1/workers` are
  different lists with different populations and different counts — a node can
  host several workers or none. Pick the one you actually mean; a number from
  the wrong list looks perfectly plausible.
- **A Lumilake job id is meaningless without its site.** The three services keep
  separate job tables, so asking the wrong one returns not-found — which reads
  exactly like a job that never submitted. Carry the site alongside the id
  everywhere, which is why the `/me/compute` routes in §2 take it in the path.

## 4. The workflow contract

Write **Lumilake-native** YAML: `name` + `inputs` + `ops` + `outputs`.

There is a second dialect in the wild — the one from the `lumilake.ui` example
repo, with `workflow_id`, `nodes[]`, `kind:`, per-node `spec:`, an `InputOp`
node and explicit `connection:` strings. **It does not execute on the deployed
server and does not render in Studio's canvas.** If you started from those
examples, you are writing a file that will be rejected at submit. Four
differences matter:

1. **There is no `InputOp`.** Workflow inputs are the top-level `inputs:` map,
   referenced by name from an op's `inputs:` list.
2. **`outputs:` is required.** Without it the job fails `Missing output for
   workflow`. `path:` within an output is optional.
3. **Op fields are flat**, not nested under `spec:`.
4. **No connection strings** — see §1.

> **`outputs:` and `output_location` are not alternatives.** The top-level
> `outputs:` block names *which* op results are the job's outputs;
> `output_location` on the submit item says *where* they are written. Notes that
> describe output as "captured by `output_location`" omit half the contract, and
> a workflow written from them runs every op and then fails `Missing output for
> workflow`.

Every declared output must yield **exactly one row per slice**. Returning three
rows for one slice fails the job with `Output length mismatch: expected=1 got=3`,
which is why the example's SQL op selects a single representative keyframe
rather than all three.

An output's source must be an `LLMOp` or a `DataRetrievalOp`. A terminal
`LambdaOp` cannot be an output at all (`OutputOp '<name>' input must be an LLMOp
or DataRetrievalOp (got LambdaOp)`) — so assemble final artifacts in your app's
own code, not in a code string inside the YAML.

The op catalog is `DataOp`, `DataRetrievalOp`, `EmbeddingOp`, `FormatOp`,
`ImageGenerationOp`, `LLMChatOp`, `LLMVisionOp`, `LambdaOp`, `MessageOp` — but
treat that as orientation, not a contract. **Author from `lumilake_node_specs()`
and `lumilake_workflow_schema()`**, which are field-by-field and track the
deployed server; an op shape copied from a stale doc will 422.

### A minimal workflow (`hello-world.yaml`)

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
    config: {model: Qwen/Qwen2.5-7B-Instruct, max_tokens: 64, temperature: 0.2}  # HuggingFace id — see §9
```

`LLMChatOp` needs `messages` + `config.model`, not `prompt` / a top-level
`model`. An op's `inputs[]` entry references either another op's `id` — an
upstream edge — or a top-level input name; there is no separate edges list.

To plan it without executing, `POST /ll/api/v1/jobs/preview` needs the
**`Workflow-Format: yaml`** header and a **non-empty `inputs`** (a missing
header or empty inputs → `422 inputs is required`):

```bash
curl -s https://lum.id/ll/api/v1/jobs/preview \
  -H "Authorization: Bearer $ADMIN_PAT" \
  -H 'Content-Type: application/json' \
  -H 'Workflow-Format: yaml' \
  -d '{"data":[{"workflow":"'"$(sed 's/"/\\"/g' hello-world.yaml)"'","inputs":{"Name":["World"]}}]}'
```

It returns the HALO plan — `selected_workers`, `worker_assignment`,
`merged_runtime_node_count`, `optimization_seconds`.

### FlowMesh tasks are a different dialect

A FlowMesh task spec is `stages[]` with a `taskType`, and it is what
`submit_workflow` / `run_workflow` take. Note `data.type: list` + `data.items`,
**not** `data.messages`:

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

For an **API** task calling an external HTTP endpoint, set
`response.parse_json: false` when the response isn't LLM-usage JSON (e.g. a
trade/data payload).

## 5. Constraints that bite

These cost real debugging time. None of them produces an error that names the
actual cause.

**The vision model must be LLaVA architecture *and* emit a 4-D pixel tensor.**
FlowMesh's visual-embedding stage reaches into `self._model.model.vision_tower`
and `.multi_modal_projector` *by name*, and calls the tower with **no reshape**.
Models using **anyres** tiling emit 5-D `(B, patches, C, H, W)` and die with
`too many values to unpack (expected 4)` — a message naming no model and no
field.

| model | LLaVA attrs | pixel rank | works |
|---|---|---|---|
| `llava-hf/llava-1.5-7b-hf` | yes | **4-D** (fixed 336px) | **yes** |
| `llava-hf/llava-onevision-qwen2-7b-ov-hf` | yes | 5-D anyres | no |
| `llava-hf/llava-v1.6-mistral-7b-hf` | yes | 5-D anyres | no |

Newer is actively worse here, and both obvious "upgrades" pass the attribute
check before failing. Check the processor's output rank, not the architecture
name.

**Qwen reasons by default, and it breaks the run rather than merely wasting
tokens.** Set **both** spellings in `chat_template_kwargs` —
`enable_thinking: false` *and* `thinking: false`. Sending only `thinking` leaves
Qwen reasoning anyway; the resulting payload fails FlowMesh's `InferenceItem`
validation, so it surfaces as a *schema* error and reads like a contract bug.

**Override `max_model_len` per op — the 8192 is a server default, not your
model.** Lumilake pins `max_model_len=8192` **fleet-wide, as a server default
applied to every op**. It is not a property of the model you chose and it is not
the office lane's choice, so a workflow on `home` or `cloud` is affected
identically. When the model derives a *smaller* maximum than that default —
`llava-1.5` derives 4096 — vLLM refuses to start and reports `Failed to
initialize vLLM after trying tensor_parallel_size candidates [1]`, which reads
like a capacity problem and is a context-length mismatch. Override per op rather
than lowering the server default.

**`output_location.prefix` is RELATIVE to the server's `S3_DATA_PREFIX`,** which
is prepended. Repeating it writes to `<prefix>/<prefix>/…` **and the job still
reports `completed`**, so the only symptom is output that is not where you
declared it.

## 6. Hardware — the part that is not in your workflow

`HardwareRequirements` (`cpu`, `memory`, `gpu`, `gpu_memory`) hangs off the job
submit item, **not off an op**. There is no per-op hardware field. A floor you
set applies to the whole job, including cheap retrieval ops, and the job then
waits for a worker that satisfies it.

The office lane is mixed: 1× RTX 6000 Ada (48 GB), 2× RTX 5090 (32 GB), 3× RTX
5080 (16 GB). A 9B model at FP16 is ~18 GB of weights before any KV cache, so it
cannot run on a 16 GB card **even empty**.

**Put `hardware` at the TOP LEVEL of the request body.** It is a field of
`JobSubmitRequest` (and `JobPreviewRequest`), beside `data` and `priority`:

```json
{ "data": [ { "workflow": "...", "inputs": {...}, "output_location": {...} } ],
  "priority": "medium",
  "hardware": { "gpu_memory": "40Gi" } }
```

`JobSubmitItem` carries only `workflow`, `inputs`, `output_location`,
`input_batch_size` and `name`. **An entry-level `hardware` key is an extra field
that pydantic drops without a 422** — the submit returns 200 and the floor
simply never existed. Three runs were lost to exactly that: the dispatched tasks
all carried the server default

```yaml
gpu: {type: any, count: 1, memory: 8Gi}
```

which matches every card in the fleet, so nothing was filtered and the 9B op
landed on a 15.47 GiB RTX 5080 and OOM'd. Sent at the top level instead, the
same job produced `memory: 40Gi` in the task spec and completed on the first
attempt.

> **Verify a constraint by reading it back, never by watching placement.**
> `GET /fm/<site>/api/v1/tasks/<id>` → field `raw_yaml` → the per-node
> `resources.hardware.gpu` block. Between two of the failed runs the op moved to
> a different worker, which looks exactly like a floor taking effect; the next
> run moved back, and the spec said `8Gi` throughout. Worker assignment varies
> on its own. **200 does not mean "accepted" — it means nothing rejected it.**

> **Still open — FlowMesh matches *total* VRAM, not *free*.**
> A floor selects a card by capacity, so a busy card can still be chosen. This
> never bit once the floor worked, because 40Gi leaves enough headroom that a
> partly-occupied card still serves — but it is unfixed, and a tighter floor on
> a contended card would hit it.

## 7. The worked example

`vla-curation` — 15 episodes, four ops, three outputs:

| op | type | does |
|---|---|---|
| `Episode Frames` | `DataRetrievalOp` (sql) | one representative keyframe row per episode |
| `Keyframe` | `DataRetrievalOp` (s3) | the JPEG for that frame |
| `Caption` | `LLMVisionOp` | describes the frame (llava-1.5) |
| `Normalized Instruction` | `LLMChatOp` | rewrites the raw instruction (Qwen3.5-9B) |

![The Pipeline surface: what the demo does, and the chat prompts that drive it.](/docs/img/lumilake-flowmesh-pipeline.png)

Two details worth copying:

- The S3 template keeps a **static, `/`-containing prefix with only the filename
  dynamic**. A bare `{key}` resolves to an empty folder prefix and lists the
  whole blob store (~60s vs 0.08s), and the profiler only counts blobs whose
  immediate folder equals the static prefix.
- The data-profile preflight refuses to sample live, so a `sample_value` map
  must supply a **real, representative** row — the shape matters as much as the
  values.

**Normalization is rowwise on purpose.** An earlier version aggregated the
instruction column into a single block. It passed schema, semantics and dry-run,
ran without error, and was *silently wrong*: two episodes with different raw
instructions both normalized to the same hallucinated text. Episodes 0 and 1
producing **different** output is the demo's primary correctness check.

![The Episodes surface — the raw inputs, queryable from chat.](/docs/img/lumilake-flowmesh-episodes.png)

![The Manifest surface — the shape of the output record.](/docs/img/lumilake-flowmesh-manifest.png)

## 8. Runbook

### Dispatch

From Studio chat: *"Run the vla_curate workflow"*. Phrasing matters — the
control-intent router keys on a verb near a platform noun. *"Curate the robot
episodes"* does **not** route and fails silently, answering that no such tool is
bound.

Headless, with a PAT (no browser session needed):

```bash
curl -X POST -H "Authorization: Bearer $PAT" -H 'Content-Type: application/json' \
  -d '{"args":{"episodes":"episode_000000,episode_000001","mode":"run"}}' \
  https://lum.id/api/v1/me/loops/vla-curation/vla_curate/run
# 202 {"data":{"job_id":"…","state":"queued"}}
```

`args` feeds the loop's `{{ args.* }}` templates, so scoping to two episodes is
a cheap smoke test. `mode: preview` plans without executing — free, no GPU.

> **`engine: {type: lumilake}` does not exist.** app_runner dispatches only
> `type: command`; an app reaches Lumilake by importing `sdk/apps/compute.py`
> from inside a command module. A manifest declaring a `lumilake` engine type
> gives you a loop that silently never runs.

### Reading a run

The cycle record lands on the scheduler's state volume under
`.lumid/cycles/<loop>/<ts>/engine_command.json`. `outcome` is the fast signal:

| outcome | means |
|---|---|
| `planned` | preview only; HALO returned a plan |
| `curated` | job completed; `metrics.records` is the row count **read back** |
| `job_failed` | Lumilake reported the job failed — read `detail.data.error` |
| `submit_rejected` | rejected before a job existed; the body says why |
| `no_credential` | no PAT with `lumilake:jobs:write` in the cycle's env |

`metrics.records` is `null`, never `0`, when the count could not be established.
A failed cycle did not curate zero episodes — it curated an unknown number.

### Reading a Lumilake job directly

Three endpoints, and each answers a different question. Remember the site (§3).

| call | gives you |
|---|---|
| `GET /api/v1/jobs/<id>` | status, timings, error — and **no progress block** |
| `GET /jobs/<id>/progress` | five lifecycle phases — queuing, query parsing, data probing, execution, outputs — plus `batch_progress` |
| `GET /jobs/<id>/workflows` | `[]` |

**`batch_progress.completed` is a COUNT, not a boolean.** It is the field a
reader misreads: treated as a flag, a job three batches into thirty looks
finished.

`/jobs/<id>/workflows` returning an empty array is not a bug and not a timing
window — **there is no per-op state**, so there is nothing to wait for and
nowhere else to look for it. Per-task detail lives on the FlowMesh side, below.

### Pulling FlowMesh task logs

Lumilake's error names a task; FlowMesh has the reason:

```bash
curl -H "Authorization: Bearer $ADMIN_PAT" \
  https://lum.id/fm/office/api/v1/results/<task_id>/logs
```

### The OOM signature

Two failures, same root cause, different appearance:

```
# already-occupied 16 GB card — dies loading weights
GPU 0 has a total capacity of 15.47 GiB of which 102.75 MiB is free
torch.OutOfMemoryError: Tried to allocate 192.00 MiB

# already-occupied larger card — dies BEFORE loading the model
vllm/v1/worker/gpu_worker.py: init_device -> MemorySnapshot
torch.AcceleratorError: CUDA error: out of memory
```

The second form — failing inside `MemorySnapshot`, before any weights load —
means the card had essentially nothing free. vLLM retries down to
`gpu_memory_utilization=0.750` and still fails, so there is no knob left. This
is the §6 gap, not a model-size problem.

## 9. Model ids, and other things learned the hard way

- **Two model-id namespaces — do not mix them.** A Lumilake `LLMChatOp` runs as
  a FlowMesh **vLLM** task that loads weights from HuggingFace, so its
  `config.model` is a **HuggingFace id** (`Qwen/Qwen2.5-7B-Instruct`,
  `Qwen/Qwen2.5-0.5B-Instruct`). Hand it a mesh alias like `deepseek-v4-flash`
  and the task fails with `not a valid model identifier on huggingface.co`. The
  lumid-llm mesh (`/llm`, OpenAI-compatible) takes **gateway keys** instead, and
  `GET /llm/v1/models` is the live list — read it rather than trusting any
  written roster, this page included.
- **An unknown gateway id has historically not 502'd — it fell through to the
  OpenRouter catch-all and was BILLED.** `z-ai/glm-5.2` returned 200, served and
  metered through OpenRouter while absent from `LUMID_LLM_BACKENDS`. The finding
  that forced the cleanup was `qwen3.6-27b` — 102 of 147 requests in one window
  from `role=user`. Ids purged from `LUMID_LLM_OPENROUTER_MODEL_MAP` now get
  lumid-llm's own 503, so a stale or typo'd id fails *loudly*. The residual risk
  is an id still in that map which a caller no longer means to use.
- **FlowMesh registry and execution drift.** `list_workers` shows the registry —
  what enrolled and last heartbeated — which is not FM Host's live execution
  view. A worker can read `IDLE`/`starting` in one and not the other. Reconcile
  before concluding a worker is gone; see `RUNBOOK.md`.

## 10. Current status

The pipeline is **verified**: dispatch → intent queue → scheduler → cycle →
Lumilake submit → HALO plan → FlowMesh dispatch → worker execution all run end
to end, and the data-retrieval stages complete. An earlier full run produced 15
records with per-episode normalization and captions confirmed against the actual
JPEGs.

**The pipeline runs.** Four dispatched runs on 2026-09-18, and the fourth
completed:

| run | job | floor sent as | floor in the spec | outcome |
|---|---|---|---|---|
| 1 | `req-PCD5fVpw…` | — | `8Gi` | `job_failed` — OOM, wkr-110 (15.47 GiB) |
| 2 | `req-barrvjbG…` | entry-level | `8Gi` | `job_failed` — OOM, wkr-120 |
| 3 | `req-5vWAsYYD…` | entry-level | `8Gi` | `job_failed` — OOM, wkr-110 |
| 4 | `req-5UgV3Qgd…` | **top level** | **`40Gi`** | **`curated`, 2 records, 183s** |

Run 4: all 5 FlowMesh tasks `DONE` on wkr-111 / wkr-118, `metrics.records = 2`
read back off the finished job.

The diagnosis went through two wrong stops worth recording, because both looked
convincing. First "the office cards are busy" — true, and not the cause. Then
"the floor moved the work to a different card" — false; the next run moved back
and the spec never changed. Run 3 was dispatched *after a GPU was freed*, which
should have been the clean test, and failing anyway is what finally forced
reading the dispatched spec instead of reasoning about placement.

The actual defect was the request shape (§6), not the platform and not the
hardware. **Freeing a card did not fix it and could not have** — with the
constraint dropped, placement was unconstrained and a 16 GB card was always a
legal target.

Still outstanding: the full 15-episode run, which is what exercises the §7
correctness checks (fifteen records, and episodes 0 and 1 normalizing
*differently*). The screenshots above show the control plane; the surfaces are
static markdown and do not render run output, so a "green run" is read from the
cycle record and the job result, not from these pages.

# Lumilake + FlowMesh: authoring a workflow that actually runs

**(Admin+)** How a Lumilake workflow is authored, planned and executed on a real
GPU, and what breaks along the way. The worked example is `vla-curation`, a demo
that turns raw robot episodes into a VLA training manifest — but the contract in
§1–§4 applies to any workflow you write.

Everything here was measured on the live office lane on 2026-09-18. Where a
thing is unverified, it says so.

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

## 2. The workflow contract

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

Every declared output must yield **exactly one row per slice**. Returning three
rows for one slice fails the job with `Output length mismatch: expected=1 got=3`,
which is why the example's SQL op selects a single representative keyframe
rather than all three.

An output's source must be an `LLMOp` or a `DataRetrievalOp`. A terminal
`LambdaOp` cannot be an output at all (`OutputOp '<name>' input must be an LLMOp
or DataRetrievalOp (got LambdaOp)`) — so assemble final artifacts in your app's
own code, not in a code string inside the YAML.

## 3. Constraints that bite

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

**`max_model_len` must not exceed the model's own maximum.** The office server
sets 8192 fleet-wide; `llava-1.5` derives 4096 and vLLM refuses to start,
reporting `Failed to initialize vLLM after trying tensor_parallel_size
candidates [1]` — which reads like a capacity problem and is a context-length
mismatch. Override per-op rather than lowering the server default.

**`output_location.prefix` is RELATIVE to the server's `S3_DATA_PREFIX`,** which
is prepended. Repeating it writes to `<prefix>/<prefix>/…` **and the job still
reports `completed`**, so the only symptom is output that is not where you
declared it.

## 4. Hardware — the part that is not in your workflow

`HardwareRequirements` (`cpu`, `memory`, `gpu`, `gpu_memory`) hangs off the job
submit item, **not off an op**. There is no per-op hardware field. A floor you
set applies to the whole job, including cheap retrieval ops, and the job then
waits for a worker that satisfies it.

The office lane is mixed: 1× RTX 6000 Ada (48 GB), 2× RTX 5090 (32 GB), 3× RTX
5080 (16 GB). A 9B model at FP16 is ~18 GB of weights before any KV cache, so it
cannot run on a 16 GB card **even empty**.

> **Known gap — FlowMesh matches *total* VRAM, not *free*.**
> Setting a `gpu_memory` floor picks a card by its total capacity. If that card
> is already busy, the job still OOMs, just on a bigger card. Measured twice on
> 2026-09-18; see §6.

## 5. The worked example

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

## 6. Runbook

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

### Pulling FlowMesh task logs

Lumilake's error names a task; FlowMesh has the reason:

```bash
curl -H "Authorization: Bearer $PAT" \
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
is the §4 gap, not a model-size problem.

## 7. Current status

The pipeline is **verified**: dispatch → intent queue → scheduler → cycle →
Lumilake submit → HALO plan → FlowMesh dispatch → worker execution all run end
to end, and the data-retrieval stages complete. An earlier full run produced 15
records with per-episode normalization and captions confirmed against the actual
JPEGs.

The demo is **currently blocked** on GPU availability, not on the pipeline: the
last two dispatched runs both OOM'd on already-occupied cards. Until FlowMesh
matches free VRAM — or the office cards are freed — expect `job_failed` with the
§6 signature.

The screenshots above therefore show the control plane, not a green run. That is
deliberate; a screenshot of a passing run does not exist yet.

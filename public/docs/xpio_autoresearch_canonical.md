# xpio Autoresearch Loop — Canonical Reference

Status: stable (2026-05-09). Workflow alias added 2026-05-25 (W1.1). The canonical contract every xpio app should target. The runtime is `sdk/apps/app_runner.py`. This doc cites file:line for every claim so it stays anchored when the runner evolves.

## Workflow as the supertype

As of W1 of the Personal AI plan, **workflow** is the user-facing supertype across the stack. The vocabulary collapses:

| User-facing word | What it points to | Where it lives |
|---|---|---|
| **Workflow** (scheduled) | An xpio loop in `xpcloud.yaml::loops[]` (or `workflows[]` — see below) | `~/.xp/apps/<app>/` or `~/.tenants/<sub>/.xp/apps/<app>/` |
| **Workflow** (visual) | An n8n DAG | n8n's own database, surfaced via `lum.id/n8n/` |
| **Workflow** (atomic) | A 1-step skill — the marketplace's gmail-mcp, tavily-search, etc. | Community-owned repo at `xpcloud /repos/community/<skill>` |
| **Workflow** (composed) | A multi-step skill (an app, in old vocabulary) — personal-agent, mbb-ai, etc. | Same xpcloud namespace |

Every kind has the same shape from the user's perspective: a thing you install, configure, run on a trigger, and observe in the runs view. The xpio canonical contract below describes the **scheduled** kind; visual kinds live in n8n's own schema.

### Optional `workflows:` schema alias (W1.1)

`xpcloud.yaml` accepts an optional top-level `workflows:` key as a synonym for `loops:`. Both have identical schema. Apps can use either, both, or omit one. When both are present the runner takes the union; on name collision `loops[]` wins for back-compat (existing apps never regress).

Examples — semantically identical:

```yaml
# Style A (current canonical)
loops:
  - name: morning_brief
    schedule: "0 8 * * *"
    skills: [email/observe, calendar/observe, draft/compose]
```

```yaml
# Style B (W1.1 alias — vocabulary aligned)
workflows:
  - name: morning_brief
    schedule: "0 8 * * *"
    skills: [email/observe, calendar/observe, draft/compose]
```

The runner reads the union from `_coalesce_workflow_entries(manifest)` in `sdk/apps/app_runner.py`; scheduler discovery does the same in `sdk/scheduling/xpio_scheduler.py::_discover_loops_from_root`. Existing apps need no migration. The alias enables marketplace + composer + Studio surfaces to consistently say "workflow" without touching app source.

## What is an autoresearch loop

An xpio autoresearch loop is a periodic, observable, learnable workflow that fits one of two engine patterns. The five logical stages — **observe → hypothesize → act → analyze → learn** — appear in both, but the *engine* differs.

| Pattern | Engine | When to use | Reference |
|---|---|---|---|
| **A — runner-driven** | `app_runner.cycle()` walks `loops[].steps[]` in order | Each step is a single skill call with a clean input/output contract | `personal-agent` |
| **B — command-driven** | `app_runner.cycle()` imports `commands/<verb>.py` and runs it; the verb implements the flow internally | Parallel fan-out, conditional retries, idempotency gating, or per-record dynamic skill loading | `mbb-ai`, `eventx` |

Both patterns get the same post-cycle hooks: `_run_auto_publish()` (privacy contract) and `_post_inbox_message()` (human-in-the-loop). Both appear in the dashboard's `/admin/loops` tile. The choice of pattern is local to the app, not visible to the operator.

## The five stages

| Stage | Question | Side effects | Skill examples |
|---|---|---|---|
| **observe** | What is the world's state? | Read-only — APIs, files, databases | `email/observe`, `calendar/observe`, `claude_code/scan_sessions`, `xpio_repo_inventory` |
| **hypothesize** | What action should I propose? | LLM calls; consumes observations + retrieved memories | `pick_skills`, `propose_trade`, `extract_corrections`, `apply_rules` |
| **act** | Execute the plan | Writes — file outputs, API POSTs, scheduled events. Force-review on destructive skills via `approval_policy` | `email/draft`, `email/send`, `calendar/schedule`, `place_order`, `llm_annotate` |
| **analyze** | What just happened? Did it match the hypothesis? | LLM or deterministic scoring; metric writes | `score_qual`, `score_proposal`, `judge_fanout`, `binary_metrics`, `kappa_band` |
| **learn** | What pattern recurred enough to remember? | Appends to a role's `bank.jsonl`; ≥3-recurrence + min_confidence gating | `insights`, `distill_principles`, `reflect_ingest` |

The five-stage decomposition is logical, not enforced by the runner. Pattern A apps map each step to one stage explicitly. Pattern B apps may collapse stages into a single command (mbb-ai's `cycle.py` does observe → analyze in one pass per question).

## Required `xpcloud.yaml` schema

Every kind=app bundle MUST have an `xpcloud.yaml` at the bundle root. `app_runner.load_manifest()` reads this file as the runtime source of truth (`app_runner.py:78-85`). `manifest.json` mirrors metadata for static indexing but is NOT read at runtime.

Install-time precedence (2026-06-11): when BOTH files declare a unified field (`skill_imports`, `loops`, `datasets`, `roles`, `benchmarks`, `human_inbox`, `approval_policy`, `experiments`) **or `version`**, `xpcloud.yaml` wins — a stale legacy `manifest.json`/`manifest.yaml` can no longer redirect skill imports or misreport the installed version. Keep both files in sync anyway (`app_push` bumps both); the mirror exists for static indexers only.

List-field tolerance: `skills_invoked[]` and `datasets[]` entries may be bare strings **or** objects (`{skill:|name:|id:, …}`). Consumers must accept both — the reference Go reader (`lumid_identity` `flexStrings`) coerces objects to their `skill`/`name`/`id` field. A strict string-list reader hides the whole loop from the UI while the scheduler happily runs it.

```yaml
# Identity
name: my-agent
display_name: "My Agent — Auto Research for X"
kind: app                  # ∈ {app, autoresearch, agent, skill}
version: 0.1.0
fork_of: null              # or "<owner_sub>/<name>"
visibility: public         # or private
summary: "One-line elevator pitch."
tags: [tag1, tag2]

# Roles + their knowledge agents
roles:
  - name: assistant
    description: "Drafts emails in user's voice"
    memory_agent: "<user>-personal-assistant"
    prompts: "prompts/assistant_*.md"
    default_model: claude-sonnet-4-6

memory_agents:
  - "<user>-personal-assistant"
  - "<user>-personal-watcher"

# Loops (see Pattern A vs B below)
loops:
  - name: …

# Cross-app shared skills mirrored under ~/.xp/skills/<owner>/<repo>/
# First-party utility skill repos (owner: a3f48236-ffe9-4fb9-9548-6e044d5cd9c7):
#   lumid-claude        — LLM calls via installed `claude` binary
#   lumid-containers    — Docker container lifecycle (build/run/stop/health/stats)
#   lumid-knowledge     — render_prior_knowledge from a knowledge agent bank
#   lumid-metrics       — Prometheus/Docker metrics + HTTP probes + log parsing
#   lumid-prompt-audit  — SHA-256 fingerprint prompts, correlate with score deltas
#   lumid-annotate      — multi-step labeling pipeline (inbox/emit/trace)
#   lumid-interview     — human-in-the-loop questions + auditable exchange log
#   lumid-al-core       — active-learning core (LQA, judge, scoring) for consulting/eval apps
skill_imports:
  - {repo: "a3f48236-ffe9-4fb9-9548-6e044d5cd9c7/lumid-claude",     version: "^0.1.0"}
  - {repo: "a3f48236-ffe9-4fb9-9548-6e044d5cd9c7/lumid-containers",  version: "^0.1.0"}
  - {repo: "a3f48236-ffe9-4fb9-9548-6e044d5cd9c7/lumid-knowledge",   version: "^0.1.0"}

# Optional dataset mounts (mbb-ai uses cases_v1)
datasets:
  - {id: cases_v1, repo: "owner/cases-v1", version: "1.0.0", mount_at: data/seed}
  # local_path instead of repo for datasets that live inside the app bundle:
  # - {id: eval_set, local_path: system, version: "0.1.0", description: "eval queries"}

# Optional benchmark declarations (recommended for sysresearch / eval-loop apps).
# Formalises what the app measures so variant_runner and dashboards can read it
# without parsing the runner script. The runner CLI must accept --endpoint <url>
# plus any declared args, and write JSON metrics to stdout.
benchmarks:
  - id: example_bench_v1
    dataset_id: cases_v1               # references datasets[].id
    runner: system/bench.py            # path relative to app root
    args:
      - "--queries"
      - "{{ dataset_path }}/queries.jsonl"  # {{ dataset_path }} = dataset local_path
      - "--schema"
      - "{{ dataset_path }}/schema.sql"
    metrics:
      - {name: accuracy,          type: fraction,    higher_is_better: true}
      - {name: latency_p95_ms,    type: duration_ms, higher_is_better: false}
      - {name: cost_per_query_usd, type: cost_usd,   higher_is_better: false}
    primary_metric: accuracy
    score_formula: "accuracy - 0.05 * (cost_per_query_usd / 0.001)"
    # score_formula is a Python expression evaluated with the metrics as locals.
    # Used by the optimizer to rank variants by a single composite number.

# Experiments (optional) — a hypothesis tested by rolling out VARIANTS over a
# dataset/casebook, measured by a METRIC, attached to a workflow step.
# The yaml block is a minimal declaration; the RUNTIME LEDGER is the real
# contract (see below). Three kinds:
#   regression — current vs previous over a casebook (mbb-ai, the flagship)
#   explore    — open variant space driven by a proposer (auto-sysresearch)
#   arms       — fixed comparison, e.g. 4 model arms on one market (auto-quant)
experiments:
  - id: casebook_regression            # unique slug within the app
    hypothesis: "Prompt and skill changes do not regress per-case scores."
    kind: regression                   # regression | explore | arms
    dataset_id: casebook_v1            # reuses datasets[] (the casebook)
    metric: {name: avg_question_score, higher_is_better: true}
    #   …or reuse a benchmark's primary metric instead of a bare metric:
    #   benchmark_id: nlsql_bench_v1
    baseline: previous                 # "previous" | {arm: <id>} | {value: <float>}
    success_criteria: "delta >= 0 and n >= 3"   # safe expr over aggregates:
    #   n, best_mean, baseline_mean/baseline_value, delta, delta_pp,
    #   best_n, baseline_n, mean_<variant_id>. Whitelisted AST only
    #   (bool/compare/arith); any failure → criteria not met, never an error.
    min_samples: 3                     # criteria never evaluated below this n
    status: active                     # active | concluded | archived
  # explore shape (auto-sysresearch):
  # - id: nlsql_variant_search
  #   kind: explore
  #   variants: {schema: config.variant_schema}
  #   dataset_id: nlsql_queries
  #   benchmark_id: nlsql_bench_v1
  #   baseline: {value: 0.62}
  # arms shape (auto-quant AI Minds):
  # - id: ai_minds
  #   kind: arms
  #   arms: [{id: gpt_baseline_crypto, label: "GPT baseline",
  #           match: {strategy_name: "GPT Baseline (crypto)"}}, …]
  #   metric: {name: return_rate, higher_is_better: true}
  #   baseline: {arm: gpt_baseline_crypto}

# ATTACHMENT: a loop produces results for an experiment via
#   steps[].experiment: <id>      (Pattern A — per step)
#   engine.experiment: <id>       (Pattern B — per verb)
#
# RUNTIME LEDGER (the real contract; runtime state, NEVER published):
#   data/experiments/<id>/results.jsonl — append-only rows:
#     {ts, cycle_ts, variant_id, variant?, metrics{}, dims?, dataset_version?, n?}
#     `dims` ({case_id, q_id, …}) powers casebook observability: rows with
#     dims.case_id group into per-case score histories in Studio.
#   data/experiments/<id>/state.json — recomputed per cycle by the runner
#     (sdk/apps/experiments.py::evaluate): per-variant {n, mean, stdev, last},
#     best_variant, baseline_value, delta/delta_pp, criteria_met, verdict.
#   Apps record rows via sdk.apps.experiments.record_result(...) — fail-soft,
#   a ledger problem must never fail a benchmark/regression run.
#
# PROMOTION is observe-only: when success_criteria flips true the runner
# appends ONE offer {kind: "experiment", …} to the cycle's offers (the
# Suggested-improvements pipe) and stamps verdict_offered_at — no duplicates,
# nothing auto-applies; a human approves.
#
# Per-variant means also stream to xpcloud as metric points
# (POST /repos/{owner}/{app}/metrics/submit with loop="exp:<id>",
# metric_name="<metric>.<variant_id>") so the PUBLIC repo card can chart
# experiment arms. Owner-authed: tenant installs keep their ledger local.

# Privacy contract — explicit allowlist; unlisted agents stay LOCAL
auto_publish:
  every: 1
  memories:
    - {agent: "<user>-personal-assistant"}
  skills:    {enabled: false}
  artifacts: {enabled: false}

# Auto-draft memory writes from cycle outputs (Pattern A only).
# Each successful step in the loop's steps[] queues a MemoryDraft into
# the primary_role's memory_agent bank. Drafts stay in
# ~/.xp/kg/agents/<id>/.drafts/ until the operator approves via the
# inbox (see inbox_publish). Default disabled.
auto_draft:
  enabled: true
  type: fact                 # ∈ {correction, principle, pattern, fact, anti_pattern}
  confidence: 0.5
  max_content_chars: 2000
  skip_skills: [render_review, transcript_render]
  skip_stages: []            # e.g. [observe] to draft only act/learn outputs

# Force-review matrix
approval_policy:
  default: stage
  rules:
    - {decision: force,  kind: skill,  path_match: "skills/email/send.py"}
    - {decision: stage,  kind: memory, source: "*-watcher"}
    - {decision: auto,   kind: memory, source: "*-philosopher", min_confidence: 0.85}

# Human-in-the-loop questions via the lum.id inbox
inbox_publish:
  enabled: true
  kind: cycle_summary
  include: [drafts_pending, flags, questions_pending]

human_inbox:
  path: "data/inbox/expert/"
  kind: both
  on_merge: xp_ingest

# CLI verbs (resolved by gate_tools_resolvable)
tools:
  - {name: setup,  description: "First-run wizard"}
```

## Optional `ui:` block — Studio sidebar entry + app-defined surface

An app may declare an optional top-level `ui:` block so it inserts itself into
the unified Studio sidebar and defines its own UI **as a runtime-loaded Markdown
document authored by the app builder**. The Python runner ignores `ui:` (it only
reads loops/engine/auto_publish/etc.), so this is metadata-only — safe to add to
any app.

Each app declares, in one place, **(1) its UI markdown(s)** and **(2) whether it
appears in the sidebar** (an explicit on/off toggle):

```yaml
ui:
  sidebar:                       # omit the whole block to keep the app out of the sidebar
    show: true                   # explicit on/off — omit = shown (back-compat), false = hide
                                 #   (keeps label/icon config so you can flip it back on)
    label: "Auto Quant"          # required when shown — nav text
    icon: "chart-candlestick"    # optional — lucide icon name (kebab-case); client maps it, default Boxes
    section: "Trading"           # optional — sidebar group header; default "Apps"
    order: 10                    # optional — sort within the section
    badge_source: "running"      # optional — drafts | review | running | none
  surface:                       # the default ("home") surface, rendered at /studio/a/<app>
    markdown: "ui/home.md"       # bundle-relative path to the surface document
    # native: "<key>"            # RESERVED: first-party-only registry key; the
                                 # server echoes it but the SPA resolves it ONLY
                                 # against its compiled allowlist (never loads
                                 # arbitrary code). Use for irreducibly-interactive
                                 # first-party surfaces (e.g. lumid-market).
  surfaces:                      # optional — additional named markdowns, each at
    home: "ui/home.md"           #   /studio/a/<app>/<name>. "home" is the default.
    detail: "ui/detail.md"       #   A bundle can ship as many UI markdowns as it likes.
```

A surface-only app (a `surface`/`surfaces` but **no** `sidebar` block, or
`sidebar.show: false`) is reachable from My Apps + by URL, just not pinned to the
left rail. The Python runner ignores `ui:` entirely.

**Surface rendering.** `GET /api/v1/me/apps/<app>/ui` serves the markdown body.
The Studio shell renders it with react-markdown plus a small set of **`lumid:*`
fenced-block directives** that become live, data-bound widgets:

| Directive | Renders | `source` (allowlisted) |
|---|---|---|
| ` ```lumid:stat ` | a stat cell | `me://today`, `me://workflows`, … |
| ` ```lumid:table ` | a sortable table | `me://*` / `/findata-cloud/*` |
| ` ```lumid:chart ` | a chart | same |
| ` ```lumid:list ` | a list of cards | same |
| ` ```lumid:action ` | a button (`open`/`run_loop`/`install_app`) | `me://*` POST |
| ` ```lumid:iframe ` | a sandboxed iframe | same-origin proxy allowlist only |

Directive `source` may bind **only** to vetted, auth-gated `me://*` endpoints and
the anon `/findata-cloud/*` proxy — never arbitrary URLs. Unknown `lumid:*` blocks
degrade gracefully to a labelled code block. Surface markdown is served with a
path-traversal guard (stays inside the bundle, `.md`-only, ≤256 KB).

See `~/.xp/apps/auto-quant/ui/home.md` for a reference surface.

## Pattern A — runner-driven loop

The runner walks `steps[]` in order. Each step is one skill call; outputs flow into `prev_outputs` so later steps can reference earlier ones.

```yaml
loops:
  - name: morning_brief
    schedule: "0 8 * * *"           # cron
    primary_role: assistant
    knowledge_agent: "<user>-personal-assistant"
    mode: paper                     # ∈ {paper, live, simulate, semi, explore}  app_runner.py:46
    requires_confirmation: false    # default: true for mode=live, false otherwise
                                    # honored by sdk/ops/job_deploy.py's AskUserQuestion gate
                                    # when the loop is dispatched from Claude Code
    cloud_runnable: true            # default: true. Set false for loops that must run
                                    # on the user's own machine (e.g. cc_watcher reads
                                    # ~/.claude/projects/, which only exists locally).
                                    # At install time, me_intent_picker writes
                                    # `.user-overrides.yaml` with `enabled: false` for
                                    # any cloud_runnable: false loop, so cloud-default
                                    # tenants don't silently fire local-only loops.
                                    # CLI users can flip the override back to enabled.
                                    #
                                    # `.user-overrides.yaml` is merged AFTER xpcloud.yaml
                                    # at scheduler discovery (2026-06-11): per-loop
                                    # `schedule:` replaces the declared cron and
                                    # `enabled: false` drops the loop from registration.
                                    # The /me/workflows API surfaces the same effective
                                    # schedule — what the UI shows is what fires.
    skills:                         # set membership; informational
      - calendar/observe
      - email/observe
      - reflect/write_brief
    steps:                          # ordered execution; runner contract
      - {id: observe_cal,    skill: "calendar/observe",    knowledge_agent: "<user>-personal-assistant"}
      - {id: observe_email,  skill: "email/observe",       knowledge_agent: "<user>-personal-assistant"}
      - {id: compose_brief,  skill: "reflect/write_brief", knowledge_agent: "<user>-personal-philosophy"}
```

**Step contract** (`_run_explicit_steps()`, `app_runner.py`):
- `id` (required): unique within the loop; outputs land in `prev_outputs[id]`.
- `skill` (required): resolves via `_load_skill_module()`. Sub-paths (`claude_code/scan_sessions`) translate slashes to dots (`skills.claude_code.scan_sessions`).
- `knowledge_agent` (optional): falls back to the loop's `knowledge_agent`, then the role's `memory_agent`. Top-k memories from this agent are rendered as `prior_knowledge` and injected into the skill's context.
- `required: true` (optional): abort the cycle on this step's failure. Default = continue.
- `args: {}` (optional): static kwargs forwarded into `mod.run(**args)`. **Static args always override auto-wired values.**
- `instructions: |` (optional): **per-step operator instructions** — plain-English text that the runner splices into the skill's prompt as an OPERATOR INSTRUCTIONS block. Backwards-compat: when absent, no block is injected and old apps work unchanged. See the Per-step operator instructions section below.
- `stage` (optional): one of `observe | hypothesize | act | analyze | learn`. Used by the runner for auto-wiring and the no-setup short-circuit.
- `substage` (optional): `pre-flight` or `risk-gate` within `act`. Routes the output to the correct auto-wired kwarg name.

**Auto-wiring.** The runner introspects each skill's `run()` signature and populates well-known kwargs from `prev_outputs` before the call — no static `args:` entries required for these. Static `args:` always win over auto-wired values.

| Kwarg | Auto-wired from |
|---|---|
| `observations` | Aggregated dict of all `stage: observe` outputs, keyed by canonical name (`account`, `holdings`, `market`, `leaderboard`, …) |
| `account`, `holdings`, `market`, … | Individual observe-stage outputs, also available as top-level kwargs |
| `proposal` | `out["proposal"]` from first `stage: hypothesize` step |
| `symbol`, `direction`, `volume` | Extracted from the proposal |
| `backtest` | Output of first `stage: act, substage: pre-flight` step |
| `risk_decision` / `risk` | Output of first `stage: act, substage: risk-gate` step |
| `fill` | Output of first `stage: act` step with no substage |
| `loop_name` | The loop's `name` field |
| `contest_id` | Contest ID from the cycle invocation |
| `mode` | `loops[].mode` (default `paper`) |

Unknown kwargs the skill doesn't declare are silently dropped, so adding new auto-wired params is backwards-compatible.

**No-setup short-circuit.** After a `stage: hypothesize` step completes successfully, if `out["proposal"]["verdict"]` is not `"propose"` or `"route"`, the runner stops the cycle immediately, sets `summary.outcome = "no_setup"`, and skips all remaining steps. This mirrors the same guard in the legacy (non-steps) cycle path.

**Skill `run()` signatures.** Two patterns both work:

```python
# Pattern 1: declare well-known params — runner auto-wires from prev_outputs.
def run(*, observations: dict, proposal: dict | None = None,
        risk_decision: dict | None = None, context: dict | None = None) -> dict:
    market = observations.get("market", {})
    prior_knowledge = (context or {}).get("prior_knowledge", "")
    return {"result": ...}

# Pattern 2: read everything from context (original contract, still supported).
def run(*, context: dict | None = None, **kwargs) -> dict:
    observations = context["prev_outputs"].get("observe_market", {})
    prior_knowledge = context.get("prior_knowledge", "")
    instructions = context.get("step_instructions")
    return {"result": ...}
```

In both patterns `context["prior_knowledge"]` is the rendered memory block, `context["step_instructions"]` is the resolved instructions text, and `kwargs["instructions"]` carries the same instructions value.

## Per-step operator instructions (Theme F)

Any step in any xpio loop can carry an `instructions:` field. The runner resolves the effective instructions for each step from **four scopes in priority order** (most-specific wins):

| Scope | Source | Lifetime | Example |
|---|---|---|---|
| **Per-cycle (CLI)** | `--instructions-for <step_id> "<text>"` on `cycle` command | One cycle only | "Be extra-conservative; month-end." |
| **Per-step (loop default)** | `xpcloud.yaml::loops[].steps[].instructions` | Until edited | "Bias toward mean-reversion in low-vol regime." |
| **Per strategy** | `xpcloud.yaml::strategies[].text` (auto-quant Theme C) | Until strategy changes | "Buy when RSI<30 and ret_5d<-2σ." |
| **Forever** | `data/established_facts.md` (Method D, v0.4.5) | Until deleted | "FOMC days have 70bps higher VIX baseline." |

The runner merges the top two (CLI override beats xpcloud.yaml) at the step-dispatch site. Skills are responsible for blending the remaining two (strategy text + established facts) inside their own prompt assembly.

### YAML schema

```yaml
loops:
  - name: momentum_research
    steps:
      - id: observe_market
        stage: observe
        skill: observe_market
        # No instructions — backwards-compat; no block injected.

      - id: propose_setup
        stage: hypothesize
        skill: propose_trade
        args: {strategy: momentum}
        instructions: |
          VIX is 18 (low-vol regime). Bias toward mean-reversion over breakouts.
          Cap entry size at 3% NAV instead of the normal 5%.

      - id: risk_gate
        stage: act
        skill: score_proposal
        args: {gates: [sizing, drawdown]}
        instructions: |
          Desk had two losing days. Be 20% more conservative on drawdown gate.
```

### Runner behaviour

When the runner (`_run_explicit_steps()`, `app_runner.py`) reaches a step:

1. If `--instructions-for <step_id>` was passed on the CLI, that text is the effective instructions.
2. Otherwise, `step.instructions` from xpcloud.yaml is used.
3. If neither is set, `instructions=None` — no block injected, skill behaves as before.

The effective instructions value is passed as:
- `kwargs["instructions"]` in `mod.run(...)` — skills that want to use it extract it there.
- `context["step_instructions"]` — so skills can read it from the context dict too.

A provenance line is appended to `data/cycles/<loop>/<utc>/prompt_audit.jsonl` per step with `{step_id, skill, instructions_applied: bool, instructions_preview, prompt_sha256}`.

### OPERATOR INSTRUCTIONS block format

Skills that load a prompt and call an LLM should call the helper (importable from `sdk.apps.app_runner`):

```python
from sdk.apps.app_runner import _render_with_instructions

final_prompt = _render_with_instructions(base_prompt_body, instructions)
```

The helper produces:

```
{base_prompt_body}

──────── OPERATOR INSTRUCTIONS (this loop/this cycle) ────────
{step_instructions}
──────────────────────────────────────────────────────────────
```

When `instructions` is `None` or empty, `_render_with_instructions` returns `base_prompt_body` unchanged — zero overhead for apps that don't use the feature.

### CLI — one-shot and persist

```bash
# One-shot: instructions apply only to this single cycle
lumid app auto-quant cycle momentum_research \
  --instructions-for risk_gate "be extra-conservative; we're at month-end"

# Multi-step: pass the flag multiple times
lumid app auto-quant cycle momentum_research \
  --instructions-for observe_market "Focus on AAPL, NVDA, META this week." \
  --instructions-for risk_gate "Be 20% more conservative on drawdown gate."

# Persist: also writes the instruction to xpcloud.yaml::loops[].steps[].instructions
lumid app auto-quant cycle momentum_research \
  --instructions-for risk_gate "be 20% more conservative" --persist
```

`--instructions-for` accepts multiple instances. Without `--persist`, the instruction is recorded in `prompt_audit.jsonl` but xpcloud.yaml is not modified. With `--persist`, the instruction is written into the step's `instructions:` field in xpcloud.yaml so every future cycle applies it until cleared.

### Related paths

- Method D (forever rules): `data/established_facts.md` — operator-curated, step-independent.
- `strategies[].text` (auto-quant): per-strategy rules baked into the propose prompt.
- Inbox reply kind `step_instructions` (Theme F.x, future): dashboard-driven per-step nudges that flow through the same mechanism.

## Pattern B — command-driven loop

The loop's `engine` field tells the runner to import `commands/<module>.py` and call `<module>.run(argv=[...])` instead of walking `steps[]`. The verb IS the engine; `steps[]` (if present) is documentation only.

```yaml
loops:
  - name: case_cycle
    schedule: "@trigger"            # or cron / */Nh
    primary_role: judge
    knowledge_agent: mbb-ai-judge
    mode: paper
    engine:
      type: command
      module: cycle                 # imports commands/cycle.py
      args: ["--case", "{{ args.case }}"]
      idempotency_gates:            # optional; documentation for pipeline DAGs
        - {step: generate_candidates, output_table: candidates}
    skills_invoked:                 # documentation: every skill the verb actually calls
      - alignment
      - opening_response
      - pick_skills
      # …
```

**Engine contract** (`_run_command_engine()`, `app_runner.py:925-1010`):
- `engine.type: command` — branches off the steps[] path.
- `engine.module` — `commands/<module>.py`; must expose `def run(argv: list[str]) -> dict`.
- `engine.args[]` — `{{ args.<key> }}` and `{{ contest_id }}` placeholders are expanded by `_expand_engine_args()` from the cycle invocation.
- The verb's return dict lands in `summary["command_engine"]`. `summary["ok"]` mirrors `out.get("ok")`.
- After the verb returns, the runner still fires `_run_auto_publish()` and `_post_inbox_message()` — privacy + inbox stay consistent across patterns.

**When to choose Pattern B:**
- Parallel fan-out (mbb-ai's parallel scoring across N judges, `cycle.py:1206-1229`).
- Conditional retries (mbb-ai's info-release re-prompt, `cycle.py:426`).
- Idempotency gating on persistent state (eventx's `_step_done()`, `run.py:34-55`, skipping pipeline stages whose output table has rows).
- Per-record dynamic skill loading (eventx's `skills/<task>.py` auto-load, `cycle.py:67-73`).
- Anything that would generate >20 `steps[]` entries per loop.

If your loop fits 3-7 sequential skill calls with no special control flow, use Pattern A. Pattern B trades declarative clarity for capability.

## LLM calls — no API key required

All first-party apps (auto-sysresearch, auto-quant, mbb-ai via lumid-al-core) route LLM calls through the installed `claude` binary rather than `ANTHROPIC_API_KEY`. The provider auto-detection order is:

1. `ANTHROPIC_API_KEY` set → direct Anthropic HTTP API
2. `DEEPSEEK_API_KEY` set → DeepSeek
3. `OPENAI_API_KEY` set → OpenAI-compatible
4. `claude` binary on PATH → **Claude Code CLI** (`claude -p … --output-format json --no-session-persistence`)
5. Error

For new apps, declare `lumid-claude` in `skill_imports[]` and load it via `_load_skill_module("lumid-claude", "claude_code_caller.py")`. Do not import `sdk/skills/claude_code_caller.py` directly — the SDK path hack is deprecated. See **Skill resolution** below.

### Docker containers

Docker containers on Linux **cannot reach the host via iptables**. Apps that spin benchmark containers (auto-sysresearch) instead bind-mount the `claude` binary and `~/.claude` auth dir into the container and set `CLAUDE_CODE=1`:

```python
claude_bin = shutil.which("claude")
if claude_bin:
    env["CLAUDE_CODE"] = "1"
    extra_flags = [
        "-v", f"{claude_bin}:/usr/local/bin/claude:ro",
        "-v", f"{Path.home() / '.claude'}:/root/.claude",
    ]
```

The container's `components/base.py` detects `CLAUDE_CODE=1` and calls `claude -p` via subprocess. No proxy, no network tunnel.

### `sdk/__init__.py` httpx cascade

`from sdk.skills.<anything> import …` triggers `sdk/__init__.py → from .client import LumilakeClient → import httpx`. Because `httpx` is not installed on the host system Python (`/usr/bin/python3`), this raises `ModuleNotFoundError` silently in skill load paths. **Never use `from sdk.skills.X import …`** in xpio app code.

**The correct pattern** is to declare the skill in `skill_imports[]` and use `_load_skill_module()`:

```python
def _load_skill_module(skill_repo: str, skill_file: str):
    """Load a skill module: installed skill repo first, LumidOS SDK fallback."""
    import importlib.util as _ilu
    from pathlib import Path
    _skills_root = Path.home() / ".xp" / "skills"
    if _skills_root.is_dir():
        for owner_dir in _skills_root.iterdir():
            if not owner_dir.is_dir():
                continue
            _p = owner_dir / skill_repo / "skills" / skill_file
            if _p.is_file():
                _spec = _ilu.spec_from_file_location(f"_{skill_repo}", str(_p))
                _m = _ilu.module_from_spec(_spec); _spec.loader.exec_module(_m)
                return _m
    for _base in ["/proj/LumidOS/LumidOS", str(Path.home() / "lumid"), "/opt/lumid"]:
        _p = Path(_base) / "sdk" / "skills" / skill_file
        if _p.is_file():
            _spec = _ilu.spec_from_file_location(f"_{skill_file[:-3]}", str(_p))
            _m = _ilu.module_from_spec(_spec); _spec.loader.exec_module(_m)
            return _m
    raise ImportError(
        f"Skill {skill_repo}/{skill_file} not found. "
        "Declare it in skill_imports[] and run `/lumid app update <app>`."
    )

# Usage:
cc = _load_skill_module("lumid-claude", "claude_code_caller.py")
text = cc.call("Analyze this pattern: ...", model="haiku", system="You are a data analyst.")
```

This tries `~/.xp/skills/<owner>/<repo>/skills/<file>` first (installed from xp.io), then falls back to `/proj/LumidOS/LumidOS/sdk/skills/<file>` (dev mode).

The correct Python environment for manual CLI operations is the lumid virtualenv's `python3` (has `httpx`, `yaml`, `tomli`, etc.); the system `python3` (`/usr/bin/python3`) lacks pip entirely. The CLI entrypoint is `/proj/LumidOS/LumidOS/bin/lumid` — locate the venv on the current host (the path is host/operator-specific).

## Skill resolution

`_load_skill_module()` (`app_runner.py:105-170`) tries, in order:

1. **App-local** — `~/.xp/apps/<app>/skills/<id>.py`. Sub-package ids (`claude_code/scan_sessions`) become dotted import paths (`skills.claude_code.scan_sessions`).
2. **Shared Python** — `~/.xp/skills/<owner>/<repo>/<id>.py` or `~/.xp/skills/<owner>/<repo>/skills/<id>.py` (the second layout is what `skill_imports` populates when mirroring an xpcloud skill repo).
3. **Prompt card** — `~/.xp/skills/<owner>/<repo>/prompts/<id>.md` becomes a synthetic module exposing `prompt_text`, `prompt_path`, and a `run()` that returns the text. Lets a kind=skill repo ship Markdown skill cards that many apps consume without each shipping their own copy.

Earlier sources win — explicit local Python overrides always beat shared lookups, useful for forking a shared skill for a one-off tweak.

## Privacy contract — `auto_publish.memories[]`

`_run_auto_publish()` (`app_runner.py:325-414`) walks the `auto_publish.memories[]` allowlist after every cycle and pushes new entries from each listed agent's bank to xpcloud. **Agents not on this list never publish.** Used by personal-agent to keep the watcher bank (raw transcript fragments + diff excerpts) local-only forever, while the philosopher bank (distilled principles) syncs cross-machine.

To prove the contract: probe `https://xp.io/api/v1/repos/<owner>/<bank-name>` after a cycle. Listed agents → 200; unlisted → 404. Step 10 of any app's verification run should include this probe.

`auto_publish.skills.enabled` and `.artifacts.enabled` default to `false`; opt in to publish skill drafts or per-cycle artifacts (rare — most apps keep these local because they may carry PII).

## Memory read + write — closing the loop

A cycle has two halves: **read** (inject prior memories into each step's prompt) and **write** (persist new memories from step outputs back into the bank). Both are needed for Level-1 compounding (cycle outputs → bank → next cycle's prompt).

### Read — `render_prior_knowledge` (`sdk/skills/knowledge_inject.py`)

`_run_explicit_steps()` calls `render_prior_knowledge(agent_id, question, k=5)` before each step and assigns the result to `context["prior_knowledge"]`. The agent is resolved in priority order: step's `knowledge_agent` → loop's `knowledge_agent` → role's `memory_agent`. Resolution path: `AgenticKG.get_agent(agent_id)` first, with a filesystem fallback to `KnowledgeAgent.load(~/.xp/kg/agents/<id>/)` for banks that exist on disk but aren't registered in `kg_config.json`. Returns `""` on any retrieval error so cycles never break.

The renderer handles both legacy and current `agent.answer()` return shapes (`{answer: str, sources: list, ...}` from `xp/agent.py:114` is the current shape).

### Write — `auto_draft` (`sdk/apps/app_runner.py:_maybe_draft_memory_from_step`)

Opt-in. When `auto_draft.enabled: true`, after each successful step in `steps[]` the runner queues a `MemoryDraft` via `skill_authoring.draft_memory()` into the primary role's `memory_agent` bank. Drafts land at `~/.xp/kg/agents/<agent>/.drafts/<draft_id>.json` and **do not enter the bank until the operator approves them** through the inbox flow (`_pull_inbox_replies` dispatches `memory_apply` on approve, `discard_memory_draft` on reject).

| Field | Purpose | Default |
|---|---|---|
| `enabled` | Master switch | `false` |
| `type` | Memory type tag — `correction\|principle\|pattern\|fact\|anti_pattern` | `fact` |
| `confidence` | Initial confidence on the staged draft | `0.5` |
| `max_content_chars` | Truncates the serialized step output | `2000` |
| `skip_skills` | Skill ids to exclude (e.g. renderers) | `[]` |
| `skip_stages` | `observe\|hypothesize\|act\|analyze\|learn` to exclude | `[]` |

Failures (no role, no agent, empty output, draft library unavailable) are non-fatal — they land in `step_log[].memory_draft` for visibility and the cycle continues.

Pattern B (`engine: command`) verbs are NOT auto-hooked here; they should call `draft_memory()` themselves where appropriate.

Interaction with `auto_publish`: drafts that get approved enter the bank → next cycle's `_run_auto_publish` pushes them to xpcloud IF the agent is on the allowlist. So enabling `auto_draft` on a `*-watcher` bank is still safe — drafts stay local forever even after approval, because the agent isn't on `auto_publish.memories[]`.

## Inbox publish + reply

`_post_inbox_message()` (`app_runner.py:597-729`) posts a `kind: cycle_summary` (or `kind: question`) message to the user's lum.id inbox after every cycle when `inbox_publish.enabled: true`. The summary fields (drafts_pending, flags, questions_pending, etc.) are listed in `include[]`.

`_pull_inbox_replies()` (`app_runner.py:732+`) runs at the START of every cycle. It:
1. GETs `/api/v1/inbox/replies?app=<app>&unprocessed_only=true` from xpcloud.
2. Dispatches each reply by kind — `approve` → `apply_skill_or_memory`; `reject` → discard; `<text>` → ingest as a memory in the asking agent.
3. POSTs `/inbox/replies/<id>/processed` so the next cycle doesn't re-fire it.

Loops opt into the inbox via `inbox_publish.enabled: true`. Apps that don't opt in (most of auto-quant) skip both publish and pull silently.

## Approval policy

The runner consults `approval_policy.rules[]` to decide whether each side-effecting action runs immediately or stages for human review.

- `decision: auto` — proceed without asking.
- `decision: stage` — write a draft to `data/outbox/<ts>/drafts/`; require an `approve` reply on the inbox question to commit.
- `decision: force` — always require approval, regardless of confidence.

Match keys: `kind: {skill, memory}`, `path_match: glob`, `source: "<agent_pattern>"`, `min_confidence: float`. First match wins. Default behavior comes from `approval_policy.default` (typically `stage`).

## Scheduler discovery

`xpio_scheduler.discover_loops()` (`sdk/scheduling/xpio_scheduler.py:96+`) walks `~/.xp/apps/*/` and reads loops in this priority:

1. `xpcloud.yaml::loops[]` — preferred, runtime source.
2. `manifest.json::loops[]` — fallback for legacy apps.
3. `autoresearch.yaml::name+schedule` — single-loop ops/xpio-ops shape.

The daemon converts each loop's `schedule` (cron / `*/Nh` / `@trigger`) into an APScheduler trigger. `@trigger` loops never auto-run; they only fire on `/lumid app <name> cycle --loop <name>`. Pattern B loops use the same trigger — the daemon doesn't care which engine the cycle eventually invokes.

State persists at `~/.lumilake/scheduler/xpio_state.json` (per-loop `{last_run_ts, last_ok, consecutive_failures, last_duration_s}`). The dashboard's `/admin/loops` endpoint joins this with `xpcloud.yaml::loops[]` to render the operations tile.

## Forking

`fork_of: "<owner_sub>/<name>"` (or `null`) declares ancestry. `app_install --as <local_name>` clones the upstream bundle into `~/.xp/apps/<local_name>/` and sets `fork_of` automatically. The fork inherits the privacy contract — `auto_publish.memories[]` is copied verbatim — but each user diverges prompts, memories, and skills per fork.

Cross-machine memory transfer: `xp pull <other_user>/<their-philosophy-bank>` seeds your bank with someone else's distilled principles. Same Git-backed mechanism that ships skill imports.

## App-CI gates (`sdk/ops/app_ci.py:442-449`)

The publish pipeline runs 6 gates against every app bundle. They define the minimum acceptable shape:

| Gate | Checks | When it skips |
|---|---|---|
| `manifest_lint` (lines 128-168) | `name` regex, `kind` enum, `tools[]` unique + described | — |
| `tools_resolvable` (lines 182-213) | every tool has `commands/<name>.py` (or matches a built-in) | — |
| `prompts_referenced` (lines 258-310) | every `prompts/*.md` is referenced in `commands/` or `skills/` Python | files matching template prefixes (`analyst_skill_`, `judge_`) |
| `autoresearch_yaml` (lines 410-436) | for `kind=autoresearch` only — declares 5 stages | other kinds |
| `install_smoke` (lines 316-358) | `pytest tests/` runs cleanly in a temp copy | no `tests/` dir, no pytest in env |
| `dco_signoff` (lines 364-404) | every commit since origin/main has `Signed-off-by:` | not a git repo |

`/lumid app_validate <name>` runs all six locally; `/lumid app_publish` requires all six to pass (or `skip_ci=True` for env-only failures).

## Reference apps

| App | Pattern | Loops | What it demonstrates |
|---|---|---|---|
| **personal-agent** | A | 4 (morning_brief, hourly_triage, cc_watcher, weekly_reflection) | Three-role multi-agent KG (assistant/watcher/philosopher), full privacy contract (watcher omitted from `auto_publish.memories[]`), inbox-question dialog, runner-driven steps[] |
| **auto-quant** | A | 10 (momentum_research, mean_reversion_research, crypto_autoinsight_research, crypto_lqa_research, regime_detector, competitor_observer, gpt_baseline_crypto, sonnet_baseline_crypto, gpt_auto_crypto, sonnet_auto_crypto) | Interval scheduling (`*/12h`), live mode with `--confirm-live`, observe → propose → backtest → risk-gate → place_order → journal flow |
| **mbb-ai** | B | 2 (case_cycle, regression_sweep) | Parallel fan-out (N-judge), conditional retry (info_release re-prompt), deterministic triangulation columns, ≥3-recurrence learn step closing the loop into bandit retrieval |
| **eventx** | B | 1 per registered task (e.g. consulting_market_match) | Pipeline DAG with idempotency gating on output table row counts, per-record dynamic skill loading, SQLite-backed cycle metrics |
| **auto-sysresearch** | B | 1 (benchmark, @trigger) | `benchmarks[]` first-class schema, three-tier variant search space (component + policy + params), Docker container lifecycle via `container_dispatch`, 20-query NL-to-SQL eval with in-process SQLite. Fork by swapping `system/` and updating `benchmarks[]` + `variant_schema`. |

## Documentation-only `steps[]` for Pattern B

For Pattern B loops, `steps[]` and `skills_invoked[]` exist for two reasons:

1. **`prompts_referenced` CI gate** reads them to confirm every prompt card is wired to a skill.
2. **Dashboard `/admin/loops`** renders them so an operator expanding a row sees what the engine actually does.

The runner does NOT enforce step ordering on Pattern B — `engine.module` is the truth. Honest declaration matters: list every skill the verb invokes, including the ones not in any loop's `steps[]` ordered list. mbb-ai's `case_cycle` declares 18 `skills_invoked[]` (vs the 7 steps the manifest used to list); eventx's `consulting_market_match` declares 8.

## Running loops manually

```bash
# Run one loop once (on-demand, bypasses the scheduler)
lumid research run <loop_name>

# Run N cycles with an interval between each
lumid research run <loop_name> --cycles 3 --interval 60

# Example: run one cycle of the crypto insight loop
lumid research run crypto_autoinsight_research
```

`lumid research run` resolves the loop name to its parent app by scanning
`~/.xp/apps/*/xpcloud.yaml`, then dispatches `app_runner.cycle(app, loop)` for each
requested cycle. This is identical to what the scheduler fires on cron trigger —
`_run_auto_publish()` runs after every cycle, so insights.md and memory banks update
correctly.

## Deferred work via `submit_jobs`

The inline cycle is fast enough for live trading, but heavier work (long backtests, GPU inference, daily LLM-driven memos) should be dispatched as a job and either picked up later or fired on a recurring schedule. The opt-in `submit_jobs` skill family lives at `sdk/skills/submit_jobs/`:

| Skill | When | Backend |
|---|---|---|
| `submit_jobs.flowmesh` | GPU inference, training fans, deep backtests | `POST kv.run:8000/flowmesh` |
| `submit_jobs.lumilake` | HALO-optimised DAGs, multi-stage ETL | `POST lum.id/lumilake-api` |
| `submit_jobs.cron` | Recurring shell command OR recurring `claude -p` prompt | the same `lumid-scheduler` daemon that runs xpio loops |
| `submit_jobs.get_result(job_id, wait=False)` | Read result back (cross-cycle or in-cycle) | reads `~/.lumilake/jobs.jsonl` ledger |

### `submit_jobs.cron` — two modes, one queue

```python
# Spec mode — any shell command (lumid verbs, curl, pipelines)
run(spec='lumid app auto-quant cycle momentum_research',
    schedule='0 4 * * *', kind='nightly_recompute')

# Prompt mode — recurring `claude -p` without authoring an xpio app
run(prompt="Summarize today's BTC moves and write a memo",
    schedule='0 8 * * *', kind='daily_brief',
    model='claude-sonnet-4-6')
```

Both modes append to `~/.lumilake/scheduler/cron_jobs.json` AND record a `scheduled` row in `~/.lumilake/jobs.jsonl`. The writer then sends `SIGHUP` to `~/.lumilake/loops.pid` so the daemon picks up the new entry within ~2 s instead of waiting up to 10 min for the next refresh tick.

Fire path (`sdk/scheduling/cron_executor.py:145`): prompt mode invokes `claude -p --model <model> "<prompt>"` (the binary is bind-mounted into the scheduler container at `/usr/local/bin/claude`); spec mode `sh -c "<spec>"`. Stdout is captured (16 KB tail-truncated) and lands in the ledger row AND a persistent file at `~/.lumilake/scheduler/results/<job_id>.txt`. Default per-fire timeout 600 s; override via `entry["timeout_s"]`.

### Daemon lifecycle (matters for fresh users)

The `lumid-scheduler` daemon stays alive at startup even when there are zero xpio loops AND the cron queue is empty — a fresh-install user always hits this. The intent: the user submits later, the daemon should still be there. `SIGHUP` forces an immediate `refresh()` so just-submitted jobs fire without waiting for the next 600 s tick. Submissions still arrive (and get picked up) on the next refresh tick if the daemon is restarting.

The unified ledger at `~/.lumilake/jobs.jsonl` is the single read source for `/dashboard/jobs` and the place to debug from. State transitions: `scheduled → running → succeeded | failed`.

## Files of record

| Path | What |
|---|---|
| `sdk/apps/app_runner.py:78` | `load_manifest()` — xpcloud.yaml is runtime |
| `sdk/apps/app_runner.py:1273` | `cycle()` entry point |
| `sdk/apps/app_runner.py:1159` | `_run_command_engine()` (Pattern B) |
| `sdk/apps/app_runner.py:1720` | `_run_explicit_steps()` (Pattern A) |
| `sdk/apps/app_runner.py:455` | `_run_auto_publish()` (privacy contract) |
| `sdk/apps/app_runner.py:757` | `_post_inbox_message()` |
| `sdk/apps/app_runner.py:935` | `_pull_inbox_replies()` |
| `sdk/apps/app_runner.py:46` | `_VALID_MODES` enum |
| `sdk/apps/app_runner.py:181` | `_load_skill_module()` (skill resolution) |
| `sdk/ops/research.py:159` | `_resolve_loop_to_app()` + `run_loop()` CLI dispatcher |
| `sdk/scheduling/xpio_scheduler.py:103` | `discover_loops()` |
| `sdk/ops/app_ci.py:442-449` | the 6 publish gates |

## Out-of-scope future work

- **Auto-port tool** (`/lumid app upgrade <name>`) for converting old-shape manifests to canonical xpcloud.yaml.
- **Pattern A enhancements** for replacing some Pattern B engines: `step.parallel: true` (replace mbb-ai's fan-out), `step.skip_if_table_has_rows: <name>` (replace eventx's idempotency gates).
- **Cross-app meta-loops** (e.g. one loop that invokes another app's loop). Currently every loop is single-app.

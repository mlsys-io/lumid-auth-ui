# xpio Autoresearch Loop — Canonical Reference

Status: stable (2026-05-09). The canonical contract every xpio app should target. The runtime is `sdk/apps/app_runner.py`. This doc cites file:line for every claim so it stays anchored when the runner evolves.

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

# Privacy contract — explicit allowlist; unlisted agents stay LOCAL
auto_publish:
  every: 1
  memories:
    - {agent: "<user>-personal-assistant"}
  skills:    {enabled: false}
  artifacts: {enabled: false}

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

## Pattern A — runner-driven loop

The runner walks `steps[]` in order. Each step is one skill call; outputs flow into `prev_outputs` so later steps can reference earlier ones.

```yaml
loops:
  - name: morning_brief
    schedule: "0 8 * * *"           # cron
    primary_role: assistant
    knowledge_agent: "<user>-personal-assistant"
    mode: paper                     # ∈ {paper, live, simulate, semi, explore}  app_runner.py:46
    skills:                         # set membership; informational
      - calendar/observe
      - email/observe
      - reflect/write_brief
    steps:                          # ordered execution; runner contract
      - {id: observe_cal,    skill: "calendar/observe",    knowledge_agent: "<user>-personal-assistant"}
      - {id: observe_email,  skill: "email/observe",       knowledge_agent: "<user>-personal-assistant"}
      - {id: compose_brief,  skill: "reflect/write_brief", knowledge_agent: "<user>-personal-philosophy"}
```

**Step contract** (`_run_explicit_steps()`, `app_runner.py:1136-1310`):
- `id` (required): unique within the loop; outputs land in `prev_outputs[id]`.
- `skill` (required): resolves via `_load_skill_module()` (`app_runner.py:105-170`). Sub-paths (`claude_code/scan_sessions`) translate slashes to dots (`skills.claude_code.scan_sessions`).
- `knowledge_agent` (optional): falls back to the loop's `knowledge_agent`, then the role's `memory_agent`. Top-k memories from this agent are rendered as `prior_knowledge` and injected into the skill's context.
- `required: true` (optional): abort the cycle on this step's failure. Default = continue.
- `args: {}` (optional): static kwargs forwarded into `mod.run(**args)`.
- `instructions: |` (optional): **per-step operator instructions** — plain-English text that the runner splices into the skill's prompt as an OPERATOR INSTRUCTIONS block. Backwards-compat: when absent, no block is injected and old apps work unchanged. See the Per-step operator instructions section below.

**Skill `run()` signature.** Every skill exposes:
```python
def run(*, context: dict | None = None, **kwargs) -> dict:
    # context["prev_outputs"][prev_step_id] is your input
    # context["prior_knowledge"] is the rendered memory block
    # context["step_instructions"] is the resolved instructions text (str | None)
    # kwargs["instructions"] is the same value when the step has instructions
    # return value lands in prev_outputs[this_step_id]
    return {"records": [...], "errors": 0}
```

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

The correct Python environment for manual CLI operations is `/home/webmaster/lumid/.venv/bin/python3` (has `httpx`, `yaml`, `tomli`, etc.). System Python (`/usr/bin/python3`) lacks pip entirely.

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
| **auto-quant** | A (legacy 7-phase) | 4 (momentum, mean-reversion, crypto-autoinsight, crypto-lqa) | Interval scheduling (`*/12h`), live mode with `--confirm-live`, observe → propose → backtest → risk-gate → place_order → journal flow |
| **mbb-ai** | B | 2 (case_cycle, regression_sweep) | Parallel fan-out (N-judge), conditional retry (info_release re-prompt), deterministic triangulation columns, ≥3-recurrence learn step closing the loop into bandit retrieval |
| **eventx** | B | 1 per registered task (e.g. consulting_market_match) | Pipeline DAG with idempotency gating on output table row counts, per-record dynamic skill loading, SQLite-backed cycle metrics |
| **auto-sysresearch** | B | 1 (benchmark, @trigger) | `benchmarks[]` first-class schema, three-tier variant search space (component + policy + params), Docker container lifecycle via `container_dispatch`, 20-query NL-to-SQL eval with in-process SQLite. Fork by swapping `system/` and updating `benchmarks[]` + `variant_schema`. |

## Documentation-only `steps[]` for Pattern B

For Pattern B loops, `steps[]` and `skills_invoked[]` exist for two reasons:

1. **`prompts_referenced` CI gate** reads them to confirm every prompt card is wired to a skill.
2. **Dashboard `/admin/loops`** renders them so an operator expanding a row sees what the engine actually does.

The runner does NOT enforce step ordering on Pattern B — `engine.module` is the truth. Honest declaration matters: list every skill the verb invokes, including the ones not in any loop's `steps[]` ordered list. mbb-ai's `case_cycle` declares 18 `skills_invoked[]` (vs the 7 steps the manifest used to list); eventx's `consulting_market_match` declares 8.

## Files of record

| Path | What |
|---|---|
| `sdk/apps/app_runner.py:78-85` | `load_manifest()` — xpcloud.yaml is runtime |
| `sdk/apps/app_runner.py:929-1010` | `cycle()` + `_run_command_engine()` |
| `sdk/apps/app_runner.py:1136-1310` | `_run_explicit_steps()` (Pattern A) |
| `sdk/apps/app_runner.py:325-414` | `_run_auto_publish()` (privacy contract) |
| `sdk/apps/app_runner.py:597-916` | `_post_inbox_message()` + `_pull_inbox_replies()` |
| `sdk/apps/app_runner.py:46` | `_VALID_MODES` enum |
| `sdk/apps/app_runner.py:105-170` | `_load_skill_module()` (skill resolution) |
| `sdk/scheduling/xpio_scheduler.py:96+` | `discover_loops()` |
| `sdk/ops/app_ci.py:442-449` | the 6 publish gates |

## Out-of-scope future work

- **Auto-port tool** (`/lumid app upgrade <name>`) for converting old-shape manifests to canonical xpcloud.yaml.
- **Pattern A enhancements** for replacing some Pattern B engines: `step.parallel: true` (replace mbb-ai's fan-out), `step.skip_if_table_has_rows: <name>` (replace eventx's idempotency gates).
- **Cross-app meta-loops** (e.g. one loop that invokes another app's loop). Currently every loop is single-app.

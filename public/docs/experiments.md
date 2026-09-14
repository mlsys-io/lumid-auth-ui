# Workflows and experiments

A **workflow** is a loop your app runs. An **experiment** is a workflow plus two
things: a **metric** — the key its runs emit, which is what gets aggregated —
and a **scope**, the dataset or case list it is measured over.

A workflow with neither is *just a workflow*, and that is a perfectly good thing
to be. It runs, and its output shows on its own row. Nothing here asks you to
promote it.

| | metric | scope | arms |
|---|---|---|---|
| **Workflow** | — | — | — |
| **Experiment** | required | required | optional |

**Arms** are what turn an experiment from a *level* into a *comparison*. One arm
tells you a number. Two tell you which is better. The worked example below has
three, and the third changed the conclusion.

---

## 1. Create an experiment

Two routes. They write the same thing.

**From the Experiments tab** — open your app and choose **Experiments**. Every
experiment the app declares is listed there with its metric, its scope, its arms
and its state. It is a *reading* surface: to create one, open **Workflows**,
select a loop that has no experiment yet, and use the **Measurement** form. A
loop that already feeds an experiment shows that experiment instead, so a second
experiment on the same loop is a chatbox job — which is exactly how
`analyst_local_gpu` and `judge_panel_parity` both came to feed `case_eval`.

**From the chatbox**, in words:

> make case_eval an experiment measuring avg_question_score over cases_v1

Either way the definition is **queued as an intent**; the scheduler applies it to
your own tenant's copy of the app. You get an intent id back, not a promise —
poll it if you need certainty.

Two guards fire at define time, and both refuse rather than warn:

| You omit | You get |
|---|---|
| the metric | *"a loop WITHOUT a metric is a workflow, not an experiment"* |
| the scope | *"a threshold counted over an undefined population cannot be interpreted"* |

A third guard **warns** instead. If an arm names a model the gateway does not
serve, you are told at define time:

> the gateway does not serve `gemma4` — it would not error, it would ABSTAIN,
> silently shrinking the panel

That matters more than it sounds. A dead judge seat does not fail; it abstains,
and a "median of three" quietly becomes a panel of one while every number on
screen still looks healthy.

### Writing success_criteria

The expression is evaluated against a fixed set of names, and **nothing else is
in scope**:

| name | is |
|---|---|
| `n` | rows counted, all arms |
| `best_n`, `best_mean` | the winning arm's count and mean |
| `baseline_n`, `baseline_mean`, `baseline_value` | the baseline's |
| `delta`, `delta_pp` | best minus baseline, direction-normalised |
| `mean_<arm_id>` | one arm's mean, by its declared id |

**There are no function calls.** `abs(delta_pp) < 2` is not a comparison that
fails — it cannot be evaluated at all, and an expression that cannot be
evaluated reads exactly like one that is not yet met. Write it out:
`(a - b) < 2 and (b - a) < 2`. The same is true of a mistyped name:
`mean_qwen7b` where the arm is `qwen7b_local` is one character between a
criterion that decides the experiment and one that can never be true.

Both are refused at define time now, and the refusal names the arms that exist.

### Adding an arm

`define_experiment` creates the experiment. It does **not** add arms — ask for
one directly:

> add an arm to analyst_local_gpu called qwen14b_local that uses
> lumilake:home:Qwen/Qwen2.5-14B-Instruct-AWQ as the analyst, same judge panel

An arm id that already exists **replaces** that arm; any other id appends. Two
arms sharing an id would be averaged together, so replacing is the only sane
reading of a repeat.

---

## 2. View status

The **Experiments** tab is the status surface.

![The Experiments tab. Each experiment carries its state, its arms, its sample count, and — once the criteria are met — its verdict.](/docs/img/experiments-surface.png)

Read the chips left to right:

| Chip | Means |
|---|---|
| `collecting` | rows are arriving, criteria not yet met |
| `criteria met` | the declared `success_criteria` evaluated true |
| `2 arms · 1 never run` | a declared arm that has produced nothing |
| `52 results` | rows carrying the **declared metric**, across all arms |
| `52 of 78 rows` | 26 rows are in the ledger and carry something else — hover for the keys they do carry |

**`no results yet` and `metric mismatch` are different states.** The first means
wait. The second means waiting will not help — your declared metric name matches
nothing your runs emit — and it names the keys that *were* emitted so you can
copy the right one. That distinction cost one app 19 recorded runs across three
tenants before it existed.

---

## 3. Harvest results

Open a workflow row to see what a run produced.

![A workflow's detail: Metric & arms, the Outputs tier, and the run tree.](/docs/img/experiments-workflows.png)

- **Metric & arms** — the experiment this loop feeds, in place, so a result is
  never in only one of the two tabs.
- **Outputs** — the latest run's final artifact, served from the run store.
  Per-step detail and the LLM transcript are *not* available: they live only in
  the cycle directory on the scheduler's volume, which the API service does not
  mount. Those surfaces now say so rather than rendering as empty, which used to
  be indistinguishable from a workflow nobody had run.
- **Run tree** — each run as a node with its score and delta. `NOT SCORED` is a
  real state, not a gap.

### The two words that decide what pools with what

`compare_within` and `dataset_version` are the fencing mechanism, and they are
the most load-bearing things an author writes after the metric itself.

- **`compare_within: [panel]`** declares which `dims` make up the *instrument*.
  Rows measured under different values of those dims are a different instrument,
  and the ranking is withheld rather than attributing the instrument's effect to
  the arm. mbb-ai once published a six-arm verdict scored by five different
  judge panels.
- **`dataset_version`** is a cohort label. `evaluate()` reads only the newest,
  so bumping it fences everything before it out of the comparison without
  deleting anything. See §6.

A verdict only appears when the experiment can support one. If two arms were
measured under **different instruments** — a different judge panel, a different
dataset version — the ranking is withheld and the experiment says
`not comparable` instead of naming a winner. An argmax over arms scored by
different instruments measures the instrument as much as the subject.

---

## 4. Discuss the results in the chatbox

Ask in the chat docked beside the app:

> how did the analyst_local_gpu experiment turn out? give me the numbers per arm

![The chatbox answering from the experiment ledger, with the per-arm table and the caveats.](/docs/img/experiments-chat-results.png)

It reads the ledger through `list_experiments` and answers from it — per-arm
means, sample sizes, the delta, and whether the success criteria are met. It
will also tell you what the verdict line does not: in the run above, the standard
deviation is roughly 0.29–0.33 on a 0–1 score, which is large next to a 0.204
delta.

**Significance is computed, and it can withhold the winner.** Every arm pair
carries a difference, a standard error and a 95% interval, on the `Δ vs best`
column of the variants table. When the best arm's interval against the baseline
crosses zero, `best_variant` is withheld entirely and the card says so — the
same thing the comparability guard does, for the same reason: keep every number
that is a fact, withhold the claim the data cannot support.

Where the arms answered the **same subjects**, the comparison is *paired*, which
is usually a large difference. The worked example below is paired over 26
`(case_id, q_id)` units and the standard error is about a third smaller than the
unpaired equivalent. Pairing is used only where it helps: two arms sharing few
subjects are compared unpaired, because a paired test over a small overlap
discards the rest of the evidence.

---

## 5. The chatbox as control plane

The same chat that reads the experiment can change it. The loop is:

**define → run → inspect → discuss → dispatch the next arm** — and every step of
it is reachable in words.

![Adding an arm from chat: the request, the tool call, and the confirmation.](/docs/img/experiments-chat-controlplane.png)

| Say | Reaches |
|---|---|
| "make X an experiment measuring M over D" | `define_experiment` |
| "list the experiments on this app" | `list_experiments` |
| "how did X turn out" · "which arm won" | `experiment_status` |
| "add an arm with deepseek as judge" | `add_experiment_arm` |
| "replace the qwen14b arm so it uses the AWQ build" | `add_experiment_arm` (replaces by id) |
| "run the median-panel arm" | `dispatch_experiment_arm` |
| "we're done with this experiment" · "archive it" | `experiment_control` (conclude / archive) |
| "the rubric changed — start a fresh cohort" | `experiment_control` (checkpoint) |
| "fork this with a new arm set" | `experiment_control` (fork) |
| "remove the qwen14b arm" · "undo that" | `experiment_control` (remove_arm / revert) |
| "which cases dragged it down" | `experiment_case` |

A request the router does not recognise falls through to the general assistant,
which cannot see the experiment registry. You will know: it answers that it has
no numbers rather than inventing any. Rephrase toward the verbs above.

---

## 6. Finishing one

An experiment that is done should say so. `status` has three terminal-ish
states and the card reads all of them:

| Say | What happens |
|---|---|
| "conclude the experiment" | `status: concluded`, with your reason recorded on the entry |
| "archive it" | `status: archived` — done and out of the way |
| "the rubric changed, checkpoint it" | `dataset_version` bumps |
| "fork this with a new arm set" | a new experiment, the original untouched |
| "undo that" | the definition is restored from before the last control op |

**A checkpoint fences; it does not delete.** `evaluate()` partitions rows by
`dataset_version` and reads only the newest cohort, so bumping the label stops
everything measured so far from diluting the comparison *while leaving every row
on disk*. That is what you want when the instrument changes underneath a running
study — a new rubric axis, a judge seat added — and it is why a checkpoint
**requires a reason**: a fence nobody recorded a motive for is unreadable six
weeks later, and the two apps that were doing this by hand had to write
paragraphs of YAML comments to compensate.

**Prefer forking to editing a running experiment.** A fork copies the metric and
the scope under a new id with the arms you name and starts its own cohort. On
2026-09-13 a re-bind of a finished 52-row experiment erased both its arms; every
control operation now snapshots the definition it is about to replace, and
`revert` restores it, but not doing the destructive thing is better than being
able to undo it.

---

## A worked example

`analyst_local_gpu` on `mbb-consultant` asks whether a local GPU is worth using
for the analyst, holding the judge panel constant. Three arms, 26 questions each,
one instrument:

| Arm | Analyst | Mean | n | Stdev |
|---|---|---|---|---|
| `gemma4_local` | Gemma-4 12B, 4-bit QAT | **0.497** | 26 | 0.326 |
| `qwen14b_local` | Qwen2.5 14B, AWQ 4-bit | 0.458 | 26 | 0.327 |
| `qwen7b_local` (baseline) | Qwen2.5 7B, bf16 | 0.294 | 26 | 0.287 |

All three arms answered the **identical 26 `(case_id, q_id)` units**, so every
comparison below is paired — and pairing is what makes two of them resolvable:

| pair | Δ | 95% CI (paired) | unpaired t | paired t |
|---|---|---|---|---|
| gemma4 − qwen7b | +0.204 | [+0.088, +0.320] | +2.39 | **+3.61** |
| gemma4 − qwen14b | +0.040 | [−0.051, +0.130] | +0.44 | +0.90 |
| qwen14b − qwen7b | +0.164 | [+0.033, +0.296] | −1.92 | **+2.57** |

The declared verdict is *"gemma4_local by +20.4pp vs qwen7b_local"*, the criteria
are met, and the interval against the baseline is clear of zero — so the winner
stands. The card adds what the verdict line cannot: **not separable from
qwen14b_local**, whose interval crosses zero. The honest reading is "both large
local models beat the 7B baseline by a wide margin, and are not separable from
each other".

Note the third row. Compared across units it is t = −1.92 and reads as
indistinguishable; compared *within* unit it is +2.57 and separates. The pairing
was always available in the rows — the arms answered the same questions — and
using it is worth about a third of the standard error. The hover on that column
also carries the number that usually matters most: separating gemma4 from
qwen14b would need roughly **250** paired questions against the 26 already run.

Two caveats travel with that table, and both are the experiment's, not the
platform's:

- **A confound.** Both large arms are 4-bit quantized; the baseline is bf16.
  Size and quantization move together, so this does not isolate "bigger model".
  Neither large model fits the 24 GiB card unquantized — that is *why* they are
  quantized, and it is worth writing into the arm's own description so the next
  reader sees it.
- **The criteria name two arms explicitly**, so the verdict string keeps
  comparing gemma4 to qwen7b even with a third arm present and 4 points behind.

An experiment reports what you declared. Reading it is still your job.

---

## A second worked example — a different shape entirely

`kol_alpha` on `quant-research` asks whether a KOL-conditioned strategy
parameterization survives recorded market history. Same machinery, and almost
nothing else in common with the one above.

![kol_alpha on the Experiments tab — collecting, 2 arms with 1 never run, 3 results.](/docs/img/experiments-kol.png)

**Its metric is a gate, not a score.** `real_tape` is `1` or `0`: did this
backtest replay real market history with all three axes real? *"Higher is
better"* on a boolean means "more often honest", not "better PnL". An experiment
is free to measure whether a result deserves to exist at all, and this one does
that before anything measures how good it is.

**Its workflow has two actions, and only one of them emits the metric.**
`kol_strategy` runs `--action generate` to build and submit a strategy, then
`--action poll` to resolve the claim once the backtest lands:

| Action | Emits |
|---|---|
| `generate` | `generated`, `compiled`, `lean` |
| `poll` | `real_tape`, `all_axes_real`, `prints_replayed` |

### Why it says 3 results when the ledger holds 14

Eleven of those rows came from `generate` and carry none of the declared metric,
so `evaluate()` skips them. That is correct — and the card says it now: the
results chip reads **`3 of 14 rows`**, and hovering it lists the keys those rows
do carry. Until recently only the *all*-zero case was explained, so a partial
drop like this one was invisible; across the estate 364 of 1,558 rows are in
that position. Ask the app and you get the same list:

```
keys emitted: all_axes_real, compiled, generated, lean, prints_replayed, real_tape
```

Seeing `generated` and `compiled` sitting beside `real_tape` tells you the gap is
*stage*, not a typo. A metric name that matched nothing at all would say so in
the same breath.

### Why it is not concluding

Two reasons, both visible on the card:

```
success_criteria:  best_n >= 10 and delta_pp >= 0
best_n = 3         2 arms · 1 never run
```

- **Not enough resolved polls.** Three rows carry `real_tape` — `1`, `0`, `0`,
  a mean of 0.33. One backtest replayed 12,378 real prints; two replayed none.
- **The baseline arm cannot run.** `baseline: {arm: current}` names `current`,
  the hand-submitted reference, and `current` declares nothing but an id and a
  description — there is no configuration for a dispatch to vary, which is why
  the panel marks it **measured passively** rather than offering a button. So
  `delta_pp` is never bound, and the criterion cannot be satisfied however many
  rows `musk_v1` collects.

**This is not fixed by running the baseline.** An earlier version of this page
said it was, and that advice was impossible to follow. Defining an experiment
in this shape now warns at define time — *"success_criteria needs a delta
against baseline `current`, but that arm declares no configuration beyond
id/description"* — and the same sentence appears on the card as the reason it is
not concluding.

There are two honest repairs, and which one is right is a question about the
experiment, not the platform:

1. **Make the arm change the run.** Have the command read the arm's config, with
   `current` meaning *no KOL conditioning* — the static parameterization the
   hypothesis actually names. The baseline becomes dispatchable and the delta
   criterion works as written.
2. **Drop the delta.** Accept it as a one-armed gate measurement:
   `best_n >= 10` on `real_tape` alone, no reference arm. Less work, still
   truthful, but it answers a narrower question than the hypothesis states.

Four other live experiments carry the same shape. It is a class, not a typo.

### What the two examples have in common

| | `analyst_local_gpu` | `kol_alpha` |
|---|---|---|
| Metric | a score, 0–1 | a gate, 0 or 1 |
| Treatment | the analyst model | the parameterization |
| Held constant | the judge panel | the backtest machinery |
| Scope | `cases_v1` | `musk_tweets_v1` |
| Dispatch | on demand, batched | `@trigger`, two actions |
| State | criteria met, 78 rows | collecting, 3 of 14 rows counted |

Different subjects, different metric semantics, one set of rules: declare what
you measure, declare what you measure it over, hold the instrument constant, and
let the ledger say when it has enough. Neither experiment was told what a good
result looks like — only what to record.

---

## Changelog

- **1.1.0** (2026-09-14) — Significance, the lifecycle, and five corrections to
  this page.

  **Corrections, one of which was impossible to follow.** This page said
  `kol_alpha` could not conclude because its baseline "has never run" and that
  the fix was to run it. `current` declares nothing for a dispatch to vary, so
  it *cannot* be run; § *A second worked example* now names the two honest
  repairs. It also said the Experiments tab has a define form (it reads — you
  create from a workflow row), that `52 results` counts rows in the ledger (it
  counts rows carrying the **declared metric**), that an empty Outputs tier
  means this tenant has not run the loop (per-step detail and transcripts are
  not available on this deployment at all), and that the platform does not
  compute significance.

  **It computes significance now, and can withhold the verdict.** Every arm pair
  carries a difference, a standard error and a 95% interval, on the new
  `Δ vs best` column. When the best arm's interval against the baseline crosses
  zero the winner is withheld and the card says why — the same thing the
  comparability guard already did, for the same reason. Comparisons are
  **paired** where the arms answered the same subjects, which on the worked
  example cuts the standard error by about a third and changes one conclusion;
  pairing is skipped where the arms share few subjects, because a paired test
  over a small overlap discards the rest of the evidence.

  **A criteria expression that can never be true is refused when you write it**,
  instead of reporting "not met" forever. There are no function calls in
  `success_criteria`: `abs(delta_pp) < 2` cannot be evaluated at all, and
  neither can a mistyped `mean_<arm>`. The refusal names the arms that exist.
  § *Writing success_criteria* has the full name vocabulary, which until now
  lived only in two apps' YAML comments.

  **Finishing an experiment is possible** (§ 6). `status: concluded | archived`
  had always been read by the card and nothing could write it. Conclude,
  archive, reopen, checkpoint, fork, remove an arm and revert are available from
  the card's overflow menu and from the chatbox. A checkpoint **fences** rather
  than deletes — and requires a reason.

  **Rows that do not count are visible.** The results chip reads `3 of 14 rows`
  when some carry no declared metric, with the keys they do carry in the
  tooltip; previously only the all-zero case was explained, so a partial drop
  was invisible. An arm that was dispatched and **kept failing** is now
  distinguished from one that was never run.

- **1.0.0** (2026-09-14) — First published: the loop from composing a workflow
  through defining a metric and scope, dispatching arms, reading results and
  discussing them in the chatbox, with two worked examples.

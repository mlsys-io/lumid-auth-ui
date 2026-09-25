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

Sections 1–8 are what a workflow is and how to measure one. Sections 9–16 are
the canvas you build one on.

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

**A Proposals candidate is held to the same two guards.** It used to be held to
only one of them: a candidate with no `dataset_id` and no `cases` verdicted
`will_collect` — "nothing found that would stop this recording rows" — and then
hit the scope guard the moment anyone tried to declare it. Measured 2026-09-21,
and the scope had to be invented by reading sibling experiments. A verdict that
calls a suggestion actionable when it cannot be accepted is worse than no
verdict, so a scope-less candidate now reads `will_be_invisible` with *no
dataset_id, cases or fixture* as the reason.

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

![KOL strategy's detail: kol_alpha under Metric & arms with its `why below min_samples (6/10)`, the Outputs tier reporting that the last run recorded no artifact, and the run tree.](/docs/img/experiments-workflows.png)

- **Metric & arms** — the experiment this loop feeds, in place, so a result is
  never in only one of the two tabs.
- **Outputs** — the latest run's final artifact, served from the run store.
  Per-step detail and the LLM transcript are *not* available: they live only in
  the cycle directory on the scheduler's volume, which the API service does not
  mount. Those surfaces now say so rather than rendering as empty, which used to
  be indistinguishable from a workflow nobody had run.
- **Run tree** — each run as a node with its score and delta. `NOT SCORED` is a
  real state, not a gap.

### Reading a run's arms on the canvas

When a run fanned out, the workflow panel offers one chip per arm above the
graph. The chip names the **arm** and where it landed — `baseline · 2 workers`,
`variant · w-5090-3` — and picking one re-points the status and the phase strip
at that arm's job, so what you are reading always matches what is selected.

![The workflow panel drawing one arm of a two-arm run: the arm chips with their
worker placement, the job's status, and the five job-level lifecycle
phases](/docs/img/workflows-panel-arms.png)

Two details that are deliberate rather than cosmetic. The chips appear **only**
when there is more than one job — a chooser that never has a second option is
noise. And `· split across sites` shows only when the arms really are split,
because that is the case where a latency difference is the fleet rather than
the arm.

The strip below them is labelled **job phases** for a reason: those five are
the job's lifecycle, not your graph's ops. See *There is no per-op state to
read*, below.

### Reading a run's arms over the API

The run tree shows this tenant's runs. The arms of a single **compute** run —
one dispatch fanned across workers — are read from the compute surface directly:

| Call | Returns |
|---|---|
| `GET /me/compute/jobs/:site/:job_id` | that job's status, gated per caller |
| `GET /me/compute/jobs/:site/:job_id/siblings` | the run's **other** arms, each with its `arm` label and its HALO `workers` map (op → worker placement) |
| `POST /me/compute/jobs` with `{site, job_id}` | claims a job you submitted |

Three things about that surface are easy to get wrong:

- **Ownership is required.** A job you do not own returns `404`
  `{"message":"no such job for this user"}` — **not** `403`, because a `403`
  would confirm the job exists.
- **A job id is meaningless without its site.** `cloud`, `home` and `office` are
  three separate Lumilake services; asking the wrong one returns not-found,
  which reads exactly like the ownership refusal.
- **A chat-dispatched job writes no run row**, so it is unreadable until you
  claim it. That is what the `POST` is for.

**There is no per-op state to read.** `GET /jobs/<id>/workflows` returns `[]`.
`GET /jobs/<id>/progress` is job-level only: five lifecycle phases — queuing,
query parsing, data probing, execution, outputs — plus `batch_progress`, whose
`completed` is a **count**, not a boolean. A run that looks stalled inside one
op cannot be diagnosed from here.

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

## 7. A worked example

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

## 8. A second worked example — a different shape entirely

`kol_alpha` on `quant-research` asks whether a KOL-conditioned strategy
parameterization survives recorded market history. Same machinery, and almost
nothing else in common with the one above.

![kol_alpha (shown as "kol alpha") on the Experiments tab — collecting, 3 arms with 2 never run, 6 results.](/docs/img/experiments-kol.png)

The counts below are from a cohort measured **2026-09-21**; an earlier cohort
this section was written against had been lost, and re-running `musk_v1`
rebuilt it. Expect your own numbers to differ — what is stable is the *shape*,
and the shape is the lesson.

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

### Why the results count is below the row count

Only `poll` emits the declared metric, so every `generate` row carries none of
it and `evaluate()` skips them. That is correct — and the card says so: the
results chip reads **`6 of 12 rows`** on the cohort above, and hovering it lists
the keys the dropped rows *do* carry. Until recently only the *all*-zero case was explained, so a partial
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
best_n = 6         3 arms · 2 never run
```

- **Not enough resolved polls.** Six rows carry `real_tape`, all of them `0` —
  a mean of 0.00, and the card says `below min_samples (6/10)`. None of these
  backtests replayed recorded prints at all, which is the metric doing its job:
  it is a gate on whether a result deserves to exist, and right now it is
  answering no. That is a finding about the strategy's symbol and window
  choice, not a fault in the experiment — and it is the exact question
  `backtest_evidence` exists to isolate.
- **The paired arms have not caught up.** The three arms are `current` (the
  same KOL generator with the tweet signal removed — the static
  parameterization the hypothesis names), `musk_v1` (a keyword-rule lean over the
  tweets), and
  `musk_llm_scored` (the same tweets, the lean scored by a model on the fleet).
  `current` used to declare nothing but an id, so no dispatch could vary it and
  `delta_pp` was never bound. It is now submitted **automatically in the same
  `kol_strategy` fire, on the same instrument**, as the treatment — each pair
  differs only in whether the tweets conditioned the parameters. Rows written
  before that change carry no pair, which is why this cohort still shows
  `current` as never run.

**Defining an experiment whose baseline cannot vary still warns** at define
time — *"success_criteria needs a delta against baseline `current`, but that arm
declares no configuration beyond id/description"* — and the card repeats it as
the reason it is not concluding. The repair `kol_alpha` took (make the baseline
arm change the run) is the general one; the alternative is to drop the delta and
accept a one-armed gate (`best_n >= 10` on `real_tape` alone), which is
truthful but answers a narrower question.

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

## 9. One canvas, five dialects

Everything above is about measuring a workflow. The rest of this page is the
surface you build one on.

Lumid has three runtimes that each take a different workflow language, plus two
foreign formats people arrive with. There is **one canvas** for all five. It
reads the dialect off the document — you never pick it from a menu.

The canvas is a **view of a document, not a replacement for it**. The YAML is
the source of truth; the graph is a projection of it, and an edit is a patch
applied at a path inside the document. That is the whole design, and everything
below follows from it.

| Dialect | What it is | On the canvas |
|---|---|---|
| **Lumilake ops** | our op DAG, authored here | **edit** — add, connect, delete, change parameters |
| **FlowMesh `flowmesh/v1`** | our task spec, authored here | **edit** — form for a single task, DAG for `spec.graph` |
| **xpio `loops[]`** | declarative app config | **edit the loop only** — the rest of the file is never touched |
| **n8n** | foreign export | **import only** — read, convert, never written back |
| **Dify** | foreign export | **import only** — read, convert, never written back |

The asymmetry is deliberate. Lumid has no n8n writer and no Dify writer, so
there is no round-trip to get wrong. An imported workflow becomes a Lumid
document and stops being an n8n one.

---

## 10. Open one

Go to [`/studio/workflows/new`](/studio/workflows/new), or press **New
workflow** on any app's **Workflows** or **Experiments** surface. Paste or
upload a definition, or start from the example that is already in the box.

There is no *Studio → Workflows → New* path: the sidebar has no Workflows
entry, and `/studio/workflows` is the **Workflow Market** — shared templates to
import, not your own workflows and not a place to create one.

**Design** and **YAML** are two views of one document. Switching between them
does not convert anything — there is nothing to convert.

![The workflow canvas with a node selected. The inspector shows that op's parameters with the schema's own help text; the unselected, unconnected node is dimmed.](/docs/img/workflow-editor.png)

Reading that screenshot:

- **`Lumilake · 4 nodes`** top right — the detected dialect and the node count.
  If this says something you did not expect, the document is not what you think
  it is.
- **`Ticker`** is dimmed because `Extract` is selected and they are not
  connected. Selecting a node dims everything outside its immediate
  neighbourhood — the node plus whatever it is directly wired to, both
  directions.
- The inspector's help text comes from the op schema, not from us writing prose
  twice. `Template` says *"Python `str.format` syntax"* because that is what
  `FormatOp` actually does.

### The one document, in text

![The same workflow in the YAML view. This is the document; the canvas is a projection of it.](/docs/img/workflow-yaml.png)

**Your file comes back as your file.** Comments, key order and formatting
survive a round trip through the canvas. Edits are applied as patches to the
parsed document, not by regenerating it from the graph. This matters most for
xpio loops, which are hand-authored files under version control — regenerating
one would be vandalism of something a person wrote.

The one thing that does *not* survive, and it is a real limitation: if you edit
a file through the canvas, **comment *alignment*** can change (the column a
trailing comment sits in). The comments themselves are kept.

---

## 11. Reading a graph

Three channels carry meaning, and they never overload each other:

| Channel | Carries | How |
|---|---|---|
| Colour + icon | what kind of thing it is | a tinted accent rail on the left edge |
| Ring | status | a ring around the card, never a border repaint |
| Edge style | what the relationship *is* | see below |

Edges are not all the same relationship, and drawing them as if they were is
how graph UIs mislead people:

- **solid, arrowed** — real data dependency. The output of one goes into the
  next.
- **dashed with a mid-line chip** — *declared*, not ordered. An xpio loop's
  `skills_invoked[]` says which skills a step uses; the contract explicitly
  does **not** say in what order. Drawing that as a pipeline would invent a
  guarantee that does not exist.
- **dotted, entering from below** — *attached*. An n8n language-model node
  plugs **into** the node it serves; it is not a step the data flows through.
- **labelled chip** — a branch, carrying its condition.

When a run overlay is applied, a node is marked succeeded only on its own
result, and an **edge** is marked succeeded only when **both** ends succeeded —
so the path that actually executed is traced through the graph rather than
inferred by eye.

---

## 12. Moving around

This is worth stating plainly, because the defaults in this class of component
are usually wrong and ours were wrong twice:

| Gesture | What happens |
|---|---|
| **Wheel / two-finger scroll** | **scrolls the page.** The canvas never traps it |
| **Ctrl / ⌘ + wheel** | zooms the canvas |
| **Drag empty canvas** | pans |
| **Controls pill**, bottom left | zoom in, zoom out, fit to view |

The canvas sits inside a scrolling page, so the page owns the wheel. A canvas
that eats your scroll as you read past it is the single most irritating thing
an embedded graph can do.

---

## 13. The inspector

Click a node. Three tabs:

**Parameters** — the fields for that node kind, from a schema, with the
schema's own help. Required fields are marked. An unknown node kind falls back
to editing that node's YAML subtree directly, so a node type we do not have a
schema for is still editable rather than a dead end.

**Run** — that node's last run: duration, output, error. The tab is always
there; without a run overlay it says *"This node has not run in the selected
cycle."* rather than disappearing, so a node you expected results for tells you
it has none instead of silently offering one tab fewer.

**YAML** — the document, scoped to *this node*, read-only. It is there so you
can see exactly what the form is writing; edit in the form, or in the page's
YAML view.

---

## 14. xpio loops

An xpio app's `.xpcloud.yaml` declares `loops[]`. Paste one and the canvas
renders the loop with its stages as bands.

![An xpio loop. Stage bands down the left, the schedule as a trigger node, the experiment badge on the step that feeds one, and the knowledge bank the loop writes into.](/docs/img/workflow-xpio.png)

The bands are the loop's own `stage:` values — `observe`, `analyze`, `learn`
above. The trigger card is the `schedule:`. The flask badge on
`analyze_papers` marks a step feeding an experiment. The card at the bottom is
the knowledge agent the loop ingests into.

**What the canvas will not let you do**, because the contract forbids it:

- **Draw an arbitrary edge.** `steps[]` is a sequence and `skills_invoked[]` is
  unordered. Neither admits a free-form edge, so connecting two nodes by hand
  is refused rather than silently written.
- **Touch anything outside `loops[]`.** Roles, datasets, skills and manifest
  metadata are never rewritten.

### One case where structural editing is refused outright

If the document uses **YAML anchors** on or above the part you are editing
(`skills: &id001` … `skills_invoked: *id001`, which real installed apps do use),
the canvas will not patch that subtree — it offers the YAML tab and says why.
Writing through an alias changes text somewhere else in the file, which is
exactly the surprise the document-first design exists to prevent.

---

## 15. FlowMesh tasks

A FlowMesh task is usually **one** node, and a canvas showing one box is a
worse form than a form. So a single-task spec is inspector-first.

Add a `spec.graph` and it becomes a real DAG:

![A FlowMesh spec with spec.graph: two branches fanning into a synthesis node, each card showing its requested hardware.](/docs/img/workflow-flowmesh.png)

Each card shows what that node asked the scheduler for. Adding a second node to
a single-task spec rewrites `spec:` into `spec.graph.nodes[]`, which is a real
change to the shape of your document — so it **asks first**, once, and says what
it is about to do. Decline and the file is left byte-identical; accept and it is
one step, so a single undo reverses it.

---

## 16. Importing from n8n or Dify

Paste an n8n or Dify export and the canvas reads it immediately — you do not
have to convert it first to see what you have.

![An n8n workflow rendered natively. The dotted languageModel edge shows the model attaching into the chain node rather than feeding it.](/docs/img/workflow-import-preview.png)

Note the banner: it is viewable, and usable as a starting point, but **never
written back**. Note also the `languageModel` edge — dotted, entering from
below. That is the `attach` relationship; drawing it like a data edge would
claim the model is a step in the pipeline.

**Import…** converts it, and the dialog says exactly what you are getting:

![The import dialog: four of five n8n nodes not imported, each with the reason; credential and attachment warnings; and what FlowMesh's own parser would accept if you submitted the original instead.](/docs/img/workflow-import-dialog.png)

This dialog is deliberately unflattering. Four of five nodes did not come
across, and each one says why — including the one that is *not* a loss
(`OpenAI Chat Model` is a model provider, so it was folded into the op it was
attached to rather than becoming an orphan node).

**What never imports:** credentials, always. Expressions — n8n's `{{$json.x}}`
and Dify's `{{#node.var#}}` — are not translated; topology and prompts are.
Any node kind with no equivalent op.

**The alternative the dialog points at** is the honest one: if you want the
original to run *as it is*, submit it with `Workflow-Format: n8n` and let the
runtime that owns those semantics execute it. Importing is for when you want it
to become a Lumid workflow.

---

## Known limits

- **Code fields are plain text, not a syntax-highlighted editor.** They were a
  full editor that never once loaded in production — it fetches itself from a
  CDN our Content-Security-Policy blocks, so the box sat on *"Loading…"*
  forever. They are now a mono textarea that works. A field holding a
  structure (`messages`, say) accepts JSON or YAML and tells you if what you
  typed is neither, rather than saving something the runtime will choke on
  later.
- **Expressions are not translated on import** (above). Topology and prompts
  come across; the plumbing between them does not.
- **Positions are not stored in your document, or anywhere else.** Layout is
  computed from the graph every time. Dragging a node moves it for as long as
  the canvas is open; nothing is written to the file, and nothing survives a
  reload. A workflow in git therefore never carries one person's canvas
  arrangement — which is the point — but it also means an imported n8n or Dify
  graph is re-laid out rather than opening in the arrangement it had in the
  tool it came from.
- **No credentials manager, no expression language, no webhook registry.** They
  are not missing pending work; they are outside what this is.

---

## Changelog

- **1.2.0** (2026-09-20) — One page. *Workflows and experiments* and *The
  workflow canvas* were always one story told twice — what a workflow is and how
  to measure one, then the surface you build it on — so they are merged here
  under one slug. Nothing was rewritten: §§1–8 and §§9–16 are the two pages'
  own prose, renumbered into a single run.

  **Reading a run's arms over the API** is new (§3). A compute job's status,
  its sibling arms with their `arm` labels and HALO worker placement, and the
  claim verb for a chat-dispatched job that wrote no run row. Ownership is
  required and the refusal is a `404`, not a `403` — a `403` would confirm the
  job exists. A job id is meaningless without its site: `cloud`, `home` and
  `office` are three separate services. There is no per-op state on this
  surface; `progress` is five job-level phases and a `batch_progress` whose
  `completed` is a count, not a boolean.

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

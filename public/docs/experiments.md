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

**From the Experiments tab** — open your app, choose **Experiments**, and use the
define form. Every experiment the app declares is listed there with its metric,
its scope and its arms.

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
| `52 results` | rows in the ledger, across all arms |

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
- **Outputs** — the latest run's final artifact. Above it reads *"No runs yet"*
  because this tenant has not run that loop; once a run reports one, its
  artifact renders here without a drill-down.
- **Run tree** — each run as a node with its score and delta. `NOT SCORED` is a
  real state, not a gap.

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

**What the platform does not compute: significance.** `best_variant` is an argmax
of means. There is no t-test behind the verdict string. If the arms are close
relative to their spread, the ranking is a ranking of means and nothing more —
ask for the per-arm stdev and n, and judge for yourself.

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

A request the router does not recognise falls through to the general assistant,
which cannot see the experiment registry. You will know: it answers that it has
no numbers rather than inventing any. Rephrase toward the verbs above.

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

The declared verdict is *"gemma4_local by +20.4pp vs qwen7b_local"*, and the
criteria are met. But the third arm is the interesting one: gemma4 and qwen14b
are **0.04 apart with a standard error of 0.09** — indistinguishable. The honest
reading is "both large local models beat the 7B baseline by a wide margin, and
are not separable from each other", which is a different sentence from the one
two arms produced.

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

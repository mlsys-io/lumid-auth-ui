# Quant Research Onboarding

The path from a working account to a strategy you have tested, walked end to
end against production as a plain `role=user` account. Every step has a
recorded result, and where something failed or misled it says so — this is a
transcript, not a brochure.

Assumes you are signed in.

**How long this takes.** Reading and deploying your first strategy: about 20
minutes. Getting a verdict back is not on that clock — a backtest is submitted
and then polled, usually minutes later, and submissions are capped at one at a
time and five minutes apart. A forward test needs hours of live paper before its
numbers mean anything. Plan the first sitting around the deploy, not the result.

---

## 1. Mint your first token — in the browser

Go to **<https://lum.id/studio/account/tokens>** and click **Mint your first
token**.

![The Personal Access Tokens page, before any token exists.](/docs/img/first-run-mint-token.png)

Give it the scopes you need; for the researcher path that is:

| Scope | Buys you |
|---|---|
| `claude:proxy` | the `/claude` API, and Claude Code if you later run it locally |
| `lqt:strategy` | submitting and inspecting strategies |

**This step must happen in the browser, and that is deliberate.** A PAT cannot
mint another PAT — try it from the API with a normal token and you get:

```
403  PAT scope insufficient: lumid:write required to mint tokens
```

That message is misleading and we are fixing the wording. It reads as though you
need a scope you cannot grant yourself. You do not: the check exempts
browser sessions entirely, so **any logged-in user can mint any scope they are
entitled to from the dashboard**. The block exists only to stop a leaked token
from minting itself a wider one. If you are reading this because you hit that
error from a script — log in and mint it in the UI, then use it in the script.

---

## 2. Chat — nothing to configure

Open the chatbox in Studio and ask something. That is the whole setup.

![A chat turn calling query_findata and answering from the news feed.](/docs/img/first-run-chat.png)

*Note the `query_findata` chip. Chat reaches the warehouse **as you** through
tools — no credential, no connection string, nothing to configure. This is the
path most people should use, and the reason a Postgres seat is a link at the
end of this page rather than a setup step.*

You do not need a token, a scope, or a model choice. The platform mints a
`claude:proxy` token for you behind the scenes on your first turn and keeps it
fresh. Your model is **`deepseek-v4-flash`** and it is unlimited — it runs on
our own GPUs, so there is no per-call cost to ration. The picker also offers
`glm-5.3-flash`. The metered lanes (qwen, Claude) are held for admin accounts,
so you cannot spend a budget by accident on your first afternoon. See
[AI coding](/studio/docs/coding) for what "unlimited" does and does not mean.

**First turn of a session is slower than the rest.** Your sandbox is spawned on
demand and reclaimed after 15 idle minutes, so the turn after a long pause pays
the spawn again. This is expected and is not your prompt.

---

## 3. Install the Quant Research app

Strategies live in an **app**, and a new account has none installed — the
sidebar entry does not exist until you add it. This is the step most people
miss, because anyone who has been here a while already has it.

Go to **[Library → Marketplace](https://lum.id/studio/library/marketplace)**,
find **Quant Research**, and install it. It is public, so nothing needs
approving.

Afterwards it appears in the sidebar and its four surfaces are yours:

| surface | what it shows |
|---|---|
| **Strategies** | everything you have registered — start here |
| **Backtest** | claims and their honesty labels |
| **Forward test** | live-paper scorecards |
| **Runtime** | what each field box is doing |

A **field box** is one of the servers that actually runs strategies — currently
Denmark, Chicago and New York, placed near the venues they trade. You never log
into one; you deploy to them and read what comes back.

*A fresh install shows an empty Strategies table saying so. That is correct,
not a failure — you have not registered anything yet.*

---
## 4. Explore the data

**Ask in chat.** Market-data questions are answered against the live warehouse
as you, through tools — no credential, no connection string, nothing to
configure. Ask for the markets with the most volume in the last day, what a
ticker resolves on, or how much history exists for an instrument, and you get
the answer plus the query that produced it.

That is the whole of this step. It is also the path that scales across a
cohort: everyone shares a prompt prefix, so the cache works in your favour.

*If you later want a Postgres seat of your own, or the raw table layout, that is
[FinData SQL](/studio/docs/findata-sql) — deliberately not on this page, because
you do not need it to run a strategy and the tables are large enough to punish
casual browsing.*

---

*You now have the app and a way to ask about the data. The next step is the
point of both: turning something you noticed into a strategy you can test.*

---

## 5. Formulate a strategy

### What a strategy is here

A **strategy** is a small program that decides, over and over, whether to place
an order. Not a document, not a spreadsheet, not a backtest script you run
yourself — a set of rules the platform executes for you, on live market data,
one decision per market tick.

It has three parts, and that is all:

1. **Inputs** — the signals it reads. `signal("vpin")` fetches the current
   value of a published signal for the market being evaluated.
2. **A condition** — when it should act. `when signal("vpin") > 0.85`.
3. **An action** — what to do. `buy 50 lots @ mid`.

You write it in **`.lqts`**, a deliberately small language: fixed-point integer
maths, no clock, no randomness, no file access. That constraint is the point —
the same inputs always produce the same decisions, so a run can be replayed
exactly and audited later. It is not a general programming language and is not
meant to be.

Once registered, the same program is used two ways: replayed against **recorded
history** (a backtest) and run against the **live market in paper mode** (a
forward test). You do not write two versions.

Read [LQT strategies](/studio/docs/lqt-strategies) for the full language. In short:
you write DSL, it is compiled off-box, the compiled program goes to the field
boxes, and telemetry comes back on the observation plane rather than the
mailbox you submitted to.

### Where its inputs come from

Before the example, the two things it depends on — because neither appears from
nowhere, and not knowing where they come from is the usual reason a first
strategy silently does nothing.

**The universe — which markets your strategy runs on.**

You do not pick a market in the strategy. The strategy is a rule; the platform
decides which instruments to run it against. That list is the **universe**, and
it is refreshed on a schedule by a `universe.refresh` job that asks each venue
what is currently tradeable, then publishes the result to FinData as
`blobs/lqt/universe/<venue>.json`. The field boxes read that blob — they do not
query the venues for it themselves.

Two cadences run today, and they own different venues:

| cadence | venue | cap | liquidity floor |
|---|---|---|---|
| `fast-kalshi`, every 10 min | Kalshi only, 6 fast crypto series | 200 | none |
| `all-venue`, every 6 hours | Polymarket + Polymarket US | 240 | $5,000 |

So Kalshi's crypto hourlies turn over quickly and the Polymarket side is
filtered for liquidity. A market that just opened may not be in your universe
yet, and one that fell below $5,000 of liquidity drops out.

**Symbols.** An `instrument_id` is the venue's own ticker, carried verbatim.
Kalshi's look like `KXBTCD-26AUG2519-T78899.99` — series, date, strike.

To see what is in your universe right now, ask in chat — *"which monitored
markets have the most volume in the last two days?"* — rather than hunting for a
table. The monitored universe is a live list and chat reads it directly; an
instrument with no recent activity replays as nothing, so this is the list worth
backtesting on.

**Signals — who computes them, and where they land.**

A signal is not something your strategy calculates. It is a number some other
process published, which your strategy then reads by name. Producers write
through the `signal.publish` mailbox seam into two tables:

* `lqt.signals` — the latest value per `(tenant, signal_name, instrument)`, which
  is what the live runtime reads;
* `lqt.signal_history` — **append-only**, every value ever published with the
  venue event time it was true at. This is the table a backtest replays, and it
  is the reason `signals: recorded` is possible at all.

Values are stored as integers (`score_ticks`) with a per-signal scale, so a
strategy comparing against `0.85` is comparing against a stored `8500`:

| signal | what it measures | stored scale |
|---|---|---|
| `vpin` | share of current flow that looks informed, in `[0,1]` | `× 10000` |
| `ofi_z` | order-flow imbalance, z-scored and signed | `× 1000` |
| `outcome_forecast` | model forecast of how the market resolves | `× 10000` |

**Those three are the only published names.** `signal_history` began filling on
2026-08-25, so there is no signal coverage before that date no matter how far
back the price tape goes.

### An example to start from

A strategy is a few lines. This one reads a published signal and buys when it
clears a threshold:

```
strategy vpin_toxicity_v1 {
  params { max_toxicity: 0.85, size_lots: 50 }
  when signal("vpin") > params.max_toxicity {
    buy params.size_lots lots @ mid
  }
}
```

`params` are named constants baked in as defaults, so you can re-run the same
program at a different setting without editing it. The `when` block is the
whole strategy: on each step, read the `vpin` signal, and if it is above 0.85,
buy 50 lots at the mid price. No exit rule — the position is settled by the
market's own outcome.

**Why `vpin`.** It is one of only **three signals published** — `vpin`,
`ofi_z`, `outcome_forecast`. A strategy reading any other name still runs, but
can never be scored against real signal values. Check what exists before you
choose what to read.

**It is deliberately a bad strategy.** VPIN estimates how much of the current
flow is informed, so buying when it is high means taking the other side of
someone who knows more than you. That is the point: your first strategy should
be simple enough that when the result comes back you can tell a plumbing
failure from a bad idea. Save the good idea for after you trust the machinery.

### A harder one: an LLM reading the news

The `vpin` example works because somebody else already publishes `vpin`. This
one shows what changes when **you** have to produce the signal — which is where
most of the real work in a strategy like this actually lives.

The strategy half stays small. That is the point:

```
strategy news_sentiment_v1 {
  params { conviction: 0.60, size_lots: 25 }
  when signal("news_llm") > params.conviction
     and signal("vpin") < 0.70 {
    buy params.size_lots lots @ mid
  }
}
```

Two signals: act on the model's conviction, **but only when flow is not toxic**.
That second clause does the real work — it separates "the news looks good" from
"the news looks good and I am not about to be picked off by someone who already
knew".

#### What `news_llm` actually is

It is a number between 0 and 1, per instrument, that you publish. Nothing about
it is special to the platform — it is a signal like any other, and the DSL
cannot tell it came from a language model. The four stages you have to build:

**1. Get the text.** You need posts or headlines with timestamps, and you need
to know which market each one bears on. The honest position today is that
**there is no tweet feed in the warehouse**. You would be adding an ingest:
pull from whatever source you have rights to, land it with a `ts_event_ns` and
an `instrument_id`, and only then is there anything to score. Budget most of your time here, not on the prompt.

**2. Score it with the in-house model.** Call `https://lum.id/llm` — it is
OpenAI-compatible, so any OpenAI client works by changing the base URL, with
your PAT as the bearer token. Use it rather than a paid API; it runs on our own
GPUs and costs you nothing.

```python
import os, httpx

r = httpx.post(
    "https://lum.id/llm/v1/chat/completions",
    headers={"Authorization": f"Bearer {os.environ['LUMID_PAT']}"},
    json={
        "model": "deepseek-v4-flash",
        "messages": [
            {"role": "system",
             "content": "Score how much this post moves the market toward YES. "
                        "Reply with only a number from 0.00 to 1.00."},
            {"role": "user",
             "content": f"Market: {question}\n\nPost: {post_text}"},
        ],
        "temperature": 0,
    },
    timeout=60,
).json()
score = float(r["choices"][0]["message"]["content"].strip())
```

`temperature: 0` is not decoration. A signal that returns a different number for
the same input cannot be replayed, and a backtest over it is not reproducible.

**3. Publish it.** Post a `signal.publish` message to the mailbox with your PAT.
The handler upserts the batch in one transaction into `lqt.signals` — the hot
table the live runtime reads — and appends to `lqt.signal_history`, which is
what makes a later backtest able to claim `signals: recorded`. The payload takes
a batch:

```json
{"signals": [
  {"signal_name": "news_llm",
   "instrument_id": "KXBTCD-26AUG2519-T78899.99",
   "score_ticks": 7200,
   "confidence_bps": 6000,
   "ts_event_ns": 1756400000000000000}
]}
```

`score_ticks` is the integer form: `0.72` at the `× 10000` scale is `7200`. Pick
a scale and never change it — the strategy compares against a decoded value, so
a silent rescale changes the meaning of every threshold you have already tested.
`ts_event_ns` must be **when the post existed**, not when you scored it.
Stamping it with the scoring time is lookahead: the backtest would let the
strategy read the news before it happened.

**4. Run it on a cadence.** A signal that updates once is not a signal. It has to
be produced continuously, at a rate the market actually moves on, or the live
strategy reads a stale value and the backtest has coverage gaps.

#### Where this code runs — not where you might assume

**The model is never called from inside the strategy.** The `.lqts` above does
one thing: read a number that is already there. It compiles to bytecode and runs
on the field boxes, in a hot path measured in microseconds, with no clock, no
network and no randomness. An HTTP call to a language model cannot live there,
and the DSL gives you no way to write one.

So an LLM strategy is always **two processes**:

| | what it is | where it runs |
|---|---|---|
| the **producer** | your Python: fetch text → score it → publish | off the hot path, on a schedule |
| the **strategy** | the `.lqts` above | on the field boxes, per market tick |

They are coupled only through `lqt.signal_history`. The strategy cannot tell
whether `news_llm` came from a language model, a regression, or a person typing
numbers in — which is exactly why the split works.

The producer graduates through five rungs, and you can stop at whichever one
your idea has earned:

1. **Notebook** — `make jupyter` on the dev stack, port 8888. Throwaway; prove
   the prompt returns something parseable.
2. **Script** — `python/lqt_research/signals/`, committed, deterministic.
3. **Workflow** — a FlowMesh YAML with a schedule. **This is the first rung
   where the signal is actually produced continuously**, and it is the one an
   LLM producer needs, because a signal that updates once is not a signal.
4. **MCP tool** — callable by name.
5. **xpio app** — packaged, installable, learning every cycle.

Do not skip to rung 3. A prompt that works on ten hand-picked posts and falls
over on the eleventh is the normal outcome, and rungs 1–2 are where that is
cheap to find out.

#### What this costs you, honestly

**It will not score `recorded` today.** `news_llm` is not published, so the run
falls back to a seeded constant and is labelled `signals: static` — a result you
cannot present no matter how good the number looks. That is not a bug to work
around; it is the label doing its job. Publishing the signal is what changes it.

The hard parts, in the order they will bite: getting rights to the text, mapping
a post to the right instrument, keeping the model's output parseable, and
holding a cadence. The DSL is the easy half, and it is already written above.

---

## 6. Deploy it

Open **Quant Research → Strategies** in the sidebar (installed in step 3).
Give the strategy a name, paste `.lqts`
source, and submit:

![The Strategies surface: the deploy form above, your registry below.](/docs/img/first-run-strategies.png)

**You do not have to write the `.lqts` by hand.** Ask the chatbox for it. It
knows the DSL and can read what signals exist, so it will not invent a name that
is not published:

> *Write me a `.lqts` strategy that buys 25 lots at mid when the `ofi_z` signal
> is above 0.15, with the threshold and size as params. Reply with just the code
> block.*

![The chatbox returning a compilable .lqts strategy.](/docs/img/first-run-chat-strategy.png)

That produced, verbatim:

```
strategy ofi_z_momentum {
  params { threshold: 0.15, size_lots: 25 }
  when signal("ofi_z") > params.threshold {
    buy params.size_lots lots @ mid
  }
}
```

Copy the code block and paste it straight into the deploy form above — that is
the whole loop. **Read it before you paste it.** The model is good at the shape
and cannot know whether `0.15` is a sensible threshold for the regime you care
about; that judgement is the part that is yours, and §5 says why picking it
against the window you score on is how you fool yourself.

Your registry, once you have registered something — one row per strategy, with
`Compiled` showing the `program_hash`:

![The Strategies surface with registered rows.](/docs/img/first-run-strategies-view.png)

The name is an **identifier**, not a title — `my_strategy`, not `"My Strategy"`
and not `my-strategy` (a dash parses as subtraction). Model the body on the
examples in the docs; a source that does not compile is rejected with the
compiler's own parse error.

Registration is not instant: the mailbox accepts your submission, then a
consumer compiles and registers it. Your row appears when that finishes. Click
it for the detail surface:

![The strategy detail page: registration, sessions, backtests, and how to stop it.](/docs/img/first-run-strategy-detail.png)

## 7. Backtest and forward test

Both are row actions on your strategy. They answer different questions.

| | what it does | what it answers |
|---|---|---|
| **Backtest** | replays recorded market history | *would this have worked?* |
| **Poll result** | fetches the verdict of that replay | — |
| **Forward test** | reads the live-paper arm's scorecards | *does it work now, against a book that pushes back?* |

**Backtest is two clicks, not one.** *Backtest* submits and returns immediately
with a claim id; *Poll result* fetches the verdict later, usually minutes
later. Nothing is wrong if the first click shows no numbers.

**Forward test has no start button.** Your strategy forward-tests from the
moment it deploys — the action *reads* what the paper arm has published. Zero
scorecards means it has not published yet, not that it failed.

**What window a backtest replays.** You do not choose it. The worker takes the
**most recent 7 days** of recorded prints for that instrument, capped at
**50,000 events** — the newest ones, not the oldest, so a busy market gives you
a shorter span than a quiet one. Then, if it can find recorded signal values, it
**clips the replay to the span those signals actually cover**, because no
instrument has a signal in force at its first print. A run needs at least 200
prints left after clipping, or it falls back to seeded constants and labels
itself `signals: static`. The result reports `tape_window_secs`,
`tape_max_events` and `span_secs`, so you never have to infer the window.

That clipping is also why a backtest cannot reach back before **2026-08-25**
with real signals: `lqt.signal_history` started filling then.

**Forward test reports risk over cycles, not prints.** A scorecard is a snapshot
per cycle — fills, buy/sell split, `net_usd`, `fees_usd`, `net_ev_bps`,
markouts. The cumulative arm folds those into an equity curve and reports a
Sharpe and a max drawdown on the `risk_cumulative` line. It banks **one
observation per cycle**, so it needs 30 cycles before reporting a ratio at all —
at a 5-minute cadence that is two and a half hours of live paper. Below that
you get `sharpe_undefined` and a drawdown, which is the honest pair.

Read `fills`, the markouts, and whether `net_usd` is positive *after*
`fees_usd` — and treat a run with `sell_fills: 0` as unfinished rather than
profitable, because an unclosed position has not been tested by anything yet.

## 8. View the results

The **Backtest** and **Forward test** surfaces in the sidebar are the
across-all-strategies views; the row actions above are the per-strategy ones.

Backtest results — read the three labels *before* the P&L, every time:

![The Backtest surface: claims with their replay, signals and settlement labels.](/docs/img/first-run-backtest-result.png)

Forward-test scorecards from the live paper arm:

![The Forward test surface: scorecards per strategy.](/docs/img/first-run-forward-result.png)

And **Runtime**, which is the decision funnel rather than P&L — proposed,
submitted, rejected, and the top reject reason. This is where you look when a
strategy is registered but nothing is happening:

![The Runtime surface: the decision funnel per strategy.](/docs/img/first-run-runtime.png)

## 9. Reading a backtest result

**Backtests now replay recorded market history.** This changed on 2026-08-28;
if you have seen an older version of this page saying the tape is synthetic,
that is out of date.

Every result carries **three independent labels**, and it counts as performance
only when all three say real:

| label | real | not real | what it means |
|---|---|---|---|
| `replay` | `pg_tape` | `synthetic_lcg` | recorded venue prints, or a made-up tape |
| `signals` | `recorded` | `static` | your decisions ran on published signal values, or one constant |
| `settlement` | `resolved` | `mark_to_market` | settled against the real outcome, or marked at the end |

A result with **no** `replay` field is treated as not-real by rule. A real tape
driving fabricated signals produces a number whose genuine half vouches for its
fake half — that is exactly how a synthetic result gets mistaken for an edge.

**Two things that decide whether your strategy can ever score `real`:**

* **Only three signal names are published**: `vpin`, `ofi_z`,
  `outcome_forecast`. A strategy reading any other name can never beat
  `signals: static`, however well written. Check before you choose.
* **Settlement is binary.** These are event contracts: YES pays 1.00, NO pays
  0.00. A position sitting at 0.90 is worth *zero* if it resolves the other way,
  which is why marking to the last price can be badly wrong.

**A real one, field by field.** This is `bt_vpin_3axis`, a run that is real on
all three axes:

```json
{
  "instrument_id": "KXBTCD-26AUG2519-T78899.99",
  "replay": "pg_tape", "signals": "recorded", "settlement": "resolved",
  "prints_replayed": 7548, "span_secs": 47183,
  "tape_window_secs": 604800, "tape_max_events": 50000,
  "steps_evaluated": 7548, "total_actions": 0,
  "filled_lots": 0, "realized_pnl_ticks": 0, "fees_ticks": 0, "net_lots": 0,
  "sharpe": null, "sharpe_ex_settlement": null,
  "max_drawdown_ticks": 0, "max_drawdown_bps": null,
  "final_equity_ticks": 0, "settlement_jump_ticks": 0,
  "metrics_observations": 0, "metrics_bucket_secs": 60
}
```

Read top-down and it tells a clear story. The three axes are all real, so this
counts. It replayed 7,548 recorded prints over about 13 hours — `span_secs`,
well inside the 7-day window it was allowed. And then: **`total_actions: 0`.**

That single field explains every other zero. The guard never fired, so nothing
was proposed, so nothing filled, so P&L is zero — not because the strategy lost
nothing, but because it never played. `sharpe` is `null` rather than `0.0` for
exactly that reason, and `max_drawdown_bps` is `null` because there was never a
positive peak to take a percentage of. `max_drawdown_ticks` is a true `0`: a
position you never opened cannot draw down.

**This is a good result, and it is the one you should expect first.** It says
the machinery works end to end and your threshold is wrong for the observed
distribution — which is a fact about the market you can act on. The failure
would be reading `realized_pnl_ticks: 0` as "flat" and moving on.

**Sharpe and max drawdown.** A result carries `sharpe`, `max_drawdown_ticks`
and `max_drawdown_bps`, derived from a mark-to-market equity curve the harness
records at every step.

Three things about them are worth knowing before you quote one:

* **`sharpe: null` is not zero.** It is refused — deliberately — when the run
  took no trades, when there are too few observations, or when the curve has no
  variance. A Sharpe over a strategy that never opened a position is undefined,
  and printing `0.00` would read as flat performance rather than no measurement.
* **It is a P&L Sharpe, annualised on a 1-minute grid.** There is no capital
  base to divide by, so it is the mean over the standard deviation of equity
  *increments*, not of percentage returns. The curve is resampled onto a fixed
  clock before differencing, because replay steps are trade prints — annualising
  per-step would scale the answer by how heavily the instrument traded rather
  than how long you were exposed.
* **Binary settlement breaks the assumption Sharpe rests on.** YES pays 1.00 and
  NO pays 0.00, so a position marked at 0.90 that resolves the wrong way loses
  everything in a single step. That is precisely the tail a volatility-scaled
  ratio assumes away, so a Sharpe over a settled run **understates** its risk.
  The result also carries `sharpe_ex_settlement` — the same ratio with the
  terminal jump removed. When the two disagree sharply, the headline number is
  describing a coin flip, and `settlement_jump_ticks` tells you how big it was.

Max drawdown has none of that fragility — it is exact integer arithmetic on the
raw curve, and the settlement counts toward it, so the worst case a binary
market can hand you is included rather than smoothed away.

**Comparing two runs is the point, and it is the thing to ask for.** A single
result is hard to read; a pair is not. Change exactly one thing — a threshold, a
window, an instrument — and ask:

> *A/B these two backtests. Same axes on both? Which fields actually moved, and
> is the difference bigger than the difference between their two windows?*

That last clause is the one that matters. Two runs over different instruments or
different date ranges are not an A/B — they differ in the thing you did not
control as well as the thing you did, and a moved number tells you nothing about
which. If the axes differ between the two, stop: you are comparing a real result
to a synthetic one.

Ask for the equity curve and the drawdown marked on it when the numbers are
close. A curve that ends in the same place can get there by drifting or by one
lucky settlement, and only one of those is a strategy.

**Expect your first real run to take no trades.** Two current backtests are real
on all three axes across ~7,500 recorded prints and made **zero** trades — the
signal never crossed the threshold. That is a result, not a breakage. Do not
tune the threshold against the same window you score on; the number that
produces is guaranteed to look good and guaranteed to mean nothing.

**Forward test is live paper, and it does not start anything.** A strategy
forward-tests from the moment it deploys; the action *reads* the paper arm's
scorecards. Zero scorecards means it has not published yet, not that it failed.

---

## 10. Discuss it, then go round again

**Discuss** on the row opens a chat already bound to that strategy, so "why did
this propose nothing yesterday?" resolves against the right one with nothing
re-pasted.

![Discuss: a chat already bound to one strategy.](/docs/img/first-run-discuss.png)

**The chat can do the analysis, not just the conversation.** It reaches your own
results through the same tools the surfaces use, so you can ask for the reading
rather than assembling it yourself:

> *Look at my backtest results so far. How many are real on all three honesty
> axes, how many took zero trades, and what is the outcome breakdown?*

![The chat pulling your own results through lqt_mailbox_read to answer.](/docs/img/first-run-chat-analytics.png)

*The chips are the tools running —`lqt_mailbox_read` against `results`,
`strategies` and `stats`. Those are your rows, scoped to you; the chat is not
guessing from the page, it is querying. Analysis over more than a handful of
runs takes it a minute or two, which the transcript shows honestly rather than
hiding.*

Things worth asking it, all of which it can actually answer:

* *Compare these two backtests side by side — what changed and what moved?*
* *My `n_proposed` is 0. Walk me through why the guard never fired.*
* *Chart the equity curve and mark the max drawdown.*
* *Is this Sharpe meaningful given how few trades it took?*

The thread is listed under Sessions, so the conversation stays
attached to the work
rather than scrolling away in a general chat.

Ask it to read the funnel with you — *why did this take no trades?* — and to
propose one change. Then **deploy the next round**: paste the revised `.lqts`
as a new strategy, backtest it, and compare.

**Change one thing per round.** Two changes and a moved number tell you nothing
about which one moved it. And do not tune a threshold against the same window
you score on — that number is guaranteed to look good and guaranteed to mean
nothing.

**Check the model actually changed it.** Ask for a *changed* `program_hash` on
the registry row. The assistant saying it updated your strategy is not
evidence; a new hash is. An unchanged hash after an "update" means the DSL
never recompiled.

That loop — formulate, deploy, backtest, read, discuss, revise — is the job.
Everything above it is setup you do once.

**One backtest at a time, 300 seconds apart.** A second submission while one
is in flight is *refused*, not queued — the consumer runs the replay inline, so
an unbounded queue would stall every other tenant. The refusal tells you the
earliest time you may retry; read it rather than re-submitting.

## What you cannot do yourself

Three things, and all of them are intentional:

- **`lumid:write`** — a platform-level scope. Granting it requires already
  having it, so a fresh account cannot self-serve it. You need it to author
  analytics jobs — **not** to mint tokens, whatever the 403 in §1 claims. That
  error message names the wrong scope; minting from the browser needs no scope
  at all.
- **The `findata` access grant** — warehouse access is given per person, not to
  everyone, because it is a direct connection to 1.7 TB of production data.
- **A `sql_<name>` warehouse role** — provisioned separately from the grant.
  Being entitled and having a role are two different states, and the SQL panel
  distinguishes them.

All three are one-line operator actions, not processes. An invitation code can
carry the first two, which is how a cohort gets them without anyone filing a
request.

Everything else on this page, a new account does alone — including querying
FinData in chat, which needs no grant at all.

---

## Where to go next

Everything below is at **<https://lum.id/studio/docs>**.

| doc | why you would open it |
|---|---|
| [LQT strategies](/studio/docs/lqt-strategies) | the full `.lqts` language — the one to read once you have deployed something |
| [AI coding](/studio/docs/coding) | the model you are on, what "unlimited" means, the one timeout that matters |
| [FinData SQL access](/studio/docs/findata-sql) | a warehouse seat, if chat-based queries stop being enough |
| [FlowMesh & Lumilake queries](/studio/docs/fm-ll-queries) | running jobs across the compute fleet |
| [AI Consulting Onboarding](/studio/docs/mbb-consultant) | the other cohort track, if you are on it |

**In the repo**, deeper than this page goes:

* `docs/researcher-onboarding/` — the research cycle, the promotion gates, the
  signal contract, and how to submit progress.
* `docs/dsl/SYNTAX.md` — the strategy language reference.
* `python/lqt_research/signals/` — real signal implementations to model yours on.

---

## If something here is wrong

This document is a transcript of a real run. If a step behaves differently for
you, that is a finding and it is worth reporting — a walkthrough that has
drifted from the system is how the next twenty people lose an afternoon.

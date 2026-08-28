# Quant Research Onboarding

This is the actual path, walked end to end against production as a plain
`role=user` account on 2026-08-24. Every step below has a recorded result. Where
something failed or misled, it says so — this is a transcript, not a brochure.

Budget about 15 minutes. You need nothing but an email address.

---

## 0. Sign up

**You need an invitation code before you start.** Registration will not complete
without one — it is a required field, not a "have one?" prompt. If you were
brought in as part of a cohort, whoever invited you has it.

1. Go to <https://lum.id> — `/` redirects to `/auth/login`.
2. Choose **Register**. You will fill in: username, email, a 6-digit email
   verification code, **the invitation code**, and a password.
3. The 6-digit code is emailed to you and is separate from the invitation code.
   Both are mandatory.
4. Submit, and you are in as `role=user`. You land on the login page — sign in.

![The Create Account form, with Invitation Code as a required field of its own.](/docs/img/first-run-register.png)

*Note the two separate codes. **Verification Code** is the 6-digit one emailed to
you and has a **Send** button next to it; **Invitation Code** is the one you were
given by whoever invited you. Confusing them is the most common way this step
stalls.*

An invitation code may also carry **access grants**, which is how a cohort gets
entitlements it could not grant itself (warehouse access, for instance). If
yours does, redeeming it applies them at signup with nothing else to do. Already
registered and handed a code later? Redeem it from
**[Account → Tokens](/studio/account/tokens)** — look for *"Have an access
code?"*.

Two things worth knowing before they surprise you:

- **One code per email per 60 seconds.** Hitting "resend" twice in a row gets you
  a rate-limit error, not a second email. Wait a minute.
- **Use an inbox you can actually read.** If you are testing with an alias of an
  address that also *sends* our mail, some providers (Gmail notably) file the
  message in All Mail rather than Inbox and it looks lost.

> **Not verified in this walkthrough.** The rest of this document was executed
> live; the signup leg was not, because the account used was an existing one and
> no test inbox was available. Delivery is wired in production (the mail
> credentials are present and the registration path calls the real sender), but
> if the code does not arrive, that is the one step here nobody has watched
> recently. Say so and it gets looked at.
>
> This section previously claimed signup was self-serve with "no invitation to
> wait for". That was wrong — the form has always required a code — and it is
> corrected above. It is exactly the drift this hedge was warning about.

---

## 1. Log in and land in Studio

<https://lum.id/studio> — chat-first. Advanced surfaces are behind the toggle.

![The Lumid sign-in card: Continue with Google above, email and password below.](/docs/img/first-run-login.png)

*`/` redirects here, so <https://lum.id> and <https://lum.id/auth/login> are the
same door. **Continue with Google** works too — if you sign up that way you will
be asked for your invitation code straight afterwards rather than during the
form.*

Your session is a cookie on the apex domain, which is why `xp.io` and the other
subdomains log you in automatically.

**Verified:** Studio, your apps, your runs, loop health, your usage, the data
catalog, strategies, knowledge agents and experiments — 12 surfaces, all `200`
for a plain `role=user`. Nothing on the default path is admin-gated.

---

## 2. Mint your first token — in the browser

Go to **<https://lum.id/studio/account/tokens>** and mint a PAT. Give it the scopes
you need; for the researcher path that is:

| Scope | Buys you |
|---|---|
| `claude:proxy` | Claude Code and the `/claude` API on deepseek |
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

## 3. Chat — nothing to configure

Open the chatbox in Studio and ask something. That is the whole setup.

![A chat turn calling query_findata and answering from the news feed.](/docs/img/first-run-chat.png)

*Note the `query_findata` chip. Chat reaches the warehouse **as you** through
tools — no credential, no connection string, nothing to configure. This is the
path most people should use, and the reason the SQL seat listed at the end is
optional rather than a setup step.*

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

## 4. Install the Quant Research app

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

*A fresh install shows an empty Strategies table saying so. That is correct,
not a failure — you have not registered anything yet.*

---
## 5. Explore the data

- **In chat** — just ask. Findata questions are answered against the live
  warehouse, and this path is comfortable at cohort scale: everyone shares a
  prompt prefix, so the cache works in your favour rather than against it.
- **In the browser** — Studio → **Data** → **Query**. A read-only `SELECT` box
  that runs as you, with no credential to set up. It is the same engine the chat
  tool uses, so the console and the assistant cannot disagree about an answer.
  A `LIMIT` is added when you omit one. Browse **Catalog** first to find schemas
  and tables.

  ![The Query tab: a SELECT against the warehouse and its result table.](/docs/img/first-run-sql-console.png)

  Errors come back in the warehouse's own words rather than a generic failure —
  and an empty result says so explicitly, because "no rows" and "it broke" are
  different things worth telling apart.
- **Over SQL** — `sql.lum.id:5432`, read-only, as your own `sql_<name>` role with
  a password you mint at [Account → FinData SQL](/studio/account/findata-sql).
  You can also reach it from **Settings → Warehouse access**, which shows whether
  you have a credential without your having to open the page. Minting a personal
  access token tagged `findata:sql` issues the same credential at the same time,
  if you would rather do both in one step.
  Unlike everything else on this page, this one is **granted, not self-serve**:
  it needs a `findata` access grant *and* a provisioned role. The panel tells you
  which you are missing. Setup, TLS and the CA bundle are in
  [FinData SQL](/studio/docs/findata-sql).
- **Browse** — the catalog at `/dataapp-proxy/_sources` lists what is exposed.

The seat lives in **Settings**, next to API tokens — it is the same shape, a
credential you mint once and are shown once:

![The Warehouse access card in Settings, before minting.](/docs/img/first-run-warehouse-card.png)

Two states are worth telling apart, because they need different things from
you. *"No credential yet for `sql_<name>`"* means you are entitled and one click
away. *"Entitled, but no warehouse role provisioned yet"* means an operator has
to provision the role first — nothing you do in the UI will fix it, and the
panel says so rather than leaving you clicking.

Once you have a role, everything a GUI client needs is on the page as fields:

![The connection panel: a CA download button and the connection settings as fields.](/docs/img/first-run-sql-connect.png)

*No terminal at any point. DBeaver, DuckDB and pgAdmin take those settings
directly, and the CA is a download rather than something to fetch by hand — you
only need it because `verify-full` checks the server against it.*

---

*You now have the app and the data. The next step is the point of both:
turning something you noticed here into a strategy you can test.*

---

## 6. Formulate a strategy

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

Read [LQT strategies](/docs/lqt-strategies) for the full language. In short:
you write DSL, it is compiled off-box, the compiled program goes to the field
boxes, and telemetry comes back on the observation plane rather than the
mailbox you submitted to.

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

### Deploy it

Open **Quant Research → Strategies** in the sidebar (installed in step 4).
Give the strategy a name, paste `.lqts`
source, and submit:

![The Strategies surface: the deploy form above, your registry below.](/docs/img/first-run-strategies.png)

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

### Backtest and forward test

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

### View the results

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

### Discuss it, then go round again

**Discuss** on the row opens a chat already bound to that strategy, so "why did
this propose nothing yesterday?" resolves against the right one with nothing
re-pasted.

![Discuss: a chat already bound to one strategy.](/docs/img/first-run-discuss.png)

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

### Reading a backtest result

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

**Expect your first real run to take no trades.** Two current backtests are real
on all three axes across ~7,500 recorded prints and made **zero** trades — the
signal never crossed the threshold. That is a result, not a breakage. Do not
tune the threshold against the same window you score on; the number that
produces is guaranteed to look good and guaranteed to mean nothing.

**Forward test is live paper, and it does not start anything.** A strategy
forward-tests from the moment it deploys; the action *reads* the paper arm's
scorecards. Zero scorecards means it has not published yet, not that it failed.

---

## 7. Claude Code from your own machine

```bash
export ANTHROPIC_BASE_URL=https://lum.id/claude
export ANTHROPIC_AUTH_TOKEN=lm_pat_live_...   # the PAT from step 2
export ANTHROPIC_MODEL=deepseek-v4-flash
export API_TIMEOUT_MS=600000                  # do not skip this
```

**`API_TIMEOUT_MS` is not optional.** The default client timeout is 60 s, and a
large cold prompt can spend longer than that just reading your context before it
emits a byte. Without the override you get *"Waiting for API response · will
retry"* and it looks like a network fault. It is not.

If your PAT is missing the scope you get a clear 403 that names the fix:

```
403  PAT lacks the claude:proxy scope — mint one at lum.id/dashboard/tokens
```

**Verified:** that 403 is exactly what a scope-less PAT receives. Note it names
`/dashboard/tokens`, which is the **old** path — it still redirects, but the
canonical page is `/studio/account/tokens`. The message text is wrong, not you;
it is quoted here verbatim so you recognise it when you see it.

---

## 8. Call the model directly

```bash
curl https://lum.id/llm/v1/chat/completions \
  -H "Authorization: Bearer $LUMID_PAT" \
  -H 'Content-Type: application/json' \
  -d '{"model":"deepseek-v4-flash","max_tokens":64,
       "messages":[{"role":"user","content":"hello"}]}'
```

**Verified:** `200` in 3.6 s on a warm cache.

`deepseek-v4-flash` is the only model this gateway serves. It is a strict
allowlist — an unrecognised model id is refused by name, not quietly routed
somewhere else and billed. If you need a model that is not there, ask; do not
work around it.

---

## What you cannot do yourself

Three things, and all of them are intentional:

- **`lumid:write`** — a platform-level scope. Granting it requires already
  having it, so a fresh account cannot self-serve it. You need it only to author
  analytics jobs.
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

## If something here is wrong

This document is a transcript of a real run. If a step behaves differently for
you, that is a finding and it is worth reporting — a walkthrough that has
drifted from the system is how the next twenty people lose an afternoon.

# Write & Submit an LQT Strategy

**A complete reference for strategy researchers.** Write a trading strategy in the LQT DSL, submit it with your lum.id token, and it runs **shadow/paper** against live prediction markets (Polymarket + Kalshi). As a normal user, your strategies always run shadow/paper — no real orders are ever placed.

> **Doc version 1.0.4** · updated 2026-08-23 · audience: **strategy researcher** (normal user role). See the [changelog](#changelog) at the end.

This page is self-contained: everything needed to author a valid `.lqts` strategy and submit it over HTTP is here, grounded in the compiler and gateway source.

---

## Table of contents

1. [Quickstart](#1--quickstart)
2. [What a strategy is](#2--what-a-strategy-is)
3. [Write — the `.lqts` DSL](#3--write--the-lqts-dsl)
   - [Top-level structure](#31-top-level-structure)
   - [`params`](#32-params)
   - [Inline `signal` declarations](#33-inline-signal-declarations)
   - [Reading context — accessors](#34-reading-context--accessors)
   - [`when` rules, guards, branching](#35-when-rules-guards-branching)
   - [Actions — `buy` / `sell`](#36-actions--buy--sell)
   - [Expressions — operators, builtins, types](#37-expressions--operators-builtins-types)
   - [Numbers & the tick scale](#38-numbers--the-tick-scale)
   - [Limits & what is not supported](#39-limits--what-is-not-supported)
4. [Submit — token & deploy](#4--submit--token--deploy)
5. [After you submit](#5--after-you-submit)
6. [Reference tables](#6--reference-tables)
7. [Worked examples](#7--worked-examples)
8. [Changelog](#changelog)

---

## 1 · Quickstart

```bash
# 1. Write a strategy in a .lqts file
cat > momentum.lqts <<'LQTS'
strategy pm_momentum {
  params { size_lots: 50, cap: 500 }
  signal fast = ewma(market.mid, halflife_s = 10)
  signal slow = ewma(market.mid, halflife_s = 60)
  when fast > slow && position.net_lots < params.cap {
    buy params.size_lots lots @ market.ask
  }
  when fast < slow && position.net_lots > 0 {
    sell position.net_lots lots @ market.bid
  }
}
LQTS

# 2. Get a lum.id PAT with the `lqt:strategy` scope (Account -> Tokens), then submit:
curl -X POST "https://lum.id/lqt/submit/lqt_inbox" \
  -H "Authorization: Bearer $LQT_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg dsl "$(cat momentum.lqts)" --arg pat "$LQT_TOKEN" '{
        records: [{
          msg_id: "cli-\(now)",
          topic: "strategy.deploy",
          payload: {
            topic: "strategy.deploy",
            auth: { pat: $pat },
            name: "pm_momentum",
            strategy_id: "pm_momentum",
            version: "1",
            strategy: { dsl: $dsl }
          }
        }]
      }')"

# -> 200 { "received": 1, "inserted": 1, "status": "ok" }
# Your strategy compiles server-side, registers under your tenant, and runs PAPER.
# Confirm it registered:
#   curl -H "Authorization: Bearer $LQT_TOKEN" https://lumid.trade/xpio/strategies
```

`$LQT_TOKEN` = your lum.id PAT. It appears **twice**: as the `Authorization` bearer (which passes the endpoint's `lqt:strategy` scope check) **and** inside `payload.auth.pat` (the per-strategy **owner** credential the runtime verifies in-transaction — this is what attributes the strategy to your tenant).

---

## 2 · What a strategy is

An LQT strategy is a small program in the **LQT DSL** — plain text in a `.lqts` file. On submit it is compiled to **deterministic bytecode** and run inside one vetted virtual machine. You ship *rules*, not free-running code; the VM executes them identically every time.

Three properties that define the model:

- **Deterministic.** No wall clock, no randomness, no floating point — the whole language is fixed-point integer math. The same inputs always produce the same actions and the same execution cost. This is what makes strategies auditable and replayable.
- **Paper by default.** A submitted strategy runs in **shadow/paper** mode: every `buy`/`sell` is recorded as what it *would* do, but mints **zero** real orders. Normal user submissions are always paper. Writing and submitting is risk-free.
- **Orders are proposals.** Each `buy`/`sell` your strategy emits is a *proposal* handed to the governed risk gate, which can still reject it (position limits, NegRisk equivalence, staleness, kill-switch, …). The DSL decides intent; the gate decides what is allowed.

Markets are **prediction markets**: prices are probabilities in `[0, 1]`, payoff is binary and oracle-settled. In the DSL those prices are represented as integer **ticks** (see [§3.8](#38-numbers--the-tick-scale)). Your strategy is evaluated against your tenant's **monitored universe** — the active instruments configured for you across **Polymarket** (instrument id = the `0x` condition id) and **Kalshi** (instrument id = the `KX…` ticker). The universe is tenant configuration, so it can change without you redeploying.

---

## 3 · Write — the `.lqts` DSL

### 3.1 Top-level structure

A strategy is one `strategy` block. Inside, in this order: an optional `params` block, zero or more inline `signal` declarations, then one or more `when` rules.

```ebnf
strategy    = "strategy" IDENT "{" [ params ] { signal_decl } when_rule { when_rule } "}" ;
params      = "params" "{" [ param { "," param } [ "," ] ] "}" ;
param       = IDENT ":" number ;
signal_decl = "signal" IDENT "=" expr ;
when_rule   = "when" expr body { "else" "if" expr body } [ "else" body ] ;
body        = "{" action { ";" action } [ ";" ] "}" ;
action      = ( "buy" | "sell" ) expr "lots" [ "@" expr ] ;
```

- Multiple `when` rules are **independent** — each fires on its own when its guard is true (they are not an if/else chain unless you use `else if`/`else` *inside* one rule).
- Comments: `#` to end of line. Whitespace is insignificant.
- At least one `when` rule is required; an empty body (`{ }`) is a compile error.

### 3.2 `params`

Named numeric constants, referenced as `params.<name>`.

```lqts
params {
  threshold: 0.6,
  size_lots: 100,
  max_spread: 0.0005   # trailing comma optional
}
```

- Values are **numeric literals only** — integers (`100`) or decimals (`0.6`). No strings, booleans, or expressions.
- Reference with `params.threshold`. Referencing an undeclared param is a **compile error**.
- There is no default syntax — every param you reference must be declared here.

### 3.3 Inline `signal` declarations

Compute your own signal from the price stream, no history plumbing required. Declared after `params`, before the `when` rules:

```lqts
signal fast  = ewma(market.mid, halflife_s = 10)
signal slow  = ewma(market.mid, halflife_s = 60)
signal cross = fast - slow            # a later signal may reference an earlier one
signal mom20 = momentum(market.mid, 20)
```

Read a signal by **bare name** (`fast`) or equivalently `signal("fast")`. Each declared signal also exposes:

- **`<name>.ready`** — boolean, true once the accumulator has seen enough data to be meaningful (warm-up guard).
- **`<name>.level`** — for `trailing_stop` signals only, the running stop level.

Rules: a signal may reference earlier signals but not itself or a later one (compile error); redeclaring the same name is a compile error.

**Inline signal builtins.** `N` (window size) must always be a **positive integer literal** (compile-time constant), never a param or expression.

*O(1) accumulators (whole history):*

| Builtin | Signature | Returns |
|---|---|---|
| `ewma(x, halflife_s=H)` | time-aware EWMA; `H` = positive integer seconds | scalar |
| `running_mean(x)` / `running_std(x)` | running mean / population std (Welford) | scalar |
| `running_sum(x)` / `running_max(x)` / `running_min(x)` | cumulative sum / max / min | scalar |
| `count()` | number of evaluations so far | scalar |
| `bars_since(cond)` | evaluations since `cond` was last true | scalar |

*Bounded-window (last N observations):*

| Builtin | Signature | Returns |
|---|---|---|
| `sma(x, N)` | simple moving average | scalar |
| `momentum(x, N)` | `x_now − x_{N ago}` (0 until the window fills) | scalar |
| `rolling_std(x, N)` | population std over last N | scalar |
| `bollinger(x, N, k)` | upper band: `sma_N + k·std_N` | scalar |

*Position / PnL (reset when `position.net_lots` crosses zero):*

| Builtin | Signature | Returns |
|---|---|---|
| `drawdown_from_entry(x)` | distance from the best point since entry (≥ 0) | scalar |
| `trailing_stop(x, ticks=T)` | **bool** — tripped? (its level via `<name>.level`) | bool |
| `time_in_trade(x)` | evaluations in the current position episode | scalar |
| `mae(x)` / `mfe(x)` | max adverse / favourable excursion from entry | scalar |
| `r_multiple(x, ticks=R)` | favourable move in units of initial risk `R` | scalar |
| `unrealized_pnl()` / `pnl_per_lot()` / `position_value()` | stateless PnL helpers | scalar |

*Edge / event detectors (fire `1` only on the crossing evaluation, `0` otherwise):*

| Builtin | Signature |
|---|---|
| `crossed_above(a, b)` / `crossed_below(a, b)` | `sign(a−b)` flips up / down |
| `new_high(x)` / `new_low(x)` | `x` sets a new running max / min |
| `breakout(x, level=L)` | `x` first crosses above `L` |
| `regime_flip(cond)` | boolean `cond` changed truth value |

### 3.4 Reading context — accessors

| Accessor | Type | Meaning |
|---|---|---|
| `market.mid` | scalar (ticks) | canonical top-of-book mid (freshest book). Prefer this. |
| `mid` | scalar (ticks) | legacy alias for the mid (first matching book); use `market.mid`. |
| `market.bid` / `market.ask` | scalar (ticks) | best bid / ask |
| `market.spread` | scalar (ticks) | `ask − bid` (saturating; `0` if no book) |
| `market.bid_size` / `market.ask_size` | scalar (lots) | depth at best bid / ask |
| `position.net_lots` (or bare `position`) | scalar (lots) | your signed net position; `0` if flat |
| `position.avg_price` | scalar (ticks) | average entry price; `0` if flat |
| `signal("name")` | scalar | a **platform-fed** signal score (see below) or one of your inline signals |
| `signal_mid("name")` | scalar (ticks) | that signal's published mid price (fail-loud if absent) |
| `signal_conf("name")` | scalar (bps) | that signal's confidence, in basis points |
| `params.<name>` | scalar | a declared parameter |
| `ctx("...")` | scalar / bool | runtime context — see below |

**Platform signals** (`signal("name")`): named values your LQT deployment publishes into the `lqt.signals` table (via a `signal.publish` producer) for strategies to consume. The set is **open / deployment-defined** — any lowercase name a producer has published is readable; there is no fixed enum. Currently deployed signal names include `outcome_forecast`, `ofi_z`, `vpin` — but which are live is specific to your deployment. Discover them by asking your operator (or, with DB access, `SELECT DISTINCT signal_name FROM lqt.signals`), or just compute your own inline signals, which need no setup.

Each signal row carries three fields the accessors read: `signal("x")` → the score, `signal_conf("x")` → confidence in basis points, `signal_mid("x")` → the producer's mid snapshot (**fails loud if the producer didn't publish a mid** — only use it for signals you know carry one).

**`ctx(...)` context reads** (all fail-safe with documented defaults):

| Call | Returns | Absent default |
|---|---|---|
| `ctx("mid_staleness_s")` | seconds since the mid last updated | `i64::MAX` (fail-closed) |
| `ctx("time_to_resolution_s")` | seconds until the market resolves | `i64::MAX` |
| `ctx("oracle_settled")` | bool — has the oracle settled? | `false` |
| `ctx("instrument_tradable")` | bool | `false` |
| `ctx("tenant_active")` | bool | — |
| `ctx("kill_global_engaged")` / `ctx("kill_tenant_engaged")` | bool — kill-switch state | — |

**Bounded NegRisk cross-instrument** (for multi-outcome baskets in the same equivalence class):

| Call | Returns |
|---|---|
| `negrisk_edge()` | `1.0 − Σ(class-mate mids)` basket-arb edge (ticks) |
| `complementary_spread(N)` | `active_mid − class_mate[N].mid`; `N` = int literal 0–255 |
| `class_aggregate(mid\|net_lots, sum\|mean)` | fold a field across all class-mates |
| `class_mate_bid(N)` / `class_mate_ask(N)` / `class_mate_mid(N)` | that class-mate's book |

### 3.5 `when` rules, guards, branching

A guard is a **boolean** expression. `when signal("x") > 0 { ... }` is valid; a bare scalar guard (`when signal("x") { }`) is rejected.

```lqts
# Independent rules — each fires on its own:
when market.spread < params.max_spread { buy 100 lots @ market.ask }
when position.net_lots > 0 && market.mid > params.fair { sell position.net_lots lots @ market.bid }

# Exclusive branching inside one rule — exactly one arm fires:
when signal("p") > params.hi {
  buy 100 lots @ mid
} else if signal("p") > params.lo {
  buy 10 lots @ mid
} else {
  sell 50 lots
}
```

- Combine conditions with `&&`, `||`, `!` and comparisons `< > <= >= == !=`.
- `else if` and `elseif` are interchangeable; a trailing `else` is optional.
- Every arm's body must contain at least one action (empty bodies are a compile error).

### 3.6 Actions — `buy` / `sell`

```lqts
buy  <qty-expr> lots [ @ <price-expr> ]
sell <qty-expr> lots [ @ <price-expr> ]
```

- **Quantity** is any scalar expression — a literal (`50`), a param (`params.size_lots`), an accessor (`position.net_lots`), or a computed value (`min(params.clip, params.cap - position.net_lots)`).
- **`@ <price>` is optional.** Omit it → **market order**. Provide it → **limit order** at that price.
- Price expression can be `mid` / `market.mid` / `market.bid` / `market.ask`, a literal (`@ 0.50`), an accessor (`@ position.avg_price`), or any expression (`@ clamp(market.mid, 0.2, 0.8)`).
- Multiple actions per body are separated by `;` and all emit (in order) when the guard is true:

```lqts
when signal("a") > 0.5 {
  buy 100 lots @ mid;
  sell 25 lots @ market.ask
}
```

### 3.7 Expressions — operators, builtins, types

**Numeric builtins** (usable anywhere an expression is — conditions, sizes, prices):

| Builtin | Result |
|---|---|
| `min(a, b)` / `max(a, b)` | smaller / larger of two scalars |
| `abs(x)` | absolute value (saturating) |
| `clamp(x, lo, hi)` | `x` constrained to `[lo, hi]` |

**Operator precedence** (lowest → highest): `||` → `&&` → comparisons → `+ -` → `* /` → prefix `!`. All binary operators are left-associative; use parentheses to override.

**Types.** Two value types, both backed by `i64`: **scalar** (fixed-point number) and **bool** (`0`/`1`). There is no float type anywhere — this is a syntactic determinism guarantee. Comparisons and logic produce bool; a bool used in arithmetic reads as `0`/`1`. Type errors (e.g. a scalar where a bool is required) are caught at compile time.

### 3.8 Numbers & the tick scale

- **Decimal literals** are scaled by **10,000** (4-digit tick resolution): `0.6 → 6000`, `0.05 → 500`, `0.12345 → 1234` (truncated, not rounded).
- **Integer literals** are context-dependent: in a **lots** position they are a raw count (`buy 50 lots` = 50 lots); in a **price/score** position they are already ticks (`market.spread < 5` = 5 ticks = 0.0005).
- **No negative literals** — `-5` is a parse error; write `0 - 5`.

Because prices are probabilities in `[0,1]`, a probability of 0.50 is `5000` ticks; a full unit is `10000` ticks.

### 3.9 Limits & what is not supported

- **No loops, no user-defined functions, no recursion** — the bytecode is forward-only, so these are structurally impossible.
- **Window `N` must be a compile-time integer literal** (keeps state bounded).
- **No float, no randomness, no wall-clock reads** (only `ewma`'s `halflife_s` is time-aware, via injected timestamps).
- Every strategy compiles to a **bounded fuel budget and bounded state size** — an unbounded construct is a compile error, not a runtime surprise.

These are deliberate guarantees, not missing features. Anything requiring cross-sectional history beyond the bounded NegRisk rung (correlations, lead-lag, model scores) is expected to arrive as a **platform-fed `signal(...)`** your deployment produces.

---

## 4 · Submit — token & deploy

### 4.1 Get a token

Sign in at [lum.id](https://lum.id) → **Account → Tokens** and mint a Personal Access Token with the **`lqt:strategy`** scope. Format: `lm_pat_live_…`. This PAT identifies you as the strategy's owner (your isolated *tenant*).

### 4.2 Submit

`POST https://lum.id/lqt/submit/lqt_inbox`, authenticated with your PAT. This is the **self-serve submission** endpoint: your PAT's `lqt:strategy` scope authorises the write, a background worker compiles your DSL and registers it under your tenant, and it starts running paper.

The body is a **records envelope** carrying one `strategy.deploy` message. Your PAT goes **both** in the `Authorization` header (scope check) **and** in `payload.auth.pat` (the per-strategy owner credential — this is what the runtime verifies and what attributes the strategy to your tenant; a submission without it is rejected).

**`payload` fields:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `topic` | string | ✓ | `"strategy.deploy"` |
| `auth.pat` | string | ✓ | **your PAT** — the strategy owner. Without it the consumer rejects (`auth_denied`) |
| `name` | string | ✓ | human label |
| `strategy_id` | string | ✓ | stable id; resubmitting the same id **updates in place** |
| `version` | string | ✓ | your version label, e.g. `"1"` |
| `strategy.dsl` | string | ✓* | your `.lqts` source |
| `strategy.program_hex` | string | ✓* | pre-compiled bytecode (alternative to `dsl`) |
| `region_scope` | string[] | — | omit to use the default paper lane |

\* Provide **exactly one** of `strategy.dsl` or `strategy.program_hex`.

```bash
curl -X POST "https://lum.id/lqt/submit/lqt_inbox" \
  -H "Authorization: Bearer $LQT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "records": [{
      "msg_id": "cli-001",
      "topic": "strategy.deploy",
      "payload": {
        "topic": "strategy.deploy",
        "auth": { "pat": "'"$LQT_TOKEN"'" },
        "name": "pm_momentum",
        "strategy_id": "pm_momentum",
        "version": "1",
        "strategy": { "dsl": "strategy pm_momentum { params { size_lots: 50 } signal fast = ewma(market.mid, halflife_s = 10) signal slow = ewma(market.mid, halflife_s = 60) when fast > slow { buy params.size_lots lots @ market.ask } when fast < slow && position.net_lots > 0 { sell position.net_lots lots @ market.bid } }" }
      }
    }]
  }'
```

**Responses:**

| Status | Body | Meaning |
|---|---|---|
| `200 OK` | `{ "received": 1, "inserted": 1, "status": "ok" }` | request accepted + queued; **compile happens next, asynchronously** (see below) |
| `400 Bad Request` | error string | malformed envelope, or neither/both of `dsl`/`program_hex` |
| `401 / 403` | error string | bad token, or your PAT lacks the `lqt:strategy` scope |

**Compilation is asynchronous — `200 ok` means *queued*, not *compiled*.** The endpoint durably records the `strategy.deploy` message; a background worker then compiles your `.lqts` and either registers it or rejects it. Confirm the outcome by listing your strategies (`GET /xpio/strategies`, [§5](#5--after-you-submit)) — a registered strategy appears there with a non-empty `program_hash` — or by reading the **`strategy.ack`** on your outbox:

- **Success** → your strategy is registered under your tenant (`program_hash` set) and starts running paper.
- **Compile failure** → a reject-ack whose reason is the compiler's verbatim diagnostic, e.g. `compile failed: <line/column + reason>`. Fix and resubmit the same `strategy_id`.

So the loop is: `POST` → `200 ok` (queued) → confirm via `GET /xpio/strategies` (or read the `strategy.ack` on your outbox — see [§5](#5--after-you-submit)). To catch errors *before* submitting, validate locally with the CLI ([§4.3](#43-optional-compile-offline-first)).

Leaving `region_scope` out runs your strategy in the default paper lane. You never need to set it to run paper.

### 4.3 Optional: compile offline first

The `lqt-strategy` CLI validates and compiles locally — handy in an editor loop or CI, but **not required** (the server compiles `dsl` for you and returns the same errors):

```bash
lqt-strategy validate momentum.lqts        # parse + typecheck (exit 0 = OK)
lqt-strategy compile  momentum.lqts         # emit registration-ready hex to stdout
lqt-strategy dump     momentum.lqts         # print the compiled op listing
```

The hex from `compile` is exactly what you'd send as `program_hex`.

---

## 5 · After you submit

- **It runs shadow/paper.** Your strategy evaluates against live market data on a recurring cycle and records what it *would* do — proposals, would-be fills, and PnL — while placing **no real orders**.
- **It's isolated to you.** Row-level security scopes every strategy, position, and result to your tenant. You can't see or affect anyone else's strategies, and they can't see yours.
- **Resubmitting updates it.** POST the same `strategy_id` with new `dsl`/`version` to replace the running version in place (an UPSERT on `(tenant, strategy_id)`); the runtime picks up the change on its next refresh.
- **Iterate freely.** Because everything is paper and deterministic, you can tune params and rules and resubmit as often as you like with zero financial risk.

### Reading results

Three channels, all scoped to **your** tenant by your PAT (a strategy's telemetry is attributed to the lum.id account that submitted it — you only ever see your own).

> **Host note — the `/xpio/*` read endpoints below are NOT served from `lum.id`.** Use
> **`https://lumid.trade/xpio/…`** (or the equivalent `https://lum.id/lqt-mailbox/xpio/…`).
> A bare `https://lum.id/xpio/strategies` falls through to the landing site and answers **302** to
> the login page, so `curl` returns HTML rather than your strategies. Submission is different and
> *is* on `lum.id`: `POST https://lum.id/lqt/submit/lqt_inbox`.

- **List your strategies — `GET /xpio/strategies`** (Bearer PAT). Returns the strategies registered under your tenant, including `program_hash` (non-empty = successfully compiled and running), `status`, and metadata.
- **Ask for a cycle rollup — topic `strategy.inspect`** (async). POST a `strategy.inspect` message `{strategy_id, window_s?}` (same PAT auth and envelope as submit); the platform writes a `strategy.inspect.result` to your outbox with the aggregated funnel (`n_proposed` / `n_submitted` / `n_rejected` / `suppressed`), the `reject_reasons` distribution, latency percentiles, and your strategy's recent result messages. Read the reply from `GET /xpio/results`.
- **Raw outbox — `GET /xpio/results`** (Bearer PAT). Your outbox stream: the `strategy.ack` (compile outcome — success or `compile failed: <diagnostic>`, [§4.2](#42-submit)), `strategy.inspect.result` replies, and any per-cycle `result.*` messages your strategy produced.

Start with `GET /xpio/strategies` to confirm registration, then POST a `strategy.inspect` message and read the rollup from `GET /xpio/results` to see how your strategy is behaving (proposed vs gated vs rejected, and why).

---

## 6 · Reference tables

### Accessors

| Accessor | Type | Meaning |
|---|---|---|
| `market.mid` / `mid` | ticks | canonical mid (probability×10000) |
| `market.bid` / `market.ask` | ticks | best bid / ask |
| `market.spread` | ticks | ask − bid |
| `market.bid_size` / `market.ask_size` | lots | depth at best |
| `position.net_lots` / `position` | lots | signed net position |
| `position.avg_price` | ticks | average entry |
| `signal("x")` / `x` | scalar | platform or inline signal |
| `signal_mid("x")` / `signal_conf("x")` | ticks / bps | published signal fields |
| `params.x` | scalar | declared param |
| `ctx("...")` | scalar/bool | staleness, resolution, kill-switch, tradable |
| `<sig>.ready` / `<sig>.level` | bool / ticks | warm-up flag / trailing-stop level |

### Inline signal builtins

`ewma · running_mean · running_std · running_sum · running_max · running_min · count · bars_since` (O(1)) · `sma · momentum · rolling_std · bollinger` (window `N`) · `drawdown_from_entry · trailing_stop · time_in_trade · mae · mfe · r_multiple · unrealized_pnl · pnl_per_lot · position_value` (position/PnL) · `crossed_above · crossed_below · new_high · new_low · breakout · regime_flip` (edges).

### NegRisk cross-instrument

`negrisk_edge() · complementary_spread(N) · class_aggregate(field, op) · class_mate_bid(N) · class_mate_ask(N) · class_mate_mid(N)`.

### Numeric builtins

`min(a,b) · max(a,b) · abs(x) · clamp(x,lo,hi)`.

---

## 7 · Worked examples

**Mean-reversion around a fair value:**

```lqts
strategy mean_reversion_spread {
  params { fair: 0.50, max_spread: 0.0005, exit_edge: 0.04, max_lots: 250, clip: 100 }

  when market.spread <= params.max_spread
       && market.mid < params.fair
       && position.net_lots < params.max_lots {
    buy min(params.clip, params.max_lots - position.net_lots) lots @ market.mid
  }
  when position.net_lots > 0 && market.mid > params.fair + params.exit_edge {
    sell position.net_lots lots @ market.bid
  }
}
```

**Laddered entry with exclusive branches:**

```lqts
strategy laddered {
  params { hi: 0.8, lo: 0.2 }
  when signal("p") > params.hi {
    buy 100 lots @ mid
  } else if signal("p") > params.lo {
    buy 10 lots @ mid
  } else {
    sell 50 lots
  }
}
```

**Bounded NegRisk basket arb (3-outcome, fee-adjusted):**

```lqts
strategy negrisk_arb_v1 {
  params { fee_ceiling_ticks: 700, size_lots: 15 }
  when class_aggregate(ask, sum) > 10000 + params.fee_ceiling_ticks
    && class_mate_bid(0) > 0 && class_mate_ask(0) > class_mate_bid(0) && class_mate_ask(0) < 10000
    && class_mate_bid(1) > 0 && class_mate_ask(1) > class_mate_bid(1) && class_mate_ask(1) < 10000
    && class_mate_bid(2) > 0 && class_mate_ask(2) > class_mate_bid(2) && class_mate_ask(2) < 10000 {
    buy params.size_lots lots @ market.ask
  }
}
```

**Trailing-stop exit with warm-up guard:**

```lqts
strategy trend_with_stop {
  params { size: 50 }
  signal mom  = momentum(market.mid, 20)
  signal stop = trailing_stop(market.mid, ticks = 50)
  when mom.ready && mom > 0 && position.net_lots == 0 {
    buy params.size lots @ market.ask
  }
  when position.net_lots > 0 && stop {          # stop tripped -> exit
    sell position.net_lots lots @ market.bid
  }
}
```

---

## Changelog

- **1.0.4** (2026-08-23) — Corrected the results host: `/xpio/*` reads are served from `lumid.trade` (or `lum.id/lqt-mailbox/xpio/…`), **not** `lum.id`, where they 302 to the login page. Step 3's `lqt:strategy` scope is now selectable in the Tokens UI — previously identity granted it but nothing in the UI could request it, so this doc asked for a PAT that could not be minted.
- **1.0.3** (2026-07-20) — Corrected submit endpoint: self-serve path is `POST https://lum.id/lqt/submit/lqt_inbox`; PAT required in both `Authorization` header and `payload.auth.pat`. Compile is async — confirm via `GET /xpio/strategies`.
- **1.0.2** (2026-07-19) — Documented results reading: `GET /xpio/strategies` (registered strategies), `strategy.inspect` mailbox topic (cycle rollup), `GET /xpio/results` (raw outbox). Per-tenant scope server-injected from PAT.
- **1.0.1** (2026-07-18) — Clarified async compile flow; enriched platform signal and universe reference tables; added results-reading section.
- **1.0.0** (2026-07-18) — Full rewrite: DSL grammar reference, submit contract, worked examples, reference tables.
- **0.1.0** (2026-07-17) — Initial draft.

---

*LQT — Lumid QuantTrading · strategies run **on** the Lumid stack, **paper by default**, on Polymarket + Kalshi prediction markets.*

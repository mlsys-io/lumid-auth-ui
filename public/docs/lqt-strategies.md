# Write & Submit an LQT Strategy

*Author a trading strategy in the LQT DSL, submit it with your lum.id token, and watch it run — shadow/paper by default, on prediction markets (Polymarket + Kalshi).*

---

## 1 · What a strategy is

An LQT strategy is a small program written in the **LQT DSL** — plain text in a `.lqts` file. The platform compiles it to deterministic bytecode and runs it inside **one vetted virtual machine**. You never ship code that runs unsandboxed; you ship *rules*, and the VM executes them the same way for everyone.

**Three things to know up front:**

- **Your orders are *proposals*.** Every `buy`/`sell` passes through the governed risk gate — it can still be rejected. The DSL decides intent; the gate decides what's allowed.
- **You run *paper* by default.** Strategies mint **zero** real orders (`INTENT_SINK=memory`) until a super-admin explicitly flips a specific strategy to live. Writing + submitting is risk-free.
- **It's deterministic.** No clock, no randomness, no floating point — same inputs always produce the same actions. That's what makes it auditable and replayable.

---

## 2 · Write it — the `.lqts` DSL

A strategy has a name, optional `params`, and one or more `when` rules. Each rule is a guard (a condition) plus the actions that fire when the guard is true.

### The reference strategy

```
strategy momentum_30m {
  params { threshold: 0.6, size_lots: 100 }

  when signal("mom_30m") > params.threshold {
    buy params.size_lots lots @ mid
  }
}
```

Read it as: "when the `mom_30m` signal exceeds my threshold, buy 100 lots at the current mid price."

### Signals — platform & inline

Two ways to get a signal value:

- **Platform signals** — `signal("name")` reads a value the platform produces for you (e.g. `ofi_z`, `vpin`, `outcome_forecast`, `venue_mid`).
- **Inline signals** — compute your own from the price stream, no history needed. Declared with `signal <name> = <builtin>(...)`:

```
strategy ema_cross {
  params { size: 50, cap: 500 }
  signal fast = ewma(market.mid, halflife_s = 10)
  signal slow = ewma(market.mid, halflife_s = 60)

  when fast > slow && position.net_lots < params.cap {
    buy params.size lots @ market.ask
  }
  when fast < slow && position.net_lots > 0 {
    sell position.net_lots lots @ market.bid
  }
}
```

Inline builtins include `ewma`, `sma`, `momentum`, `rolling_std`, `bollinger`, plus position/PnL ones like `drawdown_from_entry`, `trailing_stop`, `r_multiple`, and edge detectors `crossed_above` / `new_high` / `breakout`. See the [reference](#6--reference).

### Market & position accessors

Read live context directly in any expression:

- `market.mid`, `market.bid`, `market.ask`, `market.spread` — the current book (`mid` is also usable bare as a price target).
- `position.net_lots`, `position.avg_price` — your current position.

### Multiple rules, multiple actions, branching

```
strategy laddered {
  params { hi: 0.8, lo: 0.2, size: 100 }

  // N independent guards, each fires on its own
  when signal("p") > params.hi {
    buy params.size lots @ mid          // multiple ; -separated actions allowed
  } else if signal("p") > params.lo {
    buy 10 lots @ mid
  } else {
    sell 50 lots
  }

  when position.net_lots > 0 && market.spread > 0.04 {
    sell position.net_lots lots @ market.bid
  }
}
```

Guards support `&&` / `||`, comparisons, and the numeric builtins `min`, `max`, `abs`, `clamp` — usable anywhere an expression is (conditions, sizes, prices):

```
buy clamp(abs(position.net_lots), 0, params.size) lots @ clamp(mid, 0.2, 0.8)
```

> **Prediction-market semantics.** Prices are probabilities in `[0,1]`. Payoff is binary and oracle-settled. Time-to-resolution and NegRisk equivalence classes (a basket of N−1 NOs ≡ 1 YES of the complement) are first-class — the risk gate enforces them.

---

## 3 · Submit it — token & deploy

### a) Get a token

Sign in at [lum.id](https://lum.id) → **Account → Tokens** and mint a Personal Access Token with the `lqt:strategy` scope. Copy it (format `lm_pat_live_…`) — this is the only thing that identifies you as the strategy's owner (your *tenant*).

### b) Send the strategy

Submit a `strategy.deploy` message. The simplest form carries your `.lqts` source (the platform compiles it server-side and tells you pass/fail — no local toolchain needed):

```bash
curl -X POST https://lum.id/lqt/strategies \
  -H "Authorization: Bearer $LQT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "ema_cross",
    "strategy_id": "ema_cross",
    "version": "1",
    "strategy": { "dsl": "<your .lqts source>" }
  }'
```

That's it. The platform authenticates your token, compiles the DSL, registers the strategy under *your* tenant, and starts running it — **paper**. You can also send pre-compiled bytecode via `"program_hex"` instead of `"dsl"` if you built it with the optional `lqt-strategy` CLI.

> **Compile errors come back to you.** If the DSL doesn't typecheck, the submission is rejected with the exact located diagnostic (line/column + reason). Fix and resubmit — same `strategy_id` updates in place.

---

## 4 · Where it lands — lanes, roles, paper

Your strategy is isolated to your tenant (row-level security — you can never see or touch another user's strategies). Where it *runs* depends on the region scope you request and your role:

| You are… | No scope given | `region_scope: ["nightly-dk"]` | Real orders |
|---|---|---|---|
| **user** (default) | runs the **prod-paper** lane (paper) | rejected — nightly is super-admin only | never |
| **admin** | prod-paper (paper) + can view others' strategies/logs | rejected | never |
| **super_admin** | prod-paper (paper) | the **nightly canary** lane | only super_admin, per-strategy, governed |

Add `"region_scope": ["eu-west-1"]` (or another prod lane) to target a specific region; omit it and you get the default prod-paper lane. Everything is **paper** — `buy`/`sell` mint no real orders — until a super-admin explicitly enables live trading for one specific strategy.

---

## 5 · Lifecycle — shadow → canary → promote

1. **Shadow / paper.** Your strategy runs against live market data and records what it *would* do (proposals, fills, PnL) — no money moves. This is where you iterate.
2. **Canary** *(super-admin build path)*. A dev-HEAD build runs in the `nightly-dk` lane; an automated `canary_compare` gate checks its decision distribution against prod before anything is promoted.
3. **Promote.** A super-admin proposes and an admin approves a governed `strategy.promote` — the strategy moves from the canary lane to a prod-paper lane. Still paper.
4. **Live** *(super-admin only, per strategy)*. The one gate that moves real money — fully governed, reversible, one strategy/venue at a time.

Your results are always visible via the read surfaces (your strategies, per-cycle telemetry, fills) — scoped to your tenant.

---

## 6 · Reference

### Context accessors

| Accessor | Meaning |
|---|---|
| `market.mid` / `mid` | current mid price (probability, 0–1) |
| `market.bid` / `market.ask` | best bid / ask |
| `market.spread` | ask − bid |
| `position.net_lots` | signed net position |
| `position.avg_price` | average entry price |
| `signal("name")` | platform-produced signal value |

### Inline signal builtins

| Builtin | What it computes |
|---|---|
| `ewma(x, halflife_s=…)` | exponentially-weighted moving average |
| `sma(x, N)` · `momentum(x, N)` · `rolling_std(x, N)` | window stats over a compile-time-constant N |
| `bollinger(x, N, k_bps=…)` | bounded-window band |
| `drawdown_from_entry` · `trailing_stop` · `mae` · `mfe` · `r_multiple` · `time_in_trade` | position/PnL, reset on the position zero-crossing |
| `crossed_above` · `crossed_below` · `new_high` · `new_low` · `breakout` · `regime_flip` | ≤1-tick edge detectors |
| `negrisk_edge()` · `complementary_spread(leg)` · `class_aggregate(field,op)` | bounded NegRisk cross-instrument (equivalence class) |

### Numeric builtins (anywhere an expression is)

| Builtin | Result |
|---|---|
| `min(a,b)` · `max(a,b)` | smaller / larger |
| `abs(x)` | absolute value (saturating) |
| `clamp(x,lo,hi)` | `x` constrained to `[lo,hi]` |

> **Want to validate offline first?** The optional `lqt-strategy` CLI (`lqt-strategy validate my.lqts` / `compile my.lqts`) checks and inspects your strategy locally and emits registration-ready hex — but it is **not required**. Writing `.lqts` in any editor and submitting it as source gives you the same located errors.

---

*LQT — Lumid QuantTrading · strategies run **on** the Lumid stack · paper by default, governed to go live.*

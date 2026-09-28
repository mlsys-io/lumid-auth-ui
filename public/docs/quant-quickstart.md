# Quant Research Quickstart

Your first strategy, backtested on real market history and read correctly, in
about 15 minutes. No trading experience needed, and no real money is involved:
everything here is paper trading.

This page is the short path. [Quant Research Onboarding](/studio/docs/first-run)
is the long one, with every step's recorded result and everything that has
gone wrong.

## 1. What you are trading, in 30 seconds

Quant Research trades **prediction-market contracts** on Kalshi and
Polymarket. Each contract asks a yes/no question with a deadline: *"Will BTC
close above $84,099.99 at 2 pm?"*

- A **YES** contract pays **$1 if the answer is yes** and **$0 if it is no**.
  That payout is called **settlement**.
- Before settlement it trades at a price between 0¢ and 100¢. The price is
  the market's current guess at the probability: 62¢ means the market thinks
  "yes" is about 62% likely.
- You make money by buying below what the contract ends up paying, or selling
  above it.

A **strategy** is a short set of rules that decide when to buy and sell,
based on the price and on a few published **signals**.

## 2. Words you will meet

| Word | Meaning here |
|---|---|
| **Strategy** | Your rules, written in a small language (`.lqts`). Registered under your account and paper-traded from the moment it compiles |
| **Signal** | A number computed from the market's trading, published for you to read. Three exist: `ofi_z`, `vpin`, `outcome_forecast` |
| **`ofi_z`** | Order-flow imbalance as a z-score: are buyers or sellers more aggressive than usual right now? Stored ×1000, so `1500` means 1.5 standard deviations |
| **`vpin`** | How "informed" the recent trading looks, from 0 to 1, stored ×10000 (`7000` = 0.7) |
| **Backtest** | Replaying your strategy over a contract's recorded history to see what it would have done |
| **Tape** | The recorded history of trades (prints) for one contract |
| **Real on all three axes** | The backtest used real recorded **prices**, real recorded **signals**, and the contract's real **settlement**. Anything less is labelled and is not a performance number |
| **Lot** | One contract |
| **Tick** | The price unit: 0 to 10000 is 0% to 100% |
| **Workflow / run** | A job the app runs (for example Backtest) and one execution of it |
| **Experiment / arm** | A comparison the app runs for you, and one side of it. You can ignore these at first |

## 3. Five steps

1. **Add the app.** Open **Marketplace**, find **Quant Research**, click
   **Add to my account**, then open it from **Your Apps** in the sidebar.
2. **Deploy your first strategy.** On the **Strategies** tab, scroll to
   **Deploy a strategy**. Put `my_first_ofi` in the name field and paste this
   into the strategy field:

   ```
   strategy my_first_ofi {
     params { threshold: 0.15, size_lots: 50 }
     when signal("ofi_z") > params.threshold {
       buy params.size_lots lots @ mid
     }
   }
   ```

   It says: when buyers are more aggressive than usual by 1.5 standard
   deviations, buy 50 contracts at the middle price. It is the app's
   `ofi_momentum_v1` sample, which has traded on real recorded history.
   Click **Deploy**. It appears under **Your strategies** once it compiles;
   if it does not compile, it appears under **Rejected submissions** with the
   compiler's reason.
3. **Backtest it.** On its row click **Backtest**. Leave the instrument blank:
   the app picks a contract that has real recorded prices, signals and a
   settlement.
4. **Get the result.** About a minute later, click **Poll result** on the same
   row. The verdict appears on the strategy's own page (click the row).
5. **Read it** with section 4 below.

Prefer to type? Every step is also a chat request in the panel on the right:
*"Write me a strategy that buys YES when order flow turns strongly
positive, and deploy it"*, then *"Backtest it, let it pick the market"*, then
*"Poll the result"*. When the chat asks for permission to run something,
**Always** lets it fix and resubmit without asking again.

## 4. Reading a result: three real examples

All three are recorded backtests of `ofi_momentum_v1` from 26–28 September
2026.

**A. Not real.** `replay: synthetic_lcg` or `signals: static`. The app could
not replay real history (no recorded trades for that contract, or a signal
your strategy reads has no history there). The numbers are moved under
`synthetic` and marked `presentable_as_performance: false`. **Do not quote
them.** Leave the instrument blank so the app picks a covered contract, and
read only the three published signals.

**B. Real, zero trades.** `KXMLBTOTAL-26SEP251840TBPHI-7`: 1,408 recorded
prints replayed, `replay: pg_tape`, `signals: recorded`,
`settlement: resolved`, and `total_actions: 0`. The data was real; your rule
simply never fired. This is a result, not a bug: signals exist only for the
last 10–45 minutes of an hourly contract, and 1.5 standard deviations is a
high bar. Do not lower the threshold just to make it trade.

**C. Real, with trades.** Two runs of the same strategy:

| Contract | Actions | Lots filled | Realized PnL (ticks) | Per lot |
|---|---|---|---|---|
| `KXBTCD-26SEP2614-T84099.99` | 1,370 | 68,500 | +456,170,000 | +6,659 |
| `KXMLBTOTAL-26SEP241845CLEBOS-7` | 145 | 7,250 | −2,765,000 | −381 |

Same rules, opposite outcomes. This strategy only ever buys, so it holds
until settlement and its whole result depends on how each contract settled.
**One market is one draw**: a big win on one contract says little about the
next one.

## 5. Is it any good? A checklist

- [ ] **Real on all three axes** (prices, signals, settlement). Otherwise it
  is not evidence.
- [ ] **It traded** (`total_actions` above 0). If it only buys, as the sample
  does, its result is mostly the settlement; add an exit rule to test the
  timing itself.
- [ ] **More than one market.** Backtest several contracts before believing
  any number.
- [ ] **Change one thing at a time**, and compare versions on the **same**
  contract and window. In chat: *"compare v1 and v2 on the same market"* runs
  both with identical settings.
- [ ] **Don't tune on the result you are judging.** A threshold chosen because
  it made one backtest look good has already seen the answer.
- [ ] **Paper-trade it forward.** Deployed strategies paper-trade
  automatically. For your own strategies the paper record shows decisions
  (proposed, sent, rejected), not profit.

## 6. Limits worth knowing up front

- **Three signals only**: `ofi_z`, `vpin`, `outcome_forecast`. A strategy that
  reads any other name compiles, but its backtests can never be real.
- **Backtests replay the last 7 days**, and a contract must have settled
  before its result counts.
- **A few backtests at a time**: at most 3 open, spaced a few minutes apart.
  If one is refused, the answer says how long to wait.
- **Disable is not an instant stop**: a running paper box keeps a strategy
  until it restarts.

## 7. Ignore for now

**Workflows**, **Experiments** and **Proposals** tabs, the
[LQT strategies](/studio/docs/lqt-strategies) HTTP reference, producing your
own signal, the SQL warehouse, and sandboxes. They are all real, and none of
them is needed for your first strategy.

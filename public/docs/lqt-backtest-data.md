# Backtest data — what a backtest can replay

A backtest replays **recorded** history. It is presentable as performance only when
all three axes are real — **prices** (`replay: pg_tape`), **signals**
(`signals: recorded`) and **settlement** (`settlement: resolved`) — and, if the
strategy reads book size, **depth** (`depth: recorded`). Every result says which
axis fell short and why, and carries a sealed receipt (`receipt_blake3`).

## Instruments and venues

| Venue | Instrument id | Prices come from |
|---|---|---|
| **Kalshi** | market ticker, e.g. `KXBTCD-26SEP2518-T83799.99` | the Kalshi field feeder (crypto daily / 15-minute series and others) |
| **Polymarket** | the **`0x` condition id**, lowercase (`0x` + 64 hex) | the YES token's prints: the Dublin feeder (~480 most-active markets) **and** the home recorder (below) |
| **Polymarket US** | market slug / condition id | the PM-US feeder |

- A Polymarket `0x` id is mapped to its YES token automatically; signals and
  settlement stay on the condition id. If the mapping fails the run falls back to a
  labelled synthetic tape and the result carries `tape_map_error`.
- **Auto-picked symbols** (blank `symbol`) come from `tape_covered_v1`: settled
  **Kalshi** instruments with `ofi_z` and `vpin` coverage. A strategy that reads any
  other signal is refused there (`incompatible_subject`) — pass an explicit `symbol`.
- **Home recorder (Polymarket).** Records, going forward, every open Polymarket market
  that has published signal history, plus the daily "Will the price of Bitcoin be
  above $X on <date>?" strikes, up to 200 markets. It also records the real top of
  book with sizes, which is what makes `market.bid_size` / `market.ask_size` real in a
  backtest. Nothing before a market was picked up can be recovered.

## Signals

A strategy reads a signal with `signal("name")`. A run is `signals: recorded` only
when **every** name it reads has history on the replayed instrument covering the
replay (the replay is clipped to where coverage starts, and must keep ≥ 200 prints);
otherwise it is `static` and not presentable.

- **Published for all users:** `vpin` (×10,000), `ofi_z` (z × 1,000 — `0.15` = z of
  1.5), `outcome_forecast`, on the instruments the market-data feeds cover.
- **Your own signal:** publish it (below). Choose one scale and never change it;
  probabilities are ×10,000.
- **Whose signals a backtest reads:** yours, plus the shared names above. No other
  user's signals are ever read. If you publish a shared name yourself (say `vpin`) on
  an instrument, your series replaces the shared one there.
- History starts 2026-08-25; nothing earlier exists.

### Publishing your own signal

`POST https://lum.id/lqt/submit/lqt_inbox` with your lum.id PAT (scope
`lqt:strategy` or `lqt:trading`) **twice** — as the `Authorization: Bearer` header
**and** inside the message as `payload.auth.pat`:

```json
{"source_endpoint": "my-pipeline",
 "records": [{"msg_id": "<uuid>", "topic": "signal.publish", "sender": "my-pipeline",
   "status": "pending",
   "payload": {"auth": {"pat": "<same PAT>"},
     "signals": [{"signal_name": "my_signal", "instrument_id": "0x<lowercase condition id>",
       "score_ticks": 400, "confidence_bps": 7000, "side_hint": 0,
       "ts_event_ns": 1790000000000000000}]}}]}
```

- **Always send `ts_event_ns`** (it defaults to 0 otherwise) and **lowercase** `0x` ids.
- `confidence_bps` 0–10,000; `side_hint` 0/1/2. Bad values are rejected, not clamped.
- Keep publishing: a backtest can only use history that exists for its window. A
  signal that stops being published stops being backtestable forward.
- Publishing a signal on a Polymarket market also gets that market recorded by the
  home recorder within about an hour.

## Replay window and retention

- Default window: the **last 7 days** up to now. Per backtest: `window` (seconds, or
  `90m` / `24h` / `7d`; minimum 1 hour, maximum 90 days) and `until`
  (`YYYY-MM-DD`, RFC 3339 or epoch seconds; up to 400 days back).
- At most the **50,000 most recent prints** in the window are replayed.
- Recorded tapes and signal history are kept for months; there is no scheduled
  deletion today. A dataset note that an instrument "ages out" means it slid past the
  default 7-day window, not that it was deleted.

## Fees, book and timing in a backtest

- Fills pay the venue's taker fee curve (`rate · C · p · (1 − p)`), shown as
  `fee_model` on the result.
- `market.bid` / `market.ask` are the recorded book when one exists, else the last
  taker prints (`book: recorded | trade_derived`).
- `ctx("time_to_resolution_s")` is the venue's stated close; `ctx("bar_closed_15m")`
  is true on the first evaluation of each new 15-minute bar.

## Asking for data that isn't here

There is **no self-serve request** for a new venue, a new market series in the
recorder, or a new shared signal: those are platform changes. Ask your operator,
naming the venue, the instruments or series, and the date range you need. Recording
starts from when it is switched on.

[Strategy language](/studio/docs/lqt-strategies) · [Reading guide](/studio/docs/first-run)

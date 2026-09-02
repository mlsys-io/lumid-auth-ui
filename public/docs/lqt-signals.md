# Producing your own signal

The [onboarding walkthrough](/studio/docs/first-run) has you read a signal
somebody else publishes. This page is the other half: what changes when **you**
have to produce one.

Read it once you have deployed something. It is not a prerequisite — it is the
next thing, and it is a bigger project than a strategy.

**Only three signal names reach `lqt.signal_history` today** — `vpin`, `ofi_z`,
and `outcome_forecast`. A strategy reading any other name is scored against a
seeded constant and labelled `signals: static`, which is not presentable no
matter how good the number looks. Publishing a fourth name is the work described
here.

---

## An LLM reading the news

The starter strategy in the walkthrough works because somebody else already
publishes `vpin`. This one shows what changes when **you** have to produce the
signal — which is where most of the real work in a strategy like this actually
lives.

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

### What `news_llm` actually is

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

The `instrument_id` must be one that is **live now** — a signal published
against an expired ticker is stored, but no backtest will ever replay against
it (the tape window is 7 days). `GET /lqt-data/market/kalshi-active-instruments`
returns the currently traded set, most active first.

```json
{"signals": [
  {"signal_name": "news_llm",
   "instrument_id": "KXBTCD-26SEP0211-T77099.99",
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

### Where this code runs — not where you might assume

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

### What this costs you, honestly

**It will not score `recorded` today.** `news_llm` is not published, so the run
falls back to a seeded constant and is labelled `signals: static` — a result you
cannot present no matter how good the number looks. That is not a bug to work
around; it is the label doing its job. Publishing the signal is what changes it.

The hard parts, in the order they will bite: getting rights to the text, mapping
a post to the right instrument, keeping the model's output parseable, and
holding a cadence. The DSL is the easy half, and it is already written above.

---

## Related

| | |
|---|---|
| [Quant Research Onboarding](/studio/docs/first-run) | the walkthrough this page branches off |
| [LQT strategies](/studio/docs/lqt-strategies) | the full `.lqts` language |
| [AI coding](/studio/docs/coding) | the model you are on, and what "unlimited" means |

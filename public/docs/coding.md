# AI coding — `deepseek-v4.1-flash` and `qwen3.8-27b`

**Two non-Anthropic models, open to every role.** Neither touches the Claude account
pool, so neither spends Anthropic quota.

| | `deepseek-v4.1-flash` | `qwen3.8-27b` |
|---|---|---|
| runs on | NUS SoC's GPU gateway first, then our office GX10 cluster | NUS SoC's GPU gateway |
| daily budget | **unlimited** | no pool quota |
| context | **1M** (1,048,576 tokens) | 214K |
| speed | ~60–150 tok/s per stream, depending on load | fast on short prompts |

**`deepseek-v4.1-flash` is unlimited.** No token budget, no rolling window, no
pool account to wait for. It runs on NUS's GPUs and our own, so it costs you nothing.
It is the default — use it unless you specifically want a second opinion.

**`qwen3.8-27b`** is the second model: a smaller dense model, served by NUS SoC's
GPU gateway. Pick it for a different model's take on a problem. Its context is
**214K**, not 1M — keep whole-repo-context work on deepseek.

A third id, `qwen3.8-flash-next`, is also accepted for every role (served by NUS SoC
only, no overflow); see the role matrix linked below.

The Claude account pool is **admin+ only**. If you find a doc, a dashboard or a
runbook talking about 4h/7d quota windows, per-user token caps or homing onto
pool accounts, it is describing the operator path — not yours.

> `deepseek-v4-flash` (no `.1`) was **retired on 2026-10-27** and now returns
> `503 unknown model`. If an old config, alias or script still names it, change
> it to `deepseek-v4.1-flash`.

---

## Start here

```bash
export ANTHROPIC_BASE_URL=https://lum.id/claude
export ANTHROPIC_AUTH_TOKEN=lm_pat_live_...     # your lum.id PAT
export ANTHROPIC_MODEL=deepseek-v4.1-flash      # or qwen3.8-27b
export API_TIMEOUT_MS=600000                    # see "The one setting that matters"
claude
```

Claude Code has no picker for these — it only lists Anthropic models. Choose one
explicitly with `ANTHROPIC_MODEL`, or `claude --model qwen3.8-27b`.

No terminal? The [Studio chatbox](/studio) runs the same model server-side — no
install, no PAT.

Full setup, per-shell and settings.json variants, and the role/model matrix live
in [Claude pool & lum.id/claude](/studio/docs/claude).

---

## The one setting that matters

**`export API_TIMEOUT_MS=600000`.** Set it before anything else.

Claude Code ships a 60-second client timeout (`x-stainless-timeout=60`). Before
the first token comes back, the whole prompt has to be read (prefill). Measured
on `deepseek-v4.1-flash` on 2026-10-27, on the NUS H200 server that served it
then, a cold (uncached) prompt prefilled at roughly **10–11k tokens/sec**:

| context | cold time to first token |
|---|---|
| 100k | ~10 s |
| 500k | ~45 s |
| 1M | **~93 s** (measured) |

That server stopped serving on 2026-11-07. Today's fallback, the office GX10
cluster, prefills at about **4k tokens/sec**, so a cold 250k-token prompt
already takes over a minute. A cache-missing long turn **will** exceed the default
client timeout, abort, and retry with backoff. What you see is
*"Waiting for API response · will retry in Xm · check your network"* — which
looks like a network fault and is not one. Raising the timeout fixes it.

A prefix-cache **hit** skips most of that, which is why the second turn in a
conversation is so much faster than the first.

## Keep injected context small

Because cost is dominated by prefill, the size of what you paste or auto-inject
matters far more than the length of the reply. Cold prefills of *different*
long prompts also queue behind each other on the shared backends — one huge
paste makes everyone behind it wait, so trim what you do not need.

## Concurrency

Requests go to NUS SoC's gateway first. The office GX10 fallback, measured
2026-11-23 with 256-token replies:

| concurrent streams | per-stream tok/s | total tok/s |
|---|---|---|
| 1 | ~73 | ~73 |
| 4 | ~34 | ~124 |
| 8 | ~21 | ~151 |
| 16 | ~12 | ~166 |

The gateway runs up to **30 deepseek requests at once** (14 on NUS SoC, 16 on
the GX10s); beyond that a request waits for a slot. It spills to a metered
OpenRouter copy of the same model only if your Claude pool allows OpenRouter.
Shared prefixes (the same tool catalog, the same repo) are cached, so many
people asking similar questions at once is cheap.

## Rate limit

**120 requests/minute per user** through `lum.id/claude` (6000/minute if you call
`lum.id/llm` directly), keyed on you — not shared with anyone else. You are very
unlikely to meet it interactively; a script fanning out can.

## What "unlimited" does and does not mean

- **No quota.** `dailyBudgetTokens: -1`. Nothing decrements, nothing to check.
- The `/quota` command and the pool pages report **pooled Anthropic** usage only.
  If they read zero, that is correct — your usage is on deepseek, which those
  windows deliberately exclude.
- Unlimited is not infinite throughput: shared backends serve everyone, so heavy
  concurrent load shows up as latency (or, where your pool allows it, a spill to
  the metered overflow), not as a quota refusal.

## Context window

**1M tokens (1,048,576).** Claude Code appends a `[1m]` marker to the model id
(`deepseek-v4.1-flash[1m]`); the proxy strips it before routing. You never type
it, and for this model the marker now matches the real window.

## Reasoning

`deepseek-v4.1-flash` is a reasoning model: it thinks before answering, and the
thinking counts against `max_tokens`. Allow a few hundred tokens minimum. Over
`lum.id/llm` the thinking arrives separately as `reasoning_content`; pass
`"chat_template_kwargs": {"thinking": false}` to skip it for short answers. Tool
calls are supported.

---

## When something looks wrong

| symptom | what it actually is |
|---|---|
| *"Waiting for API response · will retry"* | Cold prefill exceeded the 60 s client default. Set `API_TIMEOUT_MS=600000`. |
| First turn slow, rest fast | Prefix cache warming. Expected. |
| `/quota` shows all zeros | Correct — that command reports pooled Claude usage, not deepseek. |
| `403` on a model | You asked for Opus or Fable above your role (a `user` asking for Sonnet or Haiku is quietly served `deepseek-v4.1-flash` instead). Use `deepseek-v4.1-flash` or `qwen3.8-27b`. |
| `503 unknown model` | The id is not served. Most often the retired `deepseek-v4-flash` — use `deepseek-v4.1-flash`. The gateway is a strict allowlist; unknown ids are refused, never silently forwarded. |
| `content: null`, `finish_reason: "length"` | `max_tokens` was used up by reasoning. Raise it. |

## Related

- [Claude pool & lum.id/claude](/studio/docs/claude) — full client setup, role matrix, session recording
- [FinData SQL access](/studio/docs/findata-sql) — query the warehouse directly
- [Write & submit an LQT strategy](/docs/lqt-strategies)

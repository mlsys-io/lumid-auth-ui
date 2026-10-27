# AI coding — `deepseek-v4.1-flash` and `qwen3.8-27b`

**Two in-house models, open to every role.** Neither touches the Claude account
pool, so neither spends Anthropic quota.

| | `deepseek-v4.1-flash` | `qwen3.8-27b` |
|---|---|---|
| runs on | our 4× H200 NVL server (NUS) | luyao1 RTX 5090 (tier 0) + home replicas (tier 1) |
| daily budget | **unlimited** | no pool quota |
| context | **1M** (1,048,576 tokens) | 376K (tier 0) / 214K (tier 1) |
| speed | ~100 tok/s per stream, even at 1M context | fast on short prompts |

**`deepseek-v4.1-flash` is unlimited.** No token budget, no rolling window, no
waiting for a slot. It runs on our own H200s, so it costs nothing at the margin.
It is the default — use it unless you specifically want a second opinion.

**`qwen3.8-27b`** is the second in-house model: a smaller dense model on our own
RTX 5090s. Pick it for a different model's take on a problem.

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
on `deepseek-v4.1-flash` on 2026-10-27, a cold (uncached) prompt prefills at
roughly **10–11k tokens/sec**:

| context | cold time to first token |
|---|---|
| 100k | ~10 s |
| 500k | ~45 s |
| 1M | **~93 s** (measured) |

So a cache-missing turn above roughly 600k tokens **will** exceed the default
client timeout, abort, and retry with backoff. What you see is
*"Waiting for API response · will retry in Xm · check your network"* — which
looks like a network fault and is not one. Raising the timeout fixes it.

A prefix-cache **hit** skips most of that, which is why the second turn in a
conversation is so much faster than the first.

## Keep injected context small

Because cost is dominated by prefill, the size of what you paste or auto-inject
matters far more than the length of the reply. Cold prefills of *different*
long prompts also queue behind each other on the shared server — a 1M-token
paste makes everyone behind it wait ~90 s, so trim what you do not need.

## Concurrency

Measured 2026-10-27 at 1M context, 512-token replies:

| concurrent streams | per-stream tok/s | total tok/s |
|---|---|---|
| 1 | ~104 | ~104 |
| 4 | ~69 | ~276 |
| 8 | ~45 | ~360 |
| 16 | ~26 | ~409 |

The server takes up to **24 concurrent requests**; beyond that the gateway sends
the overflow to a metered OpenRouter copy of the same model rather than refusing.
Shared prefixes (the same tool catalog, the same repo) are cached, so many
people asking similar questions at once is cheap.

## Rate limit

**6000 requests/minute per caller**, keyed on your PAT — not shared with anyone
else. You are very unlikely to meet it interactively; a script fanning out can.

## What "unlimited" does and does not mean

- **No quota.** `dailyBudgetTokens: -1`. Nothing decrements, nothing to check.
- The `/quota` command and the pool pages report **pooled Anthropic** usage only.
  If they read zero, that is correct — your usage is on deepseek, which those
  windows deliberately exclude.
- Unlimited is not infinite throughput: one server serves everyone, so heavy
  concurrent load shows up as latency (or a spill to the metered overflow),
  never as a refusal.

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
| `403` on a model | You asked for a pooled Claude model above your role. Use `deepseek-v4.1-flash` or `qwen3.8-27b`. |
| `503 unknown model` | The id is not served. Most often the retired `deepseek-v4-flash` — use `deepseek-v4.1-flash`. The gateway is a strict allowlist; unknown ids are refused, never silently forwarded. |
| `content: null`, `finish_reason: "length"` | `max_tokens` was used up by reasoning. Raise it. |

## Related

- [Claude pool & lum.id/claude](/studio/docs/claude) — full client setup, role matrix, session recording
- [FinData SQL access](/studio/docs/findata-sql) — query the warehouse directly
- [Write & submit an LQT strategy](/docs/lqt-strategies)

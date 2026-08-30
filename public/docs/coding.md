# AI coding — `deepseek-v4-flash` and `glm-5.3-flash`

**Two in-house models, open to every role.** Neither touches the Claude account
pool, so neither spends Anthropic quota.

| | `deepseek-v4-flash` | `glm-5.3-flash` |
|---|---|---|
| runs on | our H100 NVL pair | our CPU box, overflowing to OpenRouter |
| daily budget | **unlimited** | 1.5M tokens (~200 chat turns) |
| context | 512K | 1M |
| first turn | fast | can be slow — see below |

**`deepseek-v4-flash` is unlimited.** No token budget, no rolling window, no
waiting for a slot. It runs on our own H100 NVL pair, so it costs nothing at
the margin.

**`glm-5.3-flash`** is a 321B/18B-active MoE (MIT licence) served from our own
CPU box, with OpenRouter as the overflow when that box is busy. It has a finite
daily budget because the overflow is billed — 1.5M tokens, roughly 200 chat
turns a day. Pick it for a second opinion, a long-context job (1M), or when you
want a different model's take; stay on deepseek for everyday speed.

The Claude account pool is **admin+ only**. If you find a doc, a dashboard or a
runbook talking about 4h/7d quota windows, per-user token caps or homing onto
pool accounts, it is describing the operator path — not yours.

---

## Start here

```bash
export ANTHROPIC_BASE_URL=https://lum.id/claude
export ANTHROPIC_AUTH_TOKEN=lm_pat_live_...     # your lum.id PAT
export ANTHROPIC_MODEL=deepseek-v4-flash         # or glm-5.3-flash
export API_TIMEOUT_MS=600000                    # see "The one setting that matters"
claude
```

Claude Code has no picker for these — it only lists Anthropic models. Choose one
explicitly with `ANTHROPIC_MODEL`, or `claude --model glm-5.3-flash`.

### Why a GLM turn can start slowly

`glm-5.3-flash` is served CPU-first, and CPU **prefill** is ~65-90 tokens/sec.
Your prompt is read before a single token comes back, so a large one takes real
time: a chat turn carrying its tool catalog is a few seconds once the prefix is
cached, but the FIRST turn against an uncached prefix can take a minute or more.
Two things bound it — a warm-up keeps the common prefixes cached, and any turn
that produces nothing for 30s is answered from OpenRouter instead. Decode is not
the problem: GLM decodes at ~13 tok/s, slightly faster than deepseek's ~12.

If you are sending very large prompts (a full repo context, a 45k-token tool
catalog), prefer deepseek — the H100 pair prefills far faster.

No terminal? The [Studio chatbox](/studio) runs the same model server-side — no
install, no PAT.

Full setup, per-shell and settings.json variants, and the role/model matrix live
in [Claude pool & lum.id/claude](/studio/docs/claude).

---

## The one setting that matters

**`export API_TIMEOUT_MS=600000`.** Set it before anything else.

Claude Code ships a 60-second client timeout (`x-stainless-timeout=60`). The
table below (prefill ~1.6-1.7k tokens/sec, giving the "cold time to first
token" figures) was measured on the **retired GB10 backend** — deepseek-v4-flash
now runs on an H100 NVL pair (as of 2026-08-30) and these specific numbers have
not been re-benchmarked since. Treat them as **stale but directionally
useful**: cache-missing large-context turns can still exceed a 60s client
timeout, so the advice to raise it stands even though the exact thresholds
below need re-verification.

| context | cold time to first token (GB10, unverified on H100) |
|---|---|
| 30k | ~24 s |
| 60k | ~49 s |
| 120k | ~103 s |

So a cache-missing turn above roughly 72k tokens **may** exceed the default
client timeout, abort, and retry with backoff. What you see is
*"Waiting for API response · will retry in Xm · check your network"* — which
looks like a network fault and is not one. Raising the timeout fixes it
regardless of the exact threshold.

A prefix-cache **hit** is ~1.3 s regardless of size, which is why the second turn
in a conversation is so much faster than the first.

## Keep injected context small

Because cost is dominated by prefill, the size of what you paste or auto-inject
matters far more than the length of the reply. Trimming a 100k-token context to
30k is the difference between a 60-second wait and a 20-second one.

## Concurrency is fine — better than you'd expect

Measured against production, 2026-08-23, with FinData tool calls:

| concurrent users | p50 | all succeeded |
|---|---|---|
| 1 | 15.9 s | ✅ |
| 10 | 15.1 s | ✅ |
| 20 | 9.8 s | ✅ |

It gets **faster** under load, which is not a typo. Every one of those turns
carries the same ~18k-token tool-schema prefix, so once the first user warms the
prefix cache everyone after rides it. Twenty people asking data questions at once
is a well-tested case.

The corollary is worth knowing: this only holds while everyone shares a prefix.
Long unique preambles pasted ahead of your question defeat the cache for you
specifically.

## Rate limit

**6000 requests/minute per caller**, keyed on your PAT — not shared with anyone
else. You are very unlikely to meet it interactively; a script fanning out can.

## What "unlimited" does and does not mean

- **No quota.** `dailyBudgetTokens: -1`. Nothing decrements, nothing to check.
- The `/quota` command and the pool pages report **pooled Anthropic** usage only.
  If they read zero, that is correct — your usage is on deepseek, which those
  windows deliberately exclude.
- Unlimited is not infinite throughput: one GPU pair serves everyone, so heavy
  concurrent load shows up as latency, never as a refusal.

## Context window

**512K tokens.** The model is architecturally trained up to 1M (YaRN-extended),
but the deployed serving config runs at a 512K ceiling — the highest context
validated safe under real concurrent load on the current hardware. Claude Code
appends a `[1m]` marker to the model id (`deepseek-v4-flash[1m]`); the proxy
strips it before routing. You never type it, and selecting `deepseek-v4-flash`
gets you the deployed 512K window, not the full 1M the marker implies.

---

## When something looks wrong

| symptom | what it actually is |
|---|---|
| *"Waiting for API response · will retry"* | Cold prefill exceeded the 60 s client default. Set `API_TIMEOUT_MS=600000`. |
| First turn slow, rest fast | Prefix cache warming. Expected. |
| `/quota` shows all zeros | Correct — that command reports pooled Claude usage, not deepseek. |
| `403` on a model | You asked for a pooled Claude model above your role. Use `deepseek-v4-flash` or `glm-5.3-flash`. |
| `404` on a model | The gateway is a strict allowlist; unknown ids are refused, never silently forwarded. |
| `429` daily chat budget | Only `glm-5.3-flash` has one (1.5M tok/24h). Switch to `deepseek-v4-flash`, which is uncapped. |

## Related

- [Claude pool & lum.id/claude](/studio/docs/claude) — full client setup, role matrix, session recording
- [FinData SQL access](/studio/docs/findata-sql) — query the warehouse directly
- [Write & submit an LQT strategy](/docs/lqt-strategies)

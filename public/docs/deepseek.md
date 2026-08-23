# Your model: `deepseek-v4-flash`

**This is the model you are on, and it is unlimited.** No token budget, no
rolling window, no waiting for a slot. It runs on our own GB10 pair, so it costs
nothing at the margin and is open to every role.

The Claude account pool is **deprecated** (2026-08-23). If you find a doc, a
dashboard or a runbook talking about 4h/7d quota windows, per-user token caps or
homing onto pool accounts, it is describing the old operator path — not yours.

---

## Start here

```bash
export ANTHROPIC_BASE_URL=https://lum.id/claude
export ANTHROPIC_AUTH_TOKEN=lm_pat_live_...     # your lum.id PAT
export ANTHROPIC_MODEL=deepseek-v4-flash
export API_TIMEOUT_MS=600000                    # see "The one setting that matters"
claude
```

No terminal? The [Studio chatbox](/studio) runs the same model server-side — no
install, no PAT.

Full setup, per-shell and settings.json variants, and the role/model matrix live
in [Claude pool & lum.id/claude](/studio/docs/claude).

---

## The one setting that matters

**`export API_TIMEOUT_MS=600000`.** Set it before anything else.

Claude Code ships a 60-second client timeout (`x-stainless-timeout=60`). Prefill
on the GB10 runs at roughly **1.6–1.7k tokens/sec**, so a turn whose context
misses the cache takes about:

| context | cold time to first token |
|---|---|
| 30k | ~24 s |
| 60k | ~49 s |
| 120k | ~103 s |

So **any cache-missing turn above roughly 72k tokens exceeds the default client
timeout**, aborts, and retries with backoff. What you see is
*"Waiting for API response · will retry in Xm · check your network"* — which
looks like a network fault and is not one. Raising the timeout fixes it.

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

**1M tokens.** Claude Code appends a `[1m]` marker to the model id
(`deepseek-v4-flash[1m]`); the proxy strips it before routing. You never type it,
and selecting `deepseek-v4-flash` always gives you the full window.

---

## When something looks wrong

| symptom | what it actually is |
|---|---|
| *"Waiting for API response · will retry"* | Cold prefill exceeded the 60 s client default. Set `API_TIMEOUT_MS=600000`. |
| First turn slow, rest fast | Prefix cache warming. Expected. |
| `/quota` shows all zeros | Correct — that command reports pooled Claude usage, not deepseek. |
| `403` on a model | You asked for a pooled Claude model above your role. Use `deepseek-v4-flash`. |
| `404` on a model | The gateway is a strict allowlist; unknown ids are refused, never silently forwarded. |

## Related

- [Claude pool & lum.id/claude](/studio/docs/claude) — full client setup, role matrix, session recording
- [FinData SQL access](/studio/docs/findata-sql) — query the warehouse directly
- [Write & submit an LQT strategy](/docs/lqt-strategies)

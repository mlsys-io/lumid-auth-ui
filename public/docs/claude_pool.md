# Claude Account Pool — `lum.id/claude`

Run your own Claude Code through the org's pooled Claude accounts. The proxy
authenticates you with a lum.id PAT, then routes every request to the pooled
account with the most available quota — so nobody stalls on a personal 5-hour
limit while other accounts sit idle.

---

## No terminal? Use the Studio chatbox

The [Studio chatbox](/studio) runs **real Claude Code sessions** server-side —
no install, no PAT setup. Pick a **(Code)** model from the model picker:

| Model | Who | Backed by |
|---|---|---|
| DeepSeek-V4-Flash (Lumid GPU) | everyone | In-house GB10 pair — **default**, no pool quota |
| Claude Sonnet (Code) | everyone | Account pool (your 5h/7d quota) |
| Claude Opus (Code) | admin+ | Account pool |
| Claude Fable 5 (Code) | super_admin | Account pool |
| Kimi K3 (Code) | admin+ | Moonshot API — cost-metered, no pool quota |
| GLM-5.2 (Code) | admin+ | OpenRouter — cost-metered, no pool quota |

Each turn runs the claude CLI in a sandboxed per-user workspace, and the
transcript renders the way the CLI does: reasoning blocks, tool calls in the
order they happened (with a real diff for edits and a terminal block for Bash),
and a sub-agent's own work nested under the Task that spawned it. Stop
interrupts the agent cooperatively — it finishes the tool it's on, so the turn
stays resumable instead of being killed mid-write. Each finished turn shows its
cost, duration, step count and cache hit rate. The session pill above the composer shows
the live session; reopening a chat thread resumes it. Pool-backed models show
your personal quota next to the model picker, and their sessions are recorded
on [/claude-sessions](/claude-sessions) like any pool traffic. The
DeepSeek-V4-Flash entry runs the same Claude Code harness against our own GPUs —
free at the margin, not recorded by the pool, and open to every role.

> The **Qwen3.6-35B** row was removed on 2026-08-21. It claimed an in-house GPU
> and availability to everyone, and neither is true any more: `SELF_HOSTED_MODELS`
> on claude-proxy defaults to `deepseek-v4-flash` alone, so any other non-Anthropic
> id is treated as externally billed and gated to admin+. The qwen backends
> themselves went with luyao1 on 2026-08-17.

**The chatbox default is DeepSeek-V4-Flash, served on our own hardware.** It runs
tensor-parallel across the two GB10 boxes, so ordinary chat costs nothing per
token and consumes no pool quota — reach for a Claude **(Code)** model when you
want a real Claude Code session (tool use, repo edits, sub-agents), and leave
everyday chat on the default. It is a reasoning model, so its thinking is
streamed as a reasoning block and kept out of the final answer. Note this is the
*in-house* copy, not the metered OpenRouter one — see
[Non-Anthropic models](#non-anthropic-models-kimi-k3-glm-52-deepseek) for why the
`deepseek/` prefix matters.

---

## Quick start

1. **Mint a PAT** at [lum.id/dashboard/tokens](/dashboard/tokens) with the
   `claude:proxy` scope.
2. **Point Claude Code at the pool:**

```bash
export ANTHROPIC_BASE_URL=https://lum.id/claude
export ANTHROPIC_AUTH_TOKEN=lm_pat_live_...   # your claude:proxy PAT
claude
```

That's it. No new client, no re-login — this is the standard Claude Code
`ANTHROPIC_BASE_URL` override.

---

## Integrating with your existing Claude Code client

Your existing installation works as-is. Pick the integration style that fits:

### A. Permanent (settings.json)

Add the two variables to `~/.claude/settings.json` — they apply to every
session without touching your shell profile:

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://lum.id/claude",
    "ANTHROPIC_AUTH_TOKEN": "lm_pat_live_..."
  }
}
```

To go back to your personal account, remove the two keys. Your existing
`claude auth login` credentials are untouched the whole time — the env vars
simply take precedence while present.

### B. Per-shell / per-project

Export the variables only where you want pool routing — e.g. in a project's
`.envrc` (direnv), or as a shell alias:

```bash
alias claude-pool='ANTHROPIC_BASE_URL=https://lum.id/claude ANTHROPIC_AUTH_TOKEN=$LUMID_CLAUDE_PAT claude'
```

Then `claude-pool` uses the pool while plain `claude` stays on your
personal login.

### C. Raw API

Any Claude-Code-shaped request works with plain HTTP too:

```bash
curl https://lum.id/claude/v1/messages \
  -H "Authorization: Bearer lm_pat_live_..." \
  -H "content-type: application/json" \
  -H "anthropic-version: 2023-06-01" \
  -d '{"model":"claude-haiku-4-5-20251001","max_tokens":64,"messages":[{"role":"user","content":"hi"}]}'
```

---

## Model selection

Model choice is entirely yours and passes through untouched:

```bash
claude --model opus               # per-invocation flag
/model                            # switch model inside a session
export ANTHROPIC_MODEL=claude-opus-4-8   # env default
```

Whatever model your client requests is forwarded to the pooled account
(subject to that account's plan **and** your role tier below).

### Model access by role

The pool gates model families by your lum.id role:

| Role | Sonnet / Haiku | Opus | Fable | relay models |
|------|:---:|:---:|:---:|:---:|
| `user` | ✅ | — | — | — |
| `admin` | ✅ | ✅ | — | ✅ |
| `super_admin` | ✅ | ✅ | ✅ | ✅ |

Requesting a model above your tier returns `403` with the required role —
switch to an allowed model (e.g. `--model sonnet`) or ask an admin to raise
your role. Unlisted/base models are available to everyone.

### Non-Anthropic models (kimi-k3, GLM-5.2, DeepSeek)

Additional models are available to `admin`+ via the `lum.id/llm` relay —
same PAT, no extra setup:

| Model flag | Backing | Context | Price (input/output per M tok) |
|---|---|---|---|
| `--model deepseek-v4-flash` | **In-house GB10 pair** | 256K | **free** — owned GPUs |
| `--model kimi-k3` | Moonshot | — | $3 / $15 |
| `--model z-ai/glm-5.2` | OpenRouter | — | $0.77 / $2.42 |
| `--model deepseek/deepseek-v4-flash-0731` | OpenRouter | 1.31M | $0.14 / $0.28 |

> **Two DeepSeek-V4-Flash entries, and the difference is the bill.** They are the
> same model weights reached two different ways, and the *only* thing telling them
> apart is the `deepseek/` vendor prefix:
>
> - **`deepseek-v4-flash`** (no prefix) — served on **our own two GB10 boxes**,
>   tensor-parallel across the pair. Free at the margin, no metering, no data
>   leaving the tailnet. 256K context. This is the one the Studio chatbox uses by
>   default. Prefer it.
> - **`deepseek/deepseek-v4-flash-0731`** (vendor prefix) — the **OpenRouter**
>   hosted copy, cost-metered per token, larger 1.31M context.
>
> Reach for the OpenRouter one only when you genuinely need context beyond 256K
> or the in-house pair is down; otherwise the prefix just spends money on a model
> we already host.

Any OpenRouter model id works, not just the ones listed — unlisted models fall
through to the OpenRouter catch-all. That fallthrough is also a trap worth knowing:
a **mistyped or retired local model id does not 404**, it silently becomes an
OpenRouter request. Only the locally-served models appear in `GET /v1/models`, so
a model being absent from that list does **not** mean it is unavailable — but it
does mean you are about to be billed for it.

**DeepSeek v4 Flash is a reasoning model**, and its reasoning tokens count
against `max_tokens`. A small budget returns `content: null` with
`finish_reason: "length"` — that is the budget being consumed before any answer
is emitted, not an error. Allow a few hundred tokens minimum.

These models **do not consume the Anthropic pool quota** (they use separate API
keys). Usage is recorded and visible on [/code](/code) under **Per-user pool
usage** → model breakdown, with actual cost in USD rather than token counts.

---

## How load balancing works

- **Headroom-based selection.** For each new session the proxy asks
  lumid-identity for the pooled account with the lowest
  `max(5-hour, 7-day)` utilization — the binding constraint is whichever
  window is fuller. Accounts that are rate-limit `exceeded` are skipped.
- **Sticky sessions.** Your requests stay on the same account for ~30
  minutes. This keeps Anthropic's prompt cache warm — switching accounts
  mid-session would re-bill your whole context as fresh input tokens.
- **Own-account preference.** If your lum.id email matches an account in the
  pool, you get your own account first (when it's healthy).
- **Automatic failover.** When Anthropic returns 401/403/429 for an account,
  the proxy benches it for ~5 minutes and retries your request against a
  different account (up to 3) — so a rate-limited or dead account rotates out
  within the same call, not just the next one. Expired access tokens are
  refreshed server-side automatically (accounts registered with a refresh
  token).
- **Live quota tracking.** The proxy reads Anthropic's rate-limit headers off
  every response and feeds the [/code](/code) dashboard — no extra probes.

## Your personal pool quota

Each user gets their own quota on the pool, mirroring Anthropic's window
shape: a **5-hour** and a **7-day** rolling token budget (uncached input +
output tokens, summed across all your PATs). Currently **2M tokens / 5h**
and **30M / 7d** — operator-tunable via `LUMID_QUOTA_CLAUDE_{5H,7D}_TOKENS`
(the code defaults are 4M/40M, deliberately lowered for a small pool).

- When a window is exhausted the proxy returns `429` with the reason and
  Claude Code backs off; the window rolls continuously, so capacity returns
  as old usage ages out.
- Current per-user consumption is visible to admins on
  [/code](/code) under **Per-user pool usage**.

### Seeing your usage from the CLI

**Claude Code's built-in `/usage` cannot show pool usage** — it is a
subscription-account view. Internally `fetchUtilization()` returns early on a
check of your OAuth *subscription scopes*, and even past that it calls
`claude.ai/api/oauth/usage` rather than your `ANTHROPIC_BASE_URL`. Gateway
users have no OAuth session, so nothing lum.id serves can appear there.

Two surfaces do work. Both use the same script, and both reuse the PAT you
already export — `GET /api/v1/me/claude-usage` authenticates the user and
needs **no extra scope** (`claude:proxy` gates only the proxy route itself).

```bash
curl -fsSL https://lum.id/docs/lumid-pool-usage.sh -o ~/.claude/lumid-pool-usage.sh
chmod +x ~/.claude/lumid-pool-usage.sh
curl -fsSL https://lum.id/docs/quota.md -o ~/.claude/commands/quota.md
```

**`/quota` — a slash command**, the closest thing to `/usage`:

```
lum.id/claude — your pool usage

  5h  ████████████████████░░░░░░░░  71.0%   1.42M / 2.00M   resets in 1h36m
  7d  ████████░░░░░░░░░░░░░░░░░░░░  31.2%   9.35M / 30.00M  resets in 52h59m

  by model (7d)
    claude-sonnet-5                       7.10M
    claude-opus-5                         1.90M

  1284 requests over 7d  ·  $41.73
```

**A statusline** — always visible, one line. Add to `~/.claude/settings.json`:

```json
{ "statusLine": { "type": "command", "command": "~/.claude/lumid-pool-usage.sh" } }
```

```
⧉ pool 71%/5h ↺1h36m · 62%/7d
```

It colours cyan → yellow (≥70%) → red (≥90%) on whichever window binds
first. Results are cached for 60s and curl is capped at 2s, so it never
stalls your prompt; on any failure it prints nothing rather than an error.

## Session recording

Every conversation routed through the pool is **recorded by default** — the
full request context, system prompt, tools, tool calls/results, sampling
params, and the model's responses. Browse your own at
[/claude-sessions](/claude-sessions), turn-by-turn.

- **Storage is delta-compacted.** The API re-sends the whole conversation each
  turn; we store only the new messages per turn, so a long session doesn't
  balloon.
- **Access.** You can always read your own sessions. `super_admin` operators
  can read any user's (full content — treat the pool as operator-visible).
- **Opt out.** Toggle recording off on [/claude-sessions](/claude-sessions) (or
  `POST /api/v1/me/claude-recording {"enabled":false}`). While off, nothing is
  stored for your sessions; token metering still applies.

> Because transcripts capture whatever you send — code, secrets, PII — keep
> recording off for sensitive work, or use your personal account instead of the
> pool.

## Contributing your account to the pool

Admins add accounts on [lum.id/code](/code) → **Add account** — paste the
access + refresh token from your `~/.claude/.credentials.json` (the dialog
shows the exact one-liner). Adding the refresh token enables automatic
renewal, so the account keeps working after the access token expires.

### One family, one holder — the logout step is load-bearing

Anthropic **rotates the refresh token on every renewal**: each exchange
returns a new refresh token and invalidates the previous one, so a
credential family has exactly one live refresh token at a time. If the
same credentials live in the pool *and* in your own `~/.claude/`, both
sides refresh independently — whichever refreshes first silently stales
the other, and when the stale side next presents its token, Anthropic's
reuse detection **revokes the entire family** for both. The pool then
shows the account as *"Family revoked — re-add required"* and quarantines
it (no more retries) until it's re-added.

The fix is family separation, done at contribution time:

1. `claude auth login` as the account being contributed
2. Copy the tokens into **Add account** (pool now owns this family)
3. `claude auth logout` — **do not skip this**
4. `claude auth login` again for your own use — this mints a *separate*
   family, so your local refreshes can never collide with the pool's

If your own account is in the pool, the cleanest setup is to not hold a
local login at all: point your CLI at the pool (`ANTHROPIC_BASE_URL` +
PAT, per Quick start) — one family, one holder, nothing to collide.

---

## Notes & limits

- The endpoint accepts **lum.id PATs only** (`claude:proxy` or `*` scope).
  A missing scope returns `403` with instructions; Anthropic keys are
  rejected.
- Pooled tokens are Claude Code OAuth tokens, which Anthropic restricts to
  Claude-Code-shaped traffic. Your real Claude Code client satisfies this
  automatically; arbitrary SDK traffic may be rejected upstream.
- Long agentic turns are fine — the edge allows up to 1 hour per request,
  streaming.
- Requests are logged (your email, chosen account, path, model, status,
  duration) for usage accounting. Prompt/response bodies are **not** logged.

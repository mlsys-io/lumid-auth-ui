# Claude Account Pool — `lum.id/claude`

Run your own Claude Code through the org's pooled Claude accounts. The proxy
authenticates you with a lum.id PAT, then routes every request to the pooled
account with the most available quota — so nobody stalls on a personal 5-hour
limit while other accounts sit idle.

---

## Quick start

1. **Mint a PAT** at [lum.id/dashboard/tokens](/dashboard/tokens) with the
   `claude:proxy` scope.
2. **Point Claude Code at the pool:**

```bash
export ANTHROPIC_BASE_URL=https://lum.id/claude
export ANTHROPIC_AUTH_TOKEN=lm_pat_live_...   # your claude:proxy PAT
claude -p "hello"
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

Then `claude-pool -p "..."` uses the pool while plain `claude` stays on your
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
claude --model opus -p "..."      # per-invocation
/model                            # interactive session
export ANTHROPIC_MODEL=claude-opus-4-8   # env default
```

Whatever model your client requests is forwarded to the pooled account
(subject to that account's plan **and** your role tier below).

### Model access by role

The pool gates model families by your lum.id role:

| Role | Sonnet / Haiku | Opus | Fable | kimi-k3 / GLM-5.2 |
|------|:---:|:---:|:---:|:---:|
| `user` | ✅ | — | — | — |
| `admin` | ✅ | ✅ | — | ✅ |
| `super_admin` | ✅ | ✅ | ✅ | ✅ |

Requesting a model above your tier returns `403` with the required role —
switch to an allowed model (e.g. `--model sonnet`) or ask an admin to raise
your role. Unlisted/base models are available to everyone.

### Non-Anthropic models (kimi-k3, GLM-5.2)

Two additional models are available to `admin`+ via the `lum.id/llm` relay —
same PAT, no extra setup:

| Model flag | Backing | Price (input/output per M tok) |
|---|---|---|
| `--model kimi-k3` | Moonshot | $3 / $15 |
| `--model z-ai/glm-5.2` | OpenRouter | $0.77 / $2.42 |

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
output tokens, summed across all your PATs). Defaults: 2M tokens / 5h and
20M tokens / 7d (operator-tunable).

- When a window is exhausted the proxy returns `429` with the reason and
  Claude Code backs off; the window rolls continuously, so capacity returns
  as old usage ages out.
- Current per-user consumption is visible to admins on
  [/code](/code) under **Per-user pool usage**.

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

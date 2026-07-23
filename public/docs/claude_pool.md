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

Whatever model your client requests is what the pooled account serves
(subject to that account's plan).

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
- **Automatic failover.** On a 401/429 from Anthropic the sticky lease is
  evicted and the next request re-routes to a different account. Expired
  access tokens are refreshed server-side automatically (accounts registered
  with a refresh token).
- **Live quota tracking.** The proxy reads Anthropic's rate-limit headers off
  every response and feeds the [/quota](/quota) dashboard — no extra probes.

## Contributing your account to the pool

Admins add accounts on [lum.id/quota](/quota) → **Add account** — paste the
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

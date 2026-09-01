# Claude Account Pool — `lum.id/claude` (Admin+)

> ## The pooled Claude models are **admin+ only**
>
> **If your role is `user`, this page is not your path — use
> `deepseek-v4-flash`, and it is unlimited.** No token budget, no 4h/7d window,
> no waiting for an account slot: the model runs on our own H100 NVL pair and is
> configured `dailyBudgetTokens: -1`. The practical limits are a 6000/min
> gateway rate limit and GPU concurrency, not a quota.
>
> **If you are a researcher, you can stop after [Quick start](#quick-start).**
> Set `ANTHROPIC_MODEL=deepseek-v4-flash` and you are done. Everything below
> about pooled accounts, per-user quota, homing and contributing accounts is
> the **operator** path — Sonnet/Haiku need `admin`, Opus/Fable need
> `super_admin`.
>
> Admin+ only:
> [Your personal pool quota](#your-personal-pool-quota) ·
> [Contributing your account to the pool](#contributing-your-account-to-the-pool)

Run your own Claude Code through the org's pooled accounts, or on our
in-house LLM fleet. The proxy authenticates you with a lum.id PAT, then
routes every request to the pool or the fleet.

> **The default and recommended Claude Code model is the in-house
> `deepseek-v4-flash`** — it is free at the margin, open to **all roles**, and
> needs no pool quota. Pooled Claude models — **Sonnet / Haiku (admin+)**, and
> **Opus / Fable 5 (super_admin+)** — draw the org's shared Anthropic pool
> quota and are reserved for operators who need genuine Claude behaviour. Set
> `ANTHROPIC_MODEL=deepseek-v4-flash` (see [Quick start](#quick-start)) and a
> fresh session lands on the native model by default.

---

## No terminal? Use the Studio chatbox

The [Studio chatbox](/studio) runs **real Claude Code sessions** server-side —
no install, no PAT setup. Pick a **(Code)** model from the model picker:

| Model | Who | Backed by |
|---|---|---|
| DeepSeek-V4-Flash (Lumid GPU) | everyone | In-house H100 NVL pair — **default**, no pool quota |
| Qwen3.8-27B (Code · Lumid GPU) | everyone | In-house luyao1 RTX 5090, tier=0 — no pool quota, one physical tier |
| Claude Sonnet (Code) | admin+ | Account pool (your 4h/7d quota) |
| Claude Opus (Code) | admin+ | Account pool |
| Claude Fable 5 (Code) | super_admin | Account pool |

Other non-Anthropic vendor models (Kimi K3, GLM-5.3-Flash, any OpenRouter model) are
**disabled** — see [Non-Anthropic models](#non-anthropic-models-deepseek-and-qwen38-only).

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
free at the margin, and open to every role. (Like all traffic, it is subject to
the same per-user [session recording](#session-recording) toggle — see below.)

> **Ordinary (`user`) accounts run Claude Code on deepseek-v4-flash by default.**
> Sonnet and Haiku draw the org's shared Anthropic pool quota and now require
> **admin** — a `user` requesting a Claude pool model gets `403`. Use the
> DeepSeek-V4-Flash default for everyday work, and reach for a Claude model
> only when you need its specifically-Claude behaviour. (Opus is also admin+,
> Fable 5 is super_admin+ — unchanged.)

> The **Qwen3.6-35B** row was removed on 2026-08-21. It claimed an in-house GPU
> and availability to everyone, and neither is true any more: `SELF_HOSTED_MODELS`
> on claude-proxy defaults to `deepseek-v4-flash` alone, so any other non-Anthropic
> id is treated as externally billed. On 2026-08-21 external non-deepseek models
> became **refused for every role**. The qwen backends themselves went with
> luyao1 on 2026-08-17.
>
> **Qwen3.8-27B added back 2026-09-01 — a different model, a different backend.**
> Not a revival of Qwen3.6-35B: `qwen3.6-27b`/`qwen3.6-35b-a3b` and `glm-5.3-flash`
> were purged fleet-wide the same day (`qwen3.6-27b` was the source of a real
> OpenRouter cost-abuse incident — 102 of 147 requests in one window, from `user`
> accounts). Qwen3.8-27B runs on luyao1's RTX 5090, tier=0, `SELF_HOSTED_MODELS`
> on claude-proxy, and is open to every role — same footing as deepseek. See
> [Non-Anthropic models](#non-anthropic-models-deepseek-and-qwen38-only).

**The chatbox default is DeepSeek-V4-Flash, served on our own hardware.** It runs
tensor-parallel across two H100 NVL GPUs, so ordinary chat costs nothing per
token and consumes no pool quota — reach for a Claude **(Code)** model when you
want a real Claude Code session (tool use, repo edits, sub-agents), and leave
everyday chat on the default. It is a reasoning model, so its thinking is
streamed as a reasoning block and kept out of the final answer. Note this is the
*in-house* copy, not the metered OpenRouter offload — see
[Non-Anthropic models](#non-anthropic-models-deepseek-family-only) for why the
`deepseek/` prefix matters.

---

## Quick start

1. **Mint a PAT** at [lum.id/dashboard/tokens](/dashboard/tokens) with the
   `claude:proxy` scope.
2. **Point Claude Code at the pool (and the native model):**

```bash
export ANTHROPIC_BASE_URL=https://lum.id/claude
export ANTHROPIC_AUTH_TOKEN=lm_pat_live_...   # your claude:proxy PAT
export ANTHROPIC_MODEL=deepseek-v4-flash      # native default — free, no pool quota
claude
```

That's it. No new client, no re-login — this is the standard Claude Code
`ANTHROPIC_BASE_URL` override, and `ANTHROPIC_MODEL=deepseek-v4-flash` lands
you on the in-house native model by default. If you leave `ANTHROPIC_MODEL`
unset, Claude Code's own default applies — set it explicitly so every user
lands on the free native model. (You may of course set it to a Claude pool
model instead, subject to the [role table](#model-access-by-role) below.)

> **About the `[1m]` suffix.** `deepseek-v4-flash` is architecturally trained up
> to a 1M-token context window (YaRN-extended), but the deployed serving
> config currently runs at a **512K-token ceiling** — the highest context
> validated safe under real concurrent load on the current hardware (see
> `k8s-lift/lumid-llm/lumid-llm.yaml` for the tuning history). Claude Code
> appends a context-length marker to the model id it sends — e.g.
> `deepseek-v4-flash[1m]` for a long-context session. The proxy strips this
> `[1m]` suffix before routing, so the backend always sees the bare
> `deepseek-v4-flash`. You never need to type it, and it is never forwarded to
> the pool or the fleet — it is purely a client hint about the session's context
> window. Just set `ANTHROPIC_MODEL=deepseek-v4-flash` (without the suffix);
> requests are served up to the deployed 512K ceiling, not the full 1M the
> architecture supports.

---

## Integrating with your existing Claude Code client

Your existing installation works as-is. Pick the integration style that fits:

### A. Permanent (settings.json)

Add the variables to `~/.claude/settings.json` — they apply to every
session without touching your shell profile:

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://lum.id/claude",
    "ANTHROPIC_AUTH_TOKEN": "lm_pat_live_...",
    "ANTHROPIC_MODEL": "deepseek-v4-flash"
  }
}
```

To go back to your personal account, remove the keys. Your existing
`claude auth login` credentials are untouched the whole time — the env vars
simply take precedence while present. `ANTHROPIC_MODEL` sets the native
default; drop it to fall back to Claude Code's own model default.

### B. Per-shell / per-project

Export the variables only where you want pool routing — e.g. in a project's
`.envrc` (direnv), or as a shell alias:

```bash
alias claude-pool='ANTHROPIC_BASE_URL=https://lum.id/claude ANTHROPIC_AUTH_TOKEN=$LUMID_CLAUDE_PAT ANTHROPIC_MODEL=deepseek-v4-flash claude'
```

Then `claude-pool` uses the pool + native model while plain `claude` stays on your
personal login.

### C. Raw API

Any Claude-Code-shaped request works with plain HTTP too. The example uses the
native model, which needs no pool quota and is open to every role:

```bash
curl https://lum.id/claude/v1/messages \
  -H "Authorization: Bearer lm_pat_live_..." \
  -H "content-type: application/json" \
  -H "anthropic-version: 2023-06-01" \
  -d '{"model":"deepseek-v4-flash","max_tokens":1024,"messages":[{"role":"user","content":"hi"}]}'
```

(For a pooled Claude model, swap the model id for e.g. `claude-sonnet-5` — that
requests the shared Anthropic quota and requires `admin`+.)

---

## Model selection

Model choice is entirely yours and passes through untouched:

```bash
claude --model deepseek-v4-flash   # per-invocation flag — the native default
/model                             # switch model inside a session
export ANTHROPIC_MODEL=deepseek-v4-flash   # env default
```

Whatever model your client requests is forwarded to the pool (subject to that
account's plan **and** your role tier below). Nothing forces you onto the
native model — this is the recommendation, not a lock-in.

### Model access by role

The pool gates model families by your lum.id role:

| Role | Sonnet / Haiku | Opus | Fable | DeepSeek (in-house) | Qwen3.8-27B (in-house) |
|------|:---:|:---:|:---:|:---:|:---:|
| `user` | — | — | — | ✅ | ✅ |
| `admin` | ✅ | ✅ | — | ✅ | ✅ |
| `super_admin` | ✅ | ✅ | ✅ | ✅ | ✅ |

**Sonnet / Haiku are now `admin`+**, and **Opus is `admin`+**, so ordinary
(`user`) accounts do not get faithful Anthropic Claude models — their Claude
Code runs on `deepseek-v4-flash` by default, which is free and open to every
role. Requesting a model above your tier returns `403` with the required role —
switch to an allowed model (e.g. `--model deepseek-v4-flash`) or ask an admin
to raise your role. Unlisted Claude-base models are available to everyone.
**Two** non-Anthropic models are enabled, both in-house and open to **all
roles** — `deepseek-v4-flash` (default, multi-tier GB10 ladder) and
`qwen3.8-27b` (luyao1 RTX 5090, one physical tier). There are no admin-only
vendor models (Kimi K3 / GLM-5.3-Flash / generic OpenRouter, and every
`qwen3.6-*` id, were disabled — GLM and qwen3.6 as of 2026-09-01).

> **The `[1m]` context suffix.** Claude Code appends a context-length marker to
> the model id it sends — e.g. `claude-sonnet-5[1m]` for a 1M-context session,
> or `deepseek-v4-flash[1m]` for a long-context session. The proxy strips this
> `[1m]` suffix before routing, so the backend always sees the bare model id
> (`claude-sonnet-5` / `deepseek-v4-flash`). You never need to type it, and it
> is never forwarded to the pool or the self-hosted fleet — it is purely a
> client hint about the session's context window. `deepseek-v4-flash` is
> architecturally trained up to 1M tokens (YaRN-extended), but the deployed
> serving config currently runs at a **512K-token ceiling** (with or without
> the `[1m]` suffix) — the highest context validated safe under real
> concurrent load on the current hardware.

### Non-Anthropic models (DeepSeek and Qwen3.8 only)

Two non-Anthropic models are available, both open to **every role** (user,
admin, super_admin) via the `lum.id/llm` relay, same PAT as the Claude pool:

| Model flag | Backing | Context | Price (input/output per M tok) |
|---|---|---|---|
| `--model deepseek-v4-flash` | **In-house H100 NVL pair** | 512K | **free** — owned GPUs |
| `--model qwen3.8-27b` | **In-house luyao1 RTX 5090** | 376K | **free** — owned GPU |

> **OpenRouter is a bounded overflow, not the primary path, for either model.**
> `deepseek-v4-flash` is served on our own **two H100 NVL GPUs** (tensor-parallel
> pair) first — free at the margin, no metering, no data leaving the tailnet on
> the common path. `qwen3.8-27b` is served on luyao1's RTX 5090 first (one
> physical tier, not a multi-GPU ladder). Requests only spill to OpenRouter
> (`deepseek/deepseek-v4-flash-0731` / `qwen/qwen3.8-27b`) when the in-house
> backend is at its concurrency roof or a request runs long enough to trigger
> the hedge — that overflow is metered. **512K context for deepseek** (below the
> `[1m]` suffix's literal claim — see [Model selection](#model-selection) above
> for why), **376K for qwen3.8-27b** (measured VRAM ceiling for 8 real parallel
> slots on a single 32GB card, stress-tested clean). Deepseek is the one the
> Studio chatbox uses by default, and the one you should set as
> `ANTHROPIC_MODEL`.

**All other non-Anthropic vendor models are disabled.** Kimi K3, GLM-5.3-Flash,
every `qwen3.6-*` id, the OpenRouter catch-all (any unlisted/mistyped model
id), and the removed `deepseek/deepseek-v4-flash-0731` offload are refused for
**every role — admins included** — so no external bill can ever be run up on a
model the platform does not deliberately host. GLM-5.3-Flash and the qwen3.6
pair were dropped 2026-09-01 (`qwen3.6-27b` was the source of a real
OpenRouter cost-abuse incident — 102 of 147 requests in one window, from
`user` accounts); Kimi K3 and generic OpenRouter were removed 2026-08-21. The
proxy's `denyExternalModelForRole` enforces this: only `deepseek-v4-flash` and
`qwen3.8-27b` (both self-hosted) are accepted; any other non-Anthropic request
returns `403`.

> A **mistyped local model id no longer silently bills**: it is refused outright
> instead of falling through to a metered OpenRouter rack.

**DeepSeek v4 Flash is a reasoning model**, and its reasoning tokens count
against `max_tokens`. A small budget returns `content: null` with
`finish_reason: "length"` — that is the budget being consumed before any answer
is emitted, not an error. Allow a few hundred tokens minimum (the curl example
above uses `max_tokens: 1024` for exactly this reason).

DeepSeek **does not consume the Anthropic pool quota** and is **not limited by
the per-user pool cap** — it is recorded (counted) but never enforced against the
pool window. Usage is visible on [/code](/code) under **Per-user pool usage** →
model breakdown, tagged by serving route (onprem).

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

> DeepSeek traffic routed through `lum.id/claude` rides the same proxy, but
> because it does **not** touch the pooled accounts the load-balancing,
> stickiness and failover above apply to the pooled Claude models only.

## Your personal pool quota

> **Admin+ — this section applies only to the pooled Claude models.**
> `deepseek-v4-flash` has no quota at all. If you are trying to work out "how
> much have I got left", the answer for deepseek is: unlimited.

Each user gets their own quota on the pool, mirroring Anthropic's window
shape: a **4-hour** and a **7-day** rolling budget, summed across all your PATs.

**The budget is denominated in weighted QUOTA UNITS, not raw tokens** — and the
difference is about 10x, so this is worth reading before you compare a number
here against a token count anywhere else. Cached input is *not* free; it is
counted at a discount, and on a typical Claude Code turn it is nearly all of the
input:

| counted | weight |
|---|---|
| fresh input, output | 1x |
| **cache read** | **0.1x** |
| cache write (5-minute TTL) | 1.25x |
| cache write (1-hour TTL) | 2x |
| then multiplied by model | opus 1x · sonnet 0.6x · haiku 0.2x · non-Claude 0.1x |

The weights are Anthropic's price ratios, so a unit is "what this cost the pool",
not "a token". A turn over a 120k-token context typically reports `input_tokens`
in the hundreds with `cache_read_input_tokens` around 118k — roughly 1.2M raw
tokens across a session can draw only ~120k units. That is why `/code` shows raw
tokens and units side by side, labelled separately: one number cannot honestly be
both, and reading units as tokens makes your usage look ~10x smaller than it is.

Since 2026-08-23 the budget is **tiered by role**, because a single global
number cannot serve both a cohort and the operators running the platform —
sized for the operators it is no limit at all for 20 people, and sized for them
it throttles the heaviest legitimate work:

| Role | 4h | 7d |
|---|---|---|
| `admin` / `super_admin` | **uncapped** | **uncapped** |
| `user` | 2M | 20M |

Set by `LUMID_QUOTA_CLAUDE_USER_{5H,7D}_TOKENS` (role `user`) and
`LUMID_QUOTA_CLAUDE_{5H,7D}_TOKENS` (the default tier), both in the
lumid-identity deployment manifest. The earlier figures documented here — a
single global 15M/150M applying to everyone — were briefly live and are what
caused operators to be throttled by a cohort-sized cap.

- When a window is exhausted the proxy returns `429` with the reason and
  Claude Code backs off; the window rolls continuously, so capacity returns
  as old usage ages out.
- Current per-user consumption is visible to admins on
  [/code](/code) under **Per-user pool usage**.
- The pool quota applies to the **pooled Claude models only** — the DeepSeek
  family runs on separate keys and never counts against the 15M/150M windows.

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

  4h  ████████████████████░░░░░░░░  71.0%   10.7M / 15.0M   resets in 1h36m
  7d  ████████░░░░░░░░░░░░░░░░░░░░  31.2%   46.8M / 150M    resets in 52h59m

  by model (7d)
    claude-sonnet-5                       7.10M
    claude-opus-5                         1.90M
    deepseek-v4-flash (onprem)           35.0M
    deepseek/deepseek-v4-flash-0731 (OpenRouter)   2.8M

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
  stored for your sessions; token metering still applies. This applies to **all**
  models — the in-house DeepSeek-V4-Flash traffic is recorded the same way
  (your recording preference, not per-model), so treat the deepseek default the
  same as a pooled Claude model for privacy.

> Because transcripts capture whatever you send — code, secrets, PII — keep
> recording off for sensitive work, or use your personal account instead of the
> pool. The default is recording **on** for every model, including
> DeepSeek-V4-Flash, so toggle it off when you want no transcript.

## Contributing your account to the pool

> **Admin+, and the pool is not currently being grown.** Nobody needs to
> contribute an account today. The procedure below is retained because it is
> genuinely hard-won (the `logout` step has killed accounts twice) and is what
> you follow if the pool is expanded again.

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
  automatically; arbitrary SDK traffic may be rejected upstream. Native
  DeepSeek traffic uses the same Messages API shape, so the same rule holds.
- Long agentic turns are fine — the edge allows up to 1 hour per request,
  streaming. (DeepSeek on our own pair has no such ceiling concern; the
  OpenRouter offload does.)
- Requests are logged (your email, chosen account, path, model, status,
  duration) for usage accounting. Prompt/response bodies are **not** logged.

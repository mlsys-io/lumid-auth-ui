# First run: from signup to a working strategy

This is the actual path, walked end to end against production as a plain
`role=user` account on 2026-08-24. Every step below has a recorded result. Where
something failed or misled, it says so — this is a transcript, not a brochure.

Budget about 15 minutes. You need nothing but an email address.

---

## 0. Sign up

Signup is **self-serve**. There is no operator in the loop and no invitation to
wait for.

1. Go to <https://lum.id> — `/` redirects to `/auth/login`.
2. Choose **Register**, enter your email.
3. A 6-digit code is emailed to you. **The code is mandatory** — registration
   does not complete without it.
4. Enter the code, set a password, you are in as `role=user`.

Two things worth knowing before they surprise you:

- **One code per email per 60 seconds.** Hitting "resend" twice in a row gets you
  a rate-limit error, not a second email. Wait a minute.
- **Use an inbox you can actually read.** If you are testing with an alias of an
  address that also *sends* our mail, some providers (Gmail notably) file the
  message in All Mail rather than Inbox and it looks lost.

> **Not verified in this walkthrough.** The rest of this document was executed
> live; the signup leg was not, because the account used was an existing one and
> no test inbox was available. Delivery is wired in production (the mail
> credentials are present and the registration path calls the real sender), but
> if the code does not arrive, that is the one step here nobody has watched
> recently. Say so and it gets looked at.

---

## 1. Log in and land in Studio

<https://lum.id/studio> — chat-first. Advanced surfaces are behind the toggle.

Your session is a cookie on the apex domain, which is why `xp.io` and the other
subdomains log you in automatically.

**Verified:** Studio, your apps, your runs, loop health, your usage, the data
catalog, strategies, knowledge agents and experiments — 12 surfaces, all `200`
for a plain `role=user`. Nothing on the default path is admin-gated.

---

## 2. Mint your first token — in the browser

Go to **<https://lum.id/dashboard/tokens>** and mint a PAT. Give it the scopes
you need; for the researcher path that is:

| Scope | Buys you |
|---|---|
| `claude:proxy` | Claude Code and the `/claude` API on deepseek |
| `lqt:strategy` | submitting and inspecting strategies |

**This step must happen in the browser, and that is deliberate.** A PAT cannot
mint another PAT — try it from the API with a normal token and you get:

```
403  PAT scope insufficient: lumid:write required to mint tokens
```

That message is misleading and we are fixing the wording. It reads as though you
need a scope you cannot grant yourself. You do not: the check exempts
browser sessions entirely, so **any logged-in user can mint any scope they are
entitled to from the dashboard**. The block exists only to stop a leaked token
from minting itself a wider one. If you are reading this because you hit that
error from a script — log in and mint it in the UI, then use it in the script.

---

## 3. Chat — nothing to configure

Open the chatbox in Studio and ask something. That is the whole setup.

You do not need a token, a scope, or a model choice. The platform mints a
`claude:proxy` token for you behind the scenes on your first turn and keeps it
fresh. Your model is **`deepseek-v4-flash`** and it is unlimited — see
[Your model](/studio/docs/deepseek) for what that does and does not mean.

**First turn of a session is slower than the rest.** Your sandbox is spawned on
demand and reclaimed after 15 idle minutes, so the turn after a long pause pays
the spawn again. This is expected and is not your prompt.

---

## 4. Claude Code from your own machine

```bash
export ANTHROPIC_BASE_URL=https://lum.id/claude
export ANTHROPIC_AUTH_TOKEN=lm_pat_live_...   # the PAT from step 2
export ANTHROPIC_MODEL=deepseek-v4-flash
export API_TIMEOUT_MS=600000                  # do not skip this
```

**`API_TIMEOUT_MS` is not optional.** The default client timeout is 60 s, and a
large cold prompt can spend longer than that just reading your context before it
emits a byte. Without the override you get *"Waiting for API response · will
retry"* and it looks like a network fault. It is not.

If your PAT is missing the scope you get a clear 403 that names the fix:

```
403  PAT lacks the claude:proxy scope — mint one at lum.id/dashboard/tokens
```

**Verified:** that 403 is exactly what a scope-less PAT receives, and it points
at the right page.

---

## 5. Call the model directly

```bash
curl https://lum.id/llm/v1/chat/completions \
  -H "Authorization: Bearer $LUMID_PAT" \
  -H 'Content-Type: application/json' \
  -d '{"model":"deepseek-v4-flash","max_tokens":64,
       "messages":[{"role":"user","content":"hello"}]}'
```

**Verified:** `200` in 3.6 s on a warm cache.

`deepseek-v4-flash` is the only model this gateway serves. It is a strict
allowlist — an unrecognised model id is refused by name, not quietly routed
somewhere else and billed. If you need a model that is not there, ask; do not
work around it.

---

## 6. Query the data

- **In chat** — just ask. Findata questions are answered against the live
  warehouse, and this path is comfortable at cohort scale: everyone shares a
  prompt prefix, so the cache works in your favour rather than against it.
- **Over SQL** — `sql.lum.id:5432`, read-only. Setup and the CA bundle are in
  [FinData SQL](/studio/docs/findata-sql).
- **Browse** — the catalog at `/dataapp-proxy/_sources` lists what is exposed.

---

## 7. Write a strategy

Read [LQT strategies](/docs/lqt-strategies) — it is the accurate one. In short:
you write DSL, it is compiled off-box, the compiled program goes to the field
boxes, and telemetry comes back on the observation plane rather than the
mailbox you submitted to.

**One honest caveat about backtests.** Backtesting today runs against a
synthetic tape, not recorded market data. It will produce a number, and that
number is not evidence. Check the `replay` field on a result before you believe
a PnL: if it does not say you replayed real data, you did not. Corpus-backed
replay is scoped and in progress; until it lands, treat backtest output as a
correctness check on your logic, never as performance.

---

## What you cannot do yourself

One thing, and it is intentional: **`lumid:write`**. It is a platform-level
scope, and granting it requires already having it, so a fresh account cannot
self-serve it. You need it only to author analytics jobs. Ask an operator — it
is a one-line grant, not a process.

Everything else on this page, a new account does alone.

---

## If something here is wrong

This document is a transcript of a real run. If a step behaves differently for
you, that is a finding and it is worth reporting — a walkthrough that has
drifted from the system is how the next twenty people lose an afternoon.

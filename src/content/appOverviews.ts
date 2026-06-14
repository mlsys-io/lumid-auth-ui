// Per-app Overview copy — re-authored from the old lum.id/<app> landing pages
// (mbb / lqa / sysresearch) so the app's Overview tab tells its story instead
// of those standalone pages. Rendered as markdown via LumidMarkdown in the
// app overview (apps.tsx). Keyed by installed app slug.
//
// NOTE: deliberately no markdown inline-code (backticks) — these are JS
// template literals; bold/quotes stand in for code spans.

export const APP_OVERVIEW_MD: Record<string, string> = {
	"mbb-ai": `**Two goals, one app.** Get a sharper consulting AI by iterating its playbook against labeled cases — and get faster, more accurate case annotations by letting the same runs surface where your rubric is ambiguous, generous, or wrong.

All inside Lumid Studio — install from the marketplace, talk to the AI assistant in your browser. No terminal, no Python, nothing to download.

## How it learns

Every run is a full case interview between two AI roles. The **Candidate** (analyst) proposes an answer to each question, picking from its playbook of consulting skills. The **Interviewer** (judge) drives the case, releases gated information, and scores the answer against your rubric — keypoints, quantitative ground truth, cross-attempt audit. Then the playbook sharpens: what worked is banked, and the next run reads it.

That **analyst-proposes → judge-scores → playbook-sharpens** rhythm serves both goals at once:

- **Goal A — a sharper consulting AI.** Each run you tighten one prompt; the next score shows whether it moved. After ten runs the candidate carries a playbook built from your specific feedback.
- **Goal B — faster, more accurate annotation.** Where the candidate flounders is where your rubric is ambiguous or generous. The judge flags trigger phrases that fire inconsistently and keypoints scored differently across reruns.

The two goals share every run — the candidate gets sharper *and* the rubric gets cleaner; they feed each other.

## Five steps in Studio

1. **Install** — Marketplace → search "mbb-ai" → Install. First run starts automatically (~30s).
2. **Open the app** — Overview (this page) shows health at a glance; the workflow panel is the machinery, every run inspectable stage by stage.
3. **Ask for a run** — in the chat (right edge): *run mbb-ai's cycle*. A run lands in the workflow's Runs.
4. **Drill into the run** — the full interview transcript, the judge's scoring against your rubric, and what was banked for next time.
5. **Let it compound** — every run banks what it learned; the next reads it. Ask: *compare the last two mbb-ai runs* for per-question deltas.

No credentials or API keys needed — the platform runs the AI roles for you.`,

	"auto-quant": `**Your taste, compounded by AI.** Write your trading idea in plain English. Three AI roles run it every cycle. The casebook on xp.io gets sharper every time.

All inside Lumid Studio — install from the marketplace, talk to the AI assistant in your browser. Live boards the moment it installs; one QuantArena token when you're ready to trade.

## How you work with the AI

The bet: the most valuable thing isn't more AI — it's *your taste compounded by AI*. You bring intention; the AI runs every cycle, accumulates patterns, and surfaces what's working. Five places where you and the AI meet:

- **Alpha — the idea.** Translates "RSI under 30 and z_5d under −2" into actual trade proposals, reading 110-day bars + prior memory each cycle. *You write your thesis in five sentences of English.*
- **Strategy — how it runs.** Walks the 5-stage cycle (observe → hypothesize → act → analyze → learn) on whatever schedule you give it; soft-fails individual steps without crashing the loop. *You pick loops, nudge any step in plain English.*
- **Metrics — did it work.** Scores realized P&L vs benchmark (SPY / QQQ / BTC buy-hold) every cycle; tracks rolling Sharpe, drawdown, and win rate per loop. *You read the dashboards and drill into any cycle.*
- **Casebook — what we learned.** Writes a memory after every cycle ("this setup paid off here; this gate fired correctly there") — cursor-based, never re-writing old entries. *You review what compounded.*

## Five steps in Studio

1. **Install** — Marketplace → search "auto-quant" → Install.
2. **Open the app** — Overview shows health; the workflow panel is every run, inspectable.
3. **Ask for a run** — in the chat: *which workflow should I run now, and why?*
4. **Drill into the run** — proposal + risk decision + trades, per cycle.
5. **Let it compound** — the casebook sharpens each cycle; the next proposal starts smarter.`,

	"auto-sysresearch": `**An optimizer that proposes the next system config, runs it, measures it, and learns what works — fully automated.** Two AI roles, one benchmark workflow.

All inside Lumid Studio — install from the marketplace, talk to the AI assistant in your browser. First domain: NL-to-SQL accuracy vs cost. Fork it for any system with a configurable component and a measurable metric.

## How it works

Each run: **propose config → run it → measure → learn.** The Optimizer reads everything tried so far and proposes the next point in the search space — K=3 variants in parallel, each born, measured, and retired in its own container. The benchmark scores accuracy, latency, and cost per query; the Analyst extracts the patterns and banks them, so the next proposal starts smarter than random.

Two views keep the search honest: the **Pareto frontier** (accuracy vs cost — which configs are worth keeping) and a **regression sweep** that re-measures past winners to catch drift.

## Five steps in Studio

1. **Install** — Marketplace → search "auto-sysresearch" → Install.
2. **Open the app** — Overview shows health; the workflow panel is every run, stage by stage.
3. **Ask for a run** — in the chat: *run auto-sysresearch's benchmark*.
4. **Drill into the run** — the proposed config + the Optimizer's reasoning, the measured result, and the verdict (keep / retire / explore).
5. **Let it compound** — ask: *run the regression_sweep* to re-measure past winners; watch the Pareto frontier fill in.

No credentials or API keys needed — runs execute server-side (no local Docker).`,
};

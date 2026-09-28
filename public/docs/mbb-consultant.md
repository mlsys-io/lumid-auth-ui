# AI Consulting Onboarding

The path from a new account to a scored case interview in the **MBB
Consultant** app, walked end to end as a plain `role=user` account. Here the
unit of work is a case interview rather than a strategy, and what gets measured
is an *answer* against a fixed answer key. Same account and chat as the
[Quant Research onboarding](/studio/docs/first-run), a different app; a cohort
usually runs both.

> **Changelog**
> - **2026-09-28** — Split back out of the Quant Research onboarding page (it
>   had been §10 there since 2026-09-20), so each track has its own guide.
>   Button names as the product shows them: Marketplace's **Add to my
>   account**, and **Interview me** to start a session (was **Start**, which
>   does not exist).
> - **2026-09-20** — Folded into the Quant Research onboarding page as §10.

Assumes you are signed in.

Budget about 15 minutes. Nothing to install locally, no token, no scope — but
you do need an **invitation code**.

**The invitation code is the one thing that stops people before they start.**
Registration succeeds without it. You get a verified account, and then every
page bounces you to `/auth/redeem-invite` until you enter it — so it reads like
a breakage rather than a step you skipped. Your code comes from whoever invited
you; in a cohort, that is your organiser. It is **not** the 6-digit code emailed
at signup, which verifies your address and is separate.

*A walkthrough done over the API will tell you there is nothing to do here, and
it will be wrong. The gate is enforced client-side by AuthGuard, so an API-only
path never meets it — the block is real, it is just invisible from outside a
browser.*

---

## Chat — nothing to configure

The chat needs no token, scope or model choice: the platform mints what it
needs on your first turn. Your model is **`deepseek-v4-flash`**, unlimited on
our own GPUs; see [AI coding](/studio/docs/coding) for what that does and does
not mean.

**The first turn of a session is slower than the rest.** Your sandbox is
spawned on demand and reclaimed after 15 idle minutes, so the turn after a long
pause pays the spawn again. That is expected and is not your answer taking long.

---

## What it actually is

Two agents behind one chat.

- An **analyst** that answers in interviewee voice.
- A **judge panel** — two independent models — that scores the answer.

Behind them is a **labelled casebook**, mounted read-only from the published
`mbb-casebook-cases` dataset (**v1.0.7** at the time of writing). Each case
carries real ground-truth keypoints per question. That ground truth is what
separates this from asking a chatbot to grade itself: when you answer a casebook
question, your score is measured against a fixed answer key written before you
showed up. Read the dataset *version* rather than counting cases — the set grows
through review, so a count printed on a page goes stale in a way a version does
not.

---

## Install it

Either route works:

- **New account** — the onboarding page's *Consulting & research* card installs
  it and drops you straight into it.
- **Any account** — Marketplace → search `mbb-consultant` → **Add to my account**.

Give it 10–20 seconds. It is ready when the app appears in your sidebar under
**Your Apps** and its **Work** tab renders a case browser.

*If the app says ready but every tab errors "app not found", it was installed
under a bare name rather than its full `owner/name` slug, and the platform could
not work out whose bundle to fetch. Uninstall and reinstall from the
Marketplace, which always sends the qualified slug. Both the onboarding and
marketplace paths are fixed; it is recorded because the symptom misleads — the
install reports success, and only the surfaces fail.*

Afterwards it appears with **three tabs**:

| tab | what it shows |
|---|---|
| **Work** | pick a mode and a case — start here. Also the review queue where your corrections wait |
| **Workflows** | the `interview` and `case_eval` loops, one row each. Open a row for its runs: which case, what it scored, whether ground truth was behind it |
| **Experiments** | the status surface for arms: which arm is ahead, on how many samples, and whether the verdict is being withheld. `judge_panel_parity` lives here, and so does anything you raise with **Measure as arm** |

Same split as every app: a run is a row on its loop, an arm is a row on
**Experiments**. A run tells you what one execution did; an experiment tells you
whether an arm is actually ahead.

---

## Pick a mode, then a case

The **Work** tab is a case browser. Choose the mode **first** — it decides who
is asking whom, and it is the single choice that changes the whole session.

| Mode | What happens | What you type | How it scores |
|---|---|---|---|
| **AI interviews you** | The AI poses the case and scores your answers. You are the candidate. | Your answer — and ask for any facts you need | Against that case's ground truth |
| **AI answers a case** | The analyst works the case. You play the interviewer. | `next question`, or what the answer got wrong | Against that case's ground truth |
| **Ask anything** | Your own question, no case file. Same analyst, same rubric. | Your consulting question | **Indicative only — no ground truth** |

![The Work tab: the three modes, the case list, and the selected case's opening.](/docs/img/first-run-mbb-modes.png)

Pick **AI interviews you** for your first session. It is the one that scores
*you*, which is what most people came for. Pick a case, then press **Interview
me** — that opens the chat
already grounded in the case, so you do not paste anything or repeat the case
name.

![A case selected under AI interviews you: its client facts, four hidden questions, and the Interview me button.](/docs/img/first-run-mbb-interview-me.png)

*The button's label follows the mode: **Interview me** here, **Start case** for
AI answers a case, **Ask a question** for Ask anything.*

## Work it in the chat

Every reply ends by telling you the next move, so you can read and respond
without learning a command set. Three things work in any mode:

- `scorecard` — the running table of every turn you have been scored on
- `next question` — move on
- `wrong — …` — stage a correction (below)

Ask for facts you need. In a real case interview you are expected to ask; the
interviewer releases a fact when your answer reaches for it, and this app
follows the same rule.

**Answer the question that was asked.** The most common way a first session goes
badly is answering the case's *theme* rather than its *question*. On the
recorded run, a competent-sounding answer about margin decline went to a Q1 that
was asking for market sizing — market size and growth, top producers and shares,
average margins, target segments. It scored **0 out of 13 keypoints**, correctly.
The judge is not grading eloquence.

## Read your score

Open **Workflows → interview** (or **case_eval** for a batch) to see what ran, on
which case, what it scored, and whether it was backed by ground truth.

**Read the `Mode` column first.**

- `casebook` — scored against that case's real keypoints. This is a number that
  means something.
- `open` — there was no answer key, so the score is indicative only.

**Never average the two together.** The app deliberately shows them side by side
rather than summing them, and a combined "average score" across both is not a
measurement of anything. If you asked an open question, the reply carries a
caveat saying there is no ground truth behind the number — that caveat is not
boilerplate, it is the difference between a benchmark result and a vibe.

The rest of a scored turn:

- **Score** — keypoints covered ÷ keypoints available. The grounded turn above
  reported `covered: 0`, `total: 13`.
- **Framework / Qualitative / Quantitative** — the three rubric axes.
- **Judges** — how many panel seats actually scored it. **2** is healthy. **1**
  means a seat was unavailable and the turn is flagged low-confidence rather
  than silently averaged. A dead seat never contributes a zero.

**A scored turn takes minutes, not seconds, and that is not a hang.** The
analyst answers, then two judges read that answer against the keypoints — real
work, done serially. The first turn of a session is the slowest, for the same
cold-sandbox reason described under *Chat* above. Let it run: refreshing mid-turn does not make it
faster and costs you the reply.

## Corrections — the part that compounds

When an answer is wrong, say so in the chat: `wrong — the issue tree should
split cost before volume`. That stages a draft into the review queue on the
**Work** tab. Nothing is applied while it sits there — and beside **Approve**
you can **Measure as arm** (test the edit over the casebook before adopting it,
and read the result on **Experiments**) or **Add to casebook** (stage the gap as
a candidate case).

Two kinds land in that queue, and the *Kind* column tells them apart:

- **Correction** — a fact the analyst should recall later, with the question and
  answer it came from attached so you can judge it.
- **Skill card edit** — a change to the *prompt* that shaped the answer. Applied
  under a dated *Learned corrections* heading, it shapes **every** future answer
  that uses that card.

Approve one and it is applied for real. Dismiss drops it and nothing is
ingested. Judge memories are always staged, never auto-ingested — a score is a
claim about quality, and a claim about quality gets a human behind it first.

Two things worth knowing before you approve:

- Approval hands the work to the scheduler. It lands within a minute or two,
  not instantly.
- A card edit is a local change to *your* installed copy. Updating the app later
  takes upstream's version of that prompt and backs yours up under
  `.app-update-backup/`. Recoverable, not permanent.

The badge on the app's sidebar row is this queue. An empty queue means there is
nothing waiting on you — not that nothing is happening.

## What is not yours to change

Three things, and all of them are intentional:

- **Accept a case into the casebook.** Staging one is yours: **Add to casebook**
  puts a gap you found into the queue as a *candidate*. Accepting it is not — it
  is an operator act that pushes to the `mbb-casebook-cases` dataset repo and
  bumps its version, and your copy mounts that dataset read-only. So the
  casebook grows through the review gate rather than through a local edit. Two
  copies of the answer key is how two people quietly stop being comparable.
- **Change which models judge you.** The panel is set by the app's own config.
- **See anyone else's turns.** Runs, review and your corrections are scoped to
  your account. A correction you approve shapes *your* copy of the app.

---

## Where to go next

| doc | why you would open it |
|---|---|
| [Workflows & experiments](/studio/docs/workflows) | what **Measure as arm** actually runs, and how to read the Experiments tab |
| [Quant Research onboarding](/studio/docs/first-run) | the other cohort track: writing, deploying and testing a trading strategy |
| [AI coding](/studio/docs/coding) | the model you are on, what "unlimited" means, the one timeout that matters |

---

## If something here is wrong

This document is a transcript of a real run. If a step behaves differently for
you, that is a finding and it is worth reporting — a walkthrough that has
drifted from the system is how the next twenty people lose an afternoon.

# AI Consulting Onboarding

This walks the MBB Consultant app end to end. It was executed against
production on **2026-08-27** from a freshly-created `role=user` account — not an
admin, not the author — because a walkthrough done as the owner hides exactly
the failures a new user hits first. Timings and scores below are recorded from
that run, not estimated.

Budget about 15 minutes. You need two things: an account, and an **invitation
code**.

The code is easy to miss, because registration succeeds without one. You will
get a verified account and then be stopped at `/auth/redeem-invite` on every
page until you enter it — so it looks like something broke rather than like a
step you skipped. Your code comes from whoever invited you; if you joined as
part of a cohort, that is your organiser. It is not the 6-digit code emailed to
you at signup, which verifies your address and is separate.

Beyond that, nothing: no token, no install, no local tooling.

*(Corrected 2026-08-28. This originally said "an account and nothing else",
which was true of the API path this walkthrough was recorded on and false in a
browser — the invitation gate is enforced client-side by AuthGuard, so an
API-only walkthrough never meets it.)*

---

## What it actually is

Two agents behind one chat.

- An **analyst** that answers in interviewee voice.
- A **judge panel** — two independent models — that scores the answer.

The casebook is **50 labelled cases**, each carrying real ground-truth
keypoints per question. That ground truth is what separates this from asking a
chatbot to grade itself: when you answer a casebook question, your score is
measured against a fixed answer key that was written before you showed up.

---

## 1. Get the app

Either route works:

- **New account** — the onboarding page's *Consulting & research* card installs
  it and drops you straight into it.
- **Any account** — Marketplace → search `mbb-consultant` → **Install**.

Give it 10–20 seconds. It is ready when the app appears in your sidebar under
**Research** and its Overview page renders a case browser.

> **If the app says ready but every tab errors "app not found"**, it was
> installed under a bare name rather than its full `owner/name` slug, and the
> platform could not work out whose bundle to fetch. Uninstall and reinstall
> from the Marketplace, which always sends the qualified slug. This is fixed on
> both the onboarding and marketplace paths; it is recorded here because the
> symptom is genuinely misleading — the install reports success, and only the
> surfaces fail.

---

## 2. Pick a mode, then a case

The Overview page is a case browser. Choose the mode **first** — it decides who
is asking whom, and it is the single choice that changes the whole session.

| Mode | What happens | What you type | How it scores |
|---|---|---|---|
| **AI interviews you** | The AI poses the case and scores your answers. You are the candidate. | Your answer — and ask for any facts you need | Against that case's ground truth |
| **AI answers a case** | The analyst works the case. You play the interviewer. | `next question`, or what the answer got wrong | Against that case's ground truth |
| **Ask anything** | Your own question, no case file. Same analyst, same rubric. | Your consulting question | **Indicative only — no ground truth** |

Pick **AI interviews you** for your first session. It is the one that scores
*you*, which is what most people came for.

Press **Start**. That opens the chat already grounded in the case — you do not
need to paste anything or repeat the case name.

---

## 3. Work it in the chat

Every reply ends by telling you the next move, so you can read and respond
without learning a command set. Three things work in any mode:

- `scorecard` — the running table of every turn you have been scored on
- `next question` — move on
- `wrong — …` — stage a correction (see §5)

Ask for facts you need. In a real case interview you are expected to ask; the
interviewer releases a fact when your answer reaches for it, and this app
follows the same rule.

**Answer the question that was asked.** The most common way a first session goes
badly is answering the case's *theme* rather than its *question*. On my run I
gave a competent-sounding answer about margin decline to a Q1 that was asking
for market sizing — market size and growth, top producers and shares, average
margins, target segments. It scored **0 out of 13 keypoints**, correctly. The
judge is not grading eloquence.

---

## 4. Read your score

The app has **two tabs**: **Work** (pick a mode and a case, plus the review
queue) and **Workflows** (the `interview` and `case_eval` loops, each a row —
open one for its runs, and for `judge_panel_parity`'s Metric & arms in place).
There is no separate Results or Experiments tab: a run is a row on its loop,
and the scores render on the loop that produced them.

Open **Workflows → interview** (or **case_eval** for a batch) to see what ran,
on which case, what it scored, and whether it was backed by ground truth.

**Read the `Mode` column first.**

- `casebook` — scored against that case's real keypoints. This is a number that
  means something.
- `open` — there was no answer key, so the score is indicative only.

Never average the two together. The app deliberately shows them side by side
rather than summing them, and a combined "average score" across both is not a
measurement of anything.

The rest of a scored turn:

- **Score** — keypoints covered ÷ keypoints available. A grounded turn on my run
  reported `covered: 0`, `total: 13`.
- **Framework / Qualitative / Quantitative** — the three rubric axes.
- **Judges** — how many panel seats actually scored it. **2** is healthy. **1**
  means a seat was unavailable and the turn is flagged low-confidence rather
  than silently averaged. A dead seat never contributes a zero.

If you asked an open question, the reply carries a caveat saying there is no
ground truth behind the number. That caveat is not boilerplate — it is the
difference between a benchmark result and a vibe.

---

## 5. Corrections — the part that compounds

When an answer is wrong, say so in the chat: `wrong — the issue tree should
split cost before volume`. That stages a draft into the review queue on the **Work** tab. Nothing
is applied while it sits there — and beside **Approve** you can **Measure as
arm** (test the edit over the casebook before adopting it) or **Add to
casebook** (stage the gap as a candidate case).

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

---

## 6. What "normal" feels like

Measured on the run this document records:

| | |
|---|---|
| Open question, answered and scored | ~95–130 s |
| Casebook case: opened, answered, scored | ~190 s |

A scored turn does real work — the analyst answers, then two judges read the
answer against the keypoints — so **two to three minutes is normal, not a
hang**. The first turn of a session is the slowest.

Let it run. Refreshing mid-turn does not make it faster and costs you the reply.

---

## What you cannot do yourself

- **Add or change the 50 cases.** The casebook is mounted read-only from a
  published dataset so that everyone is scored against the same ground truth.
  Two copies of the answer key is how two people quietly stop being comparable.
- **Change which models judge you.** The panel is set by the app's own config.
- **See anyone else's turns.** Results, Review and your corrections are scoped to
  your account. A correction you approve shapes *your* copy of the app.

---

## If something here is wrong

This document is a transcript of one real run, so it goes stale the way any
transcript does. If a step does not match what you see, say so in the chat —
that is itself a correction, and it lands in the same Review queue as any other.

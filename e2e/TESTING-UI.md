# UI test instructions

Covers the browser-visible surface: the Studio sidebar, and the `mbb-consultant`
app workspace (case interview, scoring, corrections). App-side logic lives in
`~/.xp/apps/mbb-consultant/TESTING.md`.

**Status: the automated journey passes 10/10.** Manual steps below are for
eyeballing UX and for anything the journey cannot assert.

---

## A. Automated — start here

```bash
cd /proj/lumid_ui
npm i playwright                  # needs system Chrome (google-chrome-stable)

set -a; . /proj/.env; set +a
LUMID_PAT="$LQT_MAILBOX_PAT" APP=mbb-consultant node e2e/studio-mbb-consultant.mjs
```

Exit 0 = all gates. Screenshot on failure at `/tmp/studio-mbb-consultant*.png`.

Auth: `LUMID_PASSWORD` (real session cookie) is preferred; `LUMID_PAT` works and
exercises the same data plane. Either is fine — the PAT path is what CI uses.

| Gate | Asserts |
|---|---|
| G1 | all five surfaces return 200 |
| G2 | sidebar shows the app's folder |
| G3 | 3 turns; turn 3 **recalls** the case unprompted |
| G4 | transcript survives a reload |
| G5 | "Correct this" stages a draft (count increases) |
| G8 | casebook score states it is ground-truth backed |
| G9 | no `/api/v1/me/*` 404s |
| G10 | ≤4 interactions to a scored answer |

### Assertions that look odd but are deliberate

- **G3 turn 3 asks a recall question** ("without me repeating it: what industry
  is this client in…") rather than checking the answer's vocabulary. The earlier
  version hoped the prose mentioned the industry and flaked run to run. Ask
  something only answerable from loaded context and a correct answer necessarily
  contains it.
- **G3 turn 1 anchors on case body words** (`lens|optical|eyeglass|prescription`),
  never on the case id. An earlier version matched `BetaOptics` against the whole
  page — including the case name the harness itself typed — so it passed with the
  feature switched off.
- **G8 asserts casebook scores are ground-truth backed**, not that open-mode
  scores are labelled ungrounded. Both are true, but the second was unreachable
  for a long time and the first is the claim with real keypoints behind it.
- **G5 uses a persistent dialog handler.** "Correct this" opens a `window.prompt`,
  which blocks the click handler until something answers; a `once` listener
  consumed by an earlier dialog leaves the click hanging and no draft written.

### Run it twice

Turns are generative. A single green run is weaker evidence than it looks — this
suite reported 9/10 and 6/10 on the same commit earlier in its life. Two
consecutive clean runs is the bar.

---

## B. Manual — sidebar

<https://lum.id/studio>, signed in with ≥1 app installed.

| # | Do | Pass |
|---|---|---|
| A1 | Look at the left rail | An **Applications** section, one folder per installed app |
| A2 | Install anything from the Library | A folder appears **without a reload** |
| A3 | Click a folder's chevron | Expands to that app's own conversations |
| A4 | Hover the folder row | A `+` appears at the right |
| A5 | Click that `+` | Starts a **new** thread in that app, not a resume |
| A6 | Send a turn, click `+` again | Two separate conversations under the folder |
| A7 | Look at **Recent** | App-grounded threads are absent — they live under their app |
| A8 | Click **New chat** (top) | Lands on `/studio`, app-less, parallel to the folders |
| A9 | Reload | The folder you were working in is still expanded |

**A2 used to fail**: `useAppNav` required `ui.sidebar.label`, so installing most
apps added nothing to the rail. **A5 is the subtle one**: `openAppInChat`
early-returns when the app is already grounded, so `+` needs its own event — if
it reopens the previous thread, that path regressed.

On `/studio/apps/<app>` the rail is auto-hidden **by design**; reveal it with the
"Show sidebar" control before judging anything about it.

---

## C. Manual — app workspace

<https://lum.id/studio/apps/mbb-consultant>

| # | Do | Pass |
|---|---|---|
| B1 | Open the app | Sidebar row **MBB Consultant** (briefcase, under Research) |
| B2 | Nav tabs | Overview · Environment · Review · Workflows · Experiments |
| B3 | **Environment** | Harness / Infra / Data / Agents / Prompts — 11 skill cards, 8 judge rubrics |
| B4 | **Review** | Drafts table; empty state reads "Nothing to review" |
| B5 | Ask "list cases" | 52 cases |
| B6 | Pick a case, answer 3 turns | Turn 3 still knows the client without being re-told |
| B7 | Click 👎 on an answer, type a reason | A draft appears in **Review**; sidebar badge increments |
| B8 | Open the composer menu | **Ask the app** toggle, on by default |

**B8 matters**: with it on, a domain question routes through the app's analyst
instead of the generic assistant. Turn it off for administrative asks ("run the
workflow"). Neither gemma nor Sonnet selects the app's tool unprompted, which is
why the toggle exists rather than being inferred.

---

## Fixing a failure

- **A surface 404s** → check `app_actions` returns non-empty; a declared surface
  with no file behind it is the classic empty-shell state.
- **Chat answers generically in an app** → check the "Ask the app" toggle. If on
  and it still ignores the app, check `tool_choice` reaches identity: the
  lumid-llm gateway *accepts and silently drops* it, which is why forced tools
  execute server-side.
- **A correction stages nothing** → probe `/api/v1/me/drafts?app=<app>` directly.
  Write and read have failed independently before; the tool returning a
  `draft_id` tells you which half is broken.

# UI test instructions

Covers only the browser-visible surface: the Studio sidebar shipped in
`lumid-ui v0.5.118`, and the `mbb-consultant` app's surfaces. Nothing here
tests app logic — that's `~/.xp/apps/mbb-consultant/TESTING.md`.

Two parts: **A. manual** (works today, ~5 min) and **B. automated** (written,
blocked — see the blocker at the end).

---

## A. Manual — Studio sidebar (v0.5.118)

Open <https://lum.id/studio> signed in as any user with ≥1 app installed.

| # | Do | Pass |
|---|---|---|
| A1 | Look at the left rail | An **Applications** section, one collapsible folder per installed app |
| A2 | Install anything from the Library | A folder appears for it **without a reload** |
| A3 | Click a folder's chevron | Expands to that app's own conversations |
| A4 | Hover the folder row | A `+` appears on the right |
| A5 | Click that `+` | Starts a **new** thread in that app — not a resume of the last one |
| A6 | Send a turn, then click `+` again | Two separate conversations now listed under the folder |
| A7 | Look at **Recent** | App-grounded threads are **absent** — they live under their app |
| A8 | Click **New chat** (top) | Lands on `/studio`, app-less, parallel to the folders |
| A9 | Reload | The folder you were working in is still expanded; others still collapsed |

**A2 is the one that used to fail.** Before v0.5.118, `useAppNav` required
`ui.sidebar.label`, so installing any app that ships no sidebar block added
nothing to the rail — the app installed fine and appeared nowhere.

**A5 is the subtle one.** `openAppInChat` early-returns when the app is already
grounded (right for re-entry, wrong here), so re-grounding is a no-op. If `+`
reopens the previous thread instead of a fresh one, the `studio:new-app-chat`
path regressed.

**A7/A8 together** are the "parallel, not nested" requirement: a conversation
appears in exactly one place.

### Sidebar edge cases worth a look

- Narrow the window below 1024px — rail auto-hides; the header control reopens it.
- On `/studio/apps/<app>` the rail is auto-hidden **by design**; reveal it with
  the "Show sidebar" control before judging anything about it.
- An app with zero conversations shows "Start a conversation", not an empty gap.

---

## A'. Manual — mbb-consultant surfaces

<https://lum.id/studio/apps/mbb-consultant>

| # | Do | Pass |
|---|---|---|
| B1 | Open the app | Sidebar row **MBB Consultant** (briefcase, under Research) |
| B2 | Nav tabs | Overview · Environment · Review · Workflows · Experiments |
| B3 | **Overview** | Two stats + "How it works" + a runs table |
| B4 | **Environment** | Harness / Infra / Data / Agents / Prompts — 11 skill cards, 8 judge rubrics, the panel and where each seat runs |
| B5 | **Review** | Drafts table; empty state reads "Nothing to review", not a blank panel |
| B6 | **Workflows** / **Experiments** | Render the `app-workflows` / `app-experiments` native widgets |
| B7 | Ask the chat "list cases" | 52 cases |
| B8 | Pick a case, answer 3 turns | Turn 3 still references the client from turn 1 |
| B9 | Ask a non-casebook question | Score visibly marked **no ground truth / indicative** |
| B10 | 👎 + a correction | A draft appears in **Review**; sidebar badge count increments |

**B9 is a correctness requirement, not cosmetics.** An open-mode score must be
impossible to screenshot as a benchmark number.

> **B1–B6 currently fail** — see the blocker. B7–B10 depend on the chat reaching
> the app's tools, so they're only meaningful once surfaces resolve.

---

## B. Automated

```bash
cd /proj/lumid_ui
npm i playwright            # needs system Chrome (google-chrome-stable)

# per-app render check (venue-link-matcher by default)
LUMID_PASSWORD='…' node e2e/studio-app-journey.mjs

# the mbb-consultant conversation journey
LUMID_PASSWORD='…' APP=mbb-consultant node e2e/studio-mbb-consultant.mjs
```

Exit 0 = pass. Screenshot on completion at `/tmp/studio-<app>.png`.

`studio-mbb-consultant.mjs` is a **scripted conversation**, not a page load:
each turn types into the composer and waits for the transcript to stop growing
(3 stable samples) rather than sleeping a fixed time, because streamed turns
vary from 2s to 60s. It asserts G1 surfaces-200, G2 sidebar folder, G3 turn-3
references turn-1's entity, G4 reload continuity, G5 correction stages a draft,
G8 ungrounded label, G9 no `/me/*` 404s, G10 ≤4 interactions.

It deliberately does **not** assert on answer text — the analyst is generative,
so a fixed-string assertion is either trivially loose or flaky. It asserts
continuity and structure instead.

### Fixed while writing this

`studio-app-journey.mjs:50` asserted `text.includes('Agents')` and was broken
two ways: that label became "Application" (`e42b616`) then "Applications"
(v0.5.108→118), **and** the app workspace auto-hides the rail, so it was
asserting on an element never rendered. It now reveals the rail first and
asserts the app's own row, not the section label above it.

---

## Blockers

**1. No `LUMID_PASSWORD`.** Both scripts log in over REST to capture
`lm_session`. A PAT cannot substitute — the browser needs the session cookie.

**2. Surfaces 404 for every cloud-installed app.** `MeAppConfig` has a
cross-node fallback (`fetchRepoSpecYAML`) that reads the spec from the caller's
xp.io repo when local files aren't visible; `serveAppSurface`
(`internal/handler/me_app_ui.go`) has **no such fallback** and hard-fails on
`resolveAppDir == ""`, reporting a misleading "app not found". lumid-identity
doesn't mount the scheduler's `xpio-state` PVC, so tenant app files are
unreachable from it. `mbb-ai` 404s identically — this is very likely the real
reason it reads as an empty shell in Studio.

Reproduce in two lines:

```bash
set -a; . /proj/.env; set +a
curl -s -o /dev/null -w 'config=%{http_code}\n' -H "Authorization: Bearer $LQT_MAILBOX_PAT" \
  https://lum.id/api/v1/me/apps/mbb-consultant/config    # 200
curl -s -o /dev/null -w 'ui=%{http_code}\n'     -H "Authorization: Bearer $LQT_MAILBOX_PAT" \
  https://lum.id/api/v1/me/apps/mbb-consultant/ui/home   # 404
```

Fix is ~10 lines giving `serveAppSurface` the fallback `MeAppConfig` already
has. It's a change to the auth authority, so it needs a deliberate decision —
but it would un-break surfaces for every cloud-installed app, not just this one.

---

## Status

| Group | State |
|---|---|
| A1–A9 sidebar | **Runnable now** — not yet run by me (no browser session) |
| B1–B6 surfaces | **Blocked** on the identity fallback |
| B7–B10 chat | Blocked behind B1–B6 |
| Automated | Written, **not yet run** — needs a password |

The app logic underneath *is* verified: a live 2-turn interview on `Case_019`
scored 65.3% framework with `grounded: True` on the GPU fleet. What's unproven
is specifically the browser layer.

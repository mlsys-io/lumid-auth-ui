# CLAUDE.md — lumid-ui

**`lumid-ui` is the single React SPA behind almost every authenticated surface on `lum.id`** —
auth pages, the account area, Studio, the super-admin dashboard, the Claude quota/session views,
and the *verbatim ports* of the retired Runmesh, Lumilake and QuantArena-admin frontends.
React + Vite + TypeScript + shadcn/ui. Repo: `mlsys-io/lumid-auth-ui` (the name predates the
scope). `package.json` says `0.4.0`; **the real version is the git tag** (`v0.5.118`, …).

Full `lum.id` path map, auth architecture and deploy protocol: root `/proj/CLAUDE.md` §2, §4, §7.

> **Where this runs (checked 2026-08-09).** Argo **Rollout** (not a Deployment) named `lumid-ui`,
> **4 replicas, canary with a Job-smoke analysis gate**, ns `lumid`, **service** tier; Argo app
> `lumid-ui` from `/proj/deploy_infra/k8s-lift/lumid-ui/`. Never exposed directly — the
> `lumid-landing` nginx owns `lum.id` and proxies the authenticated paths to it. A parallel
> **nightly lane** (`lumid-ui-nightly` at `nightly.lum.id`) re-tags the CI image.

## Release / deploy

**Cut a `vX.Y.Z` git tag and stop — the rest is automatic.** CI builds
`ghcr.io/mlsys-io/lumid-ui:vX.Y.Z`, then **Argo CD Image Updater** (semver, allow-tags
`^v\d+\.\d+\.\d+$`, write-back `git:secret:argocd/git-creds` → branch `migration/uks`)
resolves it and commits the pin into
`k8s-lift/lumid-ui/.argocd-source-lumid-ui.yaml` itself — the `build: automatic update of
lumid-ui` commits. **There is no manual pin step**; this file claimed one until 2026-08-28, which
sends you to hand-edit a file the updater owns and will overwrite. Same lane as `lumid-identity`.

`kubectl set image` is still reverted by selfHeal — the ban stands. If you need the rollout NOW
rather than at the next reconcile, nudge the Application instead:
`kubectl -n argocd annotate application lumid-ui argocd.argoproj.io/refresh=normal --overwrite`.
Rollback = cut a **higher** tag; the updater only moves forward on semver.

Canary gating is a **Job smoke test** (curl the canary Service for HTTP 200 + a latency ceiling)
— *not* Prometheus, which was torn down 2026-07-04. Protocol:
`/proj/deploy_infra/k8s-lift/CD-PROTOCOL.md`.

Three deploy-verification traps, in the order they bite:

1. **A stale `.argocd-source-*` override silently breaks deploys.** Fixed 2026-07-25 with
   `ServerSideApply=true` plus a retag past the override. If a tag appears to deploy but the live
   bundle doesn't change, suspect that file before suspecting the build.
2. **Assets live under `/auth/assets/`, not `/assets/`.** `curl`ing `lum.id/assets/<chunk>.js`
   404s even on a perfectly healthy deploy, which reads exactly like trap 1. Get the real path
   from the served HTML (`curl -s https://lum.id/studio | grep -oE 'assets/index-[^"]+\.js'` →
   prefix `/auth/`), then grep the chunk for a string unique to your change. Chunk hashes from a
   local `npm run build` do NOT match CI's — compare content, never filenames.
3. **The flip is not atomic.** Rollout canary steps 25% → smoke → 50% → smoke → 100%, all pauses
   time-bounded (60 s) so it self-promotes; a failed smoke gate leaves it `Degraded` on the OLD
   version rather than serving a broken bundle.

## Layout

```
src/pages/
  login/, auth/            login, register, OAuth callback, forgot/reset password
  account/                 dashboard, profile, tokens (PATs + live OAuth-grants card),
                           connect + connect-google (Gmail/Calendar wizard), admin hub,
                           admin-invitations
  dashboard/               super-admin.tsx — the 5-section operational dashboard
  studio/                  THE app surface: a chat-first shell (one mode — the
                           Simple/Advanced toggle is gone; engineer details such
                           as the model chip and turn telemetry are admin-only)
  onboarding/, status/, docs/, app/, app-revamp/, deprecated/, Go.tsx
  docs/xpio-autoresearch.tsx   renders public/docs/xpio_autoresearch_canonical.md.
                           PUBLIC route — NO AuthGuard, deliberately, so anonymous
                           forkers can read the contract before installing
src/runmesh/               the entire Runmesh admin tree ported verbatim (~14k LOC),
                           imports mass-rewritten @/* → @/runmesh/*
src/lumilake/, src/admin/, src/qa/, src/quantarena/, src/lqt/   the other absorbed frontends
src/components/            auth-guard.tsx, admin-guard.tsx, shared UI
  StudioShell.tsx          sidebar + top strip; owns the fullBleed/wideMain route rules
  StudioChat.tsx           the chat; LIBRARY_KEY / DATA_KEY virtual scopes live here
  ChatRail.tsx             the docked rail (width, drag-resize, narrow takeover,
                           portaled toggle) — shared by the app workspace and /studio/data
src/hooks/                 incl. useCollapse(key, default) — localStorage-persisted tile toggles
public/docs/               mirrored copy of the canonical autoresearch contract
```
<!-- STALE (checked 2026-08-23): src/pages/explore/ was listed here but does not exist. -->

## Commands

```bash
npm install
npm run dev            # vite dev server
npm run build          # production build
npm run build:checked  # tsc --noEmit && vite build   ← prefer this before tagging
npm run typecheck
npm run test:blocks    # e2e/blocks-replay.mjs
```

## Design system (Lumen) — Studio, `/code`, `/claude-sessions`, `/explore`, `/auth`

Warm editorial, light only. **Source of truth: `src/styles/palette.json`** (typed via
`src/styles/palette.ts`); Tailwind, `globals.css` channels, `src/workflow/theme.ts` and charts all
derive from it. Don't add a hex anywhere else — `npm run check:palette` ratchets it.

- **Scoping.** Font (Inter) and radius apply only under `html[data-surface="studio"]`, stamped by
  an inline script in `index.html` (first paint) and kept in sync by `useStudioSurface()` for
  `/studio /code /claude-sessions /explore /auth`. Ported trees, LQT and QuantArena keep their look.
- **Colour.** Ink scale replaces slate/gray/zinc. Status = `src/lib/tones.ts`: ok **gold**,
  running **lagoon**, failing **brick**, attention **ember**, idle ink, knowledge **plum** — each
  tone carries an icon; never signal by colour alone. Text ≥ 4.5:1 on paper *and* `muted`:
  body text is `ink-600`+, status text uses the `-700` step, white-on-gold needs `gold-700`.
  `npm run check:contrast` asserts the pairs. Charts use `chart-1…8` (validated CVD-safe), in order.
- **Alpha on tokens works** (`bg-card/80`, `ring-ring/40`): tokens are `rgb(var(--x-rgb) / α)`.
  Before 2026-11 these silently emitted no CSS. A translucent *text* class can fail contrast —
  prefer a solid ink step.
- **Type scale** (no `text-[Npx]`): `nano 10 · micro 11 · caption 12 · meta 13 · body 14 ·
  read 15 · title 17 · h3 20 · h2 24 · h1 32` (h1–h3 in `font-display` serif). Uppercase kickers
  use `.eyebrow`. `cn()` is `extendTailwindMerge`-configured for these keys and `shadow-e1/e2/e3`
  — a plain tailwind-merge would drop `text-body` next to a colour class.
- **Primitives** (`src/components/ui/`): `Button` (primary ink · accent gold-700 · secondary ·
  ghost · destructive brick · link; `default`/`outline` are aliases), `Badge` tones,
  `PageHeader` (serif title + subtitle + actions + underline tabs), `PageContainer`, `Segmented`,
  `EmptyState`, `ErrorState` (401/403 probes the session before saying "signed out"),
  `Skeleton` (`.lumen-skeleton`), `StatTile`, `DataTable`, `StatusBadge`.
  Pages in the default `<main>` use `<PageHeader className="pt-2">` and set `ownHeader: true` in
  `TopStatusStrip`'s `PAGE_META`, or the title renders twice.
- **Illustration: Strands** (`src/components/illustrations/`): `StrandMark` (the logo; `idle |
  draw | thinking`), `StrandAvatar` (hashed app glyph, warm tints only), scenes for empty/error
  states. 160×120 grid, 1.5px round strokes, ink-300 + one bronze strand.
- **Motion is CSS** (`lumen-rise`, `.lumen-lift`, `.lumen-press`, `.lumen-sweep`, `strand-*`,
  `tailwindcss-animate` for Radix overlays). framer-motion stays in the lazy chat/canvas chunks.
  Every new animation class must be added to the `prefers-reduced-motion` block in `globals.css`
  (loaders become a fade, never a freeze).
- **Codemod**: `node scripts/codemod-studio-tokens.mjs` is idempotent — rerun it after rebasing
  a branch that predates Lumen instead of hand-resolving class conflicts.
- **Verify visually**: `vite.live.config.ts` renders local source on lum.id data (needs
  `VITE_API_BASE_URL` + `VITE_ME_API_BASE`); `e2e/studio-visual.mjs` (read-only) reports
  off-palette, contrast, font-size count and 390px overflow per route; `design-dev.html` is the
  no-auth gallery of tokens, primitives and Strands.

## Novix's look, Lumid's clarity (round 3, 2026-11-24)

Borrow Novix's visual effects and motion freely; never its obscurity. **Every element answers a
question a real user of a real app asks, in plain words, without hover or legend, with one
obvious next action. No modes, no unexplained counters.** Don't strip a visual to get
simplicity — label it.

| Surface | The question it answers | Where |
|---|---|---|
| Activity (`/studio/runs`) + app home band | Is anything running? Is anything broken? | `components/activity/`, `lib/activity.ts` |
| Workflow header | When does it run? Run it now. (⋯ = "This workflow" / "This app") | `ScheduleChip.tsx`, `WorkflowObservabilityPanel.tsx` |
| Run page | Did it work? If not, where and why? | `RunAnswerCard.tsx` + `lib/run-answer.ts`, `RunTimeline.tsx` + `lib/run-timeline.ts` |
| Research map (app home) | What is it exploring, what came from what, what's next? | `components/research/`, `lib/research-map.ts` |
| Experiment detail / evolution chart | Which version wins? Can I trust it yet? Is it improving? | `ResearchMap.tsx` `ExperimentDetail`, `EvolutionChart.tsx` |

- **Two things to manage:** a **workflow** is a job that repeats — you *operate* it (header).
  An **experiment** is a question the *app* is answering by comparing **versions** — it
  belongs to the app (experiments span workflows: `kol_alpha` feeds from two), so it lives on
  the app's Research map, not as a tab on every workflow. Workflow tabs: Runs · Data, plus
  "Experiment" only where one runs and "Changes tried" only where runs branched.
- **Vocabulary** (`src/lib/glossary.ts`, enforced by `check:glossary`): experiment (the
  question) · version (was arm / variant / attempt) · run · "winning" not champion · "can't
  tell apart yet" not "not separable" · "changes tried" not lineage · Cancel, not Stop.
- **Words come from pure, tested functions**, never inline: `plainCause()` (raw errors →
  "Server error (HTTP 500)"), `runAnswer()`, `experimentStatus()`, `criteriaInWords()`,
  `workflowStatusLine()`. A raw code or snake_case reaching the screen is a bug.
- **Honesty over completeness**: say "since 18 Nov (the newest 500)" when a list is capped;
  don't draw a series the server only guessed a version for; when versions were measured
  differently, say the lines can't be read against each other.
- **Motion** (all CSS, all in the `prefers-reduced-motion` block): live dot breathing
  (`animate-lumen-breathe`), text shine 2.4s (`.lumen-shine`), working dots 1.2s with
  200/400ms offsets (`.lumen-dots`), once-per-session hero entrance blur 8px / rise 16px /
  600ms (`.lumen-hero-in`, `useOncePerSession`), research-map edges draw in
  (`.research-edge-draw`, pathLength=100) and the selected path flows
  (`.research-edge-flow`), evolution lines draw once (`.evo-line-draw`). Motion signals
  live / changed / selected — never decoration.

### Where runs live

- `/studio/runs` = **Activity**: Running now · Needs fixing (one row per broken *workflow*, not
  per failed run) · All workflows grouped by app. `?app=` filters; `?view=list|grid|gantt|calendar`
  is the Timeline; `?state=` opens the list. Feed: `useRunsFeed` (`/me/runs`, ~6 s, 500-row
  cap → stale-while-revalidate from sessionStorage, `truncated` said in words) + the
  `/me/runs/stream` SSE.
- The app home shows the same blocks for that app (`AppActivityBand`, renders nothing when
  healthy) and the Research map.
- Sidebar: "N failing" counts failing *workflows*; an app row breathes while it has a run
  going (`useShellActivity`, one 2-min poll for the shell).

## The things that trip people up

- **Auth is enforced twice, and both layers matter.** `AuthGuard`/`AdminGuard` in the SPA are UX;
  the real gate is nginx **auth subrequests** (`/internal_admin_check`, `/internal_super_check` →
  `lumid-identity:9900/api/v1/admin/{check,super-check}`) in
  `deploy_infra/k8s-lift/nginx/lum-id-landing.conf`. Adding an admin route means touching both.
- **Cross-domain admin calls don't use the session cookie.** `lm_session` is `HttpOnly` on
  `.lum.id`, so JS can't read it and it never reaches `runmesh.ai`. `src/runmesh/utils/axios.ts`
  fetches a **10-minute, `aud=runmesh`, `scope=runmesh:admin`** bearer from
  `GET /api/v1/session-bearer` (single-flight cache, refreshed 60 s before expiry) and sends that.
  Don't "simplify" it into forwarding the session token.
- **The identity origin is resolved at runtime**, not baked at build time — that's what lets the
  same bundle serve `lum.id` and `nightly.lum.id` without CORS failures. Don't hardcode an API base.
- **Ported trees are ports.** `src/runmesh/`, `src/lumilake/`, `src/admin/` came over verbatim from
  now-deprecated repos. Match their local conventions when editing inside them rather than
  refactoring them toward the rest of the app.
- **Super-admin dashboard ordering is deliberate** — operational urgency first: health → source →
  autoresearch loops → identity → telemetry. Collapse states persist under
  `localStorage["super-admin:<key>"]`.
- **A route that docks `StudioChat` must be added to `fullBleed` in `StudioShell.tsx`.**
  `<main>` has three layouts, and the default branch is `px-6 py-6 max-w-5xl`. A page that renders
  the chat rail inside that cap looks *broken but not obviously so*: the rail is correctly pinned
  to its container's right edge, and that edge is the middle of the viewport. Full-bleed also
  carries `h-screen overflow-hidden`, which is what makes the transcript scroll inside the rail
  instead of growing the page — so missing it costs you two bugs, not one. `/studio/apps/:app`,
  `/studio/library` and `/studio/data` are the current members; full-bleed panels own their own
  padding.
- **Not every docked chat is grounded on an installed app.** `StudioChat` takes a `groundApp`
  slug, but `LIBRARY_KEY`, `DATA_KEY`, `APPS_KEY` and `COMPUTE_KEY` (`src/lib/chat-scopes.ts`) are
  *virtual* scopes — no bundle behind them and no opener (the composer placeholder names the
  place). That works only because the tools those chats drive (`data_catalog`, `data_query`,
  `save_artifact`) are platform tools; an app-declared tool would need a real install. A new
  virtual scope also needs a `workspaceApp()` branch and a `threadHome()` entry, or its threads
  save untagged and can't be resumed.
- **Every `studio:ask` pre-fills the composer; the user presses send.** `autosend` is ignored
  (one behaviour since 2026-11). The ask's `context`/`model` ride to that send. Where no chat is
  mounted, the shell parks the ask on `chat/askBus.ts` (mount counter, not a path list) and goes
  to `/studio`, whose chat drains it.
- **Studio is UIUX-only** over an unchanged engine. If a change to Studio
  requires an engine change, that's a signal to reconsider the change.

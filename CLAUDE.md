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
  studio/                  THE app surface. Chat-first "Simple mode" is the default;
                           "Advanced" (the older Studio) is behind a toggle
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
  slug, but `LIBRARY_KEY` and `DATA_KEY` are *virtual* scopes with hardcoded openers in
  `emitAppOpener` — no bundle behind them. That works only because the tools those chats drive
  (`data_catalog`, `data_query`, `save_artifact`) are platform tools; an app-declared tool would
  need a real install. A new virtual scope also needs a `workspaceApp()` branch, or its threads
  save untagged and can't be resumed.
- **Studio Simple mode is UIUX-only** over an unchanged engine. If a change to Simple mode
  requires an engine change, that's a signal to reconsider the change.

# CLAUDE.md — lumid-ui

This file provides guidance to Claude Code (claude.ai/code) when working in this repository.

**`lumid-ui` is the single React SPA behind almost every authenticated surface on `lum.id`** —
auth pages, the account area, Studio, the super-admin dashboard, the Claude quota/session views,
and the *verbatim ports* of the retired Runmesh, Lumilake and QuantArena-admin frontends.
React + Vite + TypeScript + shadcn/ui. Repo: `mlsys-io/lumid-auth-ui` (the name predates the
scope). `package.json` says `0.4.0`; **the real version is the git tag** (`v0.5.118`, …).

> **Where this runs (checked 2026-08-09).** Argo **Rollout** (not a Deployment) named `lumid-ui`,
> **4 replicas, canary strategy with a Job-smoke analysis gate**, ns `lumid` on cluster
> `lumid-prod2`, **service** tier. Argo app `lumid-ui` from `/proj/deploy_infra/k8s-lift/lumid-ui/`.
> It is never exposed directly: the `lumid-landing` nginx owns `lum.id` and proxies the
> authenticated paths to it. There is a parallel **nightly lane** (`lumid-ui-nightly` at
> `nightly.lum.id`) that re-tags the CI image.
>
> **GitOps history worth knowing:** UI deploys were silently broken for a while by a stale
> `.argocd-source-*` override; fixed 2026-07-25 with `ServerSideApply=true` plus a retag past the
> override. If a tag appears to deploy but the live bundle doesn't change, suspect that file
> before suspecting the build.
>
> **Verifying a deploy: assets live under `/auth/assets/`, not `/assets/`.** `curl`ing
> `lum.id/assets/<chunk>.js` 404s even on a perfectly healthy deploy, which reads exactly like
> the stale-bundle failure above. Get the real path from the served HTML
> (`curl -s https://lum.id/studio | grep -oE 'assets/index-[^"]+\.js'` → prefix `/auth/`), then
> grep the chunk for a string unique to your change. Chunk hashes from a local `npm run build`
> do NOT match CI's, so comparing filenames proves nothing — compare content.
> The Argo **Rollout** also means the flip isn't atomic: canary steps 25% → smoke → 50% → smoke
> → 100%, all pauses time-bounded (60s), so it self-promotes; a failed smoke gate leaves it
> `Degraded` on the OLD version rather than serving a broken bundle.

## Release / deploy

Cut a `vX.Y.Z` git tag → CI builds the image → pin it in the Argo app → commit to `deploy_infra`
branch `migration/uks`. `kubectl set image` is reverted by selfHeal. Canary gating is a **Job
smoke test** (curl the canary Service for HTTP 200 + a latency ceiling) — *not* Prometheus, which
was torn down 2026-07-04. Protocol: `/proj/deploy_infra/k8s-lift/CD-PROTOCOL.md`.

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
  onboarding/, explore/, status/, docs/, app-revamp/
  docs/xpio-autoresearch.tsx   renders public/docs/xpio_autoresearch_canonical.md.
                           PUBLIC route — NO AuthGuard, deliberately, so anonymous
                           forkers can read the contract before installing
src/runmesh/               the entire Runmesh admin tree ported verbatim (~14k LOC),
                           imports mass-rewritten @/* → @/runmesh/*
src/lumilake/, src/admin/, src/qa/, src/quantarena/, src/lqt/   the other absorbed frontends
src/components/            auth-guard.tsx, admin-guard.tsx, shared UI
src/hooks/                 incl. useCollapse(key, default) — localStorage-persisted tile toggles
public/docs/               mirrored copy of the canonical autoresearch contract
```

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
- **Studio Simple mode is UIUX-only** over an unchanged engine. If a change to Simple mode
  requires an engine change, that's a signal to reconsider the change.

Broader context — the full `lum.id` path map, the auth architecture, and the deploy protocol — is
in the root `/proj/CLAUDE.md` §2 and §4.

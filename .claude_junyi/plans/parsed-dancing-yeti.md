# Unified `/dashboard` shell — sidebar layout + path cleanup

## Context

Today the authenticated UI has two different visual shells:

- **Dashboard landing** at `/auth/dashboard` — a grid of cards (Account, Admin if admin, Apps).
- **Runmesh admin subroutes** at `/auth/dashboard/admin/runmesh/*` — use `RunmeshAdminLayout` with a left sidebar + `<Outlet/>` content area.

Clicking into admin visually yanks the user into a different-feeling page. The landing also treats Admin as a *link-out hub* — cards that navigate you elsewhere — rather than keeping the admin sections in the main nav where you live.

User wants **one shell** — the Runmesh-style sidebar layout — for *every* authenticated surface: Overview, Account, Admin (conditional), and the Apps launcher. No more card-hub middle page. And the path should read cleanly: `lum.id/dashboard`, not `lum.id/auth/dashboard`.

Auth flows (login, register, forgot-password, reset-password, OAuth callback) stay under `/auth/*` since they're infrequent and moving them churns bookmarks without helping anyone.

## Final URL shape

```
Authenticated (no /auth/ prefix — primary URLs):
  lum.id/dashboard                              Overview (landing inside the sidebar shell)
  lum.id/dashboard/profile                      Profile
  lum.id/dashboard/tokens                       Access Tokens
  lum.id/dashboard/connect                      Install LumidOS
  lum.id/dashboard/admin/invitations            Invitation codes   (admin only)
  lum.id/dashboard/admin/runmesh/dashboard      Runmesh overview   (admin only)
  lum.id/dashboard/admin/runmesh/users          ...
  lum.id/dashboard/admin/runmesh/nodes
  lum.id/dashboard/admin/runmesh/suppliers
  lum.id/dashboard/admin/runmesh/supplier-nodes
  lum.id/dashboard/admin/runmesh/billing
  lum.id/dashboard/admin/runmesh/workflow-review

Auth flows (unchanged):
  lum.id/auth/login
  lum.id/auth/register
  lum.id/auth/forgot-password
  lum.id/auth/reset-password
  lum.id/auth/callback

Legacy bookmarks (one-hop redirects):
  lum.id/auth/dashboard*    → lum.id/dashboard*
  lum.id/auth/account*      → lum.id/dashboard*
```

## Design

### Single `DashboardLayout` component

Replaces the existing card-grid `dashboard.tsx` *and* the `RunmeshAdminLayout`. One shell, sidebar + content.

```
┌────────────┬──────────────────────────────────┐
│  lum.id    │   <Outlet/>                      │
│  ─────     │                                  │
│  Overview  │                                  │
│  Profile   │                                  │
│  Tokens    │                                  │
│  Install   │                                  │
│  ─────     │                                  │
│  Admin           (only when role=admin)       │
│  Invitations                                   │
│  Runmesh:        (collapsible group)          │
│   Dashboard                                    │
│   Users                                        │
│   Nodes                                        │
│   Suppliers                                    │
│   Supplier nodes                               │
│   Billing                                      │
│   Reviews                                      │
│  ─────                                         │
│  Apps            (external, opens new tab)    │
│  Analytics ↗                                   │
│  QuantArena ↗                                  │
│  Runmesh ↗                                     │
│  Lumilake ↗                                    │
│  ─────                                         │
│  {user}  Sign out                              │
└────────────┴──────────────────────────────────┘
```

Nav items use `<NavLink>` with the active-state styling already present in `RunmeshAdminLayout` (indigo-100/700). The `LanguageProvider` wrapper from Runmesh admin is reused so the Runmesh-ported pages still have their `t(...)` helpers; for non-Runmesh pages the provider is a no-op.

### Overview page (`/dashboard` index)

Greeting header + a compact summary — account info (email, **role chip**: `user` slate / `admin` indigo), a "quick actions" row (mint token / change password / install CLI), and a short Apps list. For admins: an additional "Administration" quick-access row with Invitations + "Runmesh admin" entry links. **No card grid** — the user navigates via the sidebar; the Overview is a welcome / status-at-a-glance page, not a hub.

### Admin gating + visual role distinction

Whole admin section in the sidebar is `{user?.role === 'admin' && ...}`. Non-admins never see those items. Server-side, `AdminGuard` already protects the routes themselves.

On top of the route gating, the shell makes the role **visibly explicit** so admins never lose track of which privilege they're operating with:

- **Role chip in the sidebar header** next to the username — `user` in slate, `admin` in indigo. Small, but always visible.
- **Explicit "Administration" section header** in the sidebar (indigo Shield icon, uppercase label). Separates admin nav items from account nav so the escalation is obvious.
- **Subtle left-border accent** on admin routes — admin pages render with a 3px indigo left-border on the content container, account pages use a neutral border. Peripheral cue that the user is "in admin mode".
- **Top-of-page breadcrumb** when inside any `/dashboard/admin/*` route: `Dashboard › Admin › Runmesh › Users` with "Admin" in indigo. Reinforces scope at the content level.

```
 role=user                       role=admin
─────────                       ─────────
 junyi                           junyi [admin]
  user                            admin — acting on behalf of …

 Overview                        Overview
 Profile                         Profile
 Tokens                          Tokens
 Install                         Install
                                 ─────── Administration ───────
                                 Invitations
                                 Runmesh ▾
                                  Users
                                  Nodes …
 Apps                            Apps
 Sign out                        Sign out
```

The split lets a regular user see a clean 6-item sidebar; an admin sees clearly where the privileged surface begins.

### Runmesh admin pages

The existing 7 ported pages under `src/runmesh/pages/**` render unchanged. They currently depend on `RunmeshAdminLayout` for the sidebar + `LanguageProvider`; in the new design they render inside `DashboardLayout` directly — drop the dedicated Runmesh layout and move `LanguageProvider` up to the unified shell.

## Path cleanup

- **`vite.config.ts`** — keep `base: "/auth/"` unchanged. Bundle assets still load from `/auth/assets/*` regardless of whether the route is `/dashboard` or `/auth/login`. This avoids a collision with `lumid_front`'s own `/assets/` and keeps one asset path for the whole SPA.
- **`src/main.tsx`** — change `<BrowserRouter basename="/auth">` to `<BrowserRouter>` (no basename). All routes now use full paths.
- **`src/App.tsx`** — rewrite the route tree with full paths: `/auth/login`, `/auth/register`, `/auth/forgot-password`, `/auth/reset-password`, `/auth/callback`, `/dashboard/*`. Legacy `/auth/dashboard*` and `/auth/account*` handled by a single catch-all `LegacyDashboardRedirect` that rewrites the tail to `/dashboard/*`.
- **`/proj/infra/compose/lumid_front/nginx.conf`** — add a `location /dashboard { proxy_pass http://172.17.0.1:13080; ... }` block **alongside** the existing `/auth/`. Same headers. No URL rewriting needed — the auth UI's internal nginx has a try_files fallback that returns `index.html` for any path, so `/dashboard` lands on the SPA shell which boots and renders via the router.

### Why not change the Vite base?

Tempting to use `base: "/dashboard/"` so assets read as `/dashboard/assets/`, but the same bundle serves `/auth/login`. Changing the base would force *both* surfaces onto one asset prefix, and splitting the bundle into two entry points is much more work than keeping `/auth/assets/` as the stable asset path. Users never see the asset URL; keeping it at `/auth/` is an invisible implementation detail.

## Critical files

**New**
- `src/components/dashboard-layout.tsx` — the unified sidebar shell. Absorbs `RunmeshAdminLayout`.
- `src/pages/dashboard/overview.tsx` — the `/dashboard` index content.

**Modified**
- `src/main.tsx` — drop router `basename`.
- `src/App.tsx` — new route tree; redirects; import `DashboardLayout` and drop `RunmeshAdminLayout`.
- `src/pages/account/profile.tsx`, `tokens.tsx`, `connect.tsx`, `admin-invitations.tsx` — remove their own background-gradient + outer container (`DashboardLayout` provides the chrome now); these become content-only pages. Internal back buttons removed (sidebar handles nav).
- `src/pages/auth/callback.tsx` — `navigate(returnTo || '/dashboard')` (already done previous turn, verify).
- `src/components/auth-guard.tsx` — post-login landing → `/dashboard`.
- `src/components/admin-guard.tsx` — fallback redirect → `/dashboard`.
- `/proj/infra/compose/lumid_front/nginx.conf` — add `location /dashboard` proxy block.

**Deleted**
- `src/pages/account/dashboard.tsx` (current card grid — replaced by `dashboard-layout.tsx` + `overview.tsx`).
- `src/pages/account/admin/runmesh-layout.tsx` (merged into `dashboard-layout.tsx`).
- (Already deleted last turn) `src/pages/account/admin-hub.tsx`.

## Reuse (don't rebuild)

- Sidebar visual pattern + `NavLink` active-state styling → `src/pages/account/admin/runmesh-layout.tsx` lines 49–69.
- `LanguageProvider` wrapper → `src/runmesh/i18n` (lifted from the Runmesh layout into `DashboardLayout`).
- `AdminGuard` → unchanged, gates `/dashboard/admin/*` routes.
- `useAuth()` → unchanged, consumed by `DashboardLayout` for the user chip + role-gating of admin nav.
- Existing ECOSYSTEM app list (Analytics / QuantArena / Runmesh / Lumilake URLs) → lifted from the current `dashboard.tsx` into a sidebar "Apps" section.

## Verification

After build + deploy:

1. `curl -I https://lum.id/dashboard` → 200 text/html (SPA shell).
2. `curl -I https://lum.id/dashboard/admin/runmesh/users` → 200 text/html.
3. `curl -I https://lum.id/auth/dashboard` → 200 (SPA shell, router renders `LegacyDashboardRedirect` → client-side Navigate to `/dashboard`). Legacy bookmarks keep working.
4. `curl -I https://lum.id/auth/login` → 200 (unchanged auth flow).
5. Browser: log in → land on `/dashboard` → sidebar visible on the left → click Profile → URL becomes `/dashboard/profile` → content swaps, sidebar stays, active-row highlights.
6. Browser as admin: Admin section visible in sidebar. Click Runmesh → Users → user list loads (SSO bridge to `runmesh.ai` works — same code as today).
7. Browser as non-admin: Admin section absent from sidebar; role chip reads `user` in slate.
7b. Browser as admin: role chip reads `admin` in indigo; sidebar shows "Administration" header + admin nav items; admin pages render with the indigo left-border accent + breadcrumb.
7c. Temporarily demote admin@lum.id to role=user in the DB, re-login, and verify the admin section disappears and the chip flips.
8. Reload at `/dashboard/admin/runmesh/billing` → same view renders directly (routes resolve against the same layout; no "only works when you arrive via navigation" pitfall).

## Risks

- **`LanguageProvider` now wraps non-Runmesh pages**: the context is set up so absent `t(...)` calls no-op; verified by the existing forgot-password/reset-password flow which doesn't use it. Still, smoke the Profile and Tokens pages explicitly.
- **Auth UI shared bundle** — `/auth/login` and `/dashboard` use the same JS bundle, so a bug in the dashboard code won't break the login flow, but a router-basename misstep could. Test both entry paths post-deploy.
- **Sidebar bloat on mobile** — 15+ nav items is a lot. Version-1 uses a simple responsive collapse (hidden on `md:` screens with a hamburger); the polish pass can add sticky groups / search later.
- **Readdy regenerates `/proj/lumid_front/`** — no risk here because the nginx config + Dockerfile live in `/proj/infra/compose/lumid_front/`, outside the source tree Readdy touches.

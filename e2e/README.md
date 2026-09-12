# Studio UI e2e journey

`studio-app-journey.mjs` — render-level check that the per-app Studio page
(`/studio/apps/<app>`) actually renders its sidebar entry + Workflow tab + Data
tab, and that no `/me/*` call 404s. This is the coverage the API-plane dogfood
lacked (an endpoint returning data ≠ the page rendering it).

## Run
```
npm i playwright                       # once
# needs a system Chrome (google-chrome-stable); playwright's own chromium
# download is unreliable in sandboxes — install the .deb + use channel:'chrome'.
LUMID_PASSWORD=... APP=venue-link-matcher node e2e/studio-app-journey.mjs
```
Exit 0 = pass. Fold into the dogfood to catch Studio-UI regressions (sidebar
`ui.sidebar.label`, cross-node workflow/dataset fallbacks, per-app 404s).

## compute-nonvast-e2e.mjs

`/studio/compute` end-to-end for the **non-vast** sites (home, office, nus).
Asserts the per-site fanout actually RENDERS — each site's SiteStrip badge and
its entry in the create picker — plus that `vast` and `cloud` are *not* offered
as sandbox sites (vast is a FlowMesh SSH task; cloud is the hub). Also watches
for 404/5xx on `/sbx`, `/fm`, `/ll`.

```
LUMID_PASSWORD=... node e2e/compute-nonvast-e2e.mjs
LUMID_PASSWORD=... CREATE=1 node e2e/compute-nonvast-e2e.mjs   # real create+delete on home
```

Exit 0 pass · 1 assertion failed · 2 could not run (no credential/browser) — the
last is distinct on purpose, because "the suite never started" has previously
been indistinguishable from "the suite passed".

**Assert on elements, not `textContent('body')`.** On this page that returns
~1.2 KB and does not reach the component subtree: the first version of this
suite reported site `nus` MISSING while a visible `<span>nus</span>` was on
screen and `/sbx/nus/api/sandboxes` had returned 200. A false negative here
sends someone hunting a routing bug that does not exist.

## harbor-oidc-e2e.mjs

The Harbor OIDC login against lum.id, in a real browser. This is the leg curl
**cannot** reach: the code exchange, ID-token verification against lum.id's JWKS,
and auto-onboarding. Everything up to the authorize redirect was verifiable
without a browser; none of what happens after it was.

```
LUMID_PASSWORD=... node e2e/harbor-oidc-e2e.mjs
LUMID_PASSWORD=... HEADFUL=1 node e2e/harbor-oidc-e2e.mjs   # watch it
```

Proves the chain `/c/oidc/login -> lum.id/oauth/authorize (PKCE S256) ->
/c/oidc/callback?code&state -> authenticated`, and that Harbor recorded the user
as `"Onboarded via OIDC provider"` — a comment only the callback path writes.

**Watch responses, not `framenavigated`.** A 302 chain completes server-side and
does not fire a frame navigation per hop: the first version saw only
`harbor.lum.id/` and declared the IdP leg never happened, while Harbor had
already onboarded the user through it.

**Scope trap.** lum.id advertises `openid`/`profile`/`email` and NOT
`offline_access` (which Harbor requests by default) nor `groups`. Harbor is set
to `openid,email,profile`; widening it fails the flow with a generic error that
reads like a broken login.

It mutates: a successful run auto-onboards the authenticating identity as a
Harbor user. That is the feature, not a side effect — but it is a real write.

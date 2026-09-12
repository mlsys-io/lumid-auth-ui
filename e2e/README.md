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

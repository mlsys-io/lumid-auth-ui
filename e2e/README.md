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

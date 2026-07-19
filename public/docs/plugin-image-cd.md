# Plugin-baked image CD — Lumilake & FlowMesh

How new releases of the two **plugin-baked** control-plane services reach the UKS cluster.
Companion to [`CD-PROTOCOL.md`](CD-PROTOCOL.md) (the general immutable-tag / digest-pin protocol);
this doc covers the wrinkle that both services run a lum.id-plugin-baked image built on top of a
separate base OSS image.

## The two-image model (read this first)

Each service has **two images in two different GHCR repos** — do not confuse them:

| Service | Base OSS image (built by the app repo's CI) | Plugin-baked image (what the cluster runs) |
|---|---|---|
| Lumilake | `ghcr.io/mlsys-io/lumilake_server` — tags `v0.1.x` | `ghcr.io/mlsys-io/lumilake` — tags `v1.x` |
| FlowMesh | `ghcr.io/mlsys-io/flowmesh_server` — tags `v0.1.x` | `ghcr.io/mlsys-io/flowmesh-host` — tags `v0.1.x-plugin` |

The plugin-baked image = the base OSS image + the matching `lumid_<svc>_plugin` tree from the private
repo `mlsys-io/lumid.plugins`, copied into `/app/plugins`. The plugin supplies lum.id
identity/federation; the server **rejects all requests without it** (`*_REQUIRE_IDENTITY_PROVIDER=1`),
so the base OSS image must **never** be deployed directly.

**Consequence:** cutting an OSS release (`*_server:v0.1.x`) does **not** deploy the cluster. You must
produce a new *plugin-baked* image on top of it. This is the #1 CD gotcha for both services.

---

## Lumilake — fully automated release lane ✅

CI + Dockerfile live on the deploy_infra **`dev`** branch: `compose/lumilake_plugin/Dockerfile`
(base pinned by `ARG BASE_IMAGE=…@sha256`; `USER root` for the `_core` swap, then `USER 10001`)
and `.github/workflows/lumilake-plugin.yml` (`lumilake-plugin CI`). Argo app `lumilake-server` runs
an Image Updater **semver lane** (`allow-tags: ^v\d+\.\d+\.\d+$`, `image-list: …/lumilake`) that
git-writes-back the pin to `k8s-lift/lumilake-server/.argocd-source-lumilake-server.yaml` on
`migration/uks` and auto-rolls (deploy is **`Recreate`/replicas=1**).

Prereqs: repo secrets `GHCR_USER` + `GHCR_TOKEN` (org PAT: `repo` + `read:packages` + `write:packages`).

**Release steps**

1. **Advance the base** (on `dev`): get the new OSS base digest and bump the Dockerfile:
   ```bash
   curl -sI -H "Authorization: Bearer <GHCR_PAT>" \
     -H "Accept: application/vnd.oci.image.index.v1+json" \
     https://ghcr.io/v2/mlsys-io/lumilake_server/manifests/v0.1.5 | grep -i docker-content-digest
   # edit compose/lumilake_plugin/Dockerfile:
   #   ARG BASE_IMAGE=ghcr.io/mlsys-io/lumilake_server@sha256:<digest>
   # PR -> merge to dev  => builds ghcr.io/mlsys-io/lumilake:nightly-<sha> (semver lane ignores it)
   ```
2. **Smoke-test the nightly BEFORE cutting the release** (Recreate/replicas=1 → a bad image = downtime).
   Run a throwaway pod cloning the live `lumilake` container env, but override
   `LUMID_ACL_DB_PATH=/tmp/…` + `LUMILAKE_RECOVER_IN_FLIGHT_JOBS=0`, **and include the `socat`
   sidecar** (`127.0.0.1:8890 → oaas` — the plugin's `install()` fetches the optimizer list at load;
   without the sidecar it logs `Plugin … install() failed validation; skipping`). Expect:
   `Plugin 'lumid_lumilake_plugin' registered.` and `/openapi.json` → the new version.
3. **Cut the release** — tag on the merged dev commit (next in the `v1.x` lane, higher than the current
   baseline):
   ```bash
   git tag -a lumilake-v1.2.0 origin/dev -m "base -> lumilake_server v0.1.4"
   git push origin lumilake-v1.2.0     # builds ghcr.io/mlsys-io/lumilake:v1.2.0 -> Image Updater rolls
   ```
4. **Verify:** `curl -H "Authorization: Bearer <PAT>" https://lum.id/ll/openapi.json` → new version.

Rollback = revert the `.argocd-source-lumilake-server.yaml` pin (or re-tag) to the prior `v1.x`.

---

## FlowMesh — auto-**sync**, manual image **pin** ⚠️

Argo app `flowmesh-host` is **auto-sync** (`prune:false, selfHeal:true`), enabled 2026-07-04 after the
fleet re-enroll fixes shipped (FlowMesh **PR #91** re-register + **#93** re-subscribe/re-home + **#92**
Redis keepalive) + the per-box watchdog — a host restart re-enrolls every GPU box within a heartbeat
(verified). So a config/pin change **does** auto-roll.

**But the image lane is NOT automated.** The plugin image uses a `vX.Y.Z-plugin` tag scheme (e.g.
`v0.1.5-plugin`), which a clean-semver Image Updater lane (`^v\d+\.\d+\.\d+$`) cannot match — so
**new plugin images are pinned by hand**. There is also **no committed plugin-bake CI** for FlowMesh in
deploy_infra (unlike Lumilake); the `flowmesh-host:vX.Y.Z-plugin` image is built by a separate process.

**Deploy steps**

1. **Build** `ghcr.io/mlsys-io/flowmesh-host:vX.Y.Z-plugin` = base `flowmesh_server:vX.Y.Z` +
   `lumid_flowmesh_plugin`, and push it. Resolve its digest.
2. **Bump the pin** in git (`migration/uks`): `k8s-lift/flowmesh-host/kustomization.yaml` +
   `k8s-lift/flowmesh-host/.argocd-source-flowmesh-host.yaml` → PR → merge. Auto-sync rolls it
   (`Recreate`).
3. **The GPU fleet re-enrolls automatically** (in-image PR #91/#93/#92 + per-box watchdog). Watch the
   fleet recover: `GET https://lum.id/fm/api/v1/workers` → count returns to full. If a box lags,
   `flowmesh stack restart` on that box (or wait ~5m for the watchdog).
4. **Verify:** control-plane healthy + fleet fully re-registered/dispatch-subscribed.

> The GPU fleet workers themselves (`flowmesh_server` on luyao*/mini*) are deployed **per-box**
> (watchdog + `flowmesh stack`), separate from this Argo-managed control-plane.

---

## Side-by-side

| | Lumilake | FlowMesh (control-plane) |
|---|---|---|
| Cluster image / tags | `lumilake` / `v1.x` | `flowmesh-host` / `v0.1.x-plugin` |
| Base OSS image / tags | `lumilake_server` / `v0.1.x` | `flowmesh_server` / `v0.1.x` |
| Plugin-bake CI | ✅ `dev` (`compose/lumilake_plugin/` + workflow) | ❌ none committed (built separately) |
| Image lane | ✅ auto (Image Updater semver, tag `lumilake-v*`) | ❌ inert (tag scheme ≠ clean semver) → manual pin |
| Argo sync | auto (Recreate/replicas=1) | auto (Recreate) — fleet re-enrolls on restart |
| Fleet impact on roll | none | restart re-enrolls the whole GPU fleet (mitigated) |

Both share the golden rule: **an OSS `*_server` release does not deploy the cluster** — you cut a new
plugin-baked image (Lumilake: automatically via the `v1.x` lane; FlowMesh: build + bump the digest pin).

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
     https://ghcr.io/v2/mlsys-io/lumilake_server/manifests/v0.1.6 | grep -i docker-content-digest
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
   # The live baseline is v1.5.0 (2026-09-11) -- the lane is semver, so a tag LOWER than the
   # baseline builds an image and then rolls nothing, silently. Check first:
   #   kubectl -n lumid get pods -l app=lumilake \
   #     -o jsonpath='{.items[0].status.containerStatuses[*].imageID}'
   git tag -a lumilake-v1.6.0 origin/dev -m "base -> lumilake_server v0.1.6"
   git push origin lumilake-v1.6.0     # builds ghcr.io/mlsys-io/lumilake:v1.6.0 -> Image Updater rolls
   ```
4. **Verify:** `curl -H "Authorization: Bearer <PAT>" https://lum.id/ll/openapi.json` → new version.

Rollback = revert the `.argocd-source-lumilake-server.yaml` pin to the prior `v1.x` digest. Note a
**re-tag cannot roll you back** — the semver lane only ever moves forward, so recovering by tag means
cutting a *higher* tag that happens to carry the older build.

---

## FlowMesh — auto-**sync**, manual image **pin** ⚠️

> **Updated 2026-09-11.** Two things in this section changed since July and one of them is a live
> trap: the plugin-bake recipe **is** now committed, and the `flowmesh-host` app **does** now carry
> Image Updater annotations — which does *not* mean the image lane is automated. See the trap box
> below before trusting them.

Argo app `flowmesh-host` is **auto-sync** (`prune:false, selfHeal:true`), enabled 2026-07-04 after the
fleet re-enroll fixes shipped (FlowMesh **PR #91** re-register + **#93** re-subscribe/re-home + **#92**
Redis keepalive) + the per-box watchdog — a host restart re-enrolls every GPU box within a heartbeat
(verified). So a config/pin change **does** auto-roll.

**The image lane is still NOT automated — but it now LOOKS like it is.** The `flowmesh-host`
Application carries a full Image Updater annotation set (`update-strategy: semver`,
`allow-tags: regexp:^v\d+\.\d+\.\d+$`, `image-list: app=ghcr.io/mlsys-io/flowmesh-host`,
git write-back). Those annotations can never match the tag this service actually uses.

> ### ⚠️ The trap: a suffixed tag silently fails a clean-semver lane
>
> The plugin image is tagged `vX.Y.Z-plugin` (live today: **`v0.1.8-plugin2`**). The lane's regex is
> `^v\d+\.\d+\.\d+$`, which the `-plugin` / `-plugin2` / `-rc.N` suffix fails. The updater
> therefore tracks **nothing** — and it says so nowhere. The Application still reports
> **`Synced / Healthy`**, because "Synced" means *matches git plus the write-back override*, not
> *running the image you just built*.
>
> This is worse than having no lane at all: the annotations read as automation, so the manual pin
> step gets skipped and the cluster quietly keeps running the old image. The same shape bit the NUS
> cluster's Lumilake on 2026-09-09 — manifest said `v0.1.6-rc.1`, the pod ran `v0.1.5`, app green
> throughout, because `-rc.1` failed the identical regex.
>
> **Read the POD, never the manifest or the sync status:**
> ```bash
> kubectl -n lumid get pods -l app=flowmesh-host \
>   -o jsonpath='{.items[0].status.containerStatuses[*].imageID}'
> ```
> If you ever want this lane to work, the tag scheme and the regex have to agree — change one of
> them deliberately, and never widen `allow-tags` without checking which *other* tags it would then
> match (a widened regex can roll the app **backwards** onto an older matching tag).

**The plugin-bake recipe IS committed now** (this doc said otherwise until 2026-09-11):
`k8s-lift/flowmesh-host/plugin-image/` — `Dockerfile`, `build.sh`, `README.md`, present on **both**
`dev` and `migration/uks`. It is a script, not a CI workflow, so it is run by hand:

```bash
cd k8s-lift/flowmesh-host/plugin-image
./build.sh v0.1.8                                  # -> ghcr.io/mlsys-io/flowmesh-host:v0.1.8-plugin
./build.sh v0.1.9 flowmesh-host:v0.1.8-plugin      # extract the plugin from a specific prior image
```

It builds the new OSS base + `lumid_flowmesh_plugin` **extracted from the prior plugin image**, so the
plugin source never has to leave a running image — which is also why there is no workflow: the bake
needs a prior plugin image as an input, not just a git checkout. Its own README documents the same
allow-tags mismatch under "Why the CD did NOT auto-pick-up v0.1.5".

**Deploy steps**

1. **Build** `ghcr.io/mlsys-io/flowmesh-host:vX.Y.Z-plugin` with
   `k8s-lift/flowmesh-host/plugin-image/build.sh vX.Y.Z`, push it, resolve its digest.
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
| Cluster image / tags | `lumilake` / `v1.x` — live **v1.5.0** | `flowmesh-host` / `v0.1.x-plugin` — live **v0.1.8-plugin2** |
| Base OSS image / tags | `lumilake_server` / `v0.1.x` | `flowmesh_server` / `v0.1.x` |
| Plugin-bake | ✅ CI workflow on `dev` (`compose/lumilake_plugin/`) | ⚠️ committed **script**, run by hand (`k8s-lift/flowmesh-host/plugin-image/build.sh`) — needs a prior plugin image as input, so it cannot be a plain workflow |
| Image lane | ✅ auto (Image Updater semver, tag `lumilake-v*`) | ⚠️ annotations PRESENT but structurally inert — `-plugin` suffix fails `^v\d+\.\d+\.\d+$`, app still reports Synced → **manual pin** |
| Argo sync | auto (Recreate/replicas=1) | auto (Recreate) — fleet re-enrolls on restart |
| Fleet impact on roll | none | restart re-enrolls the whole GPU fleet (mitigated) |

Both share the golden rule: **an OSS `*_server` release does not deploy the cluster** — you cut a new
plugin-baked image (Lumilake: automatically via the `v1.x` lane; FlowMesh: build + bump the digest pin).

And both share the verification rule, which the trap above is the reason for: **assert on the running
pod's `imageID`, not on the tag in the manifest and not on Argo's sync status.** A green Application
tells you git and the write-back override agree with each other; it tells you nothing about whether
the image you built is the image serving traffic.

```bash
# the only answer that counts, for either service
kubectl -n lumid get pods -l app=<lumilake|flowmesh-host> \
  -o jsonpath='{range .items[*]}{.status.containerStatuses[*].imageID}{"\n"}{end}'
```

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
     https://ghcr.io/v2/mlsys-io/lumilake_server/manifests/v0.1.<new> | grep -i docker-content-digest
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
   # The lane is semver, so a tag NOT HIGHER than the live one builds an image and then rolls
   # nothing, silently. Live was v1.6.0 on 2026-09-28 -- check the CURRENT one first:
   #   kubectl -n lumid get pods -l app=lumilake \
   #     -o jsonpath='{.items[0].spec.containers[*].image}'
   git tag -a lumilake-v1.7.0 origin/dev -m "base -> lumilake_server v0.1.<new>"
   git push origin lumilake-v1.7.0     # builds ghcr.io/mlsys-io/lumilake:v1.7.0 -> Image Updater rolls
   ```
4. **Verify:** `curl -H "Authorization: Bearer <PAT>" https://lum.id/ll/openapi.json` → new version.

Rollback = revert the `.argocd-source-lumilake-server.yaml` pin to the prior `v1.x` digest. Note a
**re-tag cannot roll you back** — the semver lane only ever moves forward, so recovering by tag means
cutting a *higher* tag that happens to carry the older build.

---

## FlowMesh — auto-**sync**, manual image **pin** ⚠️

> **Updated 2026-09-11, and again 2026-09-27 (v0.1.10-rc.2).** The plugin-bake recipe **is**
> committed, and the `flowmesh-host` app **does** carry Image Updater annotations — which does *not*
> mean the image lane is automated (trap box below). rc.2 added: fleet-first ordering for
> node-coupled releases, bake-from-source when the plugin changed, and busy/SSH-session gates on
> the fleet roll.

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
> The plugin image is tagged `vX.Y.Z-plugin` (live since 2026-09-27: **`v0.1.10-rc.2-plugin`**). The lane's regex is
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

**`build.sh` is only right when the plugin has NOT changed** since the prior bake — it copies the
prior image's plugin tree. When `lumid.plugins` has moved, bake from source (Deploy steps, step 1).

### Shipping a PRE-RELEASE (`-rc`) — read before you pin one

A `-rc` tag matches **no** Image Updater lane (`^v\d+\.\d+\.\d+$` rejects `-rc.1`; the nightly lane
wants `^nightly-`). For the five plugin-baked FlowMesh sites that changes nothing — they are all
hand-pinned by design — but it has two consequences worth stating:

- **Nothing will auto-advance a site off the rc.** Shipping the eventual `vX.Y.Z` proper is a
  deliberate second pass, not something that happens on its own.
- **On an app that IS on an updater lane, pinning an rc silently DOWNGRADES it.** The updater does
  not skip a pin it cannot match — it resolves the newest *allowed* tag and writes that as a
  `kustomize.images` override, which **beats** the manifest. The app then reports Synced/Healthy
  while running an older image than git names. This is not hypothetical: `platform-lumilake` on
  2026-09-09 had manifest `v0.1.6-rc.1`, Application pinned `v0.1.5`, and v0.1.5 serving throughout.

  **NUS `platform-flowmesh` is exactly this shape** — stock OSS `flowmesh_server`, semver
  `allow-tags`, `write-back-method: argocd`. To put an rc there you must FIRST remove the image
  from the Application's `image-list` annotation (do **not** widen `allow-tags` to admit `-rc`;
  that regexp exists to keep pre-release builds off a service other people depend on), AND clear
  any override already on the live object — deleting the annotations does not prune it:
  ```bash
  kubectl -n argocd patch application platform-flowmesh --type json \
    -p '[{"op":"remove","path":"/spec/source/kustomize"}]'
  ```
  Both edits or neither. Bumping the pin alone produces the downgrade described above.

**Before anything: read the release's `[BREAKING]` PRs for NODE coupling.** FlowMesh keeps
compatibility only in ONE direction across a mixed-version deployment, and it differs per release.
v0.1.10-rc.2's #158 (node alias lease + `worker_name` → `alias` on the node command channel) shims
only **old root → new nodes**, so that release had to go **fleet FIRST (per-box roll below), pins
LAST** — the reverse of the order these steps are written in. With a new root in front of an old
box, root-side worker start/stop/destroy and `GET /nodes/{id}/workers` break for that box. Also
check live `NODE_ALIAS` uniqueness per site before a release that leases aliases: a second LIVE
node with the same alias gets `409` and its server crash-loops. Key that check on (site, id) —
see the shadowing warning under the per-box roll.

**Deploy steps**

1. **Build** `ghcr.io/mlsys-io/flowmesh-host:vX.Y.Z-plugin` = base `flowmesh_server:vX.Y.Z` +
   `lumid_flowmesh_plugin`, and push it. Resolve its digest. Use the recipe:
   ```bash
   cd k8s-lift/flowmesh-host/plugin-image
   ./build.sh vX.Y.Z ghcr.io/mlsys-io/flowmesh-host:v<PREV>-plugin   # extracts the plugin from the prior plugin image
   ```
   Pass the **explicit prior plugin ref** as arg 2 — the default `:plugin` floating tag may be
   stale. build.sh import-verifies the plugin on the new base before pushing and prints the digest.

   **The `-plugin2` suffix counts BAKES PER BASE, not plugin generations, and `build.sh` cannot
   emit it.** `v0.1.9-plugin2` was a second bake on the v0.1.9 base (v0.1.9-plugin + lumid.plugins
   v0.2.4 `fleet_kinds`). The first bake on any new base is therefore `-plugin`, and that is
   correct even though the previous live tag ended in `2` — it is not a downgrade. What carries
   the plugin generation forward is **which image you extract from**, so prove it rather than
   assume it:
   ```bash
   for i in <prior-plugin-ref> <new-ref>; do docker run --rm --entrypoint sh "$i" \
     -c 'find /app/plugins/lumid_flowmesh_plugin -type f -name "*.py" | sort | xargs sha256sum | sha256sum'; done
   ```
   The two hashes must be identical. (Done for v0.1.10-rc.1: identical, `fleet_kinds` present.)

   **When `lumid.plugins` has changed since the prior bake, do NOT use `build.sh`** — it extracts the
   plugin from the prior IMAGE, so a merged plugin fix silently does not ship. v0.1.10-rc.2 needed
   lumid.plugins #11: the prior image's tree was `db90565`, which lacked it (and `48aea78`). Bake
   from the merged source instead, into the same Dockerfile:
   ```bash
   git clone https://github.com/mlsys-io/lumid.plugins /tmp/lp && git -C /tmp/lp checkout <merged-sha>
   mkdir -p /tmp/ctx/plugins && cp -rL /tmp/lp/src/lumid_flowmesh_plugin /tmp/ctx/plugins/   # -L: _core is a symlink
   cp k8s-lift/flowmesh-host/plugin-image/Dockerfile /tmp/ctx/
   docker buildx build --platform linux/amd64 --build-arg BUILD_VERSION=vX.Y.Z \
     -t ghcr.io/mlsys-io/flowmesh-host:vX.Y.Z-plugin --load /tmp/ctx
   ```
   Then prove it: the image's plugin tree hash (the loop above) must equal the same hash over
   `/tmp/ctx/plugins`, the base's layers must be an exact prefix of the image's
   (`docker image inspect --format '{{range .RootFS.Layers}}{{.}} {{end}}'`), and
   `python -c "import lumid_flowmesh_plugin"` must succeed in the image. Map the image's tree back to
   a commit before you start (hash each candidate commit's `cp -rL` tree) so you know exactly which
   plugin commits the new bake adds.
2. **Check the server env vars in `flowmesh-host.yaml`** against the release's `docs/ENV.md` diff
   (`git -C /proj/flowmesh diff vPREV..vX.Y.Z -- docs/ENV.md`). FlowMesh ships **BREAKING env
   renames with no aliases** — an unrenamed var silently falls back to its default. e.g. v0.1.6
   (PR #102) renamed `ENABLE_SERVER_SSH_FORWARD → ENABLE_SERVER_PORT_FORWARD` and
   `SERVER_SSH_FORWARD_* → SERVER_PORT_FORWARD_*` (the forward relay is now shared by SSH + serve
   tasks). Rename them in the **same commit** as the pin bump or the lum.id:32032-32063 SSH-forward
   lane breaks on roll.
3. **Bump the pin + `FLOWMESH_VERSION`** in git (`migration/uks`) — at **FIVE sites, not one.**
   All five are Argo Applications with `selfHeal: true`; home and office target remote clusters
   through `site-mesh`, so one PR deploys the lot. They take **three different pin shapes** and
   editing the wrong file is a silent no-op:

   | Site | Argo app | The pin that is actually read | Shape |
   |---|---|---|---|
   | cloud | `flowmesh-host` | `flowmesh-host/.argocd-source-flowmesh-host.yaml` | write-back file **wins**; keep `kustomization.yaml`'s `digest:` in step, but it is NOT what deploys |
   | vast | `flowmesh-vast` | `flowmesh-vast/kustomization.yaml` | `newTag` + `digest` |
   | vast2 | `flowmesh-vast2` | `flowmesh-vast2/kustomization.yaml` | `newTag` + `digest` |
   | home | `flowmesh-host-home` | `home-flowmesh/flowmesh-home.yaml` | plain dir — inline full ref on the container |
   | office | `flowmesh-host-office` | `office-flowmesh/flowmesh-office.yaml` | plain dir — inline full ref on the container |

   Then `FLOWMESH_VERSION: vX.Y.Z` in each site's Deployment, so every supervisor creates workers
   from the matching `flowmesh_worker` tag (cloud: the **dind-spawned co-located CPU worker**;
   vast/vast2: the **rented instance**; home/office: their own fleets).

   PR → merge. Auto-sync rolls it (`Recreate`). Fire it immediately instead of waiting out the
   180 s reconcile:
   ```bash
   for a in flowmesh-host flowmesh-vast flowmesh-vast2 flowmesh-host-home flowmesh-host-office; do
     kubectl -n argocd annotate application "$a" argocd.argoproj.io/refresh=normal --overwrite
   done
   ```
   **Verify on the image, never on `Synced`** — Synced means "matches the git I last read". The
   home and office pods live on remote clusters, so a local `kubectl` cannot see them; read what
   Argo sees instead:
   ```bash
   for a in flowmesh-host flowmesh-vast flowmesh-vast2 flowmesh-host-home flowmesh-host-office; do
     echo -n "$a: "; kubectl -n argocd get application "$a" -o jsonpath='{.status.summary.images}'; echo
   done
   ```
   For the three in-cluster ones also check `imageID` (not `.image`, which kubelet reports as a
   bare local `sha256:` for a digest-pinned deploy and matches nothing):
   `kubectl -n lumid get po -l app=flowmesh-host -o jsonpath='{range .items[*]}{.status.containerStatuses[*].imageID}{"\n"}{end}'`
   — note `containerStatuses[0]` is the **dind sidecar**, so always glob with `[*]`.
4. **The GPU fleet re-enrolls automatically** on the host restart (in-image PR #91/#93/#92 + per-box
   watchdog). Confirm with the watchdog (`kubectl -n lumid logs <flowmesh-fleet-watchdog pod>` →
   "N heartbeating AND dispatch-reachable").
5. **Roll the GPU fleet** to the new worker images — see the per-box recipe below. The fleet is **NOT
   CD-managed**.
6. **Verify** end-to-end (see "Post-deploy smoke" — echo + GPU inference via an in-cluster Job, and the
   SSH-forward TCP probe).

### GPU fleet per-box roll (NOT CD-managed)

The fleet boxes run `flowmesh_{server,worker}` via the per-box `flowmesh stack`.

**`luyao1` IS included — do not re-exclude it.** This file used to say *"Exclude `luyao1` — it is the
dual-RTX-5090 LLM box; both cards serve `lum.id/llm` and its FM GPU workers are stopped
(`restart=no`). Rolling it would fight the LLM serving."* Checked live 2026-09-18, **every clause of
that was false**, and the note had left a heartbeating, dispatch-reachable production box a whole
version behind — it was skipped by the v0.1.10-rc.1 roll for a reason that had rotted:

| the old note claimed | measured |
|---|---|
| FM GPU workers stopped, `restart=no` | `gpu_0`/`gpu_1`/`cpu_0` Up 2 days, `restart=unless-stopped` |
| both cards serve `lum.id/llm` | only GPU0 (31.6 of 32.6 GB); **GPU1 at 18 MiB** |
| rolling fights the LLM serving | qwen3.8-27b runs in a **standalone `qwen38-vllm` container** (`vllm/vllm-openai`), not a FlowMesh worker — a stack cycle cannot reach it |

Prove the last one before touching this box rather than trusting this table: map each
`nvidia-smi --query-compute-apps=pid` to `/proc/<pid>/cgroup` and check whether the container id
belongs to one of the box's own `gpu_N`/`cpu_N` workers. It did not, and after the roll
`qwen38-vllm`'s uptime had not reset and GPU0 still held the same 31668 MiB.

**The one real caveat is capacity, not safety.** The FM worker `gpu_0` is pinned to `DeviceIDs ["0"]`
— the card qwen occupies — so it has almost no headroom; `gpu_1` is pinned to `["1"]` and is
luyao1's genuinely usable GPU worker. A large-model failure on `gpu_0` is that, not a broken box.

**Update 2026-09-25/27: luyao1 is now CPU-only in FlowMesh — still roll it.** A second qwen
(`qwen38-vllm-gpu1`) took GPU1 on 09-25 and both GPU workers were removed from its
`worker_config.yaml` (backup `worker_config.yaml.bak-2026-09-25-pre-gpu1-qwen`), so after a roll
it shows only `cpu_0`. That is expected, not a lost worker. Both qwen containers were untouched by
the rc.2 roll (uptime and ~31 GB per card unchanged).

> **DO NOT TRUST A WRITTEN ROSTER COUNT — including this one.** As of 2026-09-18 this file said 8
> boxes, `flowmesh-watchdog.sh` said 7 ("was 9 until 2026-08-13"), and
> `flowmesh-fleet-watchdog-cronjob.yaml` sets `EXPECTED_GPU_NODES: "17"` (federated: home 12 +
> office 5). They cannot all be right. Derive the roster live before planning a roll — `lum.id/fm`,
> or `kubectl get ds flowmesh-watchdog-installer` (it reconciles onto every node labelled
> `lumid.io/flowmesh-gpu=true`, so its coverage IS the roster).

**Addressing — the two sites are on different /24s and the home one was renumbered.**
Home moved to `192.168.7.0/24` on 2026-08-18 and **home has no route into `192.168.6.0/24`**, so a
`192.168.6.x` literal in an old note is an office address or simply stale. **The home row below was
verified** against live home k3s `get nodes -o wide` on 2026-09-18; the office row is carried over
from the previous revision with only `luyao0`/`luyao2` spot-checked, so re-derive it before relying
on `.203`/`.204`:

| Site | Boxes | Jump host |
|---|---|---|
| **home** `192.168.7.0/24` | `luyaomini1`…`luyaomini5` = **.182 / .183 / .184 / .185 / .186**; `luyaomini` (control-plane) .181; `luyaobox9` .199; `luyao-n5-max` .155; `luyao-gmk` .156; GB10s `gx10-548e` .170, `gx10-db5e` .171 | `luyaobox9` (`.199`) |
| **office** `192.168.6.0/24` | `luyao0/2/3/4` = .200 / .202 / .203 / .204 | `kvrun-jump` = **`luyaobox7`** |

**This table previously listed the minis at `192.168.6.182-185`** — wrong on both the subnet and the
offset (it was off by one: the old `.182` is retired, and `luyaomini1` now holds `.182`). Following
it sends you to addresses home cannot even route to.

**Access reality, measured from the dev box 2026-09-18 — the fleet is NOT key-reachable end to end:**
- `ssh luyaobox9` and `ssh kvrun-jump` both work on keys. These are the two entry points.
- `ssh luyaomini5` works on a key; `sudo` still needs the password.
- `luyaomini1/2/3` and `luyao0/2` **reject key auth** (`Permission denied (publickey,password)`),
  directly and nested from the jump host. They are password logins.
- So a fully unattended roll is not possible with keys alone today. Either run it from a session
  that can supply the password interactively, or fix key distribution first — the latter is worth
  doing, because a roll that needs a human at every box is a roll that gets half-finished.
- `luyaobox9`'s `known_hosts` does not carry the minis' host keys (`Host key verification failed`
  on first nested hop); `-o StrictHostKeyChecking=accept-new` on that hop, once, clears it.

**Pre-pull first** (the `flowmesh_worker:vX.Y.Z-gpu` image is ~large — a single vLLM layer is >8 GB, and
all boxes share one office uplink; pre-pulling avoids a stack-down window while the image downloads).
Field boxes authenticate to GHCR with `GHCR_READ_TOKEN` (read-only) as user `mlsys-io`. A transient
`unexpected EOF` mid-layer is common on the big GPU image — just retry `docker pull`; it resumes from
cached layers.

**Scripted:** `k8s-lift/flowmesh-host/fleet-roll.sh <version> [box ...]` does the loop below with
the gates wired in — idle-GPU check, a control-plane BUSY check and an on-box SSH-session check (all
re-checked after the pre-pull, since work can land during it; the last two added by PR #133),
pre-pull with retries before anything goes down, `down`+`up` rather than `restart`, stage-then-`cp`
instead of `tee`, and per-box verification before it moves on. It prompts once for the password and
keeps it in the environment, never in argv. `DRY_RUN=1` surveys without changing anything —
**start there**, since it also prints each box's current version and busy state, which is the
fastest way to check the roster against reality.

**`DRY_RUN=1` still authenticates** — the survey reads each box's `.env` over ssh, so there is no
credential-free mode. With no terminal (Claude Code's `!` prefix, a wrapper, `tmux send-keys`) the
prompt cannot run, so pass the password another way. Prefer the file: it stays out of argv, out of
the environment, and out of your shell history and session transcript.
```bash
umask 077; printf %s '<password>' > ~/.fm-pw          # once, by hand
SSHPASS_FILE=~/.fm-pw DRY_RUN=1 k8s-lift/flowmesh-host/fleet-roll.sh v0.1.10-rc.1
```
`SSHPASS=...` inline works too but lands in history. With none of the three available the script
exits 1 and names all three — it will not fail silently.

**The BUSY gate needs a FlowMesh API token** (any token that can list workers):
`FM_API_TOKEN_FILE=/path` (preferred), `FM_API_TOKEN=...`, or `~/.lumid/admin.pat`; without one the
script exits 1. **Why the GPU-pid gate alone was not enough:** an SSH-session task holds a worker with
NO GPU compute process. On 2026-09-27 the old gate passed luyao0 while `gpu_1` carried a user's live
session, and the roll recreated the session container under them. The on-box check (containers
labelled `flowmesh.ssh.managed=true`) exists alongside the API check because the merged `/fm` view
can hide a busy worker (below).

**Per box, one at a time, verify after each** (what the script automates):
```bash
# 0. gate: all 3 images present + no live GPU job (idle-guard)
docker image inspect ghcr.io/mlsys-io/flowmesh_{server:vX.Y.Z,worker:vX.Y.Z-cpu,worker:vX.Y.Z-gpu} >/dev/null || exit
[ "$(nvidia-smi --query-compute-apps=pid --format=csv,noheader | grep -c .)" -eq 0 ] || exit   # never interrupt a running job
[ "$(docker ps -q --filter label=flowmesh.ssh.managed=true | grep -c .)" -eq 0 ] || exit       # never cut a user's SSH session
# ...and check the control plane shows no BUSY worker for this box (fleet-roll.sh does both)
# 1. bump the per-box image pin
sudo sed -i 's/^FLOWMESH_VERSION=.*/FLOWMESH_VERSION=vX.Y.Z/' /home/flowmesh/FlowMesh/server/.env
# 2. down + up  (NOT `stack restart` — a changed tag hits a container-name Conflict on restart)
sudo -u flowmesh -H bash -c 'cd /home/flowmesh/FlowMesh/server && ./.venv/bin/flowmesh stack down && ./.venv/bin/flowmesh stack up'
# 3. verify: images on vX.Y.Z + node re-subscribed
docker ps --format '{{.Names}} {{.Image}}' | grep flowmesh          # server + workers all :vX.Y.Z
docker logs flowmesh_node_server 2>&1 | grep -iE 'subscribed|registered worker' | tail
```
On password-sudo boxes (the minis): feed the password from the file, e.g.
`printf '%s\n' "$(cat ~/.fm-pw)" | sudo -S -p '' …` — never write the password into this file or
any other committed doc — and **never** `echo PW | sudo -S
tee FILE` — the password hijacks tee's stdin; stage to `/tmp` then `sudo cp`. The `flowmesh` CLI resolves
`.env` relative to cwd, so always `cd /home/flowmesh/FlowMesh/server` first (else `PermissionError: '.env'`).

> `FLOWMESH_VERSION` in each box's `.env` drives **all three** image tags (server + worker cpu + gpu).
> Old node ids left behind are 0-worker ghosts that TTL-prune; there is no node/worker DELETE API.

**Verify on the BOX, not in the merged `/fm` view.** Node and worker ids are numbered per SITE, and
the merged view lets one site's record hide another's with the same id. During the rc.2 roll it hid
home `luyaomini1` behind cloud `nde-9`, home `luyaomini5`'s `gpu_0` behind office `wkr-42` (which was
`luyao4`'s `cpu_0`), and vast behind vast2's `nde-2`. A box or worker "missing" from that view is
unverified — check `docker logs flowmesh_node_server | grep 'Registered worker'` and the box
watchdog (`journalctl -u flowmesh-watchdog`) before acting.

**After the control-plane pin rolls, expect some boxes to drop workers from the registry.** The box
watchdogs recreate them within ~5 min (`never-registers … recreating`). The one they will not fix is
a worker whose container is GONE (`DECLARED-BUT-ABSENT`, detect-only by design): if its card is idle,
`flowmesh stack worker stop <w> && flowmesh stack worker start <w>` — `start` alone returns 500
"already started" because the supervisor still holds the record. (luyao3 `gpu_0`, 2026-09-27; what
removed its container was never found.)

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

---

## Post-deploy smoke (FlowMesh)

Prefer an **in-cluster one-shot Job** over `kubectl exec` into the live `flowmesh-host` pod (exec into
the prod control-plane is restricted). The Job reads `FLOWMESH_API_KEY` from the `flowmesh-server-env`
Secret and submits to the in-cluster `flowmesh-host:8000` Service. Do NOT probe with PATs scoped to other
services.

1. **Public health (no auth):** `curl -s -o /dev/null -w '%{http_code}' https://lum.id/fm/healthz` → `200`.
2. **Echo dispatch (CPU):** a Job that `POST`s `examples/templates/echo_local.yaml` to
   `/api/v1/workflows`, reads `task_id`, polls `/api/v1/tasks/<id>` to `DONE`. Proves the dispatch
   pipeline end-to-end. (Templates live in `/proj/flowmesh/examples/templates/`.)
3. **GPU inference:** same Job pattern with `inference_vllm_tiny.yaml` (TinyLlama, cold start ~1–2 min
   for model download + vLLM boot) → `DONE` on a `gpu_*` worker. Proves GPU routing.
4. **SSH-forward lane:** `bash -c 'exec 3<>/dev/tcp/lum.id/32032'` and `…/32063` → connect OK (validates
   the renamed `SERVER_PORT_FORWARD_*` env + the LB→NodePort→pod listener chain; host log shows
   `Port forward listening on 32 port(s) 32032-32063`).

Job manifests used for the v0.1.6 roll are ephemeral (`ttlSecondsAfterFinished`); re-create from the echo
/ inference templates as above.

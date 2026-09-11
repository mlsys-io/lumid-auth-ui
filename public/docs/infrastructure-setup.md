# Onboarding a GPU box (Admin+)

Bringing a machine into the fleet touches **three independent layers**, and most
onboarding failures are really "one layer is done and the reader thinks all three are".

| Layer | What it is | How you know it worked |
|---|---|---|
| **Cluster registry** | inventory — what exists, who owns it, commercial fields | the node appears under Cluster registry, status `active` |
| **FlowMesh runtime** | the thing that actually takes jobs (guardian + workers) | a worker with a real `wkr-NN` id, status `IDLE`, at **Compute → Fleet** |
| **Self-heal** | the per-box watchdog that repairs workers after a reboot | `kubectl -n kube-system get ds flowmesh-watchdog-installer` shows the node Ready |

A box can be fully enrolled in the registry and still take **zero** jobs. The registry is
inventory, not capacity. Judge capacity at **Compute → Fleet**, never here.

---

## 1. Create a cluster and wire its servers

**Cluster registry → New cluster.** Region, tags, and the FlowMesh and Lumilake server URLs.
Status flips `pending` → `active` once both server roles are wired.

Server URLs point at the *host* box's services — `http://<host>:8000` (FlowMesh) and
`http://<host>:9000` (Lumilake). The host box is where the FlowMesh control plane runs; it is
the box you drive step 3 from.

> This CRUD moved to **Cluster registry** on 2026-09-10 when the old `clusters` path was
> repointed at the live federation view. If a guide sends you to a page with no
> "New cluster" button, that is why.

## 2. Host prerequisites

Docker, the NVIDIA container toolkit, and the `flowmesh` user in the `docker` group.
Idempotent — safe to re-run.

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey \
  | sudo gpg --dearmor --batch --yes -o /etc/apt/keyrings/nvidia-container-toolkit.gpg
curl -fsSL https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list \
  | sed 's#deb https://#deb [signed-by=/etc/apt/keyrings/nvidia-container-toolkit.gpg] https://#g' \
  | sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
sudo apt-get update -y && sudo apt-get install -y nvidia-container-toolkit
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker
sudo usermod -aG docker flowmesh
```

**Disk.** The GPU worker image is ~45 GB. A stock 100 GB Ubuntu LV will not fit it alongside
anything else — grow the volume first, or the pull fails late and looks like a network problem:

```bash
sudo lvextend -l +100%FREE /dev/mapper/ubuntu--vg-ubuntu--lv
sudo resize2fs /dev/mapper/ubuntu--vg-ubuntu--lv
```

**Architecture.** A box with no arm64 worker image (NVIDIA GB10, for example) can enrol in the
registry but cannot accept jobs. That is a *partial* onboarding, and it looks identical to a
finished one from the registry side.

## 3. Cluster-registry agent

Mint a bootstrap token and run the one-line installer it gives you. The token is short-lived,
so mint it when you are at the box, not in advance.

→ **[Mint a bootstrap token](/studio/admin/infra-setup)** (live tool; pick the cluster and TTL)

The installer writes `/etc/lumid/agent.token` and starts the agent.

## 4. FlowMesh guardian + workers

Driven from `~/flowmeshctl/` **on the host box**, not on the target.

```bash
# 1. Mint an operator key (returns an api_key in 'flm-…' shape)
curl -X POST http://<host>:8010/api/v1/auth/keys \
  -H "Authorization: Bearer <admin key>" \
  -d '{"key_type":"operator","alias":"<node>-guardian","principal_id":"<principal>"}'

# 2. Append to ~/flowmeshctl/configs/flowmesh_config.yaml under guardians:
#   - node: "<ip>"
#     guardian_api_key: "flm-…"
#     env_guardian_file: "envs/.env.guardian.<node>"
#     worker_config: "configs/cpu_worker_config.yaml"   # or gpu_only_… on GPU-only boxes
#     workers:
#       images: ["cpu", "gpu"]                          # or ["gpu"]
#       auto: "per_gpu"

# 3. Generate the per-host env from the template envs/.env.guardian.1 —
#    GUARDIAN_CLUSTER, GUARDIAN_ALIAS, GUARDIAN_TOKEN (32-byte b64), FLOWMESH_API_KEY.

# 4. Pre-distribute the 45 GB image over the LAN rather than pulling per node:
ssh flowmesh@<source> "docker save \
  kaiitunnz/flowmesh_worker:latest-gpu \
  kaiitunnz/flowmesh_worker:latest-cpu \
  kaiitunnz/flowmesh_guardian:latest -o /tmp/fm_imgs.tar"
ssh flowmesh@<source> "cat /tmp/fm_imgs.tar" | ssh flowmesh@<target> "docker load"

# 5. Deploy
cd ~/flowmeshctl && .venv/bin/python flowmeshctl.py guardian deploy <node>
```

## 5. Enrol the box in self-heal — do not skip this

A reboot orphans every worker on the box: the supervisor rebuilds its worker-token registry
empty, while the worker containers survive under `restart=unless-stopped` still holding
pre-reboot tokens. They are rejected forever, and the container **name blocks its own
replacement**. The node stays registered, heartbeating and dispatch-reachable throughout, so
every node-level check reports healthy while the box has zero usable GPUs.

On 2026-09-11 all five home minis were power-cycled and sat in exactly that state until a human
repaired them one at a time.

The per-box watchdog fixes it unattended, and a DaemonSet keeps the watchdog installed:

```bash
kubectl label node <node> lumid.io/flowmesh-gpu=true
# from deploy_infra/k8s-lift/flowmesh-watchdog-installer/, KUBECONFIG on that site's k3s:
./apply.sh home     # or: ./apply.sh office
```

Coverage is `kubectl -n kube-system get ds flowmesh-watchdog-installer` — Ready counts nodes
whose timer is actually armed, not pods that happen to be running. A box outside both k3s
clusters needs the manual recipe in `k8s-lift/FRESH-SETUP.md`.

## 6. What happens on its own

- **Supplier row.** Each cluster auto-creates one Runmesh vendor on first node registration,
  stays linked one-to-one, and retires when the cluster's last node leaves. Commercial fields
  (contact, support tier) are edited on the cluster's Commercial tab.
  Vendor key `short_name = "lumid-cluster:<cluster_id>"`; node key
  `node_code = "<cluster_id>/<node_id>"`, globally unique.
- **Billing.** Usage is pushed per task on terminal state by the Lumilake plugin into the
  Runmesh ledger. Nothing to configure per node.

---

## Failure modes worth recognising

**Registry says `starting`, FlowMesh says `IDLE`.** Two sources of truth, and both are right
about different things. The registry tracks what the cluster-agent enrolled; FlowMesh tracks
what is picking up jobs. The agent persists enrolled workers to `/etc/lumid/workers.json` and
reports `{"status":"idle"}` in its heartbeat — so a registry stuck at `starting` means the agent
has not been bounced since the persist patch (≥ 2026-04-25). Restart the agent.

**Worker lifecycle:** `starting → idle → busy → stopped / lost`. A background sweeper retires
never-heartbeated rows after 1 h, and idle/busy rows whose heartbeat is stale > 5 min.

**A registry row outlives its machine.** Removal happens only on a graceful UNREGISTER, so a
destroyed or re-enrolled box leaves a ghost row behind. Always check "last seen" before reading
a row as capacity — a ghost and a live idle worker look identical otherwise.

**The box is enrolled but takes no jobs.** In order of likelihood: no arm64 image for this
architecture; the guardian deployed but its workers never registered; or the worker is in the
orphaned-token loop from §5. **Compute → Fleet** distinguishes them — it shows nodes and their
workers as one tree, so "node present, zero live workers" is visible at a glance.

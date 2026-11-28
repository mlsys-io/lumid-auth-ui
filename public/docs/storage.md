# Where your files live

Every cluster — NUS, office and home — uses the same places for your data: your **home**, a
**local disk**, a **model cache**, **container images**, and **central storage** for anything big.
Your paths did not change. This page says which folder to use for what, and the limits on each.

> Updated **2026-11-28**, after the storage maintenance: homes moved off the machines' system
> disks, every office machine got a capped image store and model cache, and sandboxes got a
> capped local disk.

| Place | Path | For | Limit |
|---|---|---|---|
| **Home** | `/home/<you>` | code, configs, notebooks, results you keep | **500 GiB** per person per machine |
| **Local disk** | `/scratch` (sandbox) | build output, temporary data, caches | 50 GiB per person per machine |
| **Models** | `/mnt/hf-hot` (office), `/huggingface` | model weights | 100 GB cache per machine |
| **Images** | `harbor.lum.id/<project>/<name>:<tag>` | container images | 150 GB per office machine |
| **Big data** | `/mnt/datasets` (office), central storage per cluster | datasets, anything shared | — |

---

## Home — `/home/<you>`

Same path on every machine you log into.

**Capped at 500 GiB per person per machine — a hard limit.** At the cap, writes fail with
"Disk quota exceeded" until you delete files or move big data to `/mnt/datasets`. Check your usage
with `quota -s`. In force on office luyao0 and luyao3 since 2026-11-28; luyao1, luyao2, luyao4 and NUS
follow at their next maintenance window.

| Where you are | Your home is stored on | Notes |
|---|---|---|
| Office machines | luyao4's 4 TB SSD — local on luyao4, over the network on luyao1 and luyao2 | If you had a home on two office machines, they are now one home: the second sits in a folder inside it (for example `~/luyao2-home/`). Nothing was overwritten — delete what you no longer need. |
| NUS s0 / h0 | storage-head disk array (`/data/homes/<machine>/<you>`) | Each machine still has its own home for now. |
| A sandbox | a network volume: **20 GiB** on office and home, **100 GiB** on NUS | Survives the sandbox. On NUS, an account linked to an s0/h0 login uses that host home instead. Details: [Sandboxes §6](/studio/docs/sandboxes#6-what-survives-a-delete). |
| A FlowMesh SSH session | **nothing persistent** — `/home/flowmesh` is scratch | Copy results out before the session ends. [FlowMesh SSH](/studio/docs/flowmesh-ssh#data-in-a-session) |

Homes are **not a backup**. Keep anything you cannot lose in git as well.

---

## Local disk — `/scratch`, 50 GiB

- In a sandbox, `/scratch` is the machine's own fast disk: build output, temporary data, caches.
- **50 GiB per person per machine.** It is a separate volume, so filling it never fills the
  machine; writes stop at the limit — delete files to continue.
- It stays on that machine, is never backed up, and goes with the sandbox. Copy results home.
- Office: every machine (luyao0–luyao4) has one. NUS: s0 uses its NVMe array, h0 its HDD array.

---

## Models

- **Office:** load from **`/mnt/hf-hot`**, the shared read-only store (Qwen 2.5 and 3 families,
  Llama 3.2, embedding models), instead of downloading your own copy.
- Each office machine also keeps a cache at **`/huggingface`**, capped at **100 GB**. Files that are
  also in the shared store take no space, and when the cache is full the least recently used
  models are removed — they can always be downloaded again.
- **NUS s0:** models are under `/data/huggingface` on central storage; NUS sandboxes see the
  shared store at `/models`.
- A FlowMesh SSH session does **not** see `/huggingface` — it downloads what it needs.
- A private copy in `~/.cache/huggingface` counts against your home. If several people need a
  model, ask for it to be added to the shared store.

---

## Container images — `harbor.lum.id`

1. Sign in at `harbor.lum.id` with your lum.id account → User Profile → **CLI secret**, then
   `docker login harbor.lum.id -u <you> -p <cli-secret>`.
2. Build for `linux/amd64` and push to a **public** project:
   `docker push harbor.lum.id/<project>/<name>:<tag>`.
3. Use that **same name everywhere** — sandboxes, FlowMesh tasks, every site. Harbor at home is the
   record; office and NUS each keep a copy (filled on the first pull and every 30 minutes), so
   pulls stay on the site's own network and keep working when the internet link is down.

- A **private** project fails exactly like a tag that does not exist: workers and the site copies
  pull without credentials. (Sandboxes at home are the exception — see
  [Sandboxes §8](/studio/docs/sandboxes#8-your-own-image--harborlumid).)
- Each office machine holds up to **150 GB** of images. When space is needed, images nobody uses
  are removed; registry images can always be pulled again, and images built on the machine are
  archived first. Push the ones you rely on.

---

## Big data — central storage per cluster

Large datasets and anything shared belong here, not in your home or on a local disk.

| Cluster | Where | Space | Notes |
|---|---|---|---|
| **Office** | **QNAP NAS** (`192.168.6.150`) | ~43 TB free | **`/mnt/datasets` on every office machine** (luyao0–luyao4). Make a folder per project; anyone can read it, only the owner can delete. About 110 MB/s, so copy what a job reads hard to `/scratch` first. Not backed up. In office sandboxes, published datasets appear read-only at `/datasets`. luyao4's SSD (homes) is nearly full — do not put datasets there. |
| **NUS** | storage-head `/data` (disk array, InfiniBand) | ~388 TB free | Datasets in `/data/data`, models in `/data/huggingface`. One disk array — not a backup. |
| **Home** | n5-max pool `tank` | ~95 TB free | Sandbox homes, shared data. |

**Tables: query them, do not copy them.** FinData and Lumid Data answer queries in place — see
[Sandboxes §5](/studio/docs/sandboxes#5-data--query-it-do-not-copy-it) and
[FinData SQL access](/studio/docs/findata-sql).

---

## What to do

1. Check that `/home/<you>` looks right. A folder like `luyao2-home` is your other machine's home —
   keep what you need, delete duplicates.
2. Put scratch work on the local disk and copy results home.
3. Load models from the shared store instead of downloading your own copy.
4. Push the images you rely on to a **public** Harbor project and use the `harbor.lum.id` name.
5. Put large datasets on your cluster's central storage — `/mnt/datasets` at office — and keep your
   home under 500 GiB.

Questions, missing files, a model to add to the shared store, or an image to restore: ask Yao.

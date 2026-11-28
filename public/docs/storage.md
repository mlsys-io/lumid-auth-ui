# Where your files live

Every cluster — NUS, office and home — uses **the same paths for the same kind of file**. Learn them once;
they are the same on every machine you log into.

> Updated **2026-11-28**: homes moved off the machines' system disks and capped at 500 GiB, one shared
> dataset folder and one shared model folder per cluster, and a model/dataset mirror at every site.
> Later the same day: `/mnt/datasets`, `/mnt/models` and `/mnt/images` became read-only at the top,
> each with a **`shared/`** folder that anyone can write to — see [Shared folders](#shared-folders).

| Kind | Path (every cluster) | For | Limit |
|---|---|---|---|
| **Home** | `/home/<you>` | code, configs, notebooks, results you keep | **500 GiB** per person per machine, hard |
| **Datasets** | `/mnt/datasets` · write in `/mnt/datasets/shared` | big data, anything shared | the cluster's big store |
| **Models** | `/mnt/models` · write in `/mnt/models/shared` | shared model weights | 20 TB for `shared/` (NUS) |
| **Image files** | `/mnt/images` · write in `/mnt/images/shared` | image tarballs, disk/VM images, other big binaries | 20 TB for `shared/` (NUS) |
| **Model/dataset downloads** | `HF_ENDPOINT` (already set) | Hugging Face downloads go through the site mirror | — |
| **Model cache** | `/huggingface` | this machine's own cache | 100 GB (office) |
| **Local disk** | `/scratch` (sandbox) | build output, temporary data | 50 GiB per person per machine |
| **Images** | `harbor.lum.id/<project>/<name>:<tag>` | container images | 150 GB per office machine |

---

## Home — `/home/<you>`

Same path on every machine you log into.

**Capped at 500 GiB per person per machine — a hard limit.** At the cap, writes fail with
"Disk quota exceeded" until you delete files or move big data to `/mnt/datasets`. Check your usage
with `quota -s`. In force on every cluster since 2026-11-28 (office, home and NUS).

| Where you are | Your home is stored on | Notes |
|---|---|---|
| Office machines | luyao4's 4 TB SSD — local on luyao4, over the network on luyao1 and luyao2 | If you had a home on two office machines, they are now one home: the second sits in a folder inside it (for example `~/luyao2-home/`). Nothing was overwritten — delete what you no longer need. |
| NUS s0 / h0 | storage-head disk array (`/data/homes/<machine>/<you>`) | Each machine still has its own home for now. |
| A sandbox | a network volume: **20 GiB** on office and home, **100 GiB** on NUS | Survives the sandbox. On NUS, an account linked to an s0/h0 login uses that host home instead. Details: [Sandboxes §6](/studio/docs/sandboxes#6-where-your-files-are--every-path-per-site). |
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

## Models — `/mnt/models` and the site mirror

- **`/mnt/models`** is the cluster's shared, read-only model store, laid out like a Hugging Face cache
  (`/mnt/models/hub/models--<org>--<name>`). Point `HF_HUB_CACHE=/mnt/models/hub` at it, or pass
  the snapshot path, instead of downloading your own copy.
  - Office: Qwen 2.5 and 3 families, Llama 3.2, embedding models (`/mnt/hf-hot` still works).
  - NUS: storage-head `/data/huggingface` (16 TB) on s0 and h0.
  - Home: n5-max `tank/models` (Qwen 2.5/3, LLaVA 1.5, Wan 2.1 so far).
- **Downloads go through the site mirror.** Every machine has `HF_ENDPOINT` set to its site's Hugging
  Face mirror, so a model or dataset is downloaded from the internet **once per site**; everyone
  after you gets it at local speed, and it keeps working when the internet link is down. Nothing to
  change in your code — `from_pretrained`, `snapshot_download` and `load_dataset` all use it.

  | Site | `HF_ENDPOINT` |
  |---|---|
  | Office | `http://192.168.6.204:31890` |
  | Home | `http://192.168.7.155:31890` |
  | NUS | `http://10.10.40.2:31890` (InfiniBand) |

  Gated models still need your own `HF_TOKEN`. The mirror keeps what it fetched for everyone at the site,
  so do not fetch anything you may not share within the group.
- Each office machine also keeps a cache at **`/huggingface`**, capped at **100 GB**; the least recently
  used models are removed when it is full.
- A FlowMesh SSH session does **not** see `/mnt/models` or `/huggingface` and has no `HF_ENDPOINT`;
  `export HF_ENDPOINT=<your site's mirror>` to download through the mirror.
- A private copy in `~/.cache/huggingface` counts against your 500 GiB home. If several people need a
  model, ask for it to be added to `/mnt/models`.

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
| **Office** | QNAP NAS (`192.168.6.150`) | ~43 TB free | **`/mnt/datasets`** on luyao0–luyao4. About 110 MB/s today (the NAS link is 1 Gb/s), so copy what a job reads hard to `/scratch` first. luyao4's SSD (homes) is nearly full — do not put datasets there. |
| **NUS** | storage-head `/data/data` (disk array, over InfiniBand) | ~48 TB free | **`/mnt/datasets`** on s0 and h0 (also at `/data/data` on s0). Models in `/data/huggingface`. |
| **Home** | n5-max pool `tank` (10 Gb/s) | ~76 TB free | **`/mnt/datasets`** on n5-max, luyaobox9 and luyaomini–luyaomini5. |

The same path on every cluster. New data goes in **`/mnt/datasets/shared/<project>`** (see below);
folders that already sit at the top of `/mnt/datasets` stay where they are and stay writable by their
owners. **Not backed up.** In sandboxes, published datasets appear read-only at `/datasets`.

---

## Shared folders

`/mnt/datasets`, `/mnt/models` and `/mnt/images` each have a curated, **read-only top** and one
**writable `shared/` folder**. The same three paths exist on every machine of every cluster.

| Path | You can |
|---|---|
| `/mnt/datasets`, `/mnt/models`, `/mnt/images` | read everything; not create files at the top |
| `/mnt/datasets/shared`, `/mnt/models/shared`, `/mnt/images/shared` | create files and folders; everyone can read them |

- **Only the owner can delete or rename** what they put in `shared/` (the folder is sticky, like `/tmp`).
- Make one folder per project, for example `/mnt/models/shared/<project>/`, and put a short `README`
  in it saying whose it is and when it can be deleted.
- A `shared/` folder is per cluster: something written at NUS is not visible at the office or at home.
- **Not backed up**, and it counts against the cluster's big store, not your home quota.
- Want something promoted to the curated top (a model everyone uses, a canonical dataset)? Ask Yao.

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
5. Put large datasets in `/mnt/datasets` (every cluster) and keep your
   home under 500 GiB.

Share models, datasets and image files with others through the `shared/` folders.

Questions, missing files, a model to add to the shared store, or an image to restore: ask Yao.

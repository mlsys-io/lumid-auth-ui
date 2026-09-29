# Sandboxes — a shell on the fleet

A sandbox is a container on real hardware with a home directory that outlives it.
You get it from the browser, reach it over SSH, and keep your files when you
delete it.

**Studio → Research Fleet → Sandboxes**, or the API — everything the page does is an HTTP
call you can make yourself (§12).

---

## 1. Before anything else: add an SSH key

Do this first. A sandbox with no key on your account is a box you cannot enter —
it starts, it runs, and every connection is refused with:

```
gw@lum.id: Permission denied (publickey,keyboard-interactive)
```

That message says nothing about keys being missing, which is why it reliably
reads as a broken gateway. It is not.

**Account → Tokens → SSH keys**, or the **SSH keys** button on the Sandboxes tab.
Paste your *public* key:

```bash
cat ~/.ssh/id_ed25519.pub      # starts with ssh-ed25519 — NOT the file without .pub
```

Adding it from the Sandboxes tab also pushes it to that site's gateway
immediately, so it works the moment it is saved.

---

## 2. Create one

| field | what to know |
|---|---|
| **Site** | `home` and `office` are open to every signed-in user. `nus` is admin+. |
| **Name** | yours, per site. Re-creating the same name after a delete reuses your home directory. |
| **CPU cores** | a CPU sandbox comes in **1, 2, 4 or 8** cores, with 4 GiB of memory per core. Any other size is refused. |
| **GPUs** | see §4 — the ceiling is **per machine**, not per site. |
| **Image** | pick from the site's list, or `custom…` for any reference — including our own `harbor.lum.id/<project>/<name>:<tag>` (§8). |
| **Data** | attach live stores — Lumid Data, FinData, LQT — see §5. Nothing is mounted or copied. File datasets need no selection: `/datasets` is already mounted. |
| **Ports** | publish up to **2** services on a real public TCP port — see §9. |
| **Expires after** | max **24h**. The container goes; your home directory does not. |

---

## 3. Get in

```bash
ssh -p 31223 gw@lum.id          # home
ssh -p 31226 gw@lum.id          # office
ssh -p 31222 gw@lum.id          # nus (admin+) — its commands are `ctl …`, see §11
```

One port per site for everyone — **your key decides whose sandbox you land in**.

Inside the gateway:

```
sbx ls              list your sandboxes
sbx enter [NAME]    shell into one
sbx logs  NAME      its output
sbx data            how to query the attached stores without copying them
```

Anything that is not `sbx ...` runs in your default sandbox, so `scp`, `rsync`
and `ssh gw@lum.id '<command>'` keep working.

> **One sandbox per site is the comfortable number.** A one-shot
> `ssh gw@lum.id '<cmd>'` goes to your *first* sandbox alphabetically, and there
> is no non-interactive way to target one by name. With two boxes up, a command
> you believe is running on the GPU one may be running on the other. This is not
> theoretical: it once produced a confident, entirely fictitious report of a
> fleet-wide GPU outage, because every probe had run in the wrong container.

---

## 4. GPUs — the ceiling is per machine

**A sandbox is one container on one machine, so it can only use GPUs that sit in
that machine.** The site total is not the limit.

| site | GPUs | most in ONE sandbox |
|---|---|---|
| **home** | 5 × RTX PRO 4000 Blackwell 24 GB | **1** — one per mini |
| **office** | 3 × RTX 5080 16 GB (+ 2 × RTX 6000 Ada 48 GB, admin+) | **1** (admins: 2 — one box holds both Adas) |
| **nus** (admin+) | 4 × H200 NVL 141 GB, all in one machine | **4** — see §11 |

So "5 GPUs free on home" and "at most 1 per sandbox" are both true. The form
only offers what the site can actually place; asking for more is refused with
the reason rather than accepted and left queued forever.

**Each GPU is rented on its own.** A card is offered only when nothing is using
it — including work started outside Studio, which the scheduler cannot see. A
machine with one card busy still rents you its idle one; a card someone else is
using is never handed to you. If a card goes busy in the moment between the list
and your create, the create is refused with *"GPU usage just changed — try again
in a minute"* rather than risking it.

Need more GPUs than one machine has? That is a **FlowMesh job**, not a shell —
multi-node work needs a scheduler, not an SSH session.

`nvidia-smi` inside the sandbox shows exactly the GPU you were given.

---

## 5. Data — query it, do not copy it

### Attach a store (or several)

Tick them under **Data** at create. Each **attaches** a live store by injecting
one environment variable. Nothing is mounted, nothing is copied, and attaching
several is normal — they are different warehouses, not one setting.

| Tick | You get | Holds | Auth |
|---|---|---|---|
| **Lumid Data** | `LUMID_DATA_URL` | reference, macro, events, regulatory, provenance, `robotics_demo`, `ukb_demo` | **your own PAT** |
| **FinData** | `FINDATA_URL` | market, news, `prediction_markets`, ownership, fundamentals, estimates, raw | none — anon-read |
| **LQT** | `LQT_DATA_URL` | LQT mailbox: strategies, results, telemetry, venue health | none — anon-read |

**These are different stores, and picking the wrong one is the single most common
confusion here.** `prediction_markets` lives in **FinData**, not Lumid Data —
a query copied from the Studio SQL console into a Lumid-Data-only sandbox answers
`relation … does not exist [42P01]`, which reads like a broken mount and is not.
When in doubt, ask the store itself: `curl "$FINDATA_URL/catalog/schemas"`.

```bash
# FinData — no token needed, answers from every site
curl "$FINDATA_URL/catalog/schemas"

# Lumid Data — your own token
export LUMID_PAT=…       # Account → Tokens, scope: lumid:read
curl -H "Authorization: Bearer $LUMID_PAT" "$LUMID_DATA_URL/catalog/schemas"

echo '{"sql":"SELECT * FROM reference.active_symbols LIMIT 20"}' > q.json
curl -X POST "$LUMID_DATA_URL/retrieve" \
     -H "Authorization: Bearer $LUMID_PAT" \
     -H "Content-Type: application/json" -d @q.json
```

`/retrieve` returns a `materialized_uri` (jsonl) plus `rowcount` and lineage —
**not rows inline**. Fetch that blob for the data.

**Push the work into the SQL.** Filter, aggregate and `LIMIT` server-side. A
`SELECT *` materialises the whole table into a blob, which is precisely the copy
you were avoiding. A three-row query moves about 500 bytes; the table never
leaves the server.

**Attribution differs, and it is worth knowing which you are using.** Lumid Data
takes your own PAT, so every query is attributable to you. FinData and LQT come
through anon-read gateways that supply a shared service credential: convenient,
no token to manage, and **not** traceable to you. Reach for Lumid Data when that
matters.

Run `sbx data` inside the sandbox for the same recipe without leaving the shell.

### Datasets — `/datasets`

For **files**: corpora, checkpoints, extracts — anything that is a directory
rather than a query. It is mounted **read-only in every sandbox at that site**,
so there is nothing to attach or select; it is simply there.

```bash
ls /datasets          # what this site has
du -sh /datasets/*    # how big
```

**To publish one**, use **Datasets** on the Sandboxes tab: name it, then add
files. It appears in every sandbox on that site immediately — no restart, no
re-create, and no NAS access needed. You may delete or add to anything you
published; datasets an operator published show as read-only to you.

Limits per dataset: **512 MB** a file, **50 GB** total, **10 datasets** each. For
a bulk corpus, `scp` to the NAS instead — the browser path goes through a single
pod.

**Still read-only inside the sandbox, deliberately.** One careless `rm` in one
sandbox must not be able to destroy a corpus everyone else depends on, so writes
go through Studio rather than through the mount. If you need to write, copy what
you need into your own `/home/<you>` first.

**Per site, not replicated.** `/datasets` on office is a different directory
from `/datasets` on home; publishing to one does not publish to the other.

**Not a model cache.** Weights stay node-local in `/huggingface` on each GPU box
on purpose — loading them over NFS is markedly slower than from local NVMe, so
centralising them would trade real speed for disk that is not scarce.

### Datasets vs attached sources — which do you want?

|  | `/datasets` | attached source (§ Data picker) |
|---|---|---|
| holds | files and directories | a live query endpoint |
| how you get it | already mounted, read-only; publish in Studio | tick it at create; injects env |
| copies data? | the files are *stored* there | **no** — query runs server-side |
| good for | corpora, checkpoints, extracts | FinData, Lumid Data, LQT |

Rule of thumb: **if it is a table, query it; if it is a directory, mount it.**
Do not copy a warehouse into `/datasets` to "have it locally" — it is stale the
moment it lands and loses the lineage `/retrieve` gives you for free.

### Other stores

`/studio/data-warehouse` has **Catalog** to browse and **Query** to run SQL with
no setup. For `psql`, DBeaver or pandas under your own warehouse role, mint a
credential at **Account → FinData SQL**.

---

## 6. What survives a delete

**Your home directory does.** The container does not.

```
/home/<you>     ← network storage, survives delete/recreate, per site
$HOME = /root   ← container overlay, GONE on delete
```

**SSH drops you in `/` with `HOME=/root`.** Work where you land and you lose it.
`cd /home/<you>` first — this is the single most common way to lose work here.

Homes are **per site**: your home on office is a different directory from your
home on home. They are not replicated, deliberately — live multi-writer sync of
ordinary dev files is a much larger problem than it looks.

---

## 7. Failure modes worth recognising

| what you see | what it means |
|---|---|
| `Permission denied (publickey)` | No SSH key on your account. §1. |
| `no sandboxes yet — create one` | Exactly that; not an error. |
| sandbox stuck `Queued` | Waiting for a GPU. The row says what for. |
| `relation … does not exist [42P01]` | Right SQL, wrong store — check `catalog/schemas` from inside the sandbox. |
| image pulls forever | A private Harbor project **on a site without per-user credentials** (office today). Works on home; see §8. |
| `scp: Connection closed` | The image ships no `sftp-server`, which default scp needs. Use `scp -O`, or an image that has one. |
| your files vanished | You worked in `$HOME` (`/root`), not `/home/<you>`. §6. |

---

## 8. Your own image — `harbor.lum.id`

The image list is a shortlist, not an allowlist. `custom…` takes any reference,
including our own registry:

```
harbor.lum.id/<project>/<name>:<tag>
```

**The same reference works at every site.** Each node rewrites that name to
whichever registry is closest to it — Harbor itself at home, the replica at office
or NUS — so a pod spec stays portable and you never write a site-specific address.

### Pushing

Harbor authenticates against lum.id, so there is no separate account to request.

```bash
# 1. Sign in at https://harbor.lum.id with your lum.id account.
# 2. Profile menu → User Profile → copy the CLI secret.
#    (OIDC accounts cannot use a password for docker login — this is the substitute.)
docker login harbor.lum.id -u <you> -p <cli-secret>

# 3. amd64, because the sandbox pool is amd64.
docker build --platform=linux/amd64 -t harbor.lum.id/<project>/<name>:v1 .
docker push harbor.lum.id/<project>/<name>:v1
```

### Two things that make a pull fail

Both surface as `ImagePullBackOff` minutes later, where neither cause is visible:

- **Private projects work on `home`, not yet on `office`.** Home mints you a
  Harbor robot on your first sandbox and attaches it as a pull credential, so
  `harbor.lum.id/sbx-<you>/…` pulls fine there. Office has no such credential yet
  — a private project simply fails, identically to a tag that does not exist — so
  use a public project for office, or push to home.
- **Wrong architecture.** A wrong-arch image is a *valid* manifest that fails at
  exec, with a message that reads like a truncated download. Build
  `--platform=linux/amd64`, or push a manifest list.

---

## 9. Publish a port

A sandbox can expose up to **2** services on a real public TCP port — a web app,
a notebook, a database, anything. Fill in the container ports under **Ports** at
create; the site assigns the public ones and the row shows what you got.

```
Ports  [8888] [6006]        →  lum.id:31501 → 8888
                               lum.id:31502 → 6006
```

Pools: `home` 31501-31516, `office` 31523-31538.

**The pool is shared across the site, not per user.** Sixteen ports means eight
sandboxes publishing two each, fleet-wide. Each one costs a load-balancer
frontend against a hard cap of 100, which is why it is a fixed pool — a full
pool is refused, with the free count, rather than queued. The form shows
free/total before you choose. Deleting the sandbox releases its ports.

Anything listening on that port inside the sandbox is then reachable from the
internet, **with no authentication in front of it**. Do not publish something
you would not put on a public IP.

---

## 10. Save a sandbox as an image

Installed a pile of packages and want them next time? Save the sandbox to your
own Harbor project and launch from it later.

```
Save → name it → harbor.lum.id/sbx-<you>/<name>:<tag>
```

It commits the running container and pushes it, so everything you installed —
and anything outside `/home/<you>` that would otherwise be lost — comes back.

- **20 GB limit**, checked *before* the push, so an over-sized save fails fast
  rather than after a long transfer.
- The image lands in **your own project**, private, reachable by your sandboxes
  on `home`. Nobody else can push to it.
- `home` only today. Office does not have it yet.

Your home directory is untouched by this — it already survives a delete. Saving
is for everything *else*: installed packages, system config, built artifacts
outside `/home`.

---

## 11. NUS — the H200 cluster (admin+)

A third site on the NUS campus InfiniBand segment. **Admin+ only**: the site is gated at the edge
and the GPU quota for other users is zero.

| | |
|---|---|
| **GPUs** | 4 × **H200 NVL 141 GB** in one machine (`s0`). Each card is rented on its own — one box can hold 1, 2 or all 4, and several boxes can share the machine. |
| **Shared with researchers** | s0 is also used directly by campus researchers. A card is only offered when *nothing* is using it; when their jobs hold cards, the list says `busy outside Kubernetes` and those cards are skipped. |
| **Multi-GPU** | The 4 cards have **no NVLink** — they talk over PCIe, and one of them sits on the other CPU socket. Measured NCCL all-reduce bus bandwidth: **~37 GB/s** across 2 cards, **~19 GB/s** across 4 (per card: ~740 bf16 TFLOPS, 111 GiB usable of 139). Fine for data-parallel training; tensor-parallel inference across cards will be communication-bound. |
| **CPUs** | CPU sandboxes (1 / 2 / 4 / 8 cores) land on s0 or on `h0`. h0's 2 × H100 serve `lum.id/llm` permanently and are **never** rentable — a CPU box there cannot see them. |
| **Account** | **Automatic.** Your first call gives you a NUS user name derived from your email (e.g. `alice@x.com` → `alice`; a short suffix is added if the name is taken, and it is never one of the campus researchers' logins on s0/h0). `GET /sbx/nus/api/whoami` shows it. **Already have a login on s0/h0?** Ask an operator to map your email to it *before* your first sandbox — otherwise you get a second, derived name with its own `/home`. |
| **Home** | `/home/<you>` — 100 GiB on the NUS storage array, survives delete like everywhere else. |
| **Models** | `/models` — the shared model store, **read-only**, mounted in every box. Load weights from here instead of downloading them again. |
| **Scratch** | `/scratch` — fast local NVMe, per user, *not* backed up. |
| **Images** | `harbor.lum.id/…` references work unchanged; the site pulls them from its own replica. NUS also has its own registry, **`registry.lum.id`** — see below. |
| **Limits** | 4 GPUs and 8 sandboxes per admin; GPU boxes up to 128 cores / 512 GiB; 24h TTL. |

**Getting a shell — `ssh -p 31222 gw@lum.id`.** Same key rules as the other sites (§1): your lum.id
key, pushed to NUS when you create a sandbox there or with `POST /sbx/nus/api/keys/sync`. The NUS
gateway speaks `ctl` rather than `sbx`:

```
ctl ls                 your boxes at NUS
ctl new NAME [--gpu N] [--cpu N] [--mem N] [--ttl H]    create one (GPU: admins, see below)
ctl enter NAME         shell into one
ctl rm NAME            delete one
ctl logs NAME          its output
ctl quota              what you are using
```

Anything that is not `ctl …` runs in your **default** box (a 2-core CPU box, created on first use),
so `ssh -p 31222 gw@lum.id '<command>'`, `scp -O -P 31222` and `rsync -e 'ssh -p 31222'` work as
on the other sites.

**GPU boxes over SSH are for admins.** The H200s are admin-only, and an SSH session counts as admin
when your NUS user belongs to an account on the site's admin list. Then `ctl new` takes `--gpu`
directly; anyone else creates GPU boxes in the page or the API. Either way, enter it with `-t` —
an interactive shell needs a TTY:

```bash
ssh -p 31222 gw@lum.id 'ctl new train --gpu 1 --cpu 8 --mem 32 --ttl 8'
ssh -t -p 31222 gw@lum.id 'ctl enter train'      # -t: an interactive shell needs a TTY
```

```bash
T=…            # an admin session token or an admin PAT with scope '*'
curl -s -H "Authorization: Bearer $T" https://lum.id/sbx/nus/api/sandboxes | jq '.gpu.products'
curl -s -X POST -H "Authorization: Bearer $T" -H 'content-type: application/json' \
  https://lum.id/sbx/nus/api/sandboxes -d '{"name":"train","gpu":2,"cpu":16,"memory_gi":64,"ttl_hours":8}'
```

**NUS's own registry — `registry.lum.id`.** Images pushed here live on the NUS storage array, so a
multi-GB image does not cross the WAN when a box starts. Push rights are per user and granted by an
operator (not automatic yet): they give you a password for your NUS user name, and you can push to
`registry.lum.id/<your-nus-user>/…` only. Every request needs the login — there is no anonymous
access from the internet.

```bash
docker login registry.lum.id -u <your-nus-user>                  # the password the operator gave you
docker build --platform linux/amd64 -t registry.lum.id/<your-nus-user>/train:v1 .
docker push registry.lum.id/<your-nus-user>/train:v1
# then create a NUS box with "image": "registry.lum.id/<your-nus-user>/train:v1"
```

`401` on `docker login` means the user name or password is wrong; `403` on push means you are
pushing outside `<your-nus-user>/` (or have not been granted push rights).

---

## 12. API — rent, query, stop and operate

Everything in this guide is plain HTTP against `sandbox-control`, the service behind the
page. Use it from a script, a notebook, CI, or an agent.

### Base URL per site

| site | base | who |
|---|---|---|
| **home** | `https://lum.id/sbx/api` | any signed-in user |
| **office** | `https://lum.id/sbx/office/api` | any signed-in user |
| **nus** | `https://lum.id/sbx/nus/api` | admin+ (§11) |

Note the shape: home is `/sbx/api`, **not** `/sbx/home/api` — that path does not
exist and answers 404.

### Token

A lum.id personal access token (**Account → Tokens**) in `Authorization: Bearer`.

- **Reading** — listing your sandboxes, quota, datasets — works with **any** active token.
- **Renting and stopping** needs the scope **Sandboxes — create and delete**
  (`sandbox:sandboxes:write`). Any user can mint it. Without it a create or delete
  answers `403 "this personal access token is read-only here …"` — the token is
  fine, it just was not minted for writing.

```bash
export LUMID_PAT=lm_pat_…            # with sandbox:sandboxes:write
SBX=https://lum.id/sbx/api           # home; office: https://lum.id/sbx/office/api
H="Authorization: Bearer $LUMID_PAT"
```

A revoked token keeps working for up to **60 seconds** — the service caches each
token's answer for a minute.

### Query — what is there, and what can I rent

```bash
curl -s -H "$H" $SBX/whoami          # {"email", "user", "admin"}
curl -s -H "$H" $SBX/sandboxes | jq
```

`GET /sandboxes` returns your rows **and** everything you need to decide what to
create — so a script never hardcodes a site's hardware:

| field | what it tells you |
|---|---|
| `sandboxes[]` | your sandboxes: `name`, `phase` (`Running`, `Pending`, `Queued`, `Terminating`, …), `node`, `image`, `gpu`, `expires_at` (epoch seconds), `created`; a queued GPU row also has `waiting_for` |
| `cpu.sizes` | the core counts a CPU sandbox may have here (`[1, 2, 4, 8]`) |
| `gpu.products[]` | each card: `product`, `max_per_sandbox`, `memory_gb`, `rentable_now`, `free_now`, `busy_reason` |
| `images` | the site's image shortlist and its CPU / GPU defaults |
| `data_sources`, `datasets` | what you can attach (§5) |
| `ports` | the public-port pool: `enabled`, `pool_size`, `free` (§9) |

`GET /quota` shows your namespace's `used` and `hard` limits.

### Rent

```bash
# CPU: 4 cores, 16 GiB, 8 hours
curl -s -X POST -H "$H" -H 'content-type: application/json' $SBX/sandboxes \
  -d '{"name":"dev","cpu":4,"memory_gi":16,"ttl_hours":8}'

# GPU: one card, a named product, a data source, one public port
curl -s -X POST -H "$H" -H 'content-type: application/json' $SBX/sandboxes \
  -d '{"name":"train","gpu":1,"gpu_product":"NVIDIA GeForce RTX 5080",
       "data_sources":["findata"],"ports":[8888],"ttl_hours":4}'
```

| field | default | notes |
|---|---|---|
| `name` | `dev` | lowercase letter first, then letters, digits, `-`; up to 20 |
| `cpu` | `2` | CPU sandbox: one of `cpu.sizes` |
| `memory_gi` | `8` | the page sends 4 × cores |
| `gpu` | `0` | at most the card's `max_per_sandbox` |
| `gpu_product` | any | a `gpu.products[].product`; omit for "any card I may have" |
| `image` | site default | any reference, including `harbor.lum.id/…` (§8) |
| `ttl_hours` | `8` | max 24 |
| `data_sources` | `[]` | ids from `data_sources` |
| `ports` | `[]` | container ports to publish (§9) |

Answer: `200 {"name", "pod", "image", "gpus_free"}`. The pod then takes a few
seconds (longer on a first pull of a large image) to reach `Running` — poll
`GET /sandboxes` until its `phase` says so.

Refusals say why, and are worth handling rather than retrying blindly:

| status | meaning |
|---|---|
| `400` | an invalid name, a CPU size not in `cpu.sizes`, or more GPUs than one machine holds |
| `403` | read-only token; or a GPU reserved for admins |
| `409` | no GPU free right now (with the reason and counts), a name you already have, or you are at your sandbox limit |
| `422` | a field out of range — the body names it |

### Stop

```bash
curl -s -X DELETE -H "$H" $SBX/sandboxes/dev
# {"deleted": "dev", "home_kept": "home-<you>"}
```

The container goes; `/home/<you>` stays (§6). A sandbox you do not stop is
removed when its `ttl_hours` run out.

### Operate — run things inside it

Commands run over the **SSH gateway**, with the key on your account (§1) — not
over HTTP:

```bash
ssh -p 31223 gw@lum.id 'nvidia-smi; cd /home/$USER && python train.py'   # home
ssh -p 31226 gw@lum.id 'sbx ls'                                          # office
ssh -p 31223 gw@lum.id 'sbx logs sbx-<you>-dev'
scp -O -P 31223 data.csv gw@lum.id:/home/<you>/
```

A one-shot command runs in your **first sandbox alphabetically** — keep one
sandbox per site when scripting, or you may be running in the wrong box (§3).

After adding a key through the API rather than the page, push it to the gateway:

```bash
curl -s -X POST -H "$H" $SBX/keys/sync     # {"keys_authorized": N}
```

### Save, datasets

| call | does |
|---|---|
| `POST /sandboxes/{name}/save` `{"image":"myenv","tag":"v1"}` | commit the sandbox to `harbor.lum.id/sbx-<you>/myenv:v1` (§10, home) |
| `GET /sandboxes/{name}/save` | that save's progress |
| `GET /datasets` | datasets at this site |
| `POST /datasets` `{"name": …, "note": …}` | create one you own |
| `PUT /datasets/{name}/files/{path}` | upload a file (request body = the file) |
| `DELETE /datasets/{name}/files/{path}`, `DELETE /datasets/{name}` | remove a file / the dataset |

### The fleet itself

Which machines and workers exist, per site, for any signed-in token:

```bash
curl -s -H "$H" https://lum.id/fm/home/api/v1/nodes
curl -s -H "$H" https://lum.id/fm/office/api/v1/workers
```

Reading other people's jobs is not part of this; a token sees its own.

Interactive reference: **`https://lum.id/sbx/api/docs`** (home). The OpenAPI schema itself is at
`https://lum.id/sbx/api/openapi.json` — for office, `https://lum.id/sbx/office/api/openapi.json`,
with your token.

---

## Limits

Per user, per site: **2 sandboxes**, **24h** TTL, **1 GPU** per sandbox (office
admins: 2), CPU sandboxes of **1 / 2 / 4 / 8** cores, **2 public ports** per
sandbox, **20 GB** per saved image.

The port pool is **shared across the whole site**, not per user — 16 ports, so
8 sandboxes can publish 2 each at any one time. Every published port costs a
load-balancer frontend against a hard cap, which is why it is a pool and why a
full one is refused rather than queued. The home directory has no enforced quota today — the PVC size is a
label, not a ceiling — so be considerate: one user filling the array takes down
everyone's home at that site.

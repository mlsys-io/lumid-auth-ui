# Sandboxes — a shell on the fleet

A sandbox is a container on real hardware with a home directory that outlives it.
You get it from the browser, reach it over SSH, and keep your files when you
delete it.

**Studio → Research Fleet → Sandboxes.**

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
| **Site** | `home` is open to every signed-in user. `office` and `nus` are admin+. |
| **Name** | yours, per site. Re-creating the same name after a delete reuses your home directory. |
| **GPUs** | see §4 — the ceiling is **per machine**, not per site. |
| **Image** | pick from the site's list, or `custom…` for any reference — including our own `harbor.lum.id/<project>/<name>:<tag>` (§8). |
| **Data** | attach live stores — Lumid Data, FinData, LQT — see §5. Nothing is mounted or copied. File datasets need no selection: `/datasets` is already mounted. |
| **Expires after** | max **24h**. The container goes; your home directory does not. |

---

## 3. Get in

```bash
ssh -p 31223 gw@lum.id          # home
ssh -p 31226 gw@lum.id          # office
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
| **office** | 2 × RTX 6000 Ada 47 GB + 3 × RTX 5080 | **2** — one box holds both Adas |

So "5 GPUs free on home" and "at most 1 per sandbox" are both true. The form
only offers what the site can actually place; asking for more is refused with
the reason rather than accepted and left queued forever.

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
| image pulls forever | A private registry the site cannot authenticate to; try a public one. |
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

- **The project must be public.** Sandbox pods carry no pull credential and the
  nodes pull anonymously, so a private project cannot be pulled here at all — it
  fails as though the tag did not exist. Mark the project public in Harbor, or
  keep the image on a public registry.
- **Wrong architecture.** A wrong-arch image is a *valid* manifest that fails at
  exec, with a message that reads like a truncated download. Build
  `--platform=linux/amd64`, or push a manifest list.

---

## Limits

Per user, per site: **2 sandboxes**, **24h** TTL, **1 GPU** at home / **2** at
office. The home directory has no enforced quota today — the PVC size is a
label, not a ceiling — so be considerate: one user filling the array takes down
everyone's home at that site.

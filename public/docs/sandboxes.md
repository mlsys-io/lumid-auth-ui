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
| **Image** | pick from the site's list, or `custom…` for any reference. |
| **Data** | attach a live source (FinData) — see §5. Nothing is mounted or copied. File datasets need no selection: `/datasets` is already mounted. |
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
sbx data            how to query FinData from a sandbox without copying it
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

### FinData

Tick **Data → FinData** at create. This **attaches** the warehouse: your sandbox
gets `LUMID_DATA_URL` pointing at the live store. Nothing is mounted and nothing
is copied.

Run `sbx data` inside the sandbox for the full recipe. The short version:

```bash
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

You bring your own token on purpose — queries stay attributable to you, not to a
shared sandbox identity.

> The **schemas differ by path**. A sandbox sees the store it is wired to; the
> Studio SQL console reaches a different one and its sample query uses
> `prediction_markets`, which a sandbox will answer with
> `relation … does not exist [42P01]`. Trust `catalog/schemas` from *inside* the
> sandbox over an example copied from elsewhere.

### Datasets — `/datasets`

For **files**: corpora, checkpoints, extracts — anything that is a directory
rather than a query. It is mounted **read-only in every sandbox at that site**,
so there is nothing to attach or select; it is simply there.

```bash
ls /datasets          # what this site has
du -sh /datasets/*    # how big
```

> **It is empty today** apart from a README. If `ls /datasets` shows nothing,
> that is the honest answer and not a broken mount.

**To publish one**, copy it to the NAS under `_shared/datasets/<name>/`. It
appears in every sandbox on that site immediately — no restart, no re-create.
Ask an operator if you do not have NAS access.

**Read-only by design.** One careless `rm` in one sandbox must not be able to
destroy a corpus everyone else depends on. If you need to write, copy what you
need into your own `/home/<you>` first.

**Per site, not replicated.** `/datasets` on office is a different directory
from `/datasets` on home; publishing to one does not publish to the other.

**Not a model cache.** Weights stay node-local in `/huggingface` on each GPU box
on purpose — loading them over NFS is markedly slower than from local NVMe, so
centralising them would trade real speed for disk that is not scarce.

### Datasets vs attached sources — which do you want?

|  | `/datasets` | attached source (§ Data picker) |
|---|---|---|
| holds | files and directories | a live query endpoint |
| how you get it | already mounted, read-only | tick it at create; injects env |
| copies data? | the files are *stored* there | **no** — query runs server-side |
| good for | corpora, checkpoints, extracts | FinData and other warehouses |

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

## Limits

Per user, per site: **2 sandboxes**, **24h** TTL, **1 GPU** at home / **2** at
office. The home directory has no enforced quota today — the PVC size is a
label, not a ceiling — so be considerate: one user filling the array takes down
everyone's home at that site.

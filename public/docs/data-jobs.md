# Use your data in jobs

A **job** runs your code on Lumid's compute (a sandbox, FlowMesh or Lumilake) and names the data it
reads. You never copy data to the job and you never pick a machine: lum.id/data checks you may read
each source, works out **where the job should run so it sits next to the data**, and gives the job
a short-lived key that opens **only** the data it declared.

## What a job can read today

| Data | Where it lives | How a job names it | Jobs? |
|---|---|---|---|
| **Lumid Data** tables | On-prem at the home site, on the Lumid Data hub (data NAS) | `lumid-data://schema.table` | Yes |
| **Your sources**, and sources shared with you | Wherever the data is | `src://<id>` or `src://me/<name>` | Yes, if you own it or it's shared with you |
| **Uploaded files** | The home hub | `data://home/blobs/<sha256>` or `data://home/<prefix>/` | Yes |
| **Models** | Hugging Face, cached on the workers | `hf://org/model` | Yes |
| **Public APIs** | The internet | `ext://host` | Yes (each call is logged) |
| **FinData** | On-prem at the home site (FinData warehouse) | — | **Not yet.** Use [FinData SQL access](/studio/docs/findata-sql) |
| **LQT** data | On-prem at the home site, served via lumid.trade | — | **Not yet** |
| **NUS research data** (UKB, …) | NUS storage | — | **Not yet**, the NUS hub is coming |

Every table in **Studio → Data Warehouse → Catalog** shows *where it lives* and, if a job can read it,
the exact name to use, with a **Copy** button and **Start a job with it →**.

## Do I choose a hub or a site?

**No.** You name the data; the plan chooses where the job runs: next to the data, because moving
compute is cheap and moving data is not. A job that reads `lumid-data://…` runs at the home site and
reads over the local network.

If a job reads data that lives in **two different places**, the plan still runs it next to most of
the data and reads the rest across sites. A small cross-site read is fine. A large one (over
**256 MiB**) is refused, with the reason and the size, rather than quietly copied. Split the job, or
read less (filter by time, sample) and try again.

What you *can* choose is the **runtime**: `sandbox`, `flowmesh`, `lumilake`, or `auto`.

> **Runtimes today:** sandbox jobs run at the **home** and **office** sites. FlowMesh and Lumilake
> jobs plan normally, but **Run** reports that the runtime isn't updated for job-scoped data yet.
> That's the safe refusal: the job is never run with broader access than it declared.

## In Studio, step by step

1. **Data Warehouse → Catalog**, pick a table, click **Start a job with it →**. The Jobs tab opens with
   that table already in the job.
2. Fill in the rest. A minimal sandbox job:

   ```yaml
   app: my-analysis          # a label, so you can find your jobs later
   runtime: sandbox
   name: phenotype-check
   sources:
     - ref: lumid-data://ukb_demo.phenotype
   payload:                  # what the runtime should start
     name: phenotype-check
     cpu: 1
     memory_gi: 1
     ttl_hours: 1
   ```

3. **Check where it runs**: the plan card shows the site, how each source is reached (local network,
   tailnet, public), the bytes, and *why* this site won over the others.
4. **Run**. The job appears under *Your jobs* with its events: submitted, running, then finished, failed
   or cancelled.
5. **Cancel** any time. The job's key stops working at once, and the sandbox is removed within a few
   minutes.

## From code

Use your lum.id **personal access token** ([create one](/studio/account/tokens)):

```bash
# 1. Dry run: where would it run, and how is each source reached?
curl -s https://lum.id/data/jobs/v1/plan \
  -H "Authorization: Bearer $LUMID_PAT" -H "Content-Type: application/json" \
  -d '{"spec": {"app": "my-analysis", "runtime": "sandbox",
                "sources": [{"ref": "lumid-data://ukb_demo.phenotype"}],
                "payload": {"name": "phenotype-check", "cpu": 1, "memory_gi": 1, "ttl_hours": 1}}}'

# 2. Run it (the Idempotency-Key makes a retry safe: it never starts twice)
curl -s https://lum.id/data/jobs/v1/jobs \
  -H "Authorization: Bearer $LUMID_PAT" -H "Content-Type: application/json" \
  -H "Idempotency-Key: phenotype-check-1" \
  -d '{"spec": { ...same spec... }}'

# 3. Follow it, and cancel it
curl -s https://lum.id/data/jobs/v1/jobs/<job_id>/events -H "Authorization: Bearer $LUMID_PAT"
curl -s -X POST https://lum.id/data/jobs/v1/jobs/<job_id>/cancel -H "Authorization: Bearer $LUMID_PAT"
```

The full reference is at [lum.id/data/openapi.json](https://lum.id/data/openapi.json).

**From an agent**: the same verbs are MCP tools on `https://lum.id/data/mcp`: `jobs_sources`,
`jobs_plan`, `jobs_submit`, `jobs_status`, `jobs_events` and `jobs_cancel`.

## Inside your job

The job finds these in its environment:

| Variable | What it is |
|---|---|
| `LUMID_DATA_URL` | Where to read, already set to the route the plan chose (e.g. the local network at home) |
| `LUMID_DATA_TOKEN` | The job's key. Opens **only** the sources you declared, and dies when the job ends |
| `LUMID_JOB_ID` | This job |
| `LUMID_SRC_<NAME>_URL` | One per declared source, when a source has its own route |

```python
import os, requests
r = requests.post(os.environ["LUMID_DATA_URL"] + "/retrieve",
                  headers={"Authorization": "Bearer " + os.environ["LUMID_DATA_TOKEN"]},
                  json={"sql": "select * from ukb_demo.phenotype limit 100"}, timeout=60)
r.raise_for_status()
```

Reading a table you did **not** declare is refused (`source_not_in_job_scope`). Add it to `sources`
and run a new job.

## Sharing data with someone

1. **Jobs → Sources → Add source**: give it a name and the ref (`lumid-data://…`, `data://home/…`).
   It's private until you share it.
2. **Share** it with a person's lum.id user ID (they can copy theirs from the Sources panel), read or
   write.
3. They see it under **Shared with me** and use it as `src://<id>`.
4. **Withdraw** a share any time: their running jobs lose access within seconds.

## When something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| `estate_not_served` | That data isn't available to jobs yet (FinData, LQT, NUS) | Use the alternative in the table at the top |
| `source_not_entitled` | You don't own the source and it isn't shared with you | Ask the owner to share it |
| `source_not_found` | No source by that name or ID | Check the spelling, or **Shared with me** |
| `source_too_large_remote` | The job would copy too much data across sites | Read less, or split the job by site |
| `route_unavailable` | There's no working network path from a site that could run it | Try later, or a different runtime |
| `quota_exceeded` | You have too many jobs running or queued | Wait for some to finish, or cancel some |
| *"does not support job-scoped data"* | That runtime isn't updated for jobs yet | Use `runtime: sandbox` for now |
| `source_not_in_job_scope` (inside the job) | The job read something it didn't declare | Add it to `sources` |

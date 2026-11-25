# Use your data in workflows and jobs

You meet data at three moments: when you **look for it**, when you **set up a run** that reads it,
and when you **look at what the run produced**. This page walks through each one with a real
example, and says plainly what doesn't work yet.

Everything here was run end to end on 25 Nov 2026 as an ordinary (non-admin) account.

## 1. Find the data

Open **Studio → Data Warehouse → Catalog**. Pick a table and you get:

- **What's in it**: columns, a row estimate, a preview.
- **Where it lives**, in one line, e.g. *"On-prem at the home site: the Lumid Data hub on the data NAS."*
- **Who uses it**: the workflows that write it and the ones that read it, with how many rows and
  when. Recording started on 25 Nov, so older use isn't shown.

The catalog lists three stores today:

| Store | Where it lives | How a run reads it |
|---|---|---|
| **Lumid Data** | Home site, on the data NAS | By table name, e.g. `macro.treasury_rates` (below) |
| **FinData** | Home site, on the data NAS | Its own SQL access. See [FinData SQL access](/studio/docs/findata-sql) |
| **LQT data** | Home site, served from lumid.trade | Read-only browsing; runs can't read it yet |

Data at **NUS** (the arXiv corpus, UK Biobank) isn't in the catalog yet. See [§5](#5-not-there-yet).

## 2. Set up a run that reads it

Runs go to **Research Fleet**. Start one either way:

- **Workflow editor → Run**, which validates the graph first and then follows the run until it ends; or
- **Research Fleet → Jobs**, which lists every run you started from anywhere.

### Pick where it runs: Home or Office

The Run button has a **Run at** choice. Each site has its own machines, and the Lumid Data hub
is at **home**:

- **Home**: next to the data. Tables are read over the local network.
- **Office**: reads the same tables through `lum.id/data`, over the internet. That's fine for normal
  reads; pick Home when a run reads a lot.

You don't change anything in the graph to switch sites. The address of the data comes from the
site, not from your file.

### A Lumilake graph: name the table in SQL

A Lumilake compute graph reads warehouse data with a `DataRetrievalOp`. You write the SQL; the
table name is exactly what the catalog shows (`schema.table`):

```yaml
name: treasury-curve
inputs:
  Run: ["1"]
outputs:
  - name: rates
    ref: "Rates"
ops:
  - id: Rates
    op: DataRetrievalOp
    inputs: [Run]
    data_spec:
      type: lumid          # the Lumid Data hub at the site the run goes to
      mode: sql
      template: "SELECT * FROM macro.treasury_rates ORDER BY 1 DESC LIMIT 5"
      output_format: jsonl
```

Paste it into the workflow editor and press **Run**. At home it finishes in seconds.

### A FlowMesh graph: data comes in, the task doesn't go out

A FlowMesh `python` task runs in a sealed container with **no network**: it can't call
`lum.id/data`, or anything else. Give it data instead:

- **from an earlier step**: a Lumilake retrieval, or any upstream stage, passes its output in; or
- **as files** you uploaded to Lumid Data, listed under `blobs:` and mounted read-only.

### A sandbox: query it, or read files

In a [sandbox](/studio/docs/sandboxes), tick **Lumid Data** (or FinData) when you create it to
get a query endpoint. File datasets need nothing: they're under `/datasets`, read-only. Rule of
thumb: **if it's a table, query it; if it's a directory, mount it.**

## 3. See what it produced

- **Research Fleet → Jobs → Your runs** lists every run you started: status, the result, and for a
  failed run, the step that failed and its error. The workflow editor shows the same run while it
  goes.
- **A scheduled workflow's run page** has **Warehouse tables**: what that run wrote and read, each
  one a link into the catalog.
- **The catalog's "Who uses it"** shows which workflows keep a table up to date, and which depend on it.

## 4. From code

The same runs, without Studio, using your lum.id
[personal access token](/studio/account/tokens):

```bash
# Run the graph above at home (site: "office" for the office machines)
curl -s https://lum.id/api/v1/me/fleet/jobs \
  -H "Authorization: Bearer $LUMID_PAT" -H "Content-Type: application/json" \
  -d "$(jq -n --rawfile wf treasury-curve.yaml '{site: "home", name: "treasury-curve", workflow: $wf}')"

# Follow it, then read the result (the id looks like home:ll:req-…)
curl -s "https://lum.id/api/v1/me/fleet/jobs/<id>"              -H "Authorization: Bearer $LUMID_PAT"
curl -s "https://lum.id/api/v1/me/fleet/jobs/<id>?view=result"  -H "Authorization: Bearer $LUMID_PAT"
```

Add `"dry_run": true` to check a graph without running it.

**Sandbox jobs that name their data.** lum.id/data can also start a sandbox for you, given the
tables it may read (`lumid-data://schema.table`). It runs the sandbox next to the data and hands it
a key that opens only those tables. The API reference is at
[lum.id/data/openapi.json](https://lum.id/data/openapi.json) (`/jobs/v1/…`).

## 5. Not there yet

Said plainly, so you don't go looking:

| What | Today |
|---|---|
| **NUS data** (arXiv corpus, UK Biobank) | Not in the catalog. The arXiv corpus is being loaded into the NUS data hub so it can be browsed and queried like any other table. |
| **Reads by a Lumilake graph** | Lumilake reads with its own key, so under "Who uses it" they count as *another person reading*, not as you. |
| **Files a run wrote** | Shown in the run's result, but not browsable in the Data Warehouse. |
| **FlowMesh tasks reading the warehouse** | Not possible from inside a task (no network). Pass data in, as above. |
| **LQT data in a run** | Not yet. |

## When something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| *relation "…" does not exist* | The table name doesn't match the catalog | Copy `schema.table` from the catalog |
| *cannot tell the workflow format* | The file is neither a Lumilake graph (`ops:`) nor a FlowMesh one (`apiVersion`/`spec`) | Check the top of the file |
| *compute service returned 401* | The site didn't accept your sign-in | Sign in again; if it persists, report it |
| A FlowMesh task fails to fetch a URL | Tasks have no network | Pass the data in from an earlier step or as files |
| A run at office is slow on a big read | It reads the home hub over the internet | Run at Home |

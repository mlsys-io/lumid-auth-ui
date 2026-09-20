# FlowMesh SSH tasks

Get an interactive shell on a FlowMesh worker — a real container on a real GPU/CPU box, reachable
from your laptop with plain `ssh`.

> Every example below was exercised end-to-end on **2026-08-21** against the `office` and `home`
> sites. Substitute your own `lm_pat_live_*` PAT where shown.

---

## The surface

| | |
|---|---|
| Submit | `POST https://lum.id/fm/<site>/api/v1/workflows` — body is YAML, `Content-Type: text/plain` |
| Dry-run | `POST …/api/v1/workflows/validate` — same body, no resources consumed |
| Poll | `GET …/api/v1/tasks/<task_id>` |
| Logs | `GET …/api/v1/tasks/<task_id>/logs` |
| Stop | `POST …/api/v1/tasks/<task_id>/stop` |

`<site>` is `office` or `home`; omit it (`https://lum.id/fm/api/v1/…`) for the cloud mesh. Auth is
`Authorization: Bearer <lm_pat_live_…>` — **one lum.id PAT works on every site**, there is no
per-site mesh key.

Pick the site where the hardware is. `GET /fm/api/v1/nodes` returns every node across all three
sites, each tagged with its `site`.

---

## Quickstart

**1. Write the task.** Note the shape: a **task envelope**, not a `tasks:` list.

```yaml
apiVersion: flowmesh/v1
kind: Task
metadata:
  name: my-shell
spec:
  taskType: ssh
  accessMode: forward
  ttlSeconds: 900          # hard ceiling on the session
  idleTimeoutSeconds: 600  # reaped after this long with no traffic
  authorizedKeys:
    - "ssh-ed25519 AAAA... you@laptop"
```

**2. Submit it.**

```bash
curl -s -X POST https://lum.id/fm/office/api/v1/workflows \
  -H "Authorization: Bearer $LUMID_PAT" \
  -H "Content-Type: text/plain" \
  --data-binary @my-shell.yaml
```

```json
{"ok":true,"workflow_id":"wfl-…","count":1,
 "tasks":[{"task_id":"tsk-…","status":"DISPATCHED","assigned_worker":"wkr-20"}]}
```

**3. Read the connection hint** off the task (it appears a few seconds after dispatch):

```bash
curl -s -H "Authorization: Bearer $LUMID_PAT" \
  https://lum.id/fm/office/api/v1/tasks/$TASK_ID | jq '{host,port,directHost,directPort}'
```

```json
{ "host": "lum.id", "port": 32640, "directHost": "luyao0", "directPort": 32775 }
```

Use **`host`/`port`**. `directHost`/`directPort` are the worker-local address behind the relay and
are not reachable from outside that box.

**4. Connect.**

```bash
ssh -p 32640 flowmesh@lum.id
```

Add `-o ConnectionAttempts=3` in scripts — the load balancer needs a second or two to mark the
freshly-bound port healthy on the very first connect after a session is allocated.

---

## Access modes

`spec.accessMode` picks how you reach the session.

| Mode | Reach it with | Consumes a port? | Use when |
|---|---|---|---|
| **`forward`** | `ssh -p <port> flowmesh@lum.id` | yes, one per session | You want plain `ssh`, `scp`, `rsync`, port-forwarding — anything that expects a real TCP endpoint. |
| **`proxy`** | WebSocket, via a `ProxyCommand` | **no** | You need many concurrent sessions, or you are already speaking HTTP to the mesh. Not subject to the per-site session cap below. |
| **`direct`** | worker address, on-LAN only | n/a | You are already inside the site's network. |

### Forward mode — port allocation

Each site owns a **disjoint** range, and the port number is the same at every hop, so one number
follows your packet the whole way (`lum.id:P` → cloud → tailnet → site → the session):

| Site | Range | Concurrent forward sessions |
|---|---|---|
| cloud | `32032-32063` | 32 |
| office | `32640-32655` | 16 |
| home | `32672-32687` | 16 |

The on-prem sites are 16 wide because the shared edge load balancer accepts at most 100 frontends
in total, and that budget is platform-wide. **If you need more than 16 concurrent sessions at a
site, use `proxy` mode** — it multiplexes over the HTTP API and consumes no port at all.

### Proxy mode

Open a WebSocket to the task and you get the raw SSH stream — the first frame is the sshd banner:

```
wss://lum.id/fm/<site>/api/v1/ssh/tasks/<task_id>/proxy
Authorization: Bearer <lm_pat_live_…>
```

To use it with a normal `ssh` client, bridge stdio to that socket with a `ProxyCommand`. Save this
as `fm-ssh-proxy.py` (`pip install websockets`, `chmod +x`):

```python
#!/usr/bin/env python3
"""stdio <-> FlowMesh SSH proxy bridge. Use as an ssh ProxyCommand."""
import asyncio, os, sys, websockets

URL = sys.argv[1]
PAT = os.environ["LUMID_PAT"]

async def main():
    async with websockets.connect(URL, additional_headers={"Authorization": f"Bearer {PAT}"},
                                  max_size=None, ping_interval=20) as ws:
        loop = asyncio.get_running_loop()
        async def up():
            rd = asyncio.StreamReader()
            await loop.connect_read_pipe(lambda: asyncio.StreamReaderProtocol(rd), sys.stdin.buffer)
            while (b := await rd.read(65536)):
                await ws.send(b)
        async def down():
            async for m in ws:
                sys.stdout.buffer.write(m if isinstance(m, (bytes, bytearray)) else m.encode())
                sys.stdout.buffer.flush()
        await asyncio.gather(up(), down())

asyncio.run(main())
```

```bash
ssh -o "ProxyCommand=./fm-ssh-proxy.py wss://lum.id/fm/office/api/v1/ssh/tasks/$TASK_ID/proxy" \
    flowmesh@placeholder
```

The hostname is ignored — the ProxyCommand is the transport — so `placeholder` is fine. Pair it
with `-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null` for throwaway sessions, since
each session container has a fresh host key.

---

## Task spec reference

Everything under `spec` beyond `taskType: ssh`:

| Field | Notes |
|---|---|
| `accessMode` | `forward` \| `proxy` \| `direct` |
| `authorizedKeys[]` | Your **public** keys. Required — there is no password auth. |
| `image` | **Omit it unless you know the image ships an sshd.** The default image is SSH-ready. |
| `user` | Login user; defaults to `flowmesh`. |
| `ttlSeconds` | Hard lifetime. The session is killed at this point regardless of activity. |
| `idleTimeoutSeconds` | Reaped after this long with no traffic. |
| `command`, `entrypoint` | Override what runs alongside the shell. |
| `env`, `mounts`, `inputs`, `sshOutput` | Environment, volumes, staged inputs, captured output. |
| `resources` | CPU/memory/GPU request used to select a worker. |

Validate before submitting — it is free and catches schema errors immediately:

```bash
curl -s -X POST https://lum.id/fm/office/api/v1/workflows/validate \
  -H "Authorization: Bearer $LUMID_PAT" -H "Content-Type: text/plain" \
  --data-binary @my-shell.yaml
```

Stop a session as soon as you are done — it frees a port for the next person:

```bash
curl -s -X POST -H "Authorization: Bearer $LUMID_PAT" \
  https://lum.id/fm/office/api/v1/tasks/$TASK_ID/stop
```

---

## Data on a worker

A worker is **not** a sandbox, and the storage differs. Check before you plan around it:

| path | on a worker | on a sandbox |
|---|---|---|
| `/huggingface` | **yes** — node-local model cache, already warm | no |
| `/datasets` | **no** | yes, read-only |
| `/home/<you>` | **no** — nothing here survives the task | yes, network storage |

**Nothing you write in an SSH session survives it.** There is no persistent home on a worker.
Push results somewhere before the task ends — the task's own output destination, object storage,
or `scp` back to your laptop. A shell that ends takes its filesystem with it.

**Weights are already there.** `/huggingface` is the box's own cache, kept node-local because
loading over NFS is markedly slower than local NVMe. A model another task has pulled is warm for
yours.

**Query FinData; do not copy it.** It answers over HTTP from the worker's own site at LAN
latency — the query runs on the server and only your result comes back. The endpoint is
site-specific; the recipe, token scope and catalog paths are in
[Sandboxes](/studio/docs/sandboxes#5-data--query-it-do-not-copy-it), and are identical here.

If you need a persistent home, a read-only corpus, or `/datasets`, you want a **sandbox**, not an
SSH task.

---

## Your own image — `harbor.lum.id`

The default session image is SSH-ready: `ghcr.io/mlsys-io/flowmesh_ssh:<version>-cpu`
(or `-gpu`), login user `flowmesh`. It is deliberately minimal — **no `python3`, no
`nvcc`, no `curl`** — and you are **not root** in it, with no `sudo`, so `apt-get`
is not an option at runtime. Anything you need has to be in the image.

> A **sandbox** is the opposite: you are **root** there and `apt-get` works.
> If you mainly need a box to install things in, use a sandbox, not an SSH task.

### Build on top of the default

Pinning an arbitrary image fails as `Container … exited (code 0) before SSH became
ready`, because the executor expects an sshd plus an entrypoint honouring `SSH_USER`
and `AUTHORIZED_KEYS`. Inherit it instead of re-implementing it:

```dockerfile
FROM ghcr.io/mlsys-io/flowmesh_ssh:latest-gpu    # or :latest-cpu

USER root
RUN apt-get update && apt-get install -y --no-install-recommends       python3 python3-pip curl git  && rm -rf /var/lib/apt/lists/*

# Blackwell (sm_120) needs CUDA 12.8+/13.x wheels — cu121/cu124 builds report
# `no kernel image is available` while cuda.is_available() still returns True.
RUN pip3 install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cu130

USER flowmesh        # leave the login user as the executor expects
```

### Push it

```bash
# harbor.lum.id → sign in with your lum.id account → User Profile → CLI secret.
# OIDC accounts cannot docker login with a password; the CLI secret is the substitute.
docker login harbor.lum.id -u <you> -p <cli-secret>

docker build --platform=linux/amd64 -t harbor.lum.id/sandbox/my-ssh:v1 .
docker push harbor.lum.id/sandbox/my-ssh:v1
```

Then set `spec.image: harbor.lum.id/sandbox/my-ssh:v1`.

**The same reference works at every site** — each node rewrites `harbor.lum.id` to
its own site's registry, so the spec stays portable.

Two things that make a pull fail, both surfacing only as a pull error that names
neither cause:

- **For a WORKER the project must be public.** FlowMesh workers pull anonymously,
  so a private Harbor project fails exactly like a tag that does not exist.
  (Sandboxes on `home` are different — they get a per-user pull credential and
  can use private projects. That does not extend to workers.)
- **`linux/amd64`.** A wrong-arch image is a *valid* manifest that fails at exec,
  with a message that reads like a truncated download.

### `/dev/shm` and PyTorch

A session gets Docker's default **64 MB** `/dev/shm`, and
`DataLoader(num_workers>0)` exhausts that immediately — it dies as `Bus error`
(SIGBUS), which names no cause and reads like a driver fault. Until the worker
sets `--shm-size`, use `num_workers=0` in an SSH task.

**Sandboxes are already fixed** — `/dev/shm` there is half the pod's memory (8 GB
on a 16 GB box), and `DataLoader(num_workers=4)` is verified working.

---

## Troubleshooting

**`Container … exited (code 0) before SSH became ready`**
You pinned an `image` with no sshd in it — `ubuntu:22.04` fails exactly this way, because its
default command exits immediately. Drop the `image` field and use the default.

**`No worker satisfies the task hardware and capability requirements`**
No eligible worker at that site. Check `GET /fm/api/v1/nodes` and confirm the site you targeted
actually has workers, and that your `resources` block isn't asking for hardware the site lacks.

**`kex_exchange_identification: Connection closed by <ip>`**
The port accepted TCP but no session was behind it. Almost always a **stale hint** — the task was
stopped, hit its `ttlSeconds`, or was reaped for idleness. Re-read `host`/`port` from a live task.
Retry once with `-o ConnectionAttempts=3` before concluding anything; the first connect after a
session binds can race the load balancer's health check.

**WebSocket handshake returns `HTTP 403`**
In proxy mode, *every* failure path closes the socket before accepting it, and that renders as a
403 no matter the cause — bad token, unknown task, session not ready, relay unavailable. The status
code tells you nothing; read the task's logs instead.

**A forward-mode task never gets a `host`/`port`**
The port pool for that site is exhausted (16 on-prem, 32 cloud). Stop a session you are done with,
or switch that task to `proxy` mode.

---

## Related

- [Sandboxes](/studio/docs/sandboxes) — persistent home, `/datasets`, and the GPU tier rules

- **[Running jobs on the fleet](/studio/docs/compute)** — listing nodes and workers,
  submitting non-interactive workflows, the federated `/fm` surface.
- **[Operations runbook](/studio/docs/operations)** — what to do when a site looks unhealthy.

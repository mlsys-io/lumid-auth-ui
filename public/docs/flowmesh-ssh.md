# FlowMesh SSH tasks

Get an interactive shell on a FlowMesh worker — a real container on a real GPU/CPU box, reachable
from your laptop with plain `ssh`.

> Re-checked end-to-end on **2026-11-28** against FlowMesh **v0.1.15-rc.1**: forward mode on
> `home` and `office`, proxy mode on `home` and `nus`, and the `flowmesh` CLI on `home`.
> Substitute your own `lm_pat_live_*` PAT where shown.

---

## The surface

| | |
|---|---|
| Submit | `POST https://lum.id/fm/<site>/api/v1/workflows` — body is YAML, `Content-Type: text/plain` |
| Dry-run | `POST …/api/v1/workflows/validate` — same body, no resources consumed |
| Poll | `GET …/api/v1/tasks/<task_id>` — the connection hint is under `latest_update.ssh` |
| Logs | `GET …/api/v1/tasks/<task_id>/logs` |
| Stop (running) | `POST …/api/v1/tasks/<task_id>/stop` |
| Cancel (still queued) | `POST …/api/v1/workflows/<workflow_id>/cancel` |

`<site>` is `home`, `office` or `nus`; omit it (`https://lum.id/fm/api/v1/…`) for the cloud mesh.
Auth is `Authorization: Bearer <lm_pat_live_…>` — **one lum.id PAT works on every site**, there is
no per-site mesh key.

Pick the site where the hardware is. `GET /fm/api/v1/nodes` lists every node across all sites
(cloud, home, office, nus, and the rented `vast` pools), each tagged with its `site`.
`GET /fm/<site>/api/v1/workers` shows whether that site's workers are `IDLE` or `BUSY` — check it
first if you need a session now.

---

## Quickest: the `flowmesh` CLI

The CLI submits the task, waits for the session and connects you, in one command. It needs
**Python 3.12+**:

```bash
pip install flowmesh-cli                     # or: uv tool install --python 3.12 flowmesh-cli
export FLOWMESH_BASE_URL=https://lum.id/fm/home    # pick your site
export FLOWMESH_API_KEY=$LUMID_PAT

flowmesh ssh run --key ~/.ssh/id_ed25519.pub --ttl 3600        # interactive shell (proxy mode)
flowmesh ssh run --key ~/.ssh/id_ed25519.pub --command 'nvidia-smi' --logs   # run one command, print its output
flowmesh ssh connect <task_id>                                 # re-attach to a running session
```

`--mode proxy` is the default and works at every site; `--mode forward` gives a plain `lum.id`
port (see [Access modes](#access-modes)). `--gpu`, `--memory`, `--cpu` and `--image` choose the
worker and the session image.

The rest of this page does the same thing by hand over the REST API.

---

## Quickstart (REST)

**1. Write the task.** Note the shape: a **task envelope**, not a `tasks:` list.

```yaml
apiVersion: flowmesh/v1
kind: Task
metadata:
  name: my-shell
spec:
  taskType: ssh
  accessMode: forward      # omitted = "direct", which only works on the site's own LAN
  ttlSeconds: 900          # hard ceiling on the session
  idleTimeoutSeconds: 600  # reaped after this long with no traffic
  authorizedKeys:
    - "ssh-ed25519 AAAA... you@laptop"
```

**2. Submit it.**

```bash
curl -s -X POST https://lum.id/fm/home/api/v1/workflows \
  -H "Authorization: Bearer $LUMID_PAT" \
  -H "Content-Type: text/plain" \
  --data-binary @my-shell.yaml
```

```json
{"ok":true,"workflow_id":"wfl-…","count":1,
 "tasks":[{"task_id":"tsk-…","status":"PENDING","assigned_worker":null}]}
```

**3. Read the connection hint** — it appears under `latest_update.ssh` a few seconds after
dispatch (10 s in the 2026-11-28 run):

```bash
curl -s -H "Authorization: Bearer $LUMID_PAT" \
  https://lum.id/fm/home/api/v1/tasks/$TASK_ID | jq '.latest_update.ssh'
```

```json
{ "host": "lum.id", "port": 32672, "mode": "forward", "username": "flowmesh",
  "directHost": "luyaomini5.lan", "directPort": 32769,
  "expires_at": "2026-11-28T05:31:29Z", "session_id": "ssn-…", "workerId": "wkr-950" }
```

Use **`host`/`port`**. `directHost`/`directPort` are the worker-local address behind the relay and
are not reachable from outside that site. The task's own `status` stays `DISPATCHED` while the
session is up — that is normal; `expires_at` is when `ttlSeconds` ends it.

**4. Connect.**

```bash
ssh -p 32672 flowmesh@lum.id
```

Add `-o ConnectionAttempts=3` in scripts — the load balancer needs a second or two to mark the
freshly-bound port healthy on the very first connect after a session is allocated.

---

## Access modes

`spec.accessMode` picks how you reach the session. **When omitted it is `direct`.**

| Mode | Reach it with | Consumes a port? | Use when |
|---|---|---|---|
| **`forward`** | `ssh -p <port> flowmesh@lum.id` | yes, one per session | You want plain `ssh`, `scp`, `rsync`, port-forwarding — anything that expects a real TCP endpoint. |
| **`proxy`** | WebSocket, via a `ProxyCommand` | **no** | Every site, including NUS; many concurrent sessions; or you are already speaking HTTP to the mesh. |
| **`direct`** | worker address, on-LAN only | n/a | You are already inside the site's network. |

### Forward mode — port allocation

Each site owns a **disjoint** range, and the port number is the same at every hop, so one number
follows your packet the whole way (`lum.id:P` → cloud → tailnet → site → the session):

| Site | Range | Concurrent forward sessions |
|---|---|---|
| cloud | `32032-32047` | 16 |
| office | `32640-32655` | 16 |
| home | `32672-32687` | 16 |
| nus | — | **use `proxy`**: NUS has no public forward ports |

Every range is 16 wide because the shared edge load balancer accepts at most 100 frontends in
total, and that budget is platform-wide. **If you need more than 16 concurrent sessions at a
site, or you are on NUS, use `proxy` mode** — it goes over the HTTP API and consumes no port.

### Proxy mode

Open a WebSocket to the task and you get the raw SSH stream — the first frame is the sshd banner:

```
wss://lum.id/fm/<site>/api/v1/ssh/tasks/<task_id>/proxy
Authorization: Bearer <lm_pat_live_…>
```

The CLI does this for you (`flowmesh ssh connect`). To use a plain `ssh` client, bridge stdio to
that socket with a `ProxyCommand`. Save this as `fm-ssh-proxy.py` (`pip install websockets`,
`chmod +x`):

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
ssh -o "ProxyCommand=./fm-ssh-proxy.py wss://lum.id/fm/nus/api/v1/ssh/tasks/$TASK_ID/proxy" \
    flowmesh@placeholder
```

The hostname is ignored — the ProxyCommand is the transport — so `placeholder` is fine. Pair it
with `-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null` for throwaway sessions, since
each session container has a fresh host key. The proxy also works for a session submitted in
`forward` mode.

---

## Task spec reference

Everything under `spec` beyond `taskType: ssh`:

| Field | Notes |
|---|---|
| `accessMode` | `forward` \| `proxy` \| `direct` (default `direct`) |
| `authorizedKeys[]` | Your **public** keys. Required — there is no password auth. |
| `image` | **Omit it unless the image is built on the default** (below). The default image is SSH-ready. |
| `user` | Login user; defaults to `flowmesh`. |
| `ttlSeconds` | Hard lifetime, counted from when the session starts. |
| `idleTimeoutSeconds` | Reaped after this long with no traffic. |
| `interactive` | `false` with `command` runs that command and ends — no shell, no port (`flowmesh ssh run --command`). |
| `command`, `entrypoint` | What runs in the session (non-interactive mode). |
| `env`, `inputs`, `sshOutput` | Environment, staged inputs, captured output. |
| `resources` | CPU/memory/GPU request used to select a worker. |

Validate before submitting — it is free and catches schema errors immediately:

```bash
curl -s -X POST https://lum.id/fm/home/api/v1/workflows/validate \
  -H "Authorization: Bearer $LUMID_PAT" -H "Content-Type: text/plain" \
  --data-binary @my-shell.yaml
```

Stop a session as soon as you are done — it frees a worker and a port for the next person:

```bash
curl -s -X POST -H "Authorization: Bearer $LUMID_PAT" \
  https://lum.id/fm/home/api/v1/tasks/$TASK_ID/stop
```

`stop` only works on a session that has started. A task still waiting for a worker answers
`{"detail":"Task is not running"}` and stays queued — cancel its workflow instead:
`POST …/api/v1/workflows/$WORKFLOW_ID/cancel`.

---

## What a session gets

Each session is its **own container** next to the worker, with limits set per site:

| | home (minis) | office | nus |
|---|---|---|---|
| memory cap | 12 GiB | 37–38 GiB | 32 GiB, 8 CPUs |
| GPU | yes (one per mini) | yes | **no** — NUS workers are CPU-only |
| processes | 4096 | 4096 | 4096 |

`/dev/shm` is Docker's default **64 MB** everywhere (see [below](#devshm-and-pytorch)).

### Data in a session

A worker session is **not** a sandbox, and the storage differs. Check before you plan around it:

| path | in an SSH session | on a sandbox |
|---|---|---|
| `/home/flowmesh` | **scratch** — writable, gone when the session ends | `/home/<you>`, persistent network storage |
| `/huggingface` | **no** — the worker's model cache is not mounted into sessions | no |
| `/datasets` | **no** | yes, read-only |

**Nothing you write in an SSH session survives it.** Push results somewhere before the session
ends — the task's own output destination, object storage, or `scp` back to your laptop.

**Model weights are downloaded per session.** Plan for the download time, or bake a small model
into your own image.

**Query FinData; do not copy it.** It answers over HTTP from the worker's own site at LAN
latency — the query runs on the server and only your result comes back. The endpoint is
site-specific; the recipe, token scope and catalog paths are in
[Sandboxes](/studio/docs/sandboxes#5-data--query-it-do-not-copy-it), and are identical here.

If you need a persistent home, a read-only corpus, `/datasets`, or root, you want a **sandbox**,
not an SSH task.

---

## Your own image — `harbor.lum.id`

The default session image is SSH-ready: `ghcr.io/mlsys-io/flowmesh_ssh:<version>-cpu`
(or `-gpu`; today `v0.1.15-rc.1-*`), Ubuntu 24.04, login user `flowmesh`. It is deliberately
minimal — **no `python3`, no `pip`, no `nvcc`, no `curl`, no `git`** — and you are **not root**
in it, with no `sudo`, so `apt-get` is not an option at runtime. Anything you need has to be in
the image.

> A **sandbox** is the opposite: you are **root** there and `apt-get` works.
> If you mainly need a box to install things in, use a sandbox, not an SSH task.

### Build on top of the default

Pinning an arbitrary image fails as `Container … exited (code 0) before SSH became
ready`, because the executor expects an sshd plus an entrypoint honouring `SSH_USER`
and `AUTHORIZED_KEYS`. Inherit it instead of re-implementing it:

```dockerfile
FROM ghcr.io/mlsys-io/flowmesh_ssh:latest-gpu    # or :latest-cpu

USER root
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-pip curl git \
 && rm -rf /var/lib/apt/lists/*

# Blackwell (sm_120) needs CUDA 12.8+/13.x wheels — cu121/cu124 builds report
# `no kernel image is available` while cuda.is_available() still returns True.
RUN pip3 install --no-cache-dir --break-system-packages torch \
      --index-url https://download.pytorch.org/whl/cu130

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

Then set `spec.image: harbor.lum.id/sandbox/my-ssh:v1` (or `flowmesh ssh run --image …`).

**Push to Harbor only, and use the `harbor.lum.id` name everywhere.** Harbor at home is the
record. Office and NUS keep replicas that copy Harbor's **public** projects (on first pull, and
every 30 minutes), and every worker's Docker resolves `harbor.lum.id` to its own site's registry —
so an SSH task at office or NUS pulls over the site LAN, not the WAN, and keeps working when the
WAN is down. A tag pushed a moment ago is fetched by the replica on the first pull.

Two things that make a pull fail, both surfacing only as a pull error that names
neither cause:

- **The project must be public.** Workers and the site replicas pull anonymously, so a
  private Harbor project fails exactly like a tag that does not exist.
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

**The task stays `PENDING`**
Every worker at that site is busy — `GET /fm/<site>/api/v1/workers` shows them as `BUSY`. Wait,
pick another site, or cancel it with `POST …/workflows/<workflow_id>/cancel` (`stop` does not
cancel a queued task).

**`Container … exited (code 0) before SSH became ready`**
You pinned an `image` with no sshd in it — `ubuntu:22.04` fails exactly this way, because its
default command exits immediately. Drop the `image` field, or build on the default image.

**`No worker satisfies the task hardware and capability requirements`**
No eligible worker at that site. Check `GET /fm/api/v1/nodes` and confirm the site you targeted
actually has workers, and that your `resources` block isn't asking for hardware the site lacks
(NUS has no GPU workers).

**`kex_exchange_identification: Connection closed by <ip>`**
The port accepted TCP but no session was behind it. Almost always a **stale hint** — the task was
stopped, hit its `ttlSeconds`, or was reaped for idleness. Re-read `latest_update.ssh` from a live
task. Retry once with `-o ConnectionAttempts=3` before concluding anything; the first connect
after a session binds can race the load balancer's health check.

**WebSocket handshake returns `HTTP 403`**
In proxy mode, *every* failure path closes the socket before accepting it, and that renders as a
403 no matter the cause — bad token, unknown task, session not ready, relay unavailable. The status
code tells you nothing; read the task's logs instead.

**A forward-mode task never gets a `port`**
The port pool for that site is exhausted (16 per site). Stop a session you are done with, or use
`proxy` mode. On NUS, forward has no public ports at all — use `proxy`.

---

## Related

- **[Sandboxes](/studio/docs/sandboxes)** — persistent home, `/datasets`, root, and the GPU tier rules.
- **[Running jobs on the fleet](/studio/docs/compute)** — listing nodes and workers,
  submitting non-interactive workflows, the federated `/fm` surface.
- **[Operations runbook](/studio/docs/operations)** — what to do when a site looks unhealthy.

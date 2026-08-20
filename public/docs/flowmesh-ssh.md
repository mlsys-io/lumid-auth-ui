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

- **[FlowMesh & Lumilake queries](/studio/docs/fm-ll-queries)** — listing nodes and workers,
  submitting non-interactive workflows, the federated `/fm` surface.
- **[Operations runbook](/studio/docs/operations)** — what to do when a site looks unhealthy.

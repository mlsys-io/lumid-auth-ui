# Operations runbook — whole-stack health probe

The whole-stack operational health probe (`tools/opsagent/stack_check.py`) checks
**every** operational dimension of the Lumid + LQT stack on a cadence and emits a
single PASS/WARN/FAIL scorecard. It is the operator's stack-wide view; the narrower
LQT-bottomlines self-audit (`tools/superdogfood/check.py`, `docs/runbooks/superdogfood.md`)
is folded in here rather than duplicated.

**The copy that runs** is baked into the `opsagent` image from
`deploy_infra/docker/opsagent/lqt-tools/tools/opsagent/stack_check.py` (the LQT-repo copy lags it).
The `opsagent-sweep` CronJob in namespace `lumid` runs one full sweep every 15 minutes and writes
the rows to `obs.stack_check`. Dimension list re-checked against that copy on 2026-11-28.

```bash
set -a; . /proj/.env; set +a               # UPCLOUD_TOKEN, LQT_MAILBOX_PAT, …
export KUBECONFIG=~/.kube/uks-lumid-prod2.yaml
python3 tools/opsagent/stack_check.py            # human table (failing-first)
python3 tools/opsagent/stack_check.py --json     # JSON scorecard (contract below)
python3 tools/opsagent/stack_check.py --dimension infra
python3 tools/opsagent/stack_check.py --remediate   # DRY-RUN only (prints, no mutations)
python3 tools/opsagent/stack_check.py --list
```

Exit code: **0** (all PASS/SKIP), **1** (any WARN), **2** (any FAIL) — so it can gate
a scheduled loop or CI.

## Design contract

- **Each dimension is a function** returning a list of result dicts; `DIMENSIONS`
  maps `name → fn`; `main()` runs all (or one via `--dimension`), prints, exits.
- **Every check is defensive.** A raised exception becomes a `FAIL`/`SKIP` result
  with the exception text — a single broken check never crashes the whole run.
- **A missing surface is SKIP, not FAIL.** A check that needs a surface/PAT that
  does not exist yet reports `SKIP` with a pointer to what would make it live.
- **`--remediate` is a dry run unless `OPSAGENT_REMEDIATE_LIVE=1`.** It prints the `AUTO`
  actions it would take. The opsagent image sets that variable, so there it runs the
  allowlisted fixes. The allowlist holds one entry: a rollout restart of a not-Ready
  `lumid` deployment. Every other `AUTO` row is surfaced, not fixed.

### JSON scorecard shape (`--json`)

```json
{"results":[{"dimension":str,"check":str,"status":"PASS|WARN|FAIL|SKIP",
             "detail":str,"remediation":"AUTO|SURFACE|null","cadence":"15m|1h|deploy|daily",
             "priority":"P0|null"}],
 "summary":{"PASS":n,"WARN":n,"FAIL":n,"SKIP":n,"gate":"PASS|WARN|FAIL"},
 "remediations":[...],
 "generated_at":"<ISO8601>"}
```

`remediation`: `AUTO` = safe for a future `--remediate` to fix automatically;
`SURFACE` = human-gated (memo/task/page); `null` = nothing to do (PASS or a pure SKIP).
`priority: "P0"` pages a human even on a WARN. It is set only on conditions that cannot heal
on their own. `remediations` lists what `--remediate` did (applied, dry-run, or surfaced).

## Environment / credentials

All optional — a missing cred degrades the relevant checks to `SKIP` (never a crash).
`set -a; . /proj/.env; set +a` supplies most of them on the dev box.

| Var | Enables | Missing → |
|---|---|---|
| `LQT_MAILBOX_PAT` | LQT read endpoints, introspect, llm backends, privacy probe | those checks SKIP; `secrets` FAILs (probe's own cred) |
| `KUBECONFIG` (default `~/.kube/uks-lumid-prod2.yaml`) | `infra` (nodes/pods/argo) | `infra` SKIP with a `upctl kubernetes config` pointer |
| `UPCLOUD_TOKEN` | `bill` (upctl account/cost) | `bill` SKIP |
| `LQT_ADMIN_PAT` | `auth-stats`, loop-SLO (admin-gated) | those SKIP |
| `LQT_OPS_DISK_WARN_PCT` / `LQT_OPS_DISK_FAIL_PCT` | per-box disk thresholds (default 85 / 92) | defaults |
| `LQT_OPS_WATCHER_OWNER` / `LQT_OPS_WATCHER_BANK` | privacy-contract probe target | defaults (`a3f48236-personal` / `yao-personal-watcher`) |
| `LQT_OPS_GPU_TEMP_WARN_C` / `_FAIL_C` (and `_GB10` variants) | `gpu_thermal` thresholds (default 75 / 85 °C; GB10 85 / 92) | defaults |
| `LUMID_IDENTITY_BRIDGE_SECRET` | `claude_pool` (identity's internal pool-health surface) | `claude_pool` SKIP |
| `ONPREM_CRED_DIR` (default `/etc/onprem-k3s`) | `onprem_nodes` home/office k3s reads via site-mesh | that site SKIP |
| `LUYAOMINI_181_PASSWORD` | `dr` (backup logs on the dev box) | `dr` SKIP |
| `REGISTRY_REPLICAS`, `VAST_API_KEY` | `registry` replica digests, `vast` spend | those SKIP |

## The dimension → check → surface → threshold → remediation → cadence matrix

Remediation column: `AUTO` = safe to auto-fix (once `--remediate` is wired);
`SURFACE` = memo/task/page only.

### infra (UKS)
| Check | Surface / command | Threshold (PASS) | Remediation | Cadence |
|---|---|---|---|---|
| nodes / node-pressure | `kubectl top nodes` | readable; every node cpu% AND mem% < 90 | SURFACE (scale/investigate) | 15m |
| cpu-unaccounted | node CPU vs the sum of its pods | no node with CPU no pod accounts for (dind-hidden) | SURFACE, P0 | 15m |
| pods | `kubectl -n lumid get pods` | none not-Ready/Running (finished Job pods ignored; pods under 5 min old still starting) | SURFACE; **FAIL** on any CrashLoop | 15m |
| argo | `kubectl -n argocd get applications` | all `Synced` + `Healthy` | SURFACE; OutOfSync+Healthy = WARN, Degraded/Missing = FAIL | deploy |
| cronjobs | latest finished run + `lastSuccessfulTime` per CronJob | newest run succeeded and last success < 3× the schedule period (suspended ones skipped) | SURFACE | 15m |
| pvc | kubelet volume stats | every PVC < 85% (WARN ≥85, FAIL ≥95) | SURFACE (PVCs grow, never shrink) | 15m |
| nginx-cm | `lumid-landing` volumes | serves the newest `lumid-landing-nginx-v*` ConfigMap on every volume | SURFACE; mixed versions = FAIL | 15m |

### cloud (reachability)
| Check | Surface | Threshold | Remediation | Cadence |
|---|---|---|---|---|
| lumid.trade, lum.id | `curl` root | 2xx/3xx | SURFACE (edge/LB) | 15m |
| kv.run findata | `curl https://kv.run:5000` | 2xx/3xx | — (SKIP off dev box: kv.run raw ports are firewalled to the field/bastion net; findata liveness proven in `findata` dim) | 15m |
| field-boxes | `lumid.trade/lqt/resource-usage/host` freshness | snapshot < 30 min old per box | SURFACE (field-cd / box down) | 15m |

### dev (this box)
| Check | Surface | Threshold | Remediation | Cadence |
|---|---|---|---|---|
| disk | `df -h /` | < 85% (WARN ≥85, FAIL ≥92) | SURFACE (prune builds/images) | 15m |
| loadavg | `/proc/loadavg` ÷ ncpu | ratio < 2 (WARN >2, FAIL >4) | SURFACE (kill stray builds — see feedback_lqt_build_oversubscription) | 15m |

### data (LQT pathway — reuses `tools/superdogfood/check.py`)
| Check | Surface | Threshold | Remediation | Cadence |
|---|---|---|---|---|
| universe | `check_universe` → `/market/kalshi-active-instruments` | age < 2h AND live-book coverage > 0 | AUTO (publish `universe.refresh`) | 15m |

### freshness (signals — reuses `check_signals`, bottomline #11)
| Check | Surface | Threshold | Remediation | Cadence |
|---|---|---|---|---|
| signal:`<name>` | `/lqt/signals/:name` | fresh per producer cadence AND `score_ticks` in bounds | AUTO restart lagging bridge (WARN); SURFACE out-of-bounds producer bug (FAIL) | 15m |

### bottomlines (folds the full superdogfood scorecard)
| Check | Surface | Threshold | Remediation | Cadence |
|---|---|---|---|---|
| #9…#14, T*/P* rows | `python -m tools.superdogfood.check --json` | per-row (see `docs/runbooks/superdogfood.md`) | mirrors each row's remediation | 1h |

Shelling out (not re-importing) keeps this a faithful mirror of the exact scorecard
operators already run — a divergence between the two is itself a real signal.

### bill (UpCloud)
| Check | Surface | Threshold | Remediation | Cadence |
|---|---|---|---|---|
| upcloud-account | `upctl account show` | credits ≥ 40 USD (WARN <40, FAIL <10; ~$5.5/day burn) | SURFACE (top up) | daily |

### findata (lum.id/findata)
| Check | Surface | Threshold | Remediation | Cadence |
|---|---|---|---|---|
| health | `curl https://lum.id/findata/health` | 200 + `status:ok` | SURFACE | 15m |

Per-collector staleness is a best-effort follow-up (no public per-collector surface yet).

### llm (lum.id/llm)
| Check | Surface | Threshold | Remediation | Cadence |
|---|---|---|---|---|
| gateway | `curl https://lum.id/llm/health` | 2xx/3xx | SURFACE | 15m |
| backends | `GET /llm/v1/models` (Bearer) | ≥ 1 local model listed | SURFACE (worker box down / tailnet) | 15m |
| model:`<id>` | each id in the live `LUMID_LLM_BACKENDS` | present as a local backend | SURFACE (circuit open or peer down) | 15m |
| completion | one short chat completion on the default model | generates text | SURFACE, P0 | 15m |

### gpu_thermal (per-box GPU temperature)
| Check | Surface | Threshold | Remediation | Cadence |
|---|---|---|---|---|
| `<box>:temp` | `lumid.trade/lqt/resource-usage/gpu` | below 75 °C (WARN ≥75, FAIL ≥85; GB10 boxes 85 / 92); snapshot < 30 min old | SURFACE | 15m |

### resource (per-box disk pressure)
| Check | Surface | Threshold | Remediation | Cadence |
|---|---|---|---|---|
| `<box>:disk` | `lumid.trade/lqt/resource-usage/host` | disk% < 85 (WARN ≥85, FAIL ≥92) | SURFACE; the field reclaim (TRUNCATE/prune HOT window) is AUTO-gated behind disk pressure only — never on a box still actively emitting placeholder (fix code first). See the Dublin/Denmark disk incidents. | 15m |

### providers (venue feed liveness)
| Check | Surface | Threshold | Remediation | Cadence |
|---|---|---|---|---|
| venue_health | `/lqt/venue-health/<box>` for each field box (`obs.venue_health`) | every md-* feed connected | SURFACE | 15m |

`field-venue-telemetry` pushes one row per market-data container, so this covers whatever
feeds each box runs (Polymarket, Kalshi, Alpaca, Massive, PM-US). A row not refreshed in
30 min is a retired feed and is dropped, not reported as down. No rows at all → SKIP.

### auth (lum.id token authority)
| Check | Surface | Threshold | Remediation | Cadence |
|---|---|---|---|---|
| healthz | `curl https://lum.id/healthz` | 2xx/3xx (302 → login gate = up) | SURFACE (page) | 15m |
| introspect | `POST /oauth/introspect {token}` | `active:true` round-trip | SURFACE | 15m |
| jwks | `GET /.well-known/jwks.json` | ≥ 1 signing key | SURFACE | 15m |
| auth-stats | `GET /api/v1/admin/auth-stats` | no failed-login spike | SURFACE — SKIP without `LQT_ADMIN_PAT` | 15m |

### claude_pool + claude_proxy (lum.id/claude)
| Check | Surface | Threshold | Remediation | Cadence |
|---|---|---|---|---|
| refreshable / quarantined / at_risk:`<signal>` | identity's internal pool-health surface | pool healthy (servable ≥ floor); none quarantined. 0 refreshable = FAIL | SURFACE, P0 — a quarantined account needs a fresh `claude auth login` + re-add | 15m |
| replicas | `deploy/claude-proxy` | `spec.replicas` == `CLAUDE_PROXY_REPLICAS` | SURFACE, P0 | 15m |
| messages-stream | one streamed `/claude/v1/messages` turn on a non-Anthropic model | completes | SURFACE | 15m |

### xpcloud + loop SLO + privacy contract
| Check | Surface | Threshold | Remediation | Cadence |
|---|---|---|---|---|
| health | `curl https://xp.io/healthz` | 2xx/3xx | SURFACE | 15m |
| loop-slo | `GET /api/v1/admin/loops` | loops readable / not failing | SURFACE — SKIP without `LQT_ADMIN_PAT` | 1h |
| privacy-contract | `curl https://xp.io/api/v1/repos/<owner>/<watcher-bank>` | **MUST 404** (never published) | **SURFACE — any non-404 is a privacy breach → hard FAIL** | 1h |

### flowmesh + lumilake
| Check | Surface | Threshold | Remediation | Cadence |
|---|---|---|---|---|
| flowmesh-host / lumilake | `lum.id/{fm,ll}/healthz` | 2xx/3xx | SURFACE | 15m |

### onprem_nodes (node conditions, cloud + home + office)
| Check | Surface | Threshold | Remediation | Cadence |
|---|---|---|---|---|
| `<site>:<node>` | `GET /api/v1/nodes` (cloud via kubeconfig; home/office k3s via site-mesh) | Ready, no Disk/Memory/PID pressure | SURFACE, P0 — NotReady = FAIL; pressure = WARN (it does not clear on its own) | 15m |

### runmesh
| Check | Surface | Threshold | Remediation | Cadence |
|---|---|---|---|---|
| health | `curl https://runmesh.ai` | 2xx/3xx (301 → canonical redirect = up); **n8n excluded** | SURFACE | 15m |

### dns + reachability
| Check | Surface | Threshold | Remediation | Cadence |
|---|---|---|---|---|
| `<domain>` | `curl` each public domain through the edge | 2xx/3xx | SURFACE (DNS / edge / cert — see reference_spaceship_dns) | 15m |

Domains: `lum.id`, `xp.io`, `lumid.market`, `runmesh.ai`, `lumilake.ai`, `lumid.trade`.
`lumid.market` lapsed on 2026-10-14 (QuantArena moved to `lum.id/market`), so its row
FAILs until it is removed from the probe's list.

### registry (Harbor at home + the per-site replicas)
| Check | Surface | Threshold | Remediation | Cadence |
|---|---|---|---|---|
| harbor-home | `https://harbor.lum.id/v2/` | **401 or 200** — a 401 here is CORRECT, it means a working OCI registry demanding auth | SURFACE — Docker refuses a plain-HTTP registry, so a detached cert or a stale `kv.run` DDNS record breaks every push and pull, not just TLS | 15m |
| replication:`<site>` | canary digest vs `harbor.lum.id` | `Docker-Content-Digest` MATCHES the source | SURFACE — a replica that stops syncing still answers pulls; only the digest reveals it is serving stale images. SKIP (not FAIL) when the canary is simply absent: onDemand replicas populate on first pull | 1h |

Set `REGISTRY_REPLICAS=<name>=<base-url>,…` to enable the comparison; unset is a SKIP with a pointer.

### sandbox (the per-site SSH sandbox control surface)
| Check | Surface | Threshold | Remediation | Cadence |
|---|---|---|---|---|
| `<site>` | `/sbx/api/whoami` (home), `/sbx/<site>/api/whoami` (office, nus) | 401 or 2xx | SURFACE — a dead site must show as unreachable in the SiteStrip, never silently absent | 15m |
| docker/`<site>` | `docker.health` in that site's `/api/sandboxes` (fed by the sysbox-probe CronJob, every 10 min) | Docker-inside healthy on every sysbox node | SURFACE — SKIP where Docker mode is off or without `LQT_ADMIN_PAT` | 15m |

**Distinguish the two 401s by BODY, not status.** sandbox-control answers ~33 B of JSON; nginx's
admin gate answers ~179 B of HTML. Both mean healthy — home is public and app-gated, office and nus
are admin-gated at the edge. Only a 5xx or a timeout is a fault. cloud is deliberately absent: it is
the hub, not a site. vast uses FlowMesh SSH, not sandbox-control.

### ci (the NUS ARC runner farm)
| Check | Surface | Threshold | Remediation | Cadence |
|---|---|---|---|---|
| nus-runners | `kubectl -n arc-systems get pods` | every ARC listener Running | SURFACE — a DEPRECATED runner version fails SILENTLY: pods read Running, the listener says "assigned job", and the workflow sits queued forever with the reason ONLY in the runner pod's log | 1h |

SKIP without a NUS kubeconfig.

### vast (rented GPU spend)
| Check | Surface | Threshold | Remediation | Cadence |
|---|---|---|---|---|
| cost | vast `/api/v0/instances/` | fleet `dph_total` under `VAST_MAX_DPH_FLEET` (default $1.00/h) | **SURFACE, never AUTO** — destroying someone's live box is a human decision. Note a DELETE answering HTTP 200 with `{"success": false}` is a REJECTED destroy, not a completed one: parse the body, never the status | 15m |

SKIP without `VAST_API_KEY`.

### secrets (token/key validity)
| Check | Surface | Threshold | Remediation | Cadence |
|---|---|---|---|---|
| LQT_MAILBOX_PAT | `POST /oauth/introspect` | `active:true` | SURFACE (re-mint) | daily |
| cert-expiry | TLS handshake to each public domain | ≥ 21 days left (WARN <21, FAIL <7) | SURFACE — the `lb-cert-reconcile` CronJob renews the certs; this catches a renewal that stopped | daily |

### dr (backups)
| Check | Surface | Threshold | Remediation | Cadence |
|---|---|---|---|---|
| lqt-field-vault | vault log on the dev box | newest run < 36 h old, no `fail=N` | SURFACE — stale = FAIL | 1h |
| fleet-dr-synology, mirror-db-nas | job logs on the dev box | newest run < 30 h old, `rc=0` | SURFACE — stale = FAIL | 1h |
| pgbackrest/`<stanza>` | both stanzas on the data primary | newest backup < 30 h old | SURFACE — stale = FAIL | 1h |

### field_cd (the field-box reconciler)
| Check | Surface | Threshold | Remediation | Cadence |
|---|---|---|---|---|
| `<box>/manifest-pullable` | `/var/log/lqt-field-cd.log` on each field box | no `pull failed` (a manifest image that does not exist) | SURFACE — FAIL; it can never converge | 1h |
| `<box>/reconcile-churn` | same log, last 24 h | no container reconciled over and over | SURFACE — WARN | 1h |

### dogfood (qa-sentinel)
| Check | Surface | Threshold | Remediation | Cadence |
|---|---|---|---|---|
| qa-sentinel pulse / sweep | `lumid.trade/lqt/stack-check` history | last pulse < 6 h (FAIL > 12 h); last sweep < 26 h (FAIL > 50 h) | SURFACE — see `deploy_infra` `dogfood-runbook.md` | 15m |

## Live vs SKIP (what's real today, on the dev box with `/proj/.env`)

**Live (real PASS/WARN/FAIL):** infra (UKS via KUBECONFIG), cloud (lumid.trade / lum.id
/ field-box freshness), dev (disk / loadavg), data (universe), freshness (signals),
bottomlines (superdogfood fold), bill (UpCloud credits), findata, llm (gateway +
backends), resource (per-box disk), auth (healthz / introspect / jwks), xpcloud (health
+ privacy-contract), runmesh, dns+reachability (6 domains; `lumid.market` fails, see above),
secrets (PAT validity + cert expiry).

**Legitimately SKIP (surface/cred not present):**
- `providers/venue_health` — SKIP only when no field box has pushed venue telemetry.
- `bottomlines` #9/#12/#5/#14 — need the cold-SoR (181) or deploy-plane, not the data
  plane (honest SKIP per the superdogfood runbook, never faked green).
- `auth/auth-stats` + `xpcloud/loop-slo` — admin-gated; SKIP without `LQT_ADMIN_PAT`.
- `cloud/kv.run findata` — kv.run raw service ports (:5000/:5012) are firewalled to
  the field/bastion network; findata liveness is covered live via `findata`.
- `claude_pool`, `onprem_nodes`, `dr`, `registry` replication, `vast` — need a credential
  the in-cluster sweep has and the dev box may not (see the env table).

## Self-evolve (the loop, future)

1. **Cadence** (the `cadence` field): run freshness/reachability dimensions every 15m,
   the heavier folds hourly, argo/single-SHA on deploy, bill/secrets daily. Today the
   `opsagent-sweep` CronJob runs every dimension every 15 min; `cadence` is a label.
2. **Remediate** (`--remediate`): apply the `AUTO` rows only — each idempotent + logged.
   Live in the opsagent image for the one allowlisted fix (see the design contract);
   everything else is still surfaced.
3. **Surface**: a `SURFACE` WARN/FAIL → an inbox memo + task; a repeated one → escalate.
   Privacy-contract, integrity (#9/#12), and RLS FAILs page immediately, never auto-fix.

## Escalation

- WARN that self-clears next cycle → log only.
- WARN persisting > 3 cycles → inbox memo + task.
- Any **FAIL** on `auth`, `secrets`, `xpcloud/privacy-contract`, or a `bottomlines`
  integrity row (#9/#12) → page immediately (never auto-remediated).
- `argo` Degraded/Missing or a `dns+reachability` FAIL → the public surface is down;
  page.

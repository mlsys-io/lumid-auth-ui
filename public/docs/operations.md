# Operations runbook — whole-stack health probe

The whole-stack operational health probe (`tools/opsagent/stack_check.py`) checks
**every** operational dimension of the Lumid + LQT stack on a cadence and emits a
single PASS/WARN/FAIL scorecard. It is the operator's stack-wide view; the narrower
LQT-bottomlines self-audit (`tools/superdogfood/check.py`, `docs/runbooks/superdogfood.md`)
is folded in here rather than duplicated.

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
- **`--remediate` is parsed but inert this pass.** It only *prints* the `AUTO`
  actions it would take (`# TODO remediate` stubs in the code). No live mutation.

### JSON scorecard shape (`--json`)

```json
{"results":[{"dimension":str,"check":str,"status":"PASS|WARN|FAIL|SKIP",
             "detail":str,"remediation":"AUTO|SURFACE|null","cadence":"15m|1h|deploy|daily"}],
 "summary":{"PASS":n,"WARN":n,"FAIL":n,"SKIP":n,"gate":"PASS|WARN|FAIL"},
 "generated_at":"<ISO8601>"}
```

`remediation`: `AUTO` = safe for a future `--remediate` to fix automatically;
`SURFACE` = human-gated (memo/task/page); `null` = nothing to do (PASS or a pure SKIP).

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

## The dimension → check → surface → threshold → remediation → cadence matrix

Remediation column: `AUTO` = safe to auto-fix (once `--remediate` is wired);
`SURFACE` = memo/task/page only.

### infra (UKS)
| Check | Surface / command | Threshold (PASS) | Remediation | Cadence |
|---|---|---|---|---|
| node-pressure | `kubectl top nodes` | every node cpu% AND mem% < 90 | SURFACE (scale/investigate) | 15m |
| pods | `kubectl -n lumid get pods` | none not-Ready/Running (dead cronjob/e2e Error pods tolerated) | SURFACE; **FAIL** on any CrashLoop | 15m |
| argo | `kubectl -n argocd get applications` | all `Synced` + `Healthy` | SURFACE; OutOfSync+Healthy = WARN, Degraded/Missing = FAIL | deploy |

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
| backends | `GET /llm/v1/models` (Bearer) | ≥ 1 model listed | SURFACE (worker box down — luyao4 / tailnet) | 15m |

### resource (per-box disk pressure)
| Check | Surface | Threshold | Remediation | Cadence |
|---|---|---|---|---|
| `<box>:disk` | `lumid.trade/lqt/resource-usage/host` | disk% < 85 (WARN ≥85, FAIL ≥92) | SURFACE; the field reclaim (TRUNCATE/prune HOT window) is AUTO-gated behind disk pressure only — never on a box still actively emitting placeholder (fix code first). See the Dublin/Denmark disk incidents. | 15m |

### providers (venue feed liveness)
| Check | Surface | Threshold | Remediation | Cadence |
|---|---|---|---|---|
| venue_health | `obs.venue_health` (via `/lqt/signals/venue_health`) | per-venue fresh | AUTO restart feed | 15m |
| alpaca/massive/rpc | — | — | SURFACE — **unmonitored gap**; build `obs.venue_health` (Stream D) | 15m |

`obs.venue_health` currently returns `[]` (surface exists, not yet populated) → SKIP
with a pointer, not FAIL. Once populated, Polymarket/Kalshi liveness moves to live.

### auth (lum.id token authority)
| Check | Surface | Threshold | Remediation | Cadence |
|---|---|---|---|---|
| healthz | `curl https://lum.id/healthz` | 2xx/3xx (302 → login gate = up) | SURFACE (page) | 15m |
| introspect | `POST /oauth/introspect {token}` | `active:true` round-trip | SURFACE | 15m |
| jwks | `GET /.well-known/jwks.json` | ≥ 1 signing key | SURFACE | 15m |
| auth-stats | `GET /api/v1/admin/auth-stats` | no failed-login spike | SURFACE — SKIP without `LQT_ADMIN_PAT` | 15m |

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

### runmesh
| Check | Surface | Threshold | Remediation | Cadence |
|---|---|---|---|---|
| health | `curl https://runmesh.ai` | 2xx/3xx (301 → canonical redirect = up); **n8n excluded** | SURFACE | 15m |

### dns + reachability
| Check | Surface | Threshold | Remediation | Cadence |
|---|---|---|---|---|
| `<domain>` | `curl` each public domain through the edge | 2xx/3xx | SURFACE (DNS / edge / cert — see reference_spaceship_dns) | 15m |

Domains: `lum.id`, `xp.io`, `lumid.market`, `runmesh.ai`, `lumilake.ai`, `lumid.trade`.

### secrets (token/key validity)
| Check | Surface | Threshold | Remediation | Cadence |
|---|---|---|---|---|
| LQT_MAILBOX_PAT | `POST /oauth/introspect` | `active:true` | SURFACE (re-mint) | daily |
| cert-expiry | (separate surface) | — | SURFACE — not probed here; the `lb-cert-reconcile` CronJob owns TLS certs (`kubectl -n lumid get cronjob lb-cert-reconcile`) | daily |

## Live vs SKIP (what's real today, on the dev box with `/proj/.env`)

**Live (real PASS/WARN/FAIL):** infra (UKS via KUBECONFIG), cloud (lumid.trade / lum.id
/ field-box freshness), dev (disk / loadavg), data (universe), freshness (signals),
bottomlines (superdogfood fold), bill (UpCloud credits), findata, llm (gateway +
backends), resource (per-box disk), auth (healthz / introspect / jwks), xpcloud (health
+ privacy-contract), runmesh, dns+reachability (all 6 domains), secrets (PAT validity).

**Legitimately SKIP (surface/cred not present):**
- `providers/venue_health` + `alpaca/massive/rpc` — `obs.venue_health` exists but is
  empty; the provider-liveness telemetry isn't populated yet (**build it — Stream D**).
- `bottomlines` #9/#12/#5/#14 — need the cold-SoR (181) or deploy-plane, not the data
  plane (honest SKIP per the superdogfood runbook, never faked green).
- `auth/auth-stats` + `xpcloud/loop-slo` — admin-gated; SKIP without `LQT_ADMIN_PAT`.
- `cloud/kv.run findata` — kv.run raw service ports (:5000/:5012) are firewalled to
  the field/bastion network; findata liveness is covered live via `findata`.
- `secrets/cert-expiry` — owned by the `lb-cert-reconcile` CronJob, not this probe.

## Self-evolve (the loop, future)

1. **Cadence** (the `cadence` field): run freshness/reachability dimensions every 15m,
   the heavier folds hourly, argo/single-SHA on deploy, bill/secrets daily. Drive it
   from the lumid-scheduler or a CronJob.
2. **Remediate** (`--remediate`, once wired): apply the `AUTO` rows only — each
   idempotent + logged. Today it is a **dry run** (prints what it would do).
3. **Surface**: a `SURFACE` WARN/FAIL → an inbox memo + task; a repeated one → escalate.
   Privacy-contract, integrity (#9/#12), and RLS FAILs page immediately, never auto-fix.

## Escalation

- WARN that self-clears next cycle → log only.
- WARN persisting > 3 cycles → inbox memo + task.
- Any **FAIL** on `auth`, `secrets`, `xpcloud/privacy-contract`, or a `bottomlines`
  integrity row (#9/#12) → page immediately (never auto-remediated).
- `argo` Degraded/Missing or a `dns+reachability` FAIL → the public surface is down;
  page.

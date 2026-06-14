// Typed client for the new /api/v1/me/* surface on lumid-identity.
//
// All calls cross-origin from the xp.io/go bundle → lum.id; the CORS
// middleware on lumid-identity (handler/router.go::meCORS) allows the
// xp.io and lum.id origins with credentials. Browser auto-sends the
// `lm_session` cookie (Domain=.lum.id) so no manual auth header is
// needed when the user is signed in via the lum.id auth flow. For
// PAT-based auth (CLI parity), pass via `Authorization: Bearer …`.
//
// All responses follow the lumid-identity envelope:
//   { ret_code: number, message: string, data: any }
// We unwrap `.data` on success and throw on non-2xx or non-zero ret_code.

export const ME_BASE =
  // Vite-inlined env. In prod (lum.id deploy) and xp.io/go deploy both
  // call lum.id since that's where lumid-identity lives.
  (import.meta.env.VITE_ME_API_BASE as string | undefined) || "https://lum.id";

export class MeApiError extends Error {
  ret_code: number;
  status: number;
  constructor(status: number, ret_code: number, message: string) {
    super(message);
    this.name = "MeApiError";
    this.status = status;
    this.ret_code = ret_code;
  }
}

// In-flight dedup for GETs — the shell, top-strip, and chat empty-state all
// poll the same endpoints (listWorkflows / listDrafts) on the same intervals
// and refetch on the same chat→page events. Sharing one in-flight promise
// collapses concurrent duplicates into a single request.
const inflight = new Map<string, Promise<unknown>>();

// Short TTL micro-cache for the hot read-only AGGREGATES. In-flight dedup only
// collapses calls that temporally OVERLAP — but the shell, top-strip, empty-
// state and apps page each poll these on independent, staggered timers, so
// their requests almost never line up and dedup misses them. A tiny TTL
// coalesces that staggered fan-out into one request every few seconds, which
// is where the bulk of residual /me/* traffic (and 429 pressure) came from.
// Staleness is bounded to TTL_MS and these views already tolerate ~poll-
// interval lag; mutations bust the cache via clearMeCache() (wired to the
// chat→page refetch bus in useStudioRefetch), so a write reflects immediately.
// Stale-while-revalidate windows. Within FRESH_MS a read is served from cache
// with no network (collapses staggered pollers). Between FRESH and STALE the
// cached value is served INSTANTLY (so navigating away and back paints with no
// spinner) while a background revalidate refreshes the cache for the next read
// / poll. Past STALE we fetch fresh and await. Mutations bust everything via
// clearMeCache(). This is what makes every cached Studio page feel instant on
// re-navigation, not just the ones I special-cased.
const FRESH_MS = 4000;
const STALE_MS = 45000;
const ttlCache = new Map<string, { at: number; value: unknown }>();
function ttlCacheable(path: string): boolean {
  const base = path.split("?")[0];
  return (
    base === "/apps" ||
    base === "/workflows" ||
    base === "/drafts" ||
    base === "/loops/health" ||
    base === "/today" ||
    base === "/runs" ||
    base === "/knowledge/agents" ||
    base === "/agent/models" ||
    base === "/personas" ||
    base === "/agents"
  );
}
/** Drop all cached aggregate reads so the next call hits the network. Called
 *  on the studio:data bus after any chat-tool mutation. */
export function clearMeCache(): void {
  ttlCache.clear();
}

// Global 429 circuit breaker. The /me limiter is PER-SESSION; once a session
// crosses the limit, every one of the ~10 page pollers retrying independently
// turns a single trip into a self-sustaining storm (observed: 2700+ req in one
// window → permanent skeletons). Instead, the FIRST 429 puts ALL /me calls into
// a shared cooldown for Retry-After, so the client stops hammering and the
// server's window clears. cooldownUntil is an epoch-ms; 0 = open.
let cooldownUntil = 0;

// Kick a network fetch for `path`, store it in the cache, deduped by `inflight`.
function fetchAndCache<T>(method: string, path: string, body: unknown, cacheable: boolean): Promise<T> {
  const existing = inflight.get(path);
  if (existing) return existing as Promise<T>;
  const p = doCall<T>(method, path, body)
    .then((v) => {
      if (cacheable) ttlCache.set(path, { at: Date.now(), value: v });
      return v;
    })
    .finally(() => inflight.delete(path));
  inflight.set(path, p);
  return p;
}

function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (method === "GET" && body === undefined) {
    const cacheable = ttlCacheable(path);
    if (cacheable) {
      const hit = ttlCache.get(path);
      const age = hit ? Date.now() - hit.at : Infinity;
      if (hit && age < FRESH_MS) return Promise.resolve(hit.value as T); // fresh — no network
      if (hit && age < STALE_MS) {
        // Serve stale INSTANTLY; revalidate in the background (fire-and-forget,
        // deduped) so the cache + next poll are fresh.
        fetchAndCache<T>(method, path, body, true).catch(() => {});
        return Promise.resolve(hit.value as T);
      }
      // Cooling down from a 429 → serve last-known at any age instead of piling on.
      if (hit && Date.now() < cooldownUntil) return Promise.resolve(hit.value as T);
    }
    return fetchAndCache<T>(method, path, body, cacheable);
  }
  return doCall<T>(method, path, body);
}

async function doCall<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  // Already cooling down from a recent 429 — fail fast WITHOUT touching the
  // network. This is what breaks the storm: pollers that fire mid-cooldown
  // don't add load, so the server's window can clear.
  if (Date.now() < cooldownUntil) {
    throw new MeApiError(429, 1429, "rate limited — cooling down");
  }
  const headers: Record<string, string> = {};
  let payload: BodyInit | undefined;
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const r = await fetch(`${ME_BASE}/api/v1/me${path}`, {
    method,
    headers,
    body: payload,
    credentials: "include", // send lm_session cookie cross-origin
  });
  // On a 429, arm the SHARED cooldown for the server-advised Retry-After
  // (capped) and fail fast. We deliberately do NOT retry in-call — that's the
  // per-caller amplification that turned one trip into a sustained storm.
  if (r.status === 429) {
    const ra = parseInt(r.headers.get("Retry-After") || "", 10);
    const waitMs = Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 60000) : 5000;
    cooldownUntil = Date.now() + waitMs;
    throw new MeApiError(429, 1429, "too many requests");
  }
  let json: { ret_code?: number; message?: string; data?: T } = {};
  try {
    json = await r.json();
  } catch {
    /* empty / non-JSON body */
  }
  if (!r.ok || (json.ret_code !== undefined && json.ret_code !== 0)) {
    throw new MeApiError(r.status, json.ret_code ?? r.status, json.message ?? r.statusText);
  }
  return (json.data ?? ({} as T));
}

// ── Apps ─────────────────────────────────────────────────────────────────

// An app may declare an optional `ui:` block in its xpcloud.yaml to insert
// itself into the Studio sidebar and define a runtime-loaded UI surface.
export interface MeAppUiSidebar {
  show?: boolean;       // explicit on/off; omitted = shown (back-compat), false = hide entry
  label: string;
  icon?: string;        // lucide icon name (kebab-case); client maps to a component, default Boxes
  section?: string;     // sidebar group header; default "Apps"
  order?: number;       // sort within section
  badge_source?: "drafts" | "review" | "running" | "none" | string;
}
export interface MeAppUiSurface {
  markdown?: string;    // bundle-relative path to the surface doc (served via me.appUI)
  native?: string;      // reserved first-party registry key (bundle-internal only)
}
export interface MeAppUi {
  sidebar?: MeAppUiSidebar;
  surface?: MeAppUiSurface;            // default ("home") surface
  surfaces?: Record<string, string>;  // optional named markdowns: name → bundle-relative .md
}

export interface MeAppCard {
  name: string;
  has_manifest: boolean;
  has_xpcloud: boolean;
  has_user_overrides: boolean;
  tenant?: boolean;
  status?: "ready" | "installing" | "failed";
  error?: string;
  ui?: MeAppUi;
}

// Surface payload returned by me.appUI — either a markdown body to render,
// or a `native` registry key the first-party client resolves to a component.
export interface MeAppSurface {
  app: string;
  surface: string;
  path?: string;
  markdown?: string;
  native?: string;
  bytes?: number;
  truncated?: boolean;
  // Optional surface switcher (from xpcloud ui.nav) — ordered, param-free
  // surfaces the client renders as a tab bar so any surface is pickable.
  nav?: { surface: string; label?: string }[];
  // The app's TOP-LEVEL xpcloud `config:` map (edited via the Config button).
  // Native widgets take their defaults from here; directive bodies override.
  config?: Record<string, unknown>;
  // Structured page surfaces: format="page", `spec` is the raw page.yaml (the
  // EDITABLE source of truth — `markdown` above is its compiled output).
  format?: "page";
  spec?: string;
  // Optimistic-lock token: pass back as base_sha on PUT; the server 409s if
  // the file changed since this read (stale-buffer protection).
  sha?: string;
}

// /me/loops/health row — what /admin/loops surfaces, scoped to the
// caller's tenant in P2 (today: operator-shared apps for the dogfood
// phase). Each row is an *app* (kind=app), not a loop — the server
// already filters skill repos out so this is the right feed for the
// /app home list.
export interface MeAppHealth {
  app: string;
  kind: string;
  version: string;
  published: boolean;
  published_slug?: string;
  status: "in_sync" | "unpublished" | "behind" | "ahead" | "dirty" | string;
  local_has_git?: boolean;
  local_dirty_count?: number;
  remote_head?: string;
  strategies?: { name: string }[];
}

export interface MeIntentResult {
  intent_id: string;
  status: "pending" | "completed";
  intent?: Record<string, unknown>;
  result?: Record<string, unknown>;
}

export const me = {
  // Apps
  listApps: () => call<{ apps: MeAppCard[] }>("GET", "/apps"),
  gpuRentals: () => call<{ rentals: Array<Record<string, unknown>>; count: number }>("GET", "/gpu-rentals"),
  installApp: (slug: string, runtime: "local" | "cloud" = "local", as?: string, opts?: { sidebar_show?: boolean; sidebar_label?: string; sidebar_section?: string }) =>
    call<{ intent_id: string; status: "pending" }>("POST", "/apps", { slug, runtime, as, ...opts }),
  uninstallApp: (app: string) =>
    call<{ intent_id: string; status: "pending" }>("DELETE", `/apps/${encodeURIComponent(app)}`),
  // Permanently remove a failed/optimistic install card (deletes the
  // underlying install intent for this app name — caller-scoped).
  deleteInstallIntent: (name: string) =>
    call<{ removed: number }>("DELETE", `/install-intents/${encodeURIComponent(name)}`),
  // App-declared UI surface (markdown body or native registry key).
  appUI: (app: string, surface?: string) =>
    call<MeAppSurface>(
      "GET",
      `/apps/${encodeURIComponent(app)}/ui${surface ? "/" + encodeURIComponent(surface) : ""}`,
    ),
  // Read the raw xpcloud.yaml for an installed app. `sha` feeds the PUT's
  // optimistic lock (base_sha) so a stale buffer can't clobber other edits.
  appConfig: (app: string) =>
    call<{ app: string; yaml: string; bytes: number; sha?: string }>("GET", `/apps/${encodeURIComponent(app)}/config`),
  // Write xpcloud.yaml — server validates YAML; 409 (ret_code 1409) when the
  // file changed since the read that produced baseSha.
  updateAppConfig: (app: string, yaml: string, baseSha?: string) =>
    call<{ ok: boolean; bytes: number; sha?: string }>("PUT", `/apps/${encodeURIComponent(app)}/config`, { yaml, base_sha: baseSha }),
  // Write a surface for an installed app: `markdown` for .md surfaces, `spec`
  // (raw page.yaml text, compiler-validated server-side) for structured page
  // surfaces. baseSha = optimistic lock. For @fork_of / @shared paths the
  // server writes a local override and patches xpcloud.yaml.
  updateAppUI: (
    app: string,
    surface: string | undefined,
    payload: { markdown?: string; spec?: string; baseSha?: string },
  ) =>
    call<{ ok: boolean; path: string; bytes: number; sha?: string; format?: "page" }>(
      "PUT",
      `/apps/${encodeURIComponent(app)}/ui${surface ? "/" + encodeURIComponent(surface) : ""}`,
      { markdown: payload.markdown, spec: payload.spec, base_sha: payload.baseSha, surface },
    ),
  generateAppUI: (app: string) =>
    call<{ markdown: string; path: string }>("POST", `/apps/${encodeURIComponent(app)}/ui/generate`),
  deleteLoop: (app: string, loop: string) =>
    call<{ app: string; removed_loop: string; remaining: number; note: string }>(
      "DELETE", `/apps/${encodeURIComponent(app)}/loops/${encodeURIComponent(loop)}`),
  getIntent: (id: string) =>
    call<MeIntentResult>("GET", `/intents/${encodeURIComponent(id)}`),
  // Kind-aware marketplace actions — skills are IMPORTED by apps (not
  // installed standalone); knowledge agents are SUBSCRIBED into the KG.
  addSkillToApp: (app: string, skillRepo: string, version?: string) =>
    call<{ intent_id: string; status: "pending" }>(
      "POST", `/apps/${encodeURIComponent(app)}/skills`, { skill_repo: skillRepo, version }),
  subscribeBank: (sourceSlug: string, targetAgentId?: string) =>
    call<{ intent_id: string; status: "pending" }>(
      "POST", "/knowledge/subscriptions", { source_slug: sourceSlug, target_agent_id: targetAgentId }),

  // Loops
  patchLoop: (
    app: string,
    loop: string,
    body: { runtime?: "local" | "cloud"; schedule?: string; enabled?: boolean },
  ) =>
    call<{ app: string; loop: string; overrides: Record<string, unknown> }>(
      "PATCH",
      `/loops/${encodeURIComponent(app)}/${encodeURIComponent(loop)}`,
      body,
    ),
  runLoopNow: (app: string, loop: string, args?: Record<string, unknown>) =>
    call<{ job_id: string; state: string }>(
      "POST",
      `/loops/${encodeURIComponent(app)}/${encodeURIComponent(loop)}/run`,
      { args },
    ),
  loopsHealth: () => call<{ apps: MeAppHealth[] }>("GET", "/loops/health"),

  // Workstream E — skills as a first-class surface.
  // Workstream F — cross-app experiments aggregate.
  experimentsAll: () => call<{ experiments: Array<MeExperiment & { app: string }>; count: number }>("GET", "/experiments"),
  // Offer lifecycle rides the generic cycle-feedback writer.
  cycleFeedback: (body: { app: string; loop: string; cycle_ts: string; output_id?: string; kind: string; note?: string; label?: string }) =>
    call<Record<string, unknown>>("POST", "/cycles/feedback", body),

  skills: () => call<{ skills: MeSkillRow[]; count: number }>("GET", "/skills"),
  skillsDiscover: () => call<{ cards: MeSkillCard[] }>("GET", "/skills/discover"),
  skillDetail: (owner: string, name: string) =>
    call<{ repo: string; meta?: Record<string, unknown>; lineage?: Record<string, unknown>; readme?: string }>(
      "GET", `/skills/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`),

  // Today summary — drives the /app/loops "Today" section.
  // headlines[] is server-authored (quota_paused → drafts → brief →
  // cycle_failed); cycles[] is the raw per-loop journal slice for
  // anyone who wants to dig in.
  today: () =>
    call<{
      headlines: Array<{
        kind: "drafts" | "quota_paused" | "brief" | "cycle_failed" | "cycle_ok";
        app?: string;
        loop?: string;
        ts?: string;
        summary: string;
        detail?: string;
      }>;
      cycles: Array<{
        app: string;
        loop: string;
        ok: boolean;
        ts: string;
        duration_s?: number;
        skipped?: boolean;
        skip_reason?: string;
        last_error?: string;
        // Workstream C — the cycle's honest outcome + queue counts,
        // mirrored from summary.* into the journal. All optional so old
        // cycles render without them.
        outcome?: "ran" | "no_change" | "awaiting_review" | "no_setup";
        review_count?: number;
        offers_count?: number;
      }>;
      as_of: string;
    }>("GET", "/today"),

  // ── Review queue (human checkpoint) ─────────────────────────────
  // Each held item in summary.review_queue awaits a human decision
  // before the engine continues. The reply rides the same approve/edit
  // path the inbox/draft machinery uses; the backend consumes:
  //   - {decision: "approve"}                  — release the held item
  //   - {decision: "edit", planned_kwargs}     — release with edits
  //   - {decision: "revamp", step_instructions}— free-text "adjust the
  //                                               next run" instruction
  // Keyed by the item's outbox_ref so the engine can match it back to
  // the held step. step_id is sent for journaling.
  replyReview: (
    app: string,
    loop: string,
    ts: string,
    body: {
      outbox_ref: string;
      step_id?: string;
      decision: "approve" | "edit" | "revamp";
      planned_kwargs?: Record<string, unknown>;
      step_instructions?: string;
    },
  ) =>
    call<{ outbox_ref: string; decision: string; state: string }>(
      "POST",
      `/cycles/${encodeURIComponent(app)}/${encodeURIComponent(loop)}/${encodeURIComponent(ts)}/review`,
      body,
    ),

  // Drafts queue
  listDrafts: (params?: { app?: string; state?: "pending" | "sent" | "dismissed" }) =>
    call<{
      drafts: Array<{
        id: string;
        app: string;
        cycle_ts: string;
        path: string;
        to?: string;
        subject?: string;
        body?: string;
        confidence?: number;
        state: "pending" | "sent" | "dismissed";
        acted_at?: string;
      }>;
      count: number;
    }>(
      "GET",
      "/drafts" +
        (params
          ? "?" +
            new URLSearchParams(
              Object.entries(params).filter(([, v]) => v != null) as [string, string][],
            ).toString()
          : ""),
    ),
  sendDraft: (id: string, ifState?: string) =>
    call<{ id: string; state: "sent"; intent_id: string }>(
      "POST",
      `/drafts/${encodeURIComponent(id)}/send`,
      ifState ? { if_state: ifState } : {},
    ),
  editDraft: (id: string, body: { subject?: string; body?: string; if_state?: string }) =>
    call<{ id: string; state: "pending" }>(
      "POST",
      `/drafts/${encodeURIComponent(id)}/edit`,
      body,
    ),
  dismissDraft: (id: string, ifState?: string) =>
    call<{ id: string; state: "dismissed" }>(
      "POST",
      `/drafts/${encodeURIComponent(id)}/dismiss`,
      ifState ? { if_state: ifState } : {},
    ),

  // Secrets — values never come back; only presence.
  listSecrets: (app: string) =>
    call<{ app: string; secrets: { key: string; is_set: boolean; updated_at: string }[] }>(
      "GET",
      `/apps/${encodeURIComponent(app)}/secrets`,
    ),
  putSecret: (app: string, key: string, value: string) =>
    call<{ app: string; key: string; is_set: true; updated_at: string }>(
      "PUT",
      `/apps/${encodeURIComponent(app)}/secrets/${encodeURIComponent(key)}`,
      { value },
    ),
  deleteSecret: (app: string, key: string) =>
    call<{ app: string; key: string }>(
      "DELETE",
      `/apps/${encodeURIComponent(app)}/secrets/${encodeURIComponent(key)}`,
    ),

  // ── Workflow surface (W1) ───────────────────────────────────────
  // Workflow = supertype across xpio scheduled loops + n8n visual
  // DAGs. The kind field disambiguates; the rest of the schema is
  // shared. Backed by /me/workflows + /me/runs aggregators.
  listWorkflows: (kind?: "scheduled" | "visual") =>
    call<{ workflows: MeWorkflowRow[]; count: number; as_of: string }>(
      "GET",
      kind ? `/workflows?kind=${kind}` : "/workflows",
    ),
  workflowDetail: (slug: string) =>
    call<MeWorkflowDetail>(
      "GET",
      `/workflows/${encodeURIComponent(slug)}`,
    ),

  // Direct compose for the composer wizard — instant draft spec, no chat LLM.
  composeWorkflow: (intent: string, name?: string) =>
    call<Record<string, unknown>>("POST", "/workflows/compose", { intent, name }),

  listRuns: (params?: {
    state?: string;
    workflow?: string;
    since?: string;
    until?: string;
    limit?: number;
    cursor?: string;
  }) => {
    const qs = new URLSearchParams();
    if (params?.state) qs.set("state", params.state);
    if (params?.workflow) qs.set("workflow", params.workflow);
    if (params?.since) qs.set("since", params.since);
    if (params?.until) qs.set("until", params.until);
    if (params?.limit !== undefined) qs.set("limit", String(params.limit));
    if (params?.cursor) qs.set("cursor", params.cursor);
    const q = qs.toString();
    return call<{
      runs: MeRunRow[];
      count: number;
      total: number;
      next_cursor: string;
      as_of: string;
    }>("GET", q ? `/runs?${q}` : "/runs");
  },
  runDetail: (runId: string) =>
    call<MeRunDetail>("GET", `/runs/${encodeURIComponent(runId)}`),
  runMark: (runId: string, state: "succeeded" | "failed", note?: string) =>
    call<{ run_id: string; new_state: string; note: string }>(
      "POST",
      `/runs/${encodeURIComponent(runId)}/mark`,
      { state, note },
    ),

  // ── Mind / Improve surface (W4) ─────────────────────────────────
  // Reads existing usage_events + journal + draft state to produce
  // plain-English deltas for one workflow.
  mindWorkflow: (slug: string) =>
    call<{
      slug: string;
      app: string;
      loop: string;
      this_month: MeMindStats;
      prev_month: MeMindStats;
      deltas: Array<{ headline: string; detail?: string; trend: "up" | "down" | "flat" }>;
      as_of: string;
    }>("GET", `/mind/workflow/${encodeURIComponent(slug)}`),
  mindEvaluate: (skill_name: string, for_app: string) =>
    call<{ queued: boolean; skill: string; for_app: string; note: string }>(
      "POST",
      "/mind/evaluate",
      { skill_name, for_app },
    ),

  // ── Cycle detail (per-dot drill-in) ─────────────────────────────
  // One cycle's full record: summary (outcome, observe-gate, offers,
  // review queue) + staged steps. Keyed by the cycle dir-id carried in
  // MeWorkflowRow.runs_recent[].ts — that's what makes sparkline dots
  // addressable.
  cycleDetail: (app: string, loop: string, ts: string) =>
    call<MeCycleDetail>(
      "GET",
      `/cycles/${encodeURIComponent(app)}/${encodeURIComponent(loop)}/${encodeURIComponent(ts)}`,
    ),

  // ── Dataset / casebook explorer ─────────────────────────────────
  appDatasets: (app: string) =>
    call<{ app: string; datasets: MeDatasetGroup[]; count: number }>(
      "GET",
      `/apps/${encodeURIComponent(app)}/datasets`,
    ),
  appDatasetFile: (app: string, path: string) =>
    call<MeDatasetFile>(
      "GET",
      `/apps/${encodeURIComponent(app)}/dataset-file?path=${encodeURIComponent(path)}`,
    ),

  // Goal-metric trajectory across cycles (improvement over iterations).
  // `events` maps a cycle dir-id → a discrete event (learn|fix|bug|analyze)
  // for the curve overlay.
  // Experiments — hypothesis × variants × dataset/casebook × metric.
  experiments: (app: string) =>
    call<{ experiments: MeExperiment[]; count: number }>(
      "GET", `/apps/${encodeURIComponent(app)}/experiments`),
  experiment: (app: string, id: string) =>
    call<MeExperimentDetail>(
      "GET", `/apps/${encodeURIComponent(app)}/experiments/${encodeURIComponent(id)}`),
  experimentCase: (app: string, id: string, caseId: string) =>
    call<{ case_id: string; rows: MeExperimentRow[]; latest_by_question: Record<string, { ts: string; metrics: Record<string, number> }> }>(
      "GET", `/apps/${encodeURIComponent(app)}/experiments/${encodeURIComponent(id)}/case/${encodeURIComponent(caseId)}`),
  loopMetricSeries: (app: string, loop: string) =>
    call<{ app: string; loop: string; series: MeMetricSeries[]; events: Record<string, string> }>(
      "GET",
      `/apps/${encodeURIComponent(app)}/loops/${encodeURIComponent(loop)}/metric-series`,
    ),
  mindSkills: (compare: string) =>
    call<{
      skill: string;
      rows: Array<{
        ts: string;
        skill: string;
        version: string;
        model: string;
        casebook: string;
        score: number;
        latency_s: number;
        cost_cents: number;
        sample_size?: number;
      }>;
      count: number;
      as_of: string;
    }>("GET", `/mind/skills?compare=${encodeURIComponent(compare)}`),
};

export interface MeMindStats {
  run_count: number;
  success_count: number;
  failure_count: number;
  skipped_count: number;
  success_rate: number;
  avg_duration_s: number;
  drafts_created?: number;
  drafts_accepted?: number;
  draft_accept_rate?: number;
}

// Workflow + run typed shapes (matches lumid_identity/internal/handler).
export interface MeWorkflowRow {
  slug: string;
  kind: "scheduled" | "visual";
  name: string;
  app?: string;
  trigger: string;
  enabled: boolean;
  tenant: boolean;
  showcase?: boolean;
  last_run_ts?: number;
  last_run_ok?: boolean;
  next_run_ts?: number;
  description?: string;
  engine?: string;
  step_count?: number;
  n8n_id?: string;
  // Sparkline char-encoding: "o"=succeeded, "x"=failed, "_"=skipped,
  // "."=running. Oldest→newest, max 14 chars.
  run_spark?: string;
  // Month-to-date server-funded cost in cents. 0/undefined when the
  // workflow has logged no usage_events this month.
  cost_cents_mtd?: number;
  // True when a cycle is in-progress right now (newest cycle dir newer
  // than the last completed journal entry). Drives the live "running"
  // indicator so long loops don't look frozen.
  running?: boolean;
  // True when the last run succeeded only via a retry/fallback (self-healed).
  // Dashboard shows an amber dot — flaky-but-recovering, not clean green.
  last_run_recovered?: boolean;
  // Per-dot addressing for the sparkline — one entry per run_spark char,
  // SAME order (oldest→newest). Lets each dot open its cycle detail. `ts`
  // is the cycle dir-id ("" if no cycle dir matched, e.g. a skipped run).
  runs_recent?: SparkRun[];
  // experiments this workflow feeds (steps[].experiment / engine.experiment)
  experiment_ids?: string[];
  // The loop's declared objective (xpcloud.yaml loops[].goal) — what it's
  // chasing + the metrics it tracks. Drives the app-overview goal header.
  goal?: { primary: string; tracked?: string[] };
  // Dataset ids/refs the loop runs against (xpcloud.yaml loops[].datasets).
  datasets?: string[];
  // The app's knowledge agents (top-level memory_agents + roles[].memory_agent).
  // Powers the learning-history timeline. App-level, repeated on each loop row.
  memory_agents?: string[];
}

// Goal-metric trajectory (GET /me/apps/:app/loops/:loop/metric-series).
export interface MeMetricSeries { label: string; points: Array<{ ts: string; v: number }> }

// ── Experiments (xpio opinion) ──────────────────────────────────────
export interface MeExperimentVariantAgg { n: number; mean: number; stdev?: number | null; last?: number }
export interface MeExperiment {
  id: string; hypothesis: string; kind: "explore" | "arms" | "regression";
  status: string; dataset_id?: string;
  metric?: { name: string; higher_is_better?: boolean; source?: string };
  metric_name?: string; benchmark_id?: string; baseline?: unknown;
  success_criteria?: string; min_samples?: number; loops?: string[];
  n_results: number; variants?: Record<string, MeExperimentVariantAgg>;
  best_variant?: string | null; baseline_value?: number | null;
  delta?: number | null; delta_pp?: number | null;
  criteria_met: boolean; criteria_reason?: string; verdict?: string;
  higher_is_better?: boolean; updated_at?: string;
}
export interface MeExperimentRow {
  ts: string; cycle_ts?: string; variant_id: string;
  metrics: Record<string, number>; dims?: Record<string, string>; n?: number;
}
export interface MeExperimentCase {
  case_id: string; n: number; latest: number; mean: number;
  delta_vs_prev?: number; points: Array<{ ts: string; v: number }>;
}
export interface MeExperimentDetail extends MeExperiment {
  state?: Record<string, unknown>;
  results: MeExperimentRow[];
  series: Array<{ variant_id: string; points: Array<{ ts: string; v: number }> }>;
  cases: MeExperimentCase[];
}

// Dataset explorer shapes (GET /me/apps/:app/datasets + /dataset-file).
export interface MeDatasetFileRef { path: string; name: string; bytes: number; kind: string }
export interface MeDatasetGroup { group: string; label: string; files: MeDatasetFileRef[] }
export interface MeDatasetFile { app: string; path: string; name: string; kind: string; bytes: number; truncated: boolean; content: string }

// One addressable dot in a workflow's run sparkline.
export interface SparkRun {
  ts: string; // cycle dir-id (→ me.cycleDetail), "" when unmatched
  st: string; // state char: o|r|x|_|.  (mirrors run_spark)
}

// Cycle detail (GET /me/cycles/:app/:loop/:ts) — the per-dot drill-in.
// summary.* mirrors the cycle/journal contract (also typed locally in
// inspector.tsx); kept loose here so the CycleCard can read what it needs.
export interface MeCycleStep {
  step_id: string;
  skill?: string;
  stage?: string;
  ok: boolean;
  output_summary?: string;
  // Full output dict + prompt audit — the server has always sent these
  // (me_cycle.go); the type lagged the payload. The canvas step
  // inspector renders them.
  output?: Record<string, unknown>;
  prompt_sha?: string;
  prompt_preview?: string;
  error?: string;
  duration_s?: number;
}
export interface MeCycleDetail {
  app: string;
  loop: string;
  ts: string;
  summary: {
    outcome?: "ran" | "no_change" | "awaiting_review" | "no_setup";
    observe_gate?: { evaluated: boolean; passed: boolean; reason: string };
    review_queue?: Array<{ step_id: string; kind: string; outbox_ref: string }>;
    offers?: Array<{ id?: string; kind: string; title: string; detail?: string }>;
    // Substance the CycleCard mines for real insight (shapes vary by app;
    // read defensively). decisions[] carries trade proposals/verdicts;
    // metrics is a flat dict of run KPIs; improvement signals a self-mutation;
    // auto_publish.memories[agent].pushed is the compounding count.
    decisions?: Array<Record<string, unknown>>;
    metrics?: Record<string, unknown>;
    improvement?: { mutations_proposed?: boolean; mutates?: string[]; pr_url?: string | null; branch?: string };
    auto_publish?: { memories?: Record<string, { pushed?: number }> };
    step_errors?: unknown[];
    steps_run?: number;
    command_engine?: { case_file?: string; case_id?: string };
    next?: string;
    [k: string]: unknown;
  };
  steps: MeCycleStep[];
  // Sidecar artifacts written as standalone files (observations, proposal,
  // result, patterns, …) — the real per-stage content for apps that don't
  // inline everything into cycle.json. Keyed by filename (no extension).
  files?: Record<string, unknown>;
}

// The loop declaration verbatim from xpcloud.yaml (rawLoop in
// admin_loops.go). Pattern A ships steps[]; Pattern B ships engine +
// skills_invoked[] (documentation-only ordering).
export interface LoopDefinition {
  name?: string;
  schedule?: string;
  knowledge_agent?: string;
  description?: string;
  mode?: string;
  skills?: string[];
  skills_invoked?: string[];
  datasets?: string[];
  steps?: Array<{ id?: string; skill?: string; knowledge_agent?: string; experiment?: string }>;
  engine?: { type?: string; module?: string; experiment?: string };
  goal?: { primary?: string; tracked?: string[] };
}

export interface MeWorkflowDetail {
  slug: string;
  kind: "scheduled" | "visual";
  app?: string;
  loop?: string;
  source?: "tenant" | "operator-shared";
  definition: LoopDefinition & Record<string, unknown>;
}

export interface MeRunRow {
  run_id: string;
  workflow_slug: string;
  kind: "scheduled" | "visual";
  name: string;
  app?: string;
  state: "succeeded" | "failed" | "running" | "skipped" | "canceled";
  started_at: number;
  started_iso?: string;
  duration_s?: number;
  reason?: string;
  cost_cents?: number;
  cycle_dir?: string;
}

export interface MeRunDetail {
  run_id: string;
  kind: "scheduled" | "visual";
  app?: string;
  loop?: string;
  ts?: string;
  cycle_dir?: string;
  steps?: unknown;
  summary?: unknown;
  step_errors?: unknown;
  execution?: unknown; // for visual
}

// SSE helper — opens /me/runs/stream and calls onEvent for each
// state-transition payload. Returns an unsubscribe closure.
//
// Auth is via the lm_session cookie (same-origin EventSource);
// React StrictMode double-mount safety is the caller's problem.
export function streamRuns(
  onEvent: (evt: { type: "started" | "state_changed" | "completed"; run: MeRunRow }) => void,
  onError?: (err: unknown) => void,
): () => void {
  const ctl = new AbortController();
  (async () => {
    try {
      const r = await fetch(`${ME_BASE}/api/v1/me/runs/stream`, {
        signal: ctl.signal,
        credentials: "include",
        headers: { Accept: "text/event-stream" },
      });
      if (!r.ok || !r.body) return;
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n\n")) >= 0) {
          const raw = buf.slice(0, nl);
          buf = buf.slice(nl + 2);
          for (const line of raw.split("\n")) {
            if (!line.startsWith("data: ")) continue;
            try {
              onEvent(JSON.parse(line.slice(6)));
            } catch { /* malformed line */ }
          }
        }
      }
    } catch (e) {
      onError?.(e);
    }
  })();
  return () => ctl.abort();
}

// Poll helper — convenience for intent completion.
export async function waitForIntent(
  id: string,
  opts: { everyMs?: number; timeoutMs?: number } = {},
): Promise<MeIntentResult> {
  const every = opts.everyMs ?? 1500;
  const deadline = Date.now() + (opts.timeoutMs ?? 120_000);
  while (true) {
    const r = await me.getIntent(id);
    if (r.status === "completed") return r;
    if (Date.now() > deadline) {
      throw new MeApiError(0, 1408, `intent ${id} did not complete in ${opts.timeoutMs ?? 120_000}ms`);
    }
    await new Promise((res) => setTimeout(res, every));
  }
}

// Workstream E — skills surface types.
export interface MeSkillRow {
  repo: string; // owner/name
  name: string;
  summary?: string;
  tags?: string[];
  version_installed?: string;
  version_latest?: string;
  update_available: boolean;
  installed_on_disk: boolean;
  used_by: Array<{ app: string; loops?: string[]; version_pinned?: string }>;
  health?: { adapter_status?: string; ci_status?: string; ci_last_run?: string };
}
export interface MeSkillCard {
  name: string;
  display_name?: string;
  summary?: string;
  category?: string;
  tags?: string[];
  kind?: string;
  step_count?: number;
  source_url?: string;
  needs_secrets?: string[];
}

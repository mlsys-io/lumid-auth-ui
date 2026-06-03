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

const ME_BASE =
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

async function call<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
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
  let json: { ret_code?: number; message?: string; data?: T } = {};
  try {
    json = await r.json();
  } catch {
    /* empty / non-JSON body */
  }
  if (!r.ok || (json.ret_code !== undefined && json.ret_code !== 0)) {
    throw new MeApiError(
      r.status,
      json.ret_code ?? r.status,
      json.message ?? r.statusText,
    );
  }
  return (json.data ?? ({} as T));
}

// ── Apps ─────────────────────────────────────────────────────────────────

export interface MeAppCard {
  name: string;
  has_manifest: boolean;
  has_xpcloud: boolean;
  has_user_overrides: boolean;
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
  installApp: (slug: string, runtime: "local" | "cloud" = "local", as?: string) =>
    call<{ intent_id: string; status: "pending" }>("POST", "/apps", { slug, runtime, as }),
  uninstallApp: (app: string) =>
    call<{ intent_id: string; status: "pending" }>("DELETE", `/apps/${encodeURIComponent(app)}`),
  getIntent: (id: string) =>
    call<MeIntentResult>("GET", `/intents/${encodeURIComponent(id)}`),

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
  loopMetricSeries: (app: string, loop: string) =>
    call<{ app: string; loop: string; series: MeMetricSeries[] }>(
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

export interface MeWorkflowDetail {
  slug: string;
  kind: "scheduled" | "visual";
  app?: string;
  loop?: string;
  source?: "tenant" | "operator-shared";
  definition: Record<string, unknown>;
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

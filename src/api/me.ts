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
      }>;
      as_of: string;
    }>("GET", "/today"),

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

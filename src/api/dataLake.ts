// Federated data-lake client — UI-fanout over the Lumid data mesh.
//
// Each lumid-data-service instance owns its own data and is fronted at a stable
// same-origin base path on lum.id (the landing nginx root-strips to the owning
// instance, which authenticates + rate-limits + separates by its own schemas —
// the viewer is untrusted, the instance is the authority). This client fans out
// client-side and merges; there is NO platform aggregation hub.
//
// HARD DESIGN PRINCIPLE: data never moves. This client only ever reads catalog
// METADATA, a CAPPED sample (via /retrieve → a small materialized blob), blob
// listings, and freshness. Bulk movement is only ever *instructed* (a future
// phase) — never a default pull.

import { bearerHeader, type Audience } from "@/api/session-bearer";

// ── Instance registry ────────────────────────────────────────────────────────
// Static for v1. Graduate to a same-origin registry.json (ConfigMap) so ops can
// add an instance without a rebuild.

export interface LakeInstance {
  id: string;
  label: string;
  // Request base. Either a SAME-ORIGIN path prefix ("/findata" — the landing
  // nginx root-strips + forwards to the instance, no CORS) OR an ABSOLUTE
  // origin ("https://lumid.trade" — a cross-origin instance on its own
  // domain; the instance must CORS-allow us, and auth rides the bearer
  // header, never the cookie, since credentials stay same-origin).
  // send() concatenates base+path, so fetch() handles either shape.
  basePath: string;
  blurb?: string;
  /** Where the data physically lives, in plain words, for the person browsing. */
  where: string;
  /** The ref scheme a lum.id/data job names this instance's tables with —
   *  set ONLY where jobs can actually read it today (the hub answers
   *  `estate_not_served` for the others). */
  jobScheme?: string;
  /** Where to go instead when jobs can't read it. */
  otherAccess?: { label: string; to: string };
}

/** The exact name to paste into a job for one table, or null when jobs can't
 *  read this instance yet. */
export function jobRefFor(inst: LakeInstance, schema: string, table: string): string | null {
  return inst.jobScheme ? `${inst.jobScheme}://${schema}.${table}` : null;
}

export const LAKE_INSTANCES: LakeInstance[] = [
  {
    id: "findata",
    label: "FinData",
    basePath: "/findata",
    blurb: "Market warehouse — fundamentals, estimates, prediction markets, news, KOL archive.",
    where: "On-prem at the home site: the FinData warehouse on the data NAS.",
    otherAccess: { label: "Query it with SQL", to: "/studio/docs/findata-sql" },
  },
  {
    id: "lumid-data",
    label: "Lumid Data",
    basePath: "/data",
    blurb: "Reference, macro, events, estimates, regulatory, fundamentals, provenance.",
    where: "On-prem at the home site: the Lumid Data hub on the data NAS. A job that runs at home reads it over the local network.",
    jobScheme: "lumid-data",
  },
  {
    // The NUS data hub (lumid-data instance `platform` on the NUS cluster), served
    // same-origin at lum.id/data-nus/ through the NUS waypoint. Added 2026-11-25
    // with the public arXiv corpus. Not a job source yet (no jobScheme): the
    // lum.id/data jobs entrance serves only the home hub.
    id: "nus-data",
    label: "NUS Data",
    basePath: "/data-nus",
    blurb: "Research corpora at NUS: the arXiv corpus (papers, full text, every file).",
    where: "At NUS, on the NUS data hub (the storage server). Runs at NUS read it locally; from home or office it is read over the internet.",
  },
  {
    id: "lqt-data",
    label: "LQT Data",
    // Migrated 2026-07-12 off the legacy same-origin lum.id/lqt-data path onto
    // its own domain (LQT umbrella; CORS-open, bearer-authed).
    basePath: "https://lumid.trade",
    blurb: "LQT planes — audit ledger, mailbox command plane, observability, xpio.",
    where: "On-prem at the home site, served from the cloud at lumid.trade.",
  },
];

export function instanceById(id: string): LakeInstance | undefined {
  return LAKE_INSTANCES.find((i) => i.id === id);
}

// ── Low-level call ───────────────────────────────────────────────────────────

const enc = encodeURIComponent;

/** The bearer audience each instance verifies. Only the lumid-data hubs have their own;
 *  the others keep the default (runmesh) bearer they have always accepted. */
export function audienceFor(basePath: string): Audience | undefined {
  // Both lumid-data hubs verify the lumid-data audience: home (/data) and NUS (/data-nus).
  const hub = (p: string) => basePath === p || basePath.startsWith(`${p}/`);
  return hub("/data") || hub("/data-nus") ? "lumid-data" : undefined;
}

/** Bearer audience for a data app reached through /dataapp-proxy/<id>. */
export function audienceForDataApp(id: string): Audience | undefined {
  return id === "lumid-data" ? "lumid-data" : undefined;
}

async function send(basePath: string, path: string, init?: RequestInit): Promise<Response> {
  const auth = await bearerHeader(audienceFor(basePath));
  const r = await fetch(`${basePath}${path}`, {
    credentials: "same-origin",
    ...init,
    headers: { ...auth, ...(init?.headers ?? {}) },
  });
  if (!r.ok) {
    let detail = "";
    try {
      detail = (await r.text()).slice(0, 200);
    } catch {
      /* ignore */
    }
    throw new Error(`${path} → ${r.status} ${r.statusText}${detail ? ` — ${detail}` : ""}`);
  }
  return r;
}

/** Ask one store's data agent a question; the raw SSE body (lib/ask-data parses it). */
export async function askAgentRaw(basePath: string, question: string): Promise<string> {
  const r = await send(basePath, "/agent/v1", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: question }], max_iterations: 8 }),
  });
  return r.text();
}

/** The rows an answer materialized (`result.materialized_uri`, owner-only), as text. */
export async function fetchAnswerRows(basePath: string, uri: string): Promise<string> {
  if (!uri.startsWith("/blobs/")) throw new Error("unexpected result location");
  const r = await send(basePath, uri);
  return r.text();
}

async function call<T>(basePath: string, path: string, init?: RequestInit): Promise<T> {
  const r = await send(basePath, path, init);
  const ct = r.headers.get("content-type") ?? "";
  return (ct.includes("json") ? r.json() : r.text()) as Promise<T>;
}

// Fetch a materialized blob as raw text regardless of content-type. The blob is
// opaque data (JSONL over application/octet-stream today), NOT an API envelope —
// content-type sniffing would mis-handle it if the service ever served x-ndjson.
async function callText(basePath: string, path: string): Promise<string> {
  return (await send(basePath, path)).text();
}

// ── Types (loose — the instance is single-source-of-truth) ───────────────────

export interface SchemaEntry {
  schema: string;
  tables: number; // count, not a list (per /catalog/schemas)
  views?: number;
  est_rows?: number;
  size_bytes?: number;
}
export interface SchemasResponse { schemas: SchemaEntry[]; }

export interface TableEntry {
  table: string;
  est_rows?: number;
  size_bytes?: number;
  is_hypertable?: boolean;
  comment?: string | null;
}
export interface TablesResponse { tables: TableEntry[]; }

export interface RetrieveResponse {
  run_id: string;
  materialized_uri: string; // e.g. /blobs/retrievals/<id>/result.jsonl (localfs → signed_url empty)
  signed_url: string;
  rowcount: number;
  size_bytes: number;
  output_format: string;
}

export interface Freshness {
  green: number;
  amber: number;
  red: number;
  gray: number;
  [k: string]: unknown;
}

// JSON-Schema column descriptor from /catalog/tables/{s}/{t}/schema.json.
export interface JsonSchema {
  title?: string;
  properties?: Record<string, { type?: unknown; nullable?: boolean; [k: string]: unknown }>;
  required?: string[];
  [k: string]: unknown;
}

export interface BlobEntry { key?: string; name?: string; size?: number; [k: string]: unknown }
export interface BlobsResponse {
  prefix?: string;
  common_prefixes?: string[];
  objects?: BlobEntry[];
  [k: string]: unknown;
}

export interface SampleResult {
  meta: RetrieveResponse;
  rows: Record<string, unknown>[];
}

// ── Per-instance endpoints ───────────────────────────────────────────────────

export const lake = {
  schemas: (b: string) => call<SchemasResponse>(b, "/catalog/schemas"),

  tables: (b: string, schema: string) =>
    call<TablesResponse>(b, `/catalog/schemas/${enc(schema)}/tables`),

  tableProfile: (b: string, schema: string, table: string) =>
    call<Record<string, unknown>>(b, `/catalog/tables/${enc(schema)}/${enc(table)}`),

  tableColumns: (b: string, schema: string, table: string) =>
    call<JsonSchema>(b, `/catalog/tables/${enc(schema)}/${enc(table)}/schema.json`),

  freshness: (b: string) => call<Freshness>(b, "/freshness"),

  // Table activity (who read/wrote what, from which app, workflow and run).
  tableActivity: (b: string, schema: string, table: string, days = 30) =>
    call<TableActivity>(b, `/catalog/tables/${enc(schema)}/${enc(table)}/activity?days=${days}`),
  runActivity: (b: string, runId: string) =>
    call<RunActivity>(b, `/activity/runs/${enc(runId)}`),
  appActivity: (b: string, app: string, loop = "", days = 30) =>
    call<RunActivity>(b, `/activity/apps/${enc(app)}?loop=${enc(loop)}&days=${days}`),

  lineageRuns: (b: string, limit = 50) =>
    call<Record<string, unknown>>(b, `/catalog/lineage/runs?limit=${limit}`),

  blobs: (b: string, prefix = "") =>
    call<BlobsResponse>(b, `/blobs?prefix=${enc(prefix)}&delimiter=/`),

  // Sample = two hops, and only a CAPPED blob ever crosses the wire:
  //   1) POST /retrieve {SELECT * … LIMIT N}  → materializes a small blob at the instance
  //   2) GET  <materialized_uri>              → fetch just that capped blob
  // schema/table come from the allow-listed catalog tree (never free-typed) and
  // are double-quoted; the server independently enforces SELECT-only + READ-ONLY
  // txn + row_cap + stmt-timeout, so a bad client cannot exceed the server cap.
  sample: async (
    b: string,
    schema: string,
    table: string,
    limit = 100,
  ): Promise<SampleResult> => {
    const n = Math.max(1, Math.min(limit, 1000));
    const sql = `SELECT * FROM "${schema}"."${table}" LIMIT ${n}`;
    const meta = await call<RetrieveResponse>(b, "/retrieve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sql, output_format: "jsonl" }),
    });
    const rows: Record<string, unknown>[] = [];
    if (meta.materialized_uri) {
      const text = await callText(b, meta.materialized_uri);
      for (const line of text.split("\n")) {
        const l = line.trim();
        if (!l) continue;
        try {
          rows.push(JSON.parse(l));
        } catch {
          /* skip malformed line */
        }
      }
    }
    return { meta, rows };
  },
};

// ── Federated catalog (fan-out, per-instance isolated) ───────────────────────

export interface InstanceCatalog {
  instance: LakeInstance;
  schemas: SchemaEntry[];
  freshness?: Freshness;
  error?: string; // a down instance degrades to an error card, others unaffected
  loading?: boolean; // seed state while this instance's catalog is still in flight
}

/**
 * The instances a reader is shown. An instance that did not answer is an
 * operator's problem: admins see it (marked offline), everyone else simply
 * doesn't get it — a student was shown "LQT Data offline" in red for a source
 * they cannot use (2026-11-28 sweep). Still loading counts as shown.
 */
export function shownCatalog(cat: InstanceCatalog[], isAdmin: boolean): InstanceCatalog[] {
  return isAdmin ? cat : cat.filter((c) => !c.error);
}

/** "3/4 instances · 24 schemas · 296 tables · read-only" (admins), "3 instances · …" otherwise. */
export function catalogLine(cat: InstanceCatalog[], isAdmin: boolean): string {
  const shown = shownCatalog(cat, isAdmin);
  const up = shown.filter((c) => !c.error).length;
  let schemas = 0;
  let tables = 0;
  for (const c of shown) {
    schemas += c.schemas.length;
    tables += c.schemas.reduce((n, x) => n + (x.tables ?? 0), 0);
  }
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const head = isAdmin ? `${up}/${cat.length} instances` : plural(up, "instance");
  return `${head} · ${plural(schemas, "schema")} · ${plural(tables, "table")} · read-only`;
}

// ── Stale-while-revalidate cache (sessionStorage-backed) ─────────────────────
// Catalog + table SHAPES barely change within a session, but every mount
// refetched them (blank spinner on every open). Cache per instance / schema:
// the viewer paints the cached shape INSTANTLY, then revalidates in the
// background and swaps in fresh data. Persisted to sessionStorage so it also
// survives a full page reload (and clears on tab close). TTL-guarded and
// version-keyed; every read still revalidates, so persisted data is only ever
// a brief first-paint, never knowingly-stale-forever.
const _CACHE_TTL_MS = 15 * 60 * 1000; // 15 min — beyond this, don't even seed
const _CACHE_VER = "v1"; // bump if InstanceCatalog/TableEntry shape changes

interface CacheEnvelope<T> {
  at: number;
  data: T;
}

function _ss(): Storage | null {
  try {
    return typeof sessionStorage !== "undefined" ? sessionStorage : null;
  } catch {
    return null; // privacy-mode / disabled storage → in-memory only
  }
}

function _load<T>(key: string): Map<string, T> {
  const m = new Map<string, T>();
  const ss = _ss();
  if (!ss) return m;
  try {
    const raw = ss.getItem(`dlv:${_CACHE_VER}:${key}`);
    if (!raw) return m;
    const obj = JSON.parse(raw) as Record<string, CacheEnvelope<T>>;
    const now = Date.now();
    for (const [k, env] of Object.entries(obj)) {
      if (env && now - env.at < _CACHE_TTL_MS) m.set(k, env.data);
    }
  } catch {
    /* corrupt entry → ignore, start clean */
  }
  return m;
}

function _persist<T>(key: string, m: Map<string, T>) {
  const ss = _ss();
  if (!ss) return;
  try {
    const now = Date.now();
    const obj: Record<string, CacheEnvelope<T>> = {};
    for (const [k, data] of m) obj[k] = { at: now, data };
    ss.setItem(`dlv:${_CACHE_VER}:${key}`, JSON.stringify(obj));
  } catch {
    /* quota / serialization failure → in-memory cache still works */
  }
}

const _catCache = _load<InstanceCatalog>("cat");
const _tblCache = _load<TableEntry[]>("tbl");

/** Drop the persisted + in-memory cache. Wired to session expiry so a new
 *  user on the same tab can't briefly see the previous session's catalog
 *  shape (bearer-scoped) before revalidation replaces it. */
export function clearDataLakeCache() {
  _catCache.clear();
  _tblCache.clear();
  const ss = _ss();
  if (ss) {
    try {
      ss.removeItem(`dlv:${_CACHE_VER}:cat`);
      ss.removeItem(`dlv:${_CACHE_VER}:tbl`);
    } catch {
      /* ignore */
    }
  }
}
if (typeof window !== "undefined") {
  // api/client.ts fires this once per session expiry (the same event the
  // AuthProvider listens for to bounce to login).
  window.addEventListener("lumid:session-expired", clearDataLakeCache);
}

/** Synchronously return a cached instance catalog for instant first paint,
 *  or undefined if never fetched this session. Always pair with a revalidate. */
export function peekInstanceCatalog(instance: LakeInstance): InstanceCatalog | undefined {
  return _catCache.get(instance.id);
}

/** Cached tables for (instance, schema), or undefined. */
export function peekTables(instanceId: string, schema: string): TableEntry[] | undefined {
  return _tblCache.get(`${instanceId}/${schema}`);
}

/** Fetch + cache one schema's tables (revalidate). Never throws upstream. */
export async function loadTables(
  instance: LakeInstance,
  schema: string,
): Promise<TableEntry[]> {
  const r = await lake.tables(instance.basePath, schema);
  const tables = r.tables ?? [];
  _tblCache.set(`${instance.id}/${schema}`, tables);
  _persist("tbl", _tblCache);
  return tables;
}

// Fetch ONE instance's catalog + freshness, isolated (never throws — a down
// instance resolves to an error card). Exported so the viewer can stream each
// instance's result into the UI as it lands instead of blocking on the slowest.
// Caches successful results for instant re-paint on remount.
export async function fetchInstanceCatalog(instance: LakeInstance): Promise<InstanceCatalog> {
  try {
    const [s, f] = await Promise.allSettled([
      lake.schemas(instance.basePath),
      lake.freshness(instance.basePath),
    ]);
    if (s.status === "rejected") throw s.reason;
    const cat: InstanceCatalog = {
      instance,
      schemas: s.value.schemas ?? [],
      freshness: f.status === "fulfilled" ? f.value : undefined,
    };
    _catCache.set(instance.id, cat);
    _persist("cat", _catCache);
    return cat;
  } catch (e: unknown) {
    // Don't cache errors — a transient failure shouldn't stick; next open retries.
    return {
      instance,
      schemas: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function federatedCatalog(): Promise<InstanceCatalog[]> {
  return Promise.all(LAKE_INSTANCES.map(fetchInstanceCatalog));
}

// ── Formatting helpers ───────────────────────────────────────────────────────

export function fmtBytes(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return "—";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
}

export function fmtRows(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return "—";
  if (n >= 1e9) return (n / 1e9).toFixed(1) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(n);
}


// ── Table activity ───────────────────────────────────────────────────────────
// Recorded by each data service since 2026-11-25 for runs whose runner sends
// the X-Lumid-App / -Loop / -Run headers. Older activity does not exist.

export interface TableUse {
  schema: string;
  table: string;
  rows: number;
  requests: number;
  last_at: string;
}
export interface RunActivity {
  wrote: TableUse[];
  read: TableUse[];
}
export interface AppUse {
  app: string;
  loop: string;
  rows: number;
  requests: number;
  last_at: string;
}
export interface TableActivity {
  wrote: AppUse[];
  read: AppUse[];
  /** Other people's activity, as counts (absent for admins, who see names). */
  others?: { writers: number; readers: number };
}

/** One instance's slice of a run's (or app's) activity. */
export interface InstanceActivity extends RunActivity {
  instance: LakeInstance;
}

function asList<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

async function acrossLakes(get: (inst: LakeInstance) => Promise<RunActivity>): Promise<InstanceActivity[]> {
  const out = await Promise.all(
    LAKE_INSTANCES.map(async (instance) => {
      try {
        const r = await get(instance);
        return { instance, wrote: asList<TableUse>(r?.wrote), read: asList<TableUse>(r?.read) };
      } catch {
        // An instance that doesn't serve activity yet (or is down) is left
        // out, never shown as "wrote nothing".
        return null;
      }
    }),
  );
  return out.filter((x): x is InstanceActivity => x !== null && (x.wrote.length > 0 || x.read.length > 0));
}

/** What one run read and wrote, across every data instance. `runId` is the
 *  run store's full run_id (e.g. "scheduled:quant-research:backtest:2026…Z"). */
export function runActivityAcrossLakes(runId: string): Promise<InstanceActivity[]> {
  return acrossLakes((i) => lake.runActivity(i.basePath, runId));
}

/** What an app — or one of its workflows — reads and writes, across instances. */
export function appActivityAcrossLakes(app: string, loop = "", days = 30): Promise<InstanceActivity[]> {
  return acrossLakes((i) => lake.appActivity(i.basePath, app, loop, days));
}

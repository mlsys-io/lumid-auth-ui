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

import { bearerHeader } from "@/api/session-bearer";

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
}

export const LAKE_INSTANCES: LakeInstance[] = [
  {
    id: "findata",
    label: "FinData",
    basePath: "/findata",
    blurb: "Market warehouse — fundamentals, estimates, prediction markets, news, KOL archive.",
  },
  {
    id: "lumid-data",
    label: "Lumid Data",
    basePath: "/data",
    blurb: "Reference, macro, events, estimates, regulatory, fundamentals, provenance.",
  },
  {
    id: "lqt-data",
    label: "LQT Data",
    // Migrated 2026-07-12 off the legacy same-origin lum.id/lqt-data path onto
    // its own domain (LQT umbrella; CORS-open, bearer-authed).
    basePath: "https://lumid.trade",
    blurb: "LQT planes — audit ledger, mailbox command plane, observability, xpio.",
  },
];

export function instanceById(id: string): LakeInstance | undefined {
  return LAKE_INSTANCES.find((i) => i.id === id);
}

// ── Low-level call ───────────────────────────────────────────────────────────

const enc = encodeURIComponent;

async function send(basePath: string, path: string, init?: RequestInit): Promise<Response> {
  const auth = await bearerHeader();
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
}

export async function federatedCatalog(): Promise<InstanceCatalog[]> {
  return Promise.all(
    LAKE_INSTANCES.map(async (instance) => {
      try {
        const [s, f] = await Promise.allSettled([
          lake.schemas(instance.basePath),
          lake.freshness(instance.basePath),
        ]);
        if (s.status === "rejected") throw s.reason;
        return {
          instance,
          schemas: s.value.schemas ?? [],
          freshness: f.status === "fulfilled" ? f.value : undefined,
        };
      } catch (e: unknown) {
        return {
          instance,
          schemas: [],
          error: e instanceof Error ? e.message : String(e),
        };
      }
    }),
  );
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

// Lumid Markdown directives — the data-bound widgets an app surface can embed.
//
// A surface is plain Markdown. Fenced blocks whose info string is
// `lumid:<type>` become live widgets. The block body is YAML (or JSON).
//
//     ```lumid:table
//     source: me://today
//     path: cycles
//     columns: [{ key: loop, label: Loop }, { key: outcome, label: Outcome }]
//     ```
//
// SECURITY: `source` may bind ONLY to the allowlisted `me://*` endpoints
// (already auth-gated + tenant-scoped on the server) and the anon-read
// `/findata-cloud/*` proxy — never arbitrary URLs. Unknown directive types
// fall back to a labelled code block (graceful degradation).

import { createContext, useContext, useId, useCallback, useMemo, Suspense, useEffect, useState, type ReactNode } from "react";
import { parse as parseYaml } from "yaml";
import { Link, useNavigate, useParams as useRouteParams } from "react-router-dom";
import { toast } from "sonner";
import { AuthContext } from "@/hooks/useAuth";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer,
} from "recharts";
import { me, ME_BASE } from "@/api/me";
import apiClient from "@/api/client";
import { cn, formatCurrency, formatPercentage } from "@/lib/utils";
import { bearerHeader } from "@/api/session-bearer";

// ── URL-param injection ─────────────────────────────────────────────────────
//
// A surface mounted at a param route (e.g. /studio/a/lumid-market/competition/
// :competitionId) gets its URL params injected here. Directive string values
// (source, row_href, to, submit_qa, field defaults, native config) may contain
// `{paramName}` tokens — these are replaced with the matched URL param BEFORE
// the widget runs. Tokens whose key is NOT a known param survive untouched, so
// a table `row_href` can still use `{rowField}` for per-row substitution.

const SurfaceParamsContext = createContext<Record<string, string>>({});
// The app's xpcloud `config:` map (returned by the surface API). Native widget
// embeds merge it UNDER their directive body, so app-level configuration (the
// Config button) sets defaults and the markdown only overrides when explicit.
const SurfaceAppConfigContext = createContext<Record<string, unknown>>({});

export function SurfaceParams({
  params,
  appConfig,
  children,
}: {
  params: Record<string, string>;
  appConfig?: Record<string, unknown>;
  children: React.ReactNode;
}) {
  return (
    <SurfaceParamsContext.Provider value={params}>
      <SurfaceAppConfigContext.Provider value={appConfig ?? {}}>
        {children}
      </SurfaceAppConfigContext.Provider>
    </SurfaceParamsContext.Provider>
  );
}

/** Replace `{k}` with params[k] ONLY for keys present in params; leave others.
 *  Keys may be dotted — `{config.<key>}` tokens resolve from the app's
 *  xpcloud `config:` map (flattened into params by AppSurface), so a surface
 *  spec stays a generic TEMPLATE: per-install values live in Config. */
function interpolate<T>(value: T, params: Record<string, string>): T {
  if (typeof value === "string") {
    return value.replace(/\{([\w.]+)\}/g, (m, k) => (k in params ? params[k] : m)) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => interpolate(v, params)) as unknown as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as object)) {
      out[k] = interpolate((value as Record<string, unknown>)[k], params);
    }
    return out as unknown as T;
  }
  return value;
}

// ── source allowlist ──────────────────────────────────────────────────────

const FINDATA_PREFIX = "findata://";
const DATAAPP_PREFIX = "dataapp://";

// Short-lived cache — deduplicates parallel fetches when multiple directives
// on the same page share a source (e.g. two tables reading market-movers),
// and avoids re-fetching on React re-renders. 30s TTL keeps data fresh.
const _cache = new Map<string, { data: unknown; exp: number }>();
const CACHE_TTL = 30_000;

/** Resolve a directive `source` spec to data. Throws on anything not allowlisted.
 *  `force` skips the cache READ (used by polling/refetch for fresh data); the
 *  result is still written back to the cache so siblings dedupe. */
export async function resolveSource(spec: string, force = false): Promise<unknown> {
  if (!force) {
    const hit = _cache.get(spec);
    if (hit && hit.exp > Date.now()) return hit.data;
  }
  let data: unknown;
  if (spec.startsWith("me://")) {
    const p = spec.slice("me://".length).replace(/^\/+/, "");
    if (p === "today") {
      data = await me.today();
    } else if (p === "workflows" || p.startsWith("workflows?")) {
      // me://workflows?app=<name> — the caller's workflow rows for ONE app
      // (name, last_run_ok, last_run_ts, running, enabled). Lets any app's
      // Overview show live run health without a bespoke data service; the
      // table empty state covers the not-yet-run case.
      const qs = p.includes("?") ? p.slice(p.indexOf("?") + 1) : "";
      const appFilter = new URLSearchParams(qs).get("app");
      const all = await me.listWorkflows();
      data = appFilter
        ? { workflows: (all.workflows ?? []).filter((w) => w.app === appFilter) }
        : all;
    } else if (p === "loops/health" || p === "loops-health") {
      data = await me.loopsHealth();
    } else if (p === "apps") {
      data = await me.listApps();
    } else if (p === "gpu-rentals") {
      data = await me.gpuRentals();
    } else if (p === "drafts" || p.startsWith("drafts?")) {
      const qs = p.includes("?") ? p.slice(p.indexOf("?") + 1) : "";
      const params = Object.fromEntries(new URLSearchParams(qs)) as Parameters<typeof me.listDrafts>[0];
      data = await me.listDrafts(params);
    } else {
      throw new Error(`source not allowed: ${spec}`);
    }
  } else if (spec.startsWith(FINDATA_PREFIX)) {
    const path = spec.slice(FINDATA_PREFIX.length).replace(/^\/+/, "");
    const auth = await bearerHeader();
    const r = await fetch(`/findata-cloud/${path}`, { credentials: "same-origin", headers: auth });
    // 404 = the warehouse simply has no record for this symbol/endpoint (common
    // for micro-caps reached from the Movers table). That's "no data", not an
    // error — return null so stat/chart/table render their empty state instead
    // of a red error chip. Real failures (401/403/5xx) still surface.
    if (r.status === 404) { data = null; }
    else if (!r.ok) throw new Error(`findata ${r.status}`);
    else data = await r.json();
  } else if (spec.startsWith(DATAAPP_PREFIX)) {
    // Generic lumid-data-service app. Spec shape: dataapp://<base-id>/<path>.
    // The base-id selects an ALLOWLISTED upstream server-side (nginx
    // /dataapp-proxy/<id>/) — SSRF-safe (no URL travels from the client).
    // Same passthrough + bearer as findata://; lets one explorer point at
    // any allowlisted data-app by setting the base-id in the source.
    const path = spec.slice(DATAAPP_PREFIX.length).replace(/^\/+/, "");
    const auth = await bearerHeader();
    const r = await fetch(`/dataapp-proxy/${path}`, { credentials: "same-origin", headers: auth });
    if (r.status === 404) { data = null; }   // no record for this key — empty, not an error
    else if (!r.ok) throw new Error(`dataapp ${r.status}`);
    else data = await r.json();
  } else if (spec.startsWith("qa://dashboard/")) {
    // QuantArena public dashboard endpoints — no auth required.
    const tail = spec.slice("qa://dashboard/".length);
    const [rawPath, qs] = tail.split("?");
    const params = Object.fromEntries(new URLSearchParams(qs ?? ""));
    const { getCompetitions, getLeaderboard, getEquityChart,
            getDashboardLeaderboardLatest, getDashboardEquityChartLatest } =
      await import("@/quantarena/api/dashboard");

    if (rawPath === "competitions") {
      const res = await getCompetitions(params.status ? { status: params.status } : undefined);
      data = res.competitions ?? [];
    } else if (rawPath === "leaderboard/latest") {
      data = await getDashboardLeaderboardLatest(parseInt(params.limit ?? "10"));
    } else if (/^leaderboard\/\d+$/.test(rawPath)) {
      const id = parseInt(rawPath.split("/")[1]);
      const res = await getLeaderboard(id);
      data = res.participants ?? [];
    } else if (rawPath === "equity-chart/latest") {
      data = await getDashboardEquityChartLatest();
    } else if (/^equity-chart\/\d+$/.test(rawPath)) {
      const id = parseInt(rawPath.split("/")[1]);
      const res = await getEquityChart(id);
      data = (res.charts ?? []).flatMap((s) =>
        (s.data_points ?? []).map((p) => ({ ts: p.timestamp, equity: p.total_equity, name: s.strategy_name }))
      );
    } else {
      throw new Error(`qa://dashboard/ path not allowed: ${rawPath}`);
    }
  } else if (spec === "qa://cluster/pricing") {
    // lumid-cluster public pricing endpoint — no auth required.
    // (Checked before the generic qa:// branch so it isn't swallowed.)
    const r = await fetch("/api/v1/cluster/pricing");
    if (!r.ok) throw new Error(`cluster pricing ${r.status}`);
    data = await r.json();
  } else if (spec.startsWith("qa://")) {
    // QuantArena auth-required endpoints. These flow through the QA apiClient,
    // which presents the lum.id session-bearer JWT (cookie-authed, introspected
    // by QA), so a studio visitor reads their own competition data without a
    // separate QA login. Param routes interpolate {competitionId}/{strategyId}
    // into the path before this resolver sees it.
    const tail = spec.slice("qa://".length).replace(/^\/+/, "");
    const [rawPath, qs] = tail.split("?");
    const params = Object.fromEntries(new URLSearchParams(qs ?? ""));
    const comp = await import("@/quantarena/api/competition");
    const strat = await import("@/quantarena/api/strategy");
    const research = await import("@/quantarena/api/research");

    if (rawPath === "competitions") {
      const res = await comp.getCompetitionsList({
        status: params.status ? [params.status] : ["Ongoing"],
        page: 1,
        page_size: parseInt(params.limit ?? "20"),
      });
      data = res.data?.competitions ?? [];
    } else if (rawPath === "my-strategies") {
      // Cross-competition roster of the caller's forward-testing strategies.
      const res = await strat.getSimulationStrategies({ page: 1, page_size: parseInt(params.limit ?? "100") });
      data = res.data?.strategies ?? [];
    } else if (/^competition\/\d+$/.test(rawPath)) {
      const id = parseInt(rawPath.split("/")[1]);
      const res = await comp.getCompetitionDetail(id);
      data = res.data ?? null;
    } else if (/^competition\/\d+\/my-strategies$/.test(rawPath)) {
      const id = parseInt(rawPath.split("/")[1]);
      const res = await comp.getMyStrategies(id);
      data = res.data?.strategies ?? [];
    } else if (/^competition\/\d+\/leaderboard$/.test(rawPath)) {
      const id = parseInt(rawPath.split("/")[1]);
      const res = await comp.getCompetitionLeaderboard(id, {
        sort_by: (params.sort_by as never) ?? "TotalEquity",
        order: (params.order as never) ?? "desc",
      });
      data = res.data?.participants ?? [];
    } else if (/^competition\/\d+\/recent-trades$/.test(rawPath)) {
      const id = parseInt(rawPath.split("/")[1]);
      const res = await comp.getCompetitionRecentTrades(id, { limit: parseInt(params.limit ?? "50") });
      data = res.trades ?? [];
    } else if (/^competition\/\d+\/strategy\/\d+$/.test(rawPath)) {
      const parts = rawPath.split("/");
      const res = await comp.getStrategyDetail(parseInt(parts[1]), parseInt(parts[3]));
      data = res.data ?? null;
    } else if (/^research\/\d+$/.test(rawPath)) {
      const id = parseInt(rawPath.split("/")[1]);
      data = await research.getResearchByStrategy(id);
    } else if (rawPath === "competitions/latest/leaderboard") {
      const listRes = await comp.getCompetitionsList({ status: ["Ongoing"], page: 1, page_size: 1 });
      const comps = listRes.data?.competitions ?? [];
      if (comps.length > 0) {
        const lbRes = await comp.getCompetitionLeaderboard(comps[0].id, { sort_by: "ReturnRate", order: "desc" });
        data = (lbRes?.data?.participants ?? []).slice(0, parseInt(params.limit ?? "10"));
      } else {
        data = [];
      }
    } else if (/^competitions\/\d+\/leaderboard$/.test(rawPath)) {
      const id = parseInt(rawPath.split("/")[1]);
      const lbRes = await comp.getCompetitionLeaderboard(id, {});
      data = lbRes?.data?.participants ?? [];
    } else {
      throw new Error(`qa:// path not allowed: ${rawPath}`);
    }
  } else {
    throw new Error(`source scheme not allowed: ${spec}`);
  }
  _cache.set(spec, { data, exp: Date.now() + CACHE_TTL });
  return data;
}

/** Dot-path getter. "" / "." / [] returns the root. */
function getPath(obj: unknown, path?: unknown): unknown {
  if (!path || path === "." || typeof path !== "string") return obj;
  return path.split(".").reduce<unknown>(
    (o, k) => (o == null ? o : (o as Record<string, unknown>)[k]),
    obj,
  );
}

// `pollSec > 0` re-fetches the source on that interval (bypassing the cache),
// pausing while the tab is hidden — this is how a declarative table becomes a
// live feed (e.g. an Ongoing-competition activity stream / leaderboard) without
// a bespoke native component. `refetch()` forces an immediate fresh fetch (used
// after a row action mutates server state).
// A source spec still containing `{token}` after param interpolation means the
// surface was opened WITHOUT its route context (e.g. competition-detail at the
// bare /studio/a/<app>/<surface> URL — reachable via the surface editor's
// back/save navigation). That's a navigation state, not a data error: report
// it as `pending` so widgets render a quiet hint instead of a red error chip.
function unresolvedToken(spec?: string): string | null {
  if (!spec) return null;
  const m = spec.match(/\{(\w+)\}/);
  return m ? m[1] : null;
}

function useSource(spec?: string, pollSec = 0) {
  const pending = unresolvedToken(spec);
  const [state, setState] = useState<{ data?: unknown; loading: boolean; error?: string }>(
    { loading: !!spec && !pending },
  );
  const [tick, setTick] = useState(0);
  const refetch = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    if (!spec || pending) { setState({ loading: false }); return; }
    let live = true;
    // Only show the loading spinner on the FIRST load — polling/refetch refresh
    // in place so the table doesn't flicker back to "Loading…" every interval.
    if (tick === 0) setState((s) => (s.data === undefined ? { loading: true } : s));
    resolveSource(spec, tick > 0)
      .then((data) => { if (live) setState({ data, loading: false }); })
      .catch((e) => { if (live) setState((s) => ({ ...s, loading: false, error: String(e?.message ?? e) })); });
    return () => { live = false; };
  }, [spec, tick]);
  useEffect(() => {
    if (!spec || pending || pollSec <= 0) return;
    const id = setInterval(() => { if (!document.hidden) setTick((t) => t + 1); }, pollSec * 1000);
    return () => clearInterval(id);
  }, [spec, pending, pollSec]);
  return { ...state, pending, refetch };
}

function Shell({ title, children, pickKind, pickId }: { title?: string; children: React.ReactNode; pickKind?: string; pickId?: string }) {
  return (
    <div
      className="my-3 rounded-lg border border-slate-200 bg-white overflow-hidden"
      data-pick-kind={pickKind}
      data-pick-id={pickId}
    >
      {title ? (
        <div className="px-3 py-1.5 border-b border-slate-100 text-[12px] font-medium text-slate-500">{title}</div>
      ) : null}
      <div className="p-3">{children}</div>
    </div>
  );
}
const Loading = () => <div className="text-[12px] text-slate-400 py-2">Loading…</div>;
const ErrLine = ({ msg }: { msg: string }) => (
  <div className="text-[12px] text-rose-600 py-2">⚠ {msg}</div>
);
// Quiet hint for a param surface opened without its route context.
const PendingLine = ({ token }: { token: string }) => (
  <div className="text-[12px] text-slate-400 italic py-2">
    Waiting for a {token} — open this page from its parent list (e.g. a row in the lobby).
  </div>
);

// ── widgets ────────────────────────────────────────────────────────────────

type Body = Record<string, unknown>;

function LumidStat({ body }: { body: Body }) {
  const { data, loading, error, pending } = useSource(body.source as string | undefined);
  if (pending) return <PendingLine token={pending} />;
  if (loading) return <Loading />;
  if (error) return <ErrLine msg={error} />;
  let base = getPath(data, body.path as string | undefined);
  // row_match: when the base is an ARRAY, select the first row whose `key`
  // field (stringified) equals `value`, then `body.value` reads from that row.
  // No match → null (renders "—"). The directive body is interpolated upstream,
  // so key/value arrive as plain config here.
  const rowMatch = body.row_match as { key?: unknown; value?: unknown } | undefined;
  if (rowMatch && typeof rowMatch.key === "string" && Array.isArray(base)) {
    base =
      (base as Record<string, unknown>[]).find(
        (r) => r != null && String(r[rowMatch.key as string]) === String(rowMatch.value),
      ) ?? null;
  }
  let value: unknown;
  if (body.value === "count") value = Array.isArray(base) ? base.length : base == null ? 0 : Object.keys(base as object).length;
  else if (body.value) value = getPath(base, body.value as string);
  else value = base;
  // format (pct = decimal-returns percentage, currency) + optional prefix/
  // suffix — only when the value is non-null; null still renders "—".
  let display = "—";
  if (value != null) {
    const n = Number(value);
    if (body.format === "pct" && isFinite(n)) display = formatPercentage(n);
    else if (body.format === "currency" && isFinite(n)) display = formatCurrency(n);
    else display = String(value);
    if (typeof body.prefix === "string") display = body.prefix + display;
    if (typeof body.suffix === "string") display = display + body.suffix;
  }
  return (
    <div className="inline-flex flex-col rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 min-w-[120px]">
      <span className="text-2xl font-semibold text-slate-900 tabular-nums">{display}</span>
      <span className="text-[11px] uppercase tracking-wide text-slate-500 mt-0.5">{String(body.label ?? "")}</span>
    </div>
  );
}

type ColDef = { key: string; label?: string; type?: string; sortable?: boolean };

const STATUS_COLORS: Record<string, string> = {
  Ongoing:   "bg-green-100 text-green-800 border-green-200",
  Upcoming:  "bg-blue-100 text-blue-800 border-blue-200",
  Completed: "bg-gray-100 text-gray-800 border-gray-200",
};

function StatusBadge({ value }: { value: string }) {
  const cls = STATUS_COLORS[value] ?? "bg-slate-100 text-slate-700 border-slate-200";
  return <span className={cn("inline-flex px-1.5 py-0.5 rounded text-[11px] font-medium border", cls)}>{value}</span>;
}

function formatCell(value: unknown, type?: string): React.ReactNode {
  if (value == null || value === "") return "—";
  const n = Number(value);
  if (type === "currency") return formatCurrency(isFinite(n) ? n : 0);
  if (type === "pct") {
    if (!isFinite(n)) return "—";
    const pct = formatPercentage(n);
    const cls = n >= 0 ? "text-green-600" : "text-red-600";
    return <span className={cls}>{pct}</span>;
  }
  if (type === "badge") return <StatusBadge value={String(value)} />;
  if (type === "datetime") {
    // Unix seconds or ms → locale string. < 1e12 ⇒ seconds.
    if (!isFinite(n) || n === 0) return "—";
    const ms = n < 1e12 ? n * 1000 : n;
    return new Date(ms).toLocaleString();
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

// A row_href target may be an INTERNAL route (/studio/...) or an EXTERNAL URL
// (https://… — e.g. a news article or tweet). External opens a new tab; internal
// uses client-side navigation.
function isExternalHref(h: string): boolean { return /^https?:\/\//i.test(h); }

// ── actions (per-row + table-level) ─────────────────────────────────────────
//
// An action POSTs (or DELETEs) to a QuantArena endpoint via the shared
// session-bearer apiClient — the same write path lumid:form uses. `gate`
// hides the control unless the caller's role qualifies (so admin bulk-reset
// only shows for admins). This is what lets a leaderboard reset / activity
// refresh live in declarative config instead of a bespoke native component.
type ActionDef = {
  label: string;
  qa_post?: string;
  qa_delete?: string;
  confirm?: string;
  success?: string;
  gate?: string;          // "admin" | "super_admin"
  variant?: string;       // "danger" → destructive styling
};

function roleAllows(role: string, gate?: string): boolean {
  if (!gate) return true;
  if (gate === "super_admin") return role === "super_admin";
  if (gate === "admin") return role === "admin" || role === "super_admin";
  return true;
}

async function runQaAction(a: ActionDef, row?: Record<string, unknown>): Promise<void> {
  const interp = (p: string) =>
    row ? p.replace(/\{([^}]+)\}/g, (_, k) => String(row[k] ?? "")) : p;
  const raw = a.qa_delete ?? a.qa_post ?? "";
  const path = interp(raw);
  if (!path || /\{|\}/.test(path)) throw new Error(`unresolved action path: ${path}`);
  const { default: apiClient } = await import("@/quantarena/api/client");
  if (a.qa_delete) await apiClient.delete(path);
  else await apiClient.post(path, {});
}

function ActionButton({ a, row, onDone, size = "sm" }: {
  a: ActionDef; row?: Record<string, unknown>; onDone?: () => void; size?: "sm" | "xs";
}) {
  const role = useContext(AuthContext)?.user?.role ?? "user";
  const [busy, setBusy] = useState(false);
  if (!roleAllows(role, a.gate)) return null;
  const danger = a.variant === "danger";
  const run = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (a.confirm && !window.confirm(a.confirm)) return;
    setBusy(true);
    try {
      await runQaAction(a, row);
      toast.success(a.success ?? "Done.");
      onDone?.();
    } catch (err) {
      toast.error(String((err as Error)?.message ?? err));
    } finally {
      setBusy(false);
    }
  };
  const pad = size === "xs" ? "px-1.5 py-0.5 text-[11px]" : "px-2.5 py-1 text-[12px]";
  const tone = danger
    ? "border-rose-200 text-rose-600 hover:bg-rose-50"
    : "border-slate-200 text-slate-600 hover:bg-slate-100 hover:text-slate-800";
  return (
    <button onClick={run} disabled={busy}
      className={cn("inline-flex items-center rounded-md border bg-white transition-colors disabled:opacity-50", pad, tone)}>
      {busy ? "…" : a.label}
    </button>
  );
}

function LumidTable({ body }: { body: Body }) {
  const pollSec = Number(body.poll) || 0;
  const { data, loading, error, pending, refetch } = useSource(body.source as string | undefined, pollSec);
  const navigate = useNavigate();
  // Click-to-sort state. Header cycle: unsorted → desc → asc → unsorted (so the
  // first click on a metric shows the leaders, matching the native leaderboard).
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(null);

  const rows = getPath(data, body.path as string | undefined);
  const rowArr = Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];

  const sortedRows = useMemo(() => {
    if (!sort) return rowArr;
    const { key, dir } = sort;
    const mul = dir === "asc" ? 1 : -1;
    return [...rowArr].sort((a, b) => {
      const av = a[key], bv = b[key];
      const an = Number(av), bn = Number(bv);
      if (isFinite(an) && isFinite(bn) && av !== "" && bv !== "") return (an - bn) * mul;
      return String(av ?? "").localeCompare(String(bv ?? "")) * mul;
    });
  }, [rowArr, sort]);

  if (pending) return <PendingLine token={pending} />;
  if (loading) return <Loading />;
  if (error) return <ErrLine msg={error} />;

  const cols = (body.columns as ColDef[] | undefined) ?? [];
  const tableActions = (body.actions as ActionDef[] | undefined)?.filter((a) => a && a.label) ?? [];
  const rowActions = (body.row_actions as ActionDef[] | undefined)?.filter((a) => a && a.label) ?? [];

  if (rowArr.length === 0) {
    // Still show table-level actions (e.g. an admin "Reset all") even with no
    // rows, so the control isn't hidden just because the board is empty.
    const empty = <div className="text-[12px] text-slate-400">No rows.</div>;
    if (!tableActions.length) return empty;
    return (
      <div className="space-y-2">
        <ActionBar actions={tableActions} onDone={refetch} />
        {empty}
      </div>
    );
  }

  const columns: ColDef[] = cols.length ? cols : Object.keys(rowArr[0]).map((k) => ({ key: k, label: k }));
  const tableSortable = body.sortable === true;
  const isSortable = (c: ColDef) => tableSortable || c.sortable === true;
  const toggleSort = (key: string) =>
    setSort((prev) =>
      !prev || prev.key !== key ? { key, dir: "desc" } : prev.dir === "desc" ? { key, dir: "asc" } : null);

  const rowHrefTemplate = typeof body.row_href === "string" ? body.row_href : null;
  const rowHref = rowHrefTemplate
    ? (row: Record<string, unknown>) => {
        const h = rowHrefTemplate.replace(/\{([^}]+)\}/g, (_, k) => String(row[k] ?? ""));
        // Drop hrefs left with empty interpolations (missing field) so we don't
        // render a dead link to a partial path.
        return /\{|\}/.test(h) || h.trim() === "" ? "" : h;
      }
    : null;
  // Navigate the WHOLE row (not just the first cell) — matches the native
  // dashboard pages where clicking anywhere on a row drilled in.
  const goHref = (href: string) => {
    if (!href) return;
    if (isExternalHref(href)) window.open(href, "_blank", "noopener,noreferrer");
    else navigate(href);
  };
  const renderHrefCell = (href: string, content: ReactNode) =>
    isExternalHref(href)
      ? <a href={href} target="_blank" rel="noopener noreferrer" className="text-emerald-700 hover:underline" onClick={(e) => e.stopPropagation()}>{content}</a>
      : <Link to={href} className="text-emerald-700 hover:underline" onClick={(e) => e.stopPropagation()}>{content}</Link>;

  // Card-grid view (no sorting/row-actions — those are table-view affordances)
  if (body.view === "cards") {
    const titleCol = columns[0];
    const badgeCol = columns.find((c) => c.type === "badge");
    const statCols = columns.filter((c) => c !== titleCol && c !== badgeCol);
    return (
      <div className="space-y-2">
        {tableActions.length > 0 && <ActionBar actions={tableActions} onDone={refetch} />}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {sortedRows.slice(0, 60).map((row, i) => {
            const href = rowHref ? rowHref(row) : "";
            const title = String(row[titleCol.key] ?? "");
            return (
              <div key={i} onClick={href ? () => goHref(href) : undefined}
                className={"rounded-lg border border-slate-200 bg-white p-3 hover:border-slate-300 hover:shadow-sm transition-all" + (href ? " cursor-pointer" : "")}>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="font-medium text-[13px] text-slate-900 leading-snug">
                    {href ? renderHrefCell(href, title) : title}
                  </div>
                  {badgeCol && <StatusBadge value={String(row[badgeCol.key] ?? "")} />}
                </div>
                <div className="space-y-1">
                  {statCols.map((c) => (
                    <div key={c.key} className="flex justify-between text-[12px]">
                      <span className="text-slate-500">{c.label ?? c.key}</span>
                      <span className="font-medium text-slate-700">{formatCell(row[c.key], c.type)}</span>
                    </div>
                  ))}
                </div>
                {rowActions.length > 0 && (
                  <div className="flex gap-1.5 mt-2 pt-2 border-t border-slate-100">
                    {rowActions.map((a, ai) => <ActionButton key={ai} a={a} row={row} onDone={refetch} size="xs" />)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // Standard table view
  const sortIcon = (key: string) =>
    !sort || sort.key !== key ? "↕" : sort.dir === "desc" ? "↓" : "↑";
  return (
    <div className="space-y-2">
      {(tableActions.length > 0 || pollSec > 0) && (
        <div className="flex items-center gap-2">
          {tableActions.length > 0 && <ActionBar actions={tableActions} onDone={refetch} />}
          {pollSec > 0 && (
            <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-emerald-600">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> Live
            </span>
          )}
        </div>
      )}
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="min-w-full text-[12px] border-collapse">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              {columns.map((c) => {
                const sortable = isSortable(c);
                return (
                  <th key={c.key}
                    onClick={sortable ? () => toggleSort(c.key) : undefined}
                    className={cn("px-2.5 py-1.5 text-left font-semibold text-slate-700", sortable && "cursor-pointer select-none hover:text-slate-900")}>
                    <span className="inline-flex items-center gap-1">
                      {c.label ?? c.key}
                      {sortable && <span className={cn("text-[10px]", sort?.key === c.key ? "text-emerald-600" : "text-slate-400")}>{sortIcon(c.key)}</span>}
                    </span>
                  </th>
                );
              })}
              {rowActions.length > 0 && <th className="px-2.5 py-1.5 text-right font-semibold text-slate-700">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {sortedRows.slice(0, 200).map((row, i) => {
              const href = rowHref ? rowHref(row) : "";
              const trCls = "border-b border-slate-100 last:border-b-0" + (href ? " hover:bg-slate-50 cursor-pointer" : "");
              return (
                <tr key={i} className={trCls} onClick={href ? () => goHref(href) : undefined}>
                  {columns.map((c, ci) => {
                    const cell = <>{
                      href && ci === 0
                        ? renderHrefCell(href, formatCell(row[c.key], c.type))
                        : formatCell(row[c.key], c.type)
                    }</>;
                    return <td key={c.key} className="px-2.5 py-1.5 text-slate-700 align-top max-w-[260px] truncate">{cell}</td>;
                  })}
                  {rowActions.length > 0 && (
                    <td className="px-2.5 py-1.5 text-right whitespace-nowrap">
                      <span className="inline-flex gap-1.5 justify-end" onClick={(e) => e.stopPropagation()}>
                        {rowActions.map((a, ai) => <ActionButton key={ai} a={a} row={row} onDone={refetch} size="xs" />)}
                      </span>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Table-level action row (e.g. an admin "Reset all"). Buttons self-hide by gate.
function ActionBar({ actions, onDone }: { actions: ActionDef[]; onDone?: () => void }) {
  const role = useContext(AuthContext)?.user?.role ?? "user";
  const visible = actions.filter((a) => roleAllows(role, a.gate));
  if (!visible.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {visible.map((a, i) => <ActionButton key={i} a={a} onDone={onDone} />)}
    </div>
  );
}

function LumidChart({ body }: { body: Body }) {
  const { data, loading, error, pending } = useSource(body.source as string | undefined);
  if (pending) return <PendingLine token={pending} />;
  if (loading) return <Loading />;
  if (error) return <ErrLine msg={error} />;
  const rawRows = getPath(data, body.path as string | undefined);
  if (!Array.isArray(rawRows) || rawRows.length === 0) return <div className="text-[12px] text-slate-400">No data.</div>;
  // Support both legacy (x/y) and new (x_key/y_key) names.
  const xKey = (body.x_key as string) ?? (body.x as string) ?? "x";
  const yKey = (body.y_key as string) ?? (body.y as string);
  const seriesKey = body.series_key as string | undefined;
  const kind = (body.kind as string) ?? (body.type as string) ?? "line";
  const height = Number(body.height) || 240;
  const palette = ["#059669", "#6366f1", "#f59e0b", "#ef4444", "#0ea5e9"];

  let chartData: object[];
  let ys: string[];

  if (seriesKey && yKey) {
    // Pivot flat [{x, yKey, seriesKey}] rows into wide [{x, SeriesA: v, SeriesB: v}] format.
    const typedRows = rawRows as Record<string, unknown>[];
    const seriesNames = [...new Set(typedRows.map((r) => String(r[seriesKey] ?? "")))];
    const byX = new Map<unknown, Record<string, unknown>>();
    for (const row of typedRows) {
      const xVal = row[xKey];
      if (!byX.has(xVal)) byX.set(xVal, { [xKey]: xVal });
      byX.get(xVal)![String(row[seriesKey] ?? "")] = row[yKey];
    }
    chartData = [...byX.values()];
    ys = seriesNames;
  } else {
    chartData = rawRows as object[];
    ys = Array.isArray(body.y) ? (body.y as string[]) : [yKey ?? "y"];
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      {kind === "bar" ? (
        <BarChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
          <XAxis dataKey={xKey} tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} /><Tooltip />
          {ys.map((k, i) => <Bar key={k} dataKey={k} fill={palette[i % palette.length]} />)}
        </BarChart>
      ) : (
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
          <XAxis dataKey={xKey} tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} /><Tooltip />
          {ys.map((k, i) => <Line key={k} type="monotone" dataKey={k} stroke={palette[i % palette.length]} dot={false} />)}
        </LineChart>
      )}
    </ResponsiveContainer>
  );
}

function LumidList({ body }: { body: Body }) {
  const { data, loading, error, pending } = useSource(body.source as string | undefined);
  if (pending) return <PendingLine token={pending} />;
  if (loading) return <Loading />;
  if (error) return <ErrLine msg={error} />;
  const items = getPath(data, body.path as string | undefined);
  if (!Array.isArray(items) || items.length === 0) return <div className="text-[12px] text-slate-400">Empty.</div>;
  const tk = (body.title_key as string) ?? "title";
  const sk = body.subtitle_key as string | undefined;
  return (
    <ul className="space-y-2">
      {(items as Record<string, unknown>[]).slice(0, 100).map((it, i) => (
        <li key={i} className="rounded-lg border border-slate-200 px-3 py-2">
          <div className="text-[13px] font-medium text-slate-800">{String(it[tk] ?? "")}</div>
          {sk ? <div className="text-[12px] text-slate-500">{String(it[sk] ?? "")}</div> : null}
        </li>
      ))}
    </ul>
  );
}

function LumidAction({ body }: { body: Body }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const label = String(body.label ?? "Run");
  const onClick = async () => {
    const intent = String(body.intent ?? "open");
    try {
      setBusy(true);
      if (intent === "open" && typeof body.to === "string") {
        // Same-origin paths only — app-authored surfaces can't open arbitrary
        // external URLs (no open-redirect / phishing via a surface button).
        if (body.to.startsWith("/") && !body.to.startsWith("//")) navigate(body.to);
        else toast.error("Only in-app links are allowed");
      } else if (intent === "run_loop" && body.app && body.loop) {
        await me.runLoopNow(String(body.app), String(body.loop), (body.args as Record<string, unknown>) ?? undefined);
        toast.success(`Triggered ${body.loop}`);
      } else if (intent === "install_app" && body.app) {
        await me.installApp(String(body.app));
        toast.success(`Installing ${body.app}…`);
      } else {
        toast.error("Unsupported action");
      }
    } catch (e) {
      toast.error(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
    >
      {busy ? "Working…" : label}
    </button>
  );
}

// lumid:native — explicitly embed a first-party interactive component by key.
// The key resolves against native-registry.ts (same allowlist as before).
// Third-party apps can declare this directive in their markdown, but the key
// only resolves if it exists in the compiled registry — no code injection.
//
//   ```lumid:native
//   key: lumid-gpu-rentals
//   title: GPU Rental Manager      # optional — any keys besides `key` are
//   hide_header: true              # passed to the component as `config`.
//   ```
//
// Everything in the block except `key` is forwarded to the component as a
// `config` prop, so a single native embed is configurable (titles, defaults,
// which panels to show) rather than one opaque entry.
function LumidNative({ body }: { body: Body }) {
  const key = String(body.key ?? "");
  // App-level config (xpcloud `config:`, edited via the Config button) provides
  // the defaults; explicit keys in the directive body override. So an app like
  // the data explorer is configured in Config, not by editing markdown.
  const appConfig = useContext(SurfaceAppConfigContext);
  const config: Record<string, unknown> = { ...appConfig, ...(body as Record<string, unknown>) };
  delete config.key;
  // Lazy-load the registry to avoid a circular import cycle at module init.
  const [Component, setComponent] = useState<React.ComponentType<{ config?: Record<string, unknown> }> | null | "loading">("loading");
  useEffect(() => {
    import("./native-registry").then((m) => {
      setComponent(() => m.resolveNativeSurface(key) ?? null);
    });
  }, [key]);
  if (Component === "loading") return <Loading />;
  if (!Component) return <ErrLine msg={`Unknown native component: ${key}`} />;
  return (
    <Suspense fallback={<Loading />}>
      <Component config={config} />
    </Suspense>
  );
}

// lumid:tabs — tab container. Each tab has a label and an array of blocks,
// where each block is any directive config ({type, source, columns, ...}).
// Tabs themselves don't fetch — they just switch which blocks are rendered.
//
//   ```lumid:tabs
//   tabs:
//     - label: Gainers
//       blocks:
//         - type: chart
//           source: findata://market-movers?kind=gainer
//           path: data
//           x: symbol
//           y: changes_percentage
//         - type: table
//           source: findata://market-movers?kind=gainer
//           path: data
//           columns: [{key: symbol, label: Symbol}, ...]
//     - label: Losers
//       blocks:
//         - type: table
//           source: findata://market-movers?kind=loser
//           ...
//   ```
function LumidTabs({ body }: { body: Body }) {
  const tabs = (body.tabs as Array<{ label: string; blocks: Body[] }> | undefined) ?? [];
  const [active, setActive] = useState(0);
  if (!tabs.length) return <ErrLine msg="lumid:tabs: tabs list is empty" />;
  const cur = tabs[Math.min(active, tabs.length - 1)];
  return (
    <div>
      <div className="flex items-center gap-0.5 border-b border-slate-200 mb-3 -mx-3 px-3">
        {tabs.map((t, i) => (
          <button
            key={i}
            onClick={() => setActive(i)}
            className={[
              "px-3 py-1.5 text-sm border-b-2 -mb-px transition-colors whitespace-nowrap",
              active === i
                ? "border-slate-800 text-slate-900 font-medium"
                : "border-transparent text-slate-500 hover:text-slate-700",
            ].join(" ")}
          >
            {t.label}
          </button>
        ))}
      </div>
      {(cur.blocks ?? []).map((block, i) => {
        const type = String((block as Body).type ?? "");
        const Widget = WIDGETS[type];
        if (!Widget) return <ErrLine key={i} msg={`Unknown block type: ${type}`} />;
        return <Widget key={i} body={block as Body} />;
      })}
    </div>
  );
}

// lumid:search-table — a table with an inline search input that drives the
// source URL. The source_template must contain {query} which is replaced
// with the (URL-encoded) current search term.
//
//   ```lumid:search-table
//   source_template: "findata://kols/tweets/search?q={query}&limit=50"
//   default_query: "markets"
//   placeholder: "Search tweets…"
//   columns:
//     - key: kol_username
//       label: Handle
//     - key: text
//       label: Tweet
//   ```
function LumidSearchTable({ body }: { body: Body }) {
  const [query, setQuery] = useState(String(body.default_query ?? ""));
  const [committed, setCommitted] = useState(query);
  const template = String(body.source_template ?? "");
  const source = template.replace("{query}", encodeURIComponent(committed));
  const onKey = (e: React.KeyboardEvent) => { if (e.key === "Enter") setCommitted(query); };
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKey}
          placeholder={String(body.placeholder ?? "Search…")}
          className="flex-1 px-3 py-1.5 text-sm rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-teal-400/20 focus:border-teal-400"
        />
        <button
          onClick={() => setCommitted(query)}
          className="px-3 py-1.5 text-sm rounded-lg bg-slate-900 text-white hover:bg-slate-700 transition-colors"
        >
          Search
        </button>
      </div>
      {source && <LumidTable body={{ ...body, source }} />}
    </div>
  );
}

// ── dispatcher ───────────────────────────────────────────────────────────

// lumid:form — a parameter form that submits to an ALLOWLISTED backend action.
// The block names an `action` KEY (validated server-side against the allowlist
// in me_form_action.go) plus `fields`. It never references a raw URL, so a
// generated page can only trigger reviewed, scope-checked backend actions.
//
//   ```lumid:form
//   action: gpu_rental.create
//   submit_label: Create rental
//   fields:
//     - { key: gpu, label: GPU count, type: number, default: 1 }
//     - { key: mode, label: Access mode, type: select, options: [proxy, direct, forward], default: proxy }
//   ```
type FormField = {
  key: string; label?: string; type?: string;
  options?: string[]; default?: unknown; placeholder?: string; required?: boolean;
  group?: string;        // optional group heading (clusters related fields)
  full_width?: boolean;  // span all columns even in a multi-column grid
  // Dynamic select options from an ALLOWLISTED feed (never a free URL).
  // "pats://<audience>" (flowmesh | lumilake) — the user's own PATs as
  // run-as profiles (ids + names only; values are hashed, unrecoverable).
  options_source?: string;
  // advanced: true folds the field into a collapsed "Advanced" disclosure
  // at the end of the form — defaults stay in force when untouched.
  advanced?: boolean;
};

type SelectOption = { value: string; label: string };

// Allowlisted dynamic option feeds for lumid:form selects.
async function loadFieldOptions(source: string): Promise<SelectOption[]> {
  if (source.startsWith("pats://")) {
    const r = await apiClient.get("/api/v1/identity/personal-access-tokens?limit=100");
    // The identity API returns { id, name, token_prefix, status, revoked_at, … }.
    // Earlier code read `prefix` (always undefined) so every PAT showed as a
    // UUID shard; use token_prefix and prefer the explicit `status` flag.
    const rows = (r.data?.data?.tokens ?? []) as Array<{ id: string; name?: string; token_prefix?: string; status?: string; revoked_at?: number | string | null }>;
    return [
      { value: "session", label: "This session — full access, expires in minutes (recommended)" },
      ...rows
        .filter((t) => (t.status ? t.status === "active" : !t.revoked_at))
        .map((t) => ({ value: t.id, label: `PAT · ${t.name || t.token_prefix || t.id.slice(0, 8)}` })),
    ];
  }
  return [];
}

// One field's input + label — shared by grouped/columned rendering.
function FormFieldInput({ f, vals, setVals }: {
  f: FormField; vals: Record<string, unknown>; setVals: React.Dispatch<React.SetStateAction<Record<string, unknown>>>;
}) {
  const isWide = f.full_width || f.type === "textarea";
  // Associate the label with its control (htmlFor/id) so clicking the label
  // focuses the field and screen readers pair them. useId keeps ids unique
  // even when two forms on the same surface share a field key.
  const fid = useId();
  // Dynamic options (options_source) load once; static options render as-is.
  const [dynOptions, setDynOptions] = useState<SelectOption[] | null>(null);
  useEffect(() => {
    if (!f.options_source) return;
    let live = true;
    loadFieldOptions(f.options_source)
      .then((o) => { if (live) setDynOptions(o); })
      .catch(() => { if (live) setDynOptions([]); });
    return () => { live = false; };
  }, [f.options_source]);
  const selectOptions: SelectOption[] | null =
    f.type === "select"
      ? f.options_source
        ? dynOptions
        : Array.isArray(f.options) ? f.options.map((o) => ({ value: o, label: o })) : null
      : null;
  return (
    <div className={cn("flex flex-col gap-1", isWide && "sm:col-span-full")}>
      <label htmlFor={fid} className="text-[12px] font-medium text-slate-700">{f.label ?? f.key}</label>
      {f.type === "select" && (selectOptions || f.options_source) ? (
        <select
          id={fid}
          value={String(vals[f.key] ?? "")}
          onChange={(e) => setVals((v) => ({ ...v, [f.key]: e.target.value }))}
          className="rounded-md border border-slate-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400/20 focus:border-emerald-400"
        >
          {(selectOptions ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ) : f.type === "textarea" ? (
        <textarea
          id={fid}
          value={String(vals[f.key] ?? "")}
          placeholder={f.placeholder}
          onChange={(e) => setVals((v) => ({ ...v, [f.key]: e.target.value }))}
          className="rounded-md border border-slate-200 px-2.5 py-1.5 text-sm font-mono resize-y min-h-[60px] focus:outline-none focus:ring-2 focus:ring-emerald-400/20 focus:border-emerald-400"
        />
      ) : (
        <input
          id={fid}
          type={f.type === "number" ? "number" : f.type === "password" ? "password" : "text"}
          value={String(vals[f.key] ?? "")}
          placeholder={f.placeholder}
          required={f.required}
          onChange={(e) => setVals((v) => ({ ...v, [f.key]: e.target.value }))}
          className="rounded-md border border-slate-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400/20 focus:border-emerald-400"
        />
      )}
    </div>
  );
}

// Coerce a form value to the type its field declares (numbers as numbers so
// QA endpoints that expect numeric competition_id / quantity don't 400).
function coerceValues(fields: FormField[], vals: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = vals[f.key];
    out[f.key] = f.type === "number" && v !== "" && v != null ? Number(v) : v;
  }
  return out;
}

function LumidForm({ body }: { body: Body }) {
  const action = String(body.action ?? "");
  // submit_qa: a QuantArena path (e.g. /api/v1/competitions/28/join) the form
  // POSTs to client-side via the QA apiClient (session-bearer auth). This is
  // the write counterpart to the qa:// read sources — a generated surface can
  // trigger a real QA write without a per-app server allowlist entry, because
  // QA enforces auth + scope + role on its own endpoints.
  const submitQa = typeof body.submit_qa === "string" ? body.submit_qa : "";
  const submitMethod = String(body.submit_method ?? "POST").toUpperCase();
  const navigate = useNavigate();
  const redirectTo = typeof body.redirect_to === "string" ? body.redirect_to : "";
  const fields: FormField[] = Array.isArray(body.fields) ? (body.fields as FormField[]) : [];
  const submitLabel = String(body.submit_label ?? "Submit");
  const cols = Math.max(1, Math.min(3, Number(body.field_columns) || 1));
  const gridCls = cols === 3 ? "sm:grid-cols-3" : cols === 2 ? "sm:grid-cols-2" : "grid-cols-1";
  // Cluster fields into ordered groups (first-seen order; ungrouped = "").
  // advanced:true fields collect separately into one collapsed disclosure.
  const groups: { name: string; fields: FormField[] }[] = [];
  const advanced: FormField[] = [];
  for (const f of fields) {
    if (f.advanced) { advanced.push(f); continue; }
    const g = f.group || "";
    let bucket = groups.find((x) => x.name === g);
    if (!bucket) { bucket = { name: g, fields: [] }; groups.push(bucket); }
    bucket.fields.push(f);
  }
  const [vals, setVals] = useState<Record<string, unknown>>(() => {
    const init: Record<string, unknown> = {};
    for (const f of fields) if (f && f.key) init[f.key] = f.default ?? "";
    return init;
  });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  if (!action && !submitQa) return <ErrLine msg="lumid:form needs `action` or `submit_qa`" />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setResult(null);
    try {
      if (submitQa) {
        // A submit path still holding `{token}` means the surface was opened
        // without its route context — refuse with a hint, not a server 404.
        const tok = submitQa.match(/\{(\w+)\}/);
        if (tok) throw new Error(`This form needs a ${tok[1]} — open the page from its parent list first.`);
        // Client-side QuantArena write via the shared apiClient (session-bearer).
        const { default: apiClient } = await import("@/quantarena/api/client");
        const payload = coerceValues(fields, vals);
        if (submitMethod === "DELETE") await apiClient.delete(submitQa);
        else await apiClient.post(submitQa, payload);
        setResult({ ok: true, msg: String(body.success_message ?? "Done.") });
        if (redirectTo) setTimeout(() => navigate(redirectTo), 600);
      } else {
        const auth = await bearerHeader();
        const r = await fetch(`${ME_BASE}/api/v1/me/form-action`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...auth },
          credentials: "include",
          body: JSON.stringify({ action, values: vals }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || (j.ret_code !== undefined && j.ret_code !== 0)) {
          throw new Error(j.message || `HTTP ${r.status}`);
        }
        setResult({ ok: true, msg: "Submitted." });
      }
    } catch (err) {
      const m = (err as { message?: string })?.message ?? String(err);
      setResult({ ok: false, msg: m });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="my-3 rounded-lg border border-slate-200 bg-white p-4 space-y-4">
      {groups.map((g, gi) => (
        <div key={gi} className="space-y-2">
          {g.name && <div className="text-[12px] font-semibold text-slate-800 border-b border-slate-100 pb-1">{g.name}</div>}
          <div className={cn("grid gap-3", gridCls)}>
            {g.fields.map((f) => <FormFieldInput key={f.key} f={f} vals={vals} setVals={setVals} />)}
          </div>
        </div>
      ))}
      {advanced.length > 0 && (
        <details className="rounded-lg border border-slate-100 bg-slate-50/40 px-3 py-2">
          <summary className="text-[12px] font-medium text-slate-500 cursor-pointer select-none hover:text-slate-800 transition-colors">
            Advanced
          </summary>
          <div className={cn("grid gap-3 pt-3", gridCls)}>
            {advanced.map((f) => <FormFieldInput key={f.key} f={f} vals={vals} setVals={setVals} />)}
          </div>
        </details>
      )}
      {body.cost_estimate ? <CostEstimate cfg={body.cost_estimate as Record<string, unknown>} vals={vals} /> : null}
      <div className="flex items-center gap-2">
        <button
          type="submit" disabled={busy}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-sm hover:from-emerald-600 hover:to-teal-700 disabled:opacity-60 transition"
        >
          {busy ? "Submitting…" : submitLabel}
        </button>
        {result && (
          <span className={cn("text-[12px]", result.ok ? "text-emerald-600" : "text-rose-600")}>{result.msg}</span>
        )}
      </div>
    </form>
  );
}

// CostEstimate — a live, flat-rate cost panel for a lumid:form. Rates come
// from the form's cost_estimate config (not hardcoded in the widget) and the
// estimate recomputes from the form's own field values. Faithfully reproduces
// the native wizard's cost card.
//   cost_estimate: { gpu_field, cpu_field, ttl_field, gpu_rate, cpu_rate }
function CostEstimate({ cfg, vals }: { cfg: Record<string, unknown>; vals: Record<string, unknown> }) {
  const num = (v: unknown) => { const n = Number(v); return isFinite(n) ? n : 0; };
  const gpuRate = num(cfg.gpu_rate);
  const cpuRate = num(cfg.cpu_rate);
  const gpu = num(vals[String(cfg.gpu_field ?? "gpu")]);
  const cpu = num(vals[String(cfg.cpu_field ?? "cpu")]);
  const ttlMin = num(vals[String(cfg.ttl_field ?? "ttl_minutes")]) || 60;
  const perHr = gpu * gpuRate + cpu * cpuRate;
  const forRun = perHr * (ttlMin / 60);
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3 text-[12px] text-slate-600 space-y-1">
      <div className="font-medium text-slate-700">Cost estimate</div>
      <div className="text-[11px] text-slate-400 leading-snug">
        Flat-rate estimate before a worker is assigned. Actual cost is measured per-second against the worker's published rate; any difference settles into the ledger at teardown.
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-0.5 pt-1">
        <span>Rate (GPU): <span className="tabular-nums">${gpuRate.toFixed(2)}/hr each</span></span>
        <span>Rate (CPU): <span className="tabular-nums">${cpuRate.toFixed(2)}/hr each</span></span>
      </div>
      <div className="font-medium text-slate-800 tabular-nums">
        This rental: ${perHr.toFixed(2)}/hr · ~${forRun.toFixed(2)} for {ttlMin} min
      </div>
    </div>
  );
}

// lumid:columns — lay child widgets side by side in a responsive N-column grid
// (1 column on mobile). Each block is a normal widget {type, ...config}.
//   ```lumid:columns
//   columns: 2
//   blocks:
//     - { type: stat, source: me://gpu-rentals, path: count, label: "Active" }
//     - { type: table, source: me://gpu-rentals, path: rentals, columns: [...] }
//   ```
function LumidColumns({ body }: { body: Body }) {
  const n = Math.max(1, Math.min(4, Number(body.columns) || 2));
  const blocks = (body.blocks as Body[] | undefined) ?? [];
  if (!blocks.length) return <ErrLine msg="lumid:columns: blocks list is empty" />;
  const gridCls = n === 4 ? "lg:grid-cols-4" : n === 3 ? "lg:grid-cols-3" : "lg:grid-cols-2";
  return (
    <div className={cn("grid grid-cols-1 gap-4 my-3 items-start", gridCls)}>
      {blocks.map((block, i) => {
        const type = String((block as Body).type ?? "");
        const Widget = WIDGETS[type];
        if (!Widget) return <ErrLine key={i} msg={`Unknown block type: ${type}`} />;
        return <div key={i} className="min-w-0"><Widget body={block as Body} /></div>;
      })}
    </div>
  );
}

// lumid:workflow — showcase the app's pipeline as a node canvas (D2).
// Renders the loop's declared structure (read-only, compact); set
// `cycle: latest` to overlay the most recent run's per-step statuses.
//
//   ```lumid:workflow
//   loop: case_cycle
//   cycle: latest        # optional; omit for pure structure
//   app: mbb-ai          # optional; defaults to the surface's app
//   ```
function LumidWorkflow({ body }: { body: Body }) {
  const routeParams = useRouteParams();
  const app = String(body.app ?? routeParams.app ?? "");
  const loop = String(body.loop ?? "");
  const wantLatest = String(body.cycle ?? "") === "latest";
  const [def, setDef] = useState<import("@/api/me").LoopDefinition | null>(null);
  const [cycle, setCycle] = useState<import("@/api/me").MeCycleDetail | null>(null);
  const [Canvas, setCanvas] = useState<React.ComponentType<any> | null>(null);
  useEffect(() => {
    // Lazy-load the canvas (xyflow) so app surfaces without the
    // directive never pay for it.
    import("@/components/workflow/WorkflowCanvas").then((m) => setCanvas(() => m.default));
  }, []);
  useEffect(() => {
    if (!app || !loop) return;
    let live = true;
    import("@/api/me").then(({ me }) => {
      me.workflowDetail(`${app}:${loop}`)
        .then((r) => { if (live) setDef((r.definition || null) as any); })
        .catch(() => { /* hidden below */ });
      if (wantLatest) {
        import("@/api/client").then(({ default: apiClient }) => {
          apiClient.get(`/api/v1/me/cycles?app=${encodeURIComponent(app)}&loop=${encodeURIComponent(loop)}&limit=1`)
            .then((l: any) => {
              const ts = l.data?.data?.cycles?.[0]?.ts;
              if (!ts) return;
              return apiClient.get(`/api/v1/me/cycles/${encodeURIComponent(app)}/${encodeURIComponent(loop)}/${encodeURIComponent(ts)}`)
                .then((r: any) => { if (live) setCycle((r.data?.data ?? null) as any); });
            })
            .catch(() => { /* structure-only */ });
        });
      }
    });
    return () => { live = false; };
  }, [app, loop, wantLatest]);
  if (!app || !loop) return <ErrLine msg="lumid:workflow needs a `loop:` (and an app context)" />;
  if (!def || !Canvas) return <Loading />;
  return <Canvas definition={def} cycle={cycle} mode="showcase" />;
}

// lumid:ask — prompt chips that route into the Studio chat rail with
// this app as structured grounding (C5). The visible affordance for
// "chat is the action surface" on app-authored pages.
//
//   ```lumid:ask
//   prompts:
//     - How is this app doing this week?
//     - Run the case_cycle workflow now
//   loop: case_cycle     # optional grounding refinement
//   ```
function LumidAsk({ body }: { body: Body }) {
  const routeParams = useRouteParams();
  const app = String(body.app ?? routeParams.app ?? "");
  const loop = body.loop ? String(body.loop) : undefined;
  const prompts = Array.isArray(body.prompts) ? body.prompts.map(String) : [];
  if (prompts.length === 0) return <ErrLine msg="lumid:ask needs prompts: [...]" />;
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      {prompts.map((p) => (
        <button
          key={p}
          onClick={() =>
            window.dispatchEvent(new CustomEvent("studio:ask", {
              detail: {
                prompt: p,
                autosend: true,
                context: { page: "app-surface", ...(app ? { app } : {}), ...(loop ? { loop } : {}) },
              },
            }))
          }
          className="group px-3 py-1.5 rounded-full border border-emerald-200/70 bg-white hover:bg-emerald-50 text-emerald-800 hover:border-emerald-300 transition-all active:scale-[0.98]"
        >
          <span className="opacity-60 group-hover:opacity-100 transition-opacity mr-0.5">›</span>
          {p}
        </button>
      ))}
    </div>
  );
}

const WIDGETS: Record<string, (p: { body: Body }) => React.ReactElement> = {
  stat: LumidStat,
  table: LumidTable,
  chart: LumidChart,
  list: LumidList,
  action: LumidAction,
  native: LumidNative,
  tabs: LumidTabs,
  form: LumidForm,
  columns: LumidColumns,
  "search-table": LumidSearchTable,
  workflow: LumidWorkflow,
  ask: LumidAsk,
};

/** Returns true for fenced-block classNames that are Lumid directives. */
export function isLumidDirective(className?: string): boolean {
  return !!className && className.startsWith("language-lumid:");
}

/** Render a `lumid:<type>` fenced block. `className` is "language-lumid:<type>". */
export function LumidDirective({ className, raw }: { className?: string; raw: string }) {
  const type = (className ?? "").replace("language-lumid:", "").trim();
  const Widget = WIDGETS[type];
  const params = useContext(SurfaceParamsContext);
  let body: Body = {};
  let parseErr = "";
  try {
    const parsed = raw.trim() ? parseYaml(raw) : {};
    body = (parsed && typeof parsed === "object") ? interpolate(parsed as Body, params) : {};
  } catch (e) {
    parseErr = String((e as Error)?.message ?? e);
  }
  const title = body.title ? String(body.title) : undefined;
  if (!Widget) {
    // Graceful fallback — show the raw directive labelled.
    return (
      <Shell title={`lumid:${type} (unsupported)`}>
        <pre className="text-[11px] text-slate-500 whitespace-pre-wrap">{raw}</pre>
      </Shell>
    );
  }
  if (parseErr) return <Shell title={`lumid:${type}`}><ErrLine msg={`config parse error: ${parseErr}`} /></Shell>;
  // Every rendered directive block is pickable by the chat's crosshair —
  // app-authored surfaces get "point at this widget" for free.
  return (
    <Shell title={title} pickKind="surface-block" pickId={`${type}:${title || body.loop || body.source || ""}`}>
      <Widget body={body} />
    </Shell>
  );
}

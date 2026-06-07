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
// `/findata-cloud/*` proxy — never arbitrary URLs. `lumid:iframe` `src` is
// restricted to same-origin proxy prefixes. Unknown directive types fall
// back to a labelled code block (graceful degradation).

import { useEffect, useState } from "react";
import { parse as parseYaml } from "yaml";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer,
} from "recharts";
import { me } from "@/api/me";

// ── source allowlist ──────────────────────────────────────────────────────

const FINDATA_PREFIX = "findata://";
const IFRAME_ALLOW = ["/findata-cloud/", "/grafana/", "/analytics/"];

/** Resolve a directive `source` spec to data. Throws on anything not allowlisted. */
export async function resolveSource(spec: string): Promise<unknown> {
  if (spec.startsWith("me://")) {
    const p = spec.slice("me://".length).replace(/^\/+/, "");
    switch (p) {
      case "today":             return me.today();
      case "workflows":         return me.listWorkflows();
      case "loops/health":
      case "loops-health":      return me.loopsHealth();
      case "apps":              return me.listApps();
      default:                  throw new Error(`source not allowed: ${spec}`);
    }
  }
  if (spec.startsWith(FINDATA_PREFIX)) {
    const path = spec.slice(FINDATA_PREFIX.length).replace(/^\/+/, "");
    const r = await fetch(`/findata-cloud/${path}`, { credentials: "omit" });
    if (!r.ok) throw new Error(`findata ${r.status}`);
    return r.json();
  }
  throw new Error(`source scheme not allowed: ${spec}`);
}

/** Dot-path getter. "" / "." returns the root. */
function getPath(obj: unknown, path?: string): unknown {
  if (!path || path === ".") return obj;
  return path.split(".").reduce<unknown>(
    (o, k) => (o == null ? o : (o as Record<string, unknown>)[k]),
    obj,
  );
}

function useSource(spec?: string) {
  const [state, setState] = useState<{ data?: unknown; loading: boolean; error?: string }>(
    { loading: !!spec },
  );
  useEffect(() => {
    if (!spec) { setState({ loading: false }); return; }
    let live = true;
    setState({ loading: true });
    resolveSource(spec)
      .then((data) => { if (live) setState({ data, loading: false }); })
      .catch((e) => { if (live) setState({ loading: false, error: String(e?.message ?? e) }); });
    return () => { live = false; };
  }, [spec]);
  return state;
}

function Shell({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="my-3 rounded-lg border border-slate-200 bg-white overflow-hidden">
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

// ── widgets ────────────────────────────────────────────────────────────────

type Body = Record<string, unknown>;

function LumidStat({ body }: { body: Body }) {
  const { data, loading, error } = useSource(body.source as string | undefined);
  if (loading) return <Loading />;
  if (error) return <ErrLine msg={error} />;
  const base = getPath(data, body.path as string | undefined);
  let value: unknown;
  if (body.value === "count") value = Array.isArray(base) ? base.length : base == null ? 0 : Object.keys(base as object).length;
  else if (body.value) value = getPath(base, body.value as string);
  else value = base;
  return (
    <div className="inline-flex flex-col rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 min-w-[120px]">
      <span className="text-2xl font-semibold text-slate-900 tabular-nums">{String(value ?? "—")}</span>
      <span className="text-[11px] uppercase tracking-wide text-slate-500 mt-0.5">{String(body.label ?? "")}</span>
    </div>
  );
}

function LumidTable({ body }: { body: Body }) {
  const { data, loading, error } = useSource(body.source as string | undefined);
  if (loading) return <Loading />;
  if (error) return <ErrLine msg={error} />;
  const rows = getPath(data, body.path as string | undefined);
  const cols = (body.columns as { key: string; label?: string }[] | undefined) ?? [];
  if (!Array.isArray(rows) || rows.length === 0) return <div className="text-[12px] text-slate-400">No rows.</div>;
  const columns = cols.length ? cols : Object.keys(rows[0] as object).map((k) => ({ key: k, label: k }));
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="min-w-full text-[12px] border-collapse">
        <thead className="bg-slate-50 border-b border-slate-200">
          <tr>{columns.map((c) => <th key={c.key} className="px-2.5 py-1.5 text-left font-semibold text-slate-700">{c.label ?? c.key}</th>)}</tr>
        </thead>
        <tbody>
          {(rows as Record<string, unknown>[]).slice(0, 200).map((row, i) => (
            <tr key={i} className="border-b border-slate-100 last:border-b-0">
              {columns.map((c) => <td key={c.key} className="px-2.5 py-1.5 text-slate-700 align-top">{String(row[c.key] ?? "")}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LumidChart({ body }: { body: Body }) {
  const { data, loading, error } = useSource(body.source as string | undefined);
  if (loading) return <Loading />;
  if (error) return <ErrLine msg={error} />;
  const rows = getPath(data, body.path as string | undefined);
  if (!Array.isArray(rows) || rows.length === 0) return <div className="text-[12px] text-slate-400">No data.</div>;
  const x = (body.x as string) ?? "x";
  const ys = Array.isArray(body.y) ? (body.y as string[]) : [(body.y as string) ?? "y"];
  const kind = (body.kind as string) ?? "line";
  const palette = ["#059669", "#6366f1", "#f59e0b", "#ef4444", "#0ea5e9"];
  return (
    <ResponsiveContainer width="100%" height={240}>
      {kind === "bar" ? (
        <BarChart data={rows as object[]}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
          <XAxis dataKey={x} tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} /><Tooltip />
          {ys.map((k, i) => <Bar key={k} dataKey={k} fill={palette[i % palette.length]} />)}
        </BarChart>
      ) : (
        <LineChart data={rows as object[]}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
          <XAxis dataKey={x} tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} /><Tooltip />
          {ys.map((k, i) => <Line key={k} type="monotone" dataKey={k} stroke={palette[i % palette.length]} dot={false} />)}
        </LineChart>
      )}
    </ResponsiveContainer>
  );
}

function LumidList({ body }: { body: Body }) {
  const { data, loading, error } = useSource(body.source as string | undefined);
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

function LumidIframe({ body }: { body: Body }) {
  const src = String(body.src ?? "");
  const ok = IFRAME_ALLOW.some((p) => src.startsWith(p));
  if (!ok) return <ErrLine msg={`iframe src not allowed: ${src || "(empty)"}`} />;
  const height = typeof body.height === "number" ? body.height : 480;
  return (
    <iframe
      src={src}
      title={String(body.title ?? "embed")}
      style={{ width: "100%", height, border: 0 }}
      className="rounded-lg border border-slate-200"
      sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
    />
  );
}

// ── dispatcher ───────────────────────────────────────────────────────────

const WIDGETS: Record<string, (p: { body: Body }) => React.ReactElement> = {
  stat: LumidStat,
  table: LumidTable,
  chart: LumidChart,
  list: LumidList,
  action: LumidAction,
  iframe: LumidIframe,
};

/** Returns true for fenced-block classNames that are Lumid directives. */
export function isLumidDirective(className?: string): boolean {
  return !!className && className.startsWith("language-lumid:");
}

/** Render a `lumid:<type>` fenced block. `className` is "language-lumid:<type>". */
export function LumidDirective({ className, raw }: { className?: string; raw: string }) {
  const type = (className ?? "").replace("language-lumid:", "").trim();
  const Widget = WIDGETS[type];
  let body: Body = {};
  let parseErr = "";
  try {
    const parsed = raw.trim() ? parseYaml(raw) : {};
    body = (parsed && typeof parsed === "object") ? (parsed as Body) : {};
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
  return <Shell title={title}><Widget body={body} /></Shell>;
}

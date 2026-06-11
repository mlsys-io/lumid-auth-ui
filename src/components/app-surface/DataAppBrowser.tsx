// Generic data-app catalog browser — the configurable explorer surface.
//
// Renders `lumid:native: data-app-browser` with config `{ data_app, label }`.
// `data_app` is an ALLOWLISTED base-id (server-side nginx /dataapp-proxy/<id>/
// maps it to an upstream lumid-data-service app — no URL travels from here, so
// no SSRF). The component is data-app-agnostic: it fetches the app's public
// /openapi.json, lists every declarative read endpoint grouped by path family,
// lets the user fill path/query params, runs the endpoint (bearer-authed,
// gated), and renders the JSON result as a generic table.
//
// This is the "point at any data-app" generality the curated per-domain
// surfaces (lumid-data-findata) trade away for polish.

import { useEffect, useMemo, useState } from "react";
import { bearerHeader } from "@/api/session-bearer";

type Param = { name: string; in: "path" | "query"; required?: boolean; type?: string };
// kind: how the endpoint is consumed. The platform's OpenAPI doc carries no
// structured marker for this, so we classify from the operation summary/
// description ("WebSocket upgrade…", "Server-Sent Events…"). ws/sse endpoints
// can't be run by a plain fetch (the 400 the server returns is correct) — the
// runner pane shows how to consume them instead of a Run button.
type EndpointKind = "rest" | "ws" | "sse";
type Endpoint = { path: string; method: string; params: Param[]; group: string; kind: EndpointKind; summary?: string };
// One allowlisted data source, as served by the public /dataapp-proxy/_sources
// registry (a static JSON living NEXT TO the nginx allowlist, so the picker
// can never offer an id the proxy would 404).
type SourceDef = { id: string; label?: string; description?: string };

function proxyBase(dataApp: string): string {
  return `/dataapp-proxy/${encodeURIComponent(dataApp)}`;
}

// Parse the OpenAPI 3.1 doc the platform serves into a flat endpoint list.
function parseOpenApi(doc: any): Endpoint[] {
  const out: Endpoint[] = [];
  const paths = (doc && doc.paths) || {};
  for (const path of Object.keys(paths)) {
    const methods = paths[path] || {};
    for (const method of Object.keys(methods)) {
      const op = methods[method] || {};
      const params: Param[] = (op.parameters || []).map((p: any) => ({
        name: p.name,
        in: p.in === "path" ? "path" : "query",
        required: !!p.required || p.in === "path",
        type: p.schema?.type,
      }));
      // Group by first path segment (e.g. /fundamentals/{symbol} → fundamentals).
      const seg = path.split("/").filter(Boolean)[0] || "misc";
      const blurb = `${op.summary || ""} ${op.description || ""}`;
      const kind: EndpointKind = /websocket/i.test(blurb) || seg === "ws"
        ? "ws"
        : /\bSSE\b|server-sent events/i.test(blurb)
          ? "sse"
          : "rest";
      out.push({ path, method: method.toUpperCase(), params, group: seg, kind, summary: op.summary });
    }
  }
  out.sort((a, b) => (a.group + a.path).localeCompare(b.group + b.path));
  return out;
}

// Build the concrete request path from the template + user-entered values.
function buildPath(ep: Endpoint, vals: Record<string, string>): string {
  let p = ep.path;
  const qs: string[] = [];
  for (const param of ep.params) {
    const v = (vals[param.name] ?? "").trim();
    if (param.in === "path") {
      p = p.replace(`{${param.name}}`, encodeURIComponent(v || ""));
    } else if (v !== "") {
      qs.push(`${encodeURIComponent(param.name)}=${encodeURIComponent(v)}`);
    }
  }
  return qs.length ? `${p}?${qs.join("&")}` : p;
}

function ResultTable({ data }: { data: unknown }) {
  const rows: any[] = Array.isArray(data)
    ? data
    : data && typeof data === "object" && Array.isArray((data as any).data)
      ? (data as any).data
      : data && typeof data === "object"
        ? [data]
        : [];
  if (!rows.length) {
    return <pre className="text-[11px] bg-slate-50 border border-slate-200 rounded p-2 overflow-auto max-h-[420px]">{JSON.stringify(data, null, 2)}</pre>;
  }
  const cols = Array.from(rows.slice(0, 50).reduce((s: Set<string>, r) => {
    if (r && typeof r === "object") Object.keys(r).forEach((k) => s.add(k));
    return s;
  }, new Set<string>())).slice(0, 12);
  const cell = (v: unknown) => (v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));
  return (
    <div className="overflow-auto max-h-[480px] border border-slate-200 rounded">
      <table className="w-full text-[11px]">
        <thead className="bg-slate-100 sticky top-0">
          <tr>{cols.map((c) => <th key={c} className="text-left px-2 py-1 font-medium text-slate-600">{c}</th>)}</tr>
        </thead>
        <tbody>
          {rows.slice(0, 200).map((r, i) => (
            <tr key={i} className="odd:bg-white even:bg-slate-50">
              {cols.map((c) => <td key={c} className="px-2 py-1 align-top truncate max-w-[220px]" title={cell(r?.[c])}>{cell(r?.[c])}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="text-[10px] text-slate-400 px-2 py-1">{rows.length} row(s){rows.length > 200 ? " (showing 200)" : ""}</div>
    </div>
  );
}

export default function DataAppBrowser({ config }: { config?: Record<string, unknown> }) {
  const defaultApp = String(config?.data_app ?? "findata");

  // Available sources from the public registry; the dropdown lets users
  // switch sources without editing the surface markdown. The directive's
  // data_app is just the initial selection.
  const [sources, setSources] = useState<SourceDef[]>([]);
  const [dataApp, setDataApp] = useState(defaultApp);
  const current = sources.find((s) => s.id === dataApp);
  const label = current?.label ?? String(config?.label ?? config?.data_app_label ?? dataApp);

  useEffect(() => {
    let live = true;
    fetch("/dataapp-proxy/_sources", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (live && Array.isArray(j?.sources)) setSources(j.sources); })
      .catch(() => { /* registry missing — picker just doesn't render */ });
    return () => { live = false; };
  }, []);

  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [loadErr, setLoadErr] = useState<string>("");
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<Endpoint | null>(null);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [result, setResult] = useState<unknown>(null);
  // Non-JSON 200s (e.g. a /status HTML page) — shown as raw text so Run never
  // silently renders nothing.
  const [resultText, setResultText] = useState<{ ctype: string; text: string } | null>(null);
  const [running, setRunning] = useState(false);
  const [runErr, setRunErr] = useState("");

  useEffect(() => {
    let live = true;
    (async () => {
      setLoadErr(""); setEndpoints([]);
      try {
        const auth = await bearerHeader();
        const r = await fetch(`${proxyBase(dataApp)}/openapi.json`, { credentials: "same-origin", headers: auth });
        if (!r.ok) throw new Error(`openapi ${r.status}`);
        const doc = await r.json();
        if (live) setEndpoints(parseOpenApi(doc));
      } catch (e: any) {
        if (live) setLoadErr(String(e?.message || e));
      }
    })();
    return () => { live = false; };
  }, [dataApp]);

  const groups = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const list = f ? endpoints.filter((e) => e.path.toLowerCase().includes(f) || e.group.includes(f)) : endpoints;
    const m = new Map<string, Endpoint[]>();
    for (const e of list) { if (!m.has(e.group)) m.set(e.group, []); m.get(e.group)!.push(e); }
    return Array.from(m.entries());
  }, [endpoints, filter]);

  const pick = (ep: Endpoint) => { setSelected(ep); setResult(null); setResultText(null); setRunErr(""); setVals({}); };

  const run = async () => {
    if (!selected) return;
    const missing = selected.params.filter((p) => p.in === "path" && !(vals[p.name] || "").trim());
    if (missing.length) { setRunErr(`required: ${missing.map((p) => p.name).join(", ")}`); return; }
    setRunning(true); setRunErr(""); setResult(null); setResultText(null);
    try {
      const auth = await bearerHeader();
      const r = await fetch(`${proxyBase(dataApp)}/${buildPath(selected, vals).replace(/^\/+/, "")}`, { credentials: "same-origin", headers: auth });
      const raw = await r.text();
      let body: any = null;
      try { body = JSON.parse(raw); } catch { /* non-JSON — handled below */ }
      if (!r.ok) throw new Error(`${r.status} ${body?.error || body?.detail || raw.slice(0, 200)}`.trim());
      if (body !== null) setResult(body);
      else setResultText({ ctype: r.headers.get("content-type") || "unknown", text: raw.slice(0, 20_000) });
    } catch (e: any) {
      setRunErr(String(e?.message || e));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex gap-4 h-[640px]">
      {/* Left: endpoint catalog */}
      <div className="w-[320px] flex-shrink-0 flex flex-col border border-slate-200 rounded">
        <div className="p-2 border-b border-slate-200 space-y-1">
          {sources.length > 0 ? (
            <select
              value={dataApp}
              onChange={(e) => { setDataApp(e.target.value); setSelected(null); setResult(null); setRunErr(""); }}
              title={current?.description}
              className="w-full text-[12px] px-1.5 py-1 border border-slate-300 rounded bg-white text-slate-700"
            >
              {/* Keep an entry for a configured id missing from the registry so
                  the select isn't silently wrong (it'll 404 on fetch instead). */}
              {!sources.some((s) => s.id === dataApp) && <option value={dataApp}>{dataApp} (not allowlisted)</option>}
              {sources.map((s) => <option key={s.id} value={s.id}>{s.label || s.id}</option>)}
            </select>
          ) : (
            <div className="text-[12px] font-medium text-slate-700">{label}</div>
          )}
          {current?.description && <div className="text-[10px] text-slate-400 leading-snug">{current.description}</div>}
          <div className="text-[11px] text-slate-500">{endpoints.length} endpoints</div>
          <input
            value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="filter endpoints…"
            className="w-full text-[12px] px-2 py-1 border border-slate-300 rounded"
          />
        </div>
        <div className="overflow-auto flex-1">
          {loadErr && <div className="p-2 text-[11px] text-red-600">catalog error: {loadErr}</div>}
          {groups.map(([g, eps]) => (
            <div key={g}>
              <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-slate-400 bg-slate-50 sticky top-0">{g}</div>
              {eps.map((ep) => (
                <button key={ep.method + ep.path} onClick={() => pick(ep)}
                  className={["w-full text-left px-2 py-1 text-[11px] font-mono hover:bg-violet-50 truncate",
                    selected?.path === ep.path ? "bg-violet-100 text-violet-800" : "text-slate-600"].join(" ")}
                  title={ep.path}>
                  {ep.kind !== "rest" && (
                    <span className="inline-block mr-1 px-1 rounded text-[9px] font-sans font-semibold bg-amber-100 text-amber-700 align-middle">
                      {ep.kind.toUpperCase()}
                    </span>
                  )}
                  {ep.path}
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Right: params + result */}
      <div className="flex-1 flex flex-col min-w-0">
        {!selected ? (
          <div className="text-[12px] text-slate-400 p-4">Pick an endpoint to query {label}. Fill any parameters, then Run.</div>
        ) : (
          <>
            <div className="font-mono text-[12px] text-slate-700 mb-1">{selected.method} {selected.path}</div>
            {selected.summary && <div className="text-[11px] text-slate-500 mb-2">{selected.summary}</div>}
            {selected.kind !== "rest" ? (
              // Streaming endpoints aren't runnable by a one-shot fetch — show
              // how to consume them instead of a Run that can only 400.
              <div className="rounded border border-amber-200 bg-amber-50 p-3 text-[12px] text-amber-800 space-y-1.5 max-w-xl">
                {selected.kind === "sse" ? (
                  <>
                    <div className="font-medium">Streaming endpoint (Server-Sent Events)</div>
                    <div>Consume it with an EventSource against the same-origin proxy:</div>
                    <pre className="text-[11px] bg-white border border-amber-200 rounded p-2 overflow-x-auto text-slate-700">{`new EventSource("${proxyBase(dataApp)}${selected.path}")`}</pre>
                  </>
                ) : (
                  <>
                    <div className="font-medium">WebSocket endpoint</div>
                    <div>Browsers can&apos;t open WS through this panel — connect a WS client directly to the data service (bearer auth via header or first message):</div>
                    <pre className="text-[11px] bg-white border border-amber-200 rounded p-2 overflow-x-auto text-slate-700">{`wss://<data-service-host>${selected.path}`}</pre>
                  </>
                )}
              </div>
            ) : (
            <>
            <div className="flex flex-wrap gap-2 mb-2">
              {selected.params.length === 0 && <span className="text-[11px] text-slate-400">no parameters</span>}
              {selected.params.map((p) => (
                <label key={p.name} className="text-[11px] text-slate-600 flex flex-col">
                  <span>{p.name}{p.in === "path" ? " *" : ""} <span className="text-slate-300">{p.type || p.in}</span></span>
                  <input
                    value={vals[p.name] ?? ""} onChange={(e) => setVals((v) => ({ ...v, [p.name]: e.target.value }))}
                    placeholder={p.in === "path" ? "(required)" : ""}
                    className="text-[12px] px-2 py-1 border border-slate-300 rounded w-40"
                  />
                </label>
              ))}
            </div>
            <div className="mb-2">
              <button onClick={run} disabled={running}
                className="text-[12px] px-3 py-1 rounded bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50">
                {running ? "Running…" : "Run"}
              </button>
              {runErr && <span className="ml-2 text-[11px] text-red-600">{runErr}</span>}
            </div>
            {result != null && <ResultTable data={result} />}
            {resultText && (
              <div>
                <div className="text-[10px] text-slate-400 mb-1">non-JSON response ({resultText.ctype})</div>
                <pre className="text-[11px] bg-slate-50 border border-slate-200 rounded p-2 overflow-auto max-h-[420px] whitespace-pre-wrap">{resultText.text}</pre>
              </div>
            )}
            </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// Federated data-lake viewer — one screen to browse the whole Lumid data mesh.
//
// Renders `lumid:native: data-lake-viewer` (also mounted directly at
// /studio/a/lumid-data-lake). It fans out to each instance's EXISTING catalog +
// sample endpoints over same-origin base paths and merges client-side — no
// platform aggregation hub. Read-only: catalog tree, table profile/columns,
// capped sample preview, freshness. Per-instance failures isolate to one card.
//
// Data never moves: only catalog metadata and a CAPPED sample (via /retrieve → a
// small materialized blob) ever cross the wire. Bulk export is a deferred phase.

import { useEffect, useMemo, useState } from "react";
import {
  LAKE_INSTANCES,
  federatedCatalog,
  lake,
  fmtBytes,
  fmtRows,
  type InstanceCatalog,
  type LakeInstance,
  type TableEntry,
  type JsonSchema,
  type SampleResult,
} from "@/api/dataLake";

// ── Small shared bits ────────────────────────────────────────────────────────

function FreshnessPill({ f }: { f?: InstanceCatalog["freshness"] }) {
  if (!f) return null;
  const cell = (n: number, cls: string, title: string) =>
    n > 0 ? (
      <span className={`px-1 rounded ${cls}`} title={title}>
        {n}
      </span>
    ) : null;
  return (
    <span className="inline-flex gap-1 text-[10px] font-medium">
      {cell(f.green, "bg-emerald-100 text-emerald-700", "fresh")}
      {cell(f.amber, "bg-amber-100 text-amber-700", "stale")}
      {cell(f.red, "bg-red-100 text-red-700", "overdue")}
      {cell(f.gray, "bg-slate-100 text-slate-500", "unknown")}
    </span>
  );
}

function GenericTable({ rows }: { rows: Record<string, unknown>[] }) {
  if (!rows.length) {
    return <div className="text-[12px] text-slate-400 p-4">No rows.</div>;
  }
  const cols = Array.from(
    rows.slice(0, 100).reduce((s: Set<string>, r) => {
      if (r && typeof r === "object") Object.keys(r).forEach((k) => s.add(k));
      return s;
    }, new Set<string>()),
  ).slice(0, 20);
  const cell = (v: unknown) =>
    v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
  return (
    <div className="overflow-auto max-h-[520px] border border-slate-200 rounded">
      <table className="w-full text-[11px]">
        <thead className="bg-slate-100 sticky top-0">
          <tr>
            {cols.map((c) => (
              <th key={c} className="text-left px-2 py-1 font-medium text-slate-600 whitespace-nowrap">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 500).map((r, i) => (
            <tr key={i} className="odd:bg-white even:bg-slate-50">
              {cols.map((c) => (
                <td
                  key={c}
                  className="px-2 py-1 align-top truncate max-w-[240px]"
                  title={cell(r?.[c])}
                >
                  {cell(r?.[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="text-[10px] text-slate-400 px-2 py-1">
        {rows.length} row(s){rows.length > 500 ? " (showing 500)" : ""}
      </div>
    </div>
  );
}

// ── Table detail (right pane) ────────────────────────────────────────────────

type Tab = "sample" | "columns" | "profile";

interface Selection {
  inst: LakeInstance;
  schema: string;
  table: TableEntry;
}

function TableDetail({ sel }: { sel: Selection }) {
  const [tab, setTab] = useState<Tab>("sample");
  const [sample, setSample] = useState<SampleResult | null>(null);
  const [cols, setCols] = useState<JsonSchema | null>(null);
  const [profile, setProfile] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [limit, setLimit] = useState(100);

  const key = `${sel.inst.id}/${sel.schema}/${sel.table.table}`;

  // Reset when the selected table changes.
  useEffect(() => {
    setTab("sample");
    setSample(null);
    setCols(null);
    setProfile(null);
    setErr("");
  }, [key]);

  useEffect(() => {
    let live = true;
    (async () => {
      setBusy(true);
      setErr("");
      try {
        if (tab === "sample" && !sample) {
          const r = await lake.sample(sel.inst.basePath, sel.schema, sel.table.table, limit);
          if (live) setSample(r);
        } else if (tab === "columns" && !cols) {
          const r = await lake.tableColumns(sel.inst.basePath, sel.schema, sel.table.table);
          if (live) setCols(r);
        } else if (tab === "profile" && !profile) {
          const r = await lake.tableProfile(sel.inst.basePath, sel.schema, sel.table.table);
          if (live) setProfile(r);
        }
      } catch (e: unknown) {
        if (live) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (live) setBusy(false);
      }
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, key]);

  const reSample = async () => {
    setBusy(true);
    setErr("");
    try {
      const r = await lake.sample(sel.inst.basePath, sel.schema, sel.table.table, limit);
      setSample(r);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const t = sel.table;
  const colProps = cols?.properties ?? {};
  const required = new Set(cols?.required ?? []);

  return (
    <div className="flex-1 flex flex-col min-w-0">
      <div className="mb-2">
        <div className="font-mono text-[13px] text-slate-800">
          <span className="text-slate-400">{sel.inst.label} ·</span> {sel.schema}.
          <span className="font-semibold">{t.table}</span>
        </div>
        <div className="text-[11px] text-slate-500 flex gap-3 mt-0.5">
          <span>{fmtRows(t.est_rows)} rows</span>
          <span>{fmtBytes(t.size_bytes)}</span>
          {t.is_hypertable && <span className="text-violet-600">hypertable</span>}
          {t.comment && <span className="italic truncate max-w-[360px]" title={t.comment}>{t.comment}</span>}
        </div>
      </div>

      <div className="flex gap-1 border-b border-slate-200 mb-2">
        {(["sample", "columns", "profile"] as Tab[]).map((x) => (
          <button
            key={x}
            onClick={() => setTab(x)}
            className={[
              "text-[12px] px-3 py-1 -mb-px border-b-2 capitalize",
              tab === x
                ? "border-violet-600 text-violet-700 font-medium"
                : "border-transparent text-slate-500 hover:text-slate-700",
            ].join(" ")}
          >
            {x}
          </button>
        ))}
      </div>

      {err && <div className="text-[11px] text-red-600 mb-2">error: {err}</div>}

      {tab === "sample" && (
        <>
          <div className="flex items-center gap-2 mb-2 text-[11px] text-slate-500">
            <span>rows</span>
            <select
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              className="border border-slate-300 rounded px-1 py-0.5 text-[11px]"
            >
              {[25, 100, 250, 500, 1000].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
            <button
              onClick={reSample}
              disabled={busy}
              className="px-2 py-0.5 rounded bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50"
            >
              {busy ? "Sampling…" : "Sample"}
            </button>
            {sample && (
              <span className="text-slate-400">
                {sample.meta.rowcount} rows · {fmtBytes(sample.meta.size_bytes)} materialized
                {" "}(only this capped blob crossed)
              </span>
            )}
          </div>
          {busy && !sample ? (
            <div className="text-[12px] text-slate-400 p-4">Materializing capped sample…</div>
          ) : sample ? (
            <GenericTable rows={sample.rows} />
          ) : null}
        </>
      )}

      {tab === "columns" && (
        busy ? (
          <div className="text-[12px] text-slate-400 p-4">Loading columns…</div>
        ) : cols ? (
          <div className="overflow-auto max-h-[520px] border border-slate-200 rounded">
            <table className="w-full text-[11px]">
              <thead className="bg-slate-100 sticky top-0">
                <tr>
                  <th className="text-left px-2 py-1 font-medium text-slate-600">column</th>
                  <th className="text-left px-2 py-1 font-medium text-slate-600">type</th>
                  <th className="text-left px-2 py-1 font-medium text-slate-600">nullable</th>
                  <th className="text-left px-2 py-1 font-medium text-slate-600">required</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(colProps).map(([name, spec]) => (
                  <tr key={name} className="odd:bg-white even:bg-slate-50">
                    <td className="px-2 py-1 font-mono">{name}</td>
                    <td className="px-2 py-1 text-slate-600">
                      {Array.isArray(spec.type) ? spec.type.join(" | ") : String(spec.type ?? "—")}
                    </td>
                    <td className="px-2 py-1 text-slate-500">{spec.nullable ? "yes" : "no"}</td>
                    <td className="px-2 py-1 text-slate-500">{required.has(name) ? "yes" : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="text-[10px] text-slate-400 px-2 py-1">
              {Object.keys(colProps).length} column(s) · zero rows read
            </div>
          </div>
        ) : (
          <div className="text-[12px] text-slate-400 p-4">No column schema.</div>
        )
      )}

      {tab === "profile" && (
        busy ? (
          <div className="text-[12px] text-slate-400 p-4">Loading profile…</div>
        ) : profile ? (
          <pre className="text-[11px] bg-slate-50 border border-slate-200 rounded p-2 overflow-auto max-h-[520px]">
            {JSON.stringify(profile, null, 2)}
          </pre>
        ) : (
          <div className="text-[12px] text-slate-400 p-4">No profile.</div>
        )
      )}
    </div>
  );
}

// ── Left pane: instance → schema → table tree ────────────────────────────────

function SchemaNode({
  inst,
  schema,
  filter,
  selectedKey,
  onSelect,
}: {
  inst: LakeInstance;
  schema: string;
  filter: string;
  selectedKey: string;
  onSelect: (s: Selection) => void;
}) {
  const [open, setOpen] = useState(false);
  const [tables, setTables] = useState<TableEntry[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!open || tables) return;
    let live = true;
    setBusy(true);
    lake
      .tables(inst.basePath, schema)
      .then((r) => live && setTables(r.tables ?? []))
      .catch((e) => live && setErr(String(e?.message ?? e)))
      .finally(() => live && setBusy(false));
    return () => {
      live = false;
    };
  }, [open, tables, inst.basePath, schema]);

  const f = filter.trim().toLowerCase();
  const shown = tables?.filter((t) => !f || t.table.toLowerCase().includes(f)) ?? null;
  // Auto-open when a filter is active so matches surface.
  useEffect(() => {
    if (f) setOpen(true);
  }, [f]);

  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full text-left px-2 py-1 text-[12px] hover:bg-violet-50 flex items-center gap-1"
      >
        <span className="text-slate-400 w-3">{open ? "▾" : "▸"}</span>
        <span className="font-medium text-slate-700">{schema}</span>
      </button>
      {open && (
        <div className="ml-4 border-l border-slate-100">
          {busy && <div className="px-2 py-1 text-[11px] text-slate-400">loading…</div>}
          {err && <div className="px-2 py-1 text-[11px] text-red-600">{err}</div>}
          {shown?.map((t) => {
            const k = `${inst.id}/${schema}/${t.table}`;
            return (
              <button
                key={t.table}
                onClick={() => onSelect({ inst, schema, table: t })}
                className={[
                  "w-full text-left px-2 py-0.5 text-[11px] font-mono truncate flex justify-between gap-2",
                  selectedKey === k
                    ? "bg-violet-100 text-violet-800"
                    : "text-slate-600 hover:bg-violet-50",
                ].join(" ")}
                title={`${t.table} · ${fmtRows(t.est_rows)} rows · ${fmtBytes(t.size_bytes)}`}
              >
                <span className="truncate">{t.table}</span>
                <span className="text-slate-400 flex-shrink-0">{fmtRows(t.est_rows)}</span>
              </button>
            );
          })}
          {shown && shown.length === 0 && (
            <div className="px-2 py-1 text-[11px] text-slate-400">no match</div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Root ─────────────────────────────────────────────────────────────────────

export default function DataLakeViewer({ config }: { config?: Record<string, unknown> }) {
  const title = String(config?.title ?? "Data Lake");
  const [cat, setCat] = useState<InstanceCatalog[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [sel, setSel] = useState<Selection | null>(null);
  const [openInst, setOpenInst] = useState<Record<string, boolean>>(
    () => Object.fromEntries(LAKE_INSTANCES.map((i, idx) => [i.id, idx === 0])),
  );

  useEffect(() => {
    let live = true;
    setLoading(true);
    federatedCatalog()
      .then((c) => live && setCat(c))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, []);

  const selectedKey = sel ? `${sel.inst.id}/${sel.schema}/${sel.table.table}` : "";

  const totals = useMemo(() => {
    let schemas = 0;
    let tables = 0;
    for (const c of cat) {
      schemas += c.schemas.length;
      tables += c.schemas.reduce((s, x) => s + (x.tables ?? 0), 0);
    }
    return { schemas, tables, instances: cat.filter((c) => !c.error).length };
  }, [cat]);

  return (
    <div className="flex flex-col h-[720px]">
      {/* Header */}
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <div>
          <div className="text-[15px] font-semibold text-slate-800">{title}</div>
          <div className="text-[11px] text-slate-500">
            {loading
              ? "loading catalog…"
              : `${totals.instances}/${LAKE_INSTANCES.length} instances · ${totals.schemas} schemas · ${totals.tables} tables · read-only`}
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          {cat.map((c) => (
            <div key={c.instance.id} className="flex items-center gap-1.5 text-[11px]">
              <span className={c.error ? "text-red-500" : "text-slate-600 font-medium"}>
                {c.instance.label}
              </span>
              {c.error ? (
                <span className="text-red-400" title={c.error}>offline</span>
              ) : (
                <FreshnessPill f={c.freshness} />
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="flex gap-4 flex-1 min-h-0">
        {/* Left: tree */}
        <div className="w-[340px] flex-shrink-0 flex flex-col border border-slate-200 rounded">
          <div className="p-2 border-b border-slate-200">
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="filter tables across all instances…"
              className="w-full text-[12px] px-2 py-1 border border-slate-300 rounded"
            />
          </div>
          <div className="overflow-auto flex-1">
            {loading && <div className="p-3 text-[12px] text-slate-400">loading…</div>}
            {cat.map((c) => (
              <div key={c.instance.id} className="border-b border-slate-100">
                <button
                  onClick={() => setOpenInst((o) => ({ ...o, [c.instance.id]: !o[c.instance.id] }))}
                  className="w-full text-left px-2 py-1.5 text-[12px] font-semibold text-slate-800 bg-slate-50 hover:bg-slate-100 flex items-center gap-1"
                  title={c.instance.blurb}
                >
                  <span className="text-slate-400 w-3">{openInst[c.instance.id] ? "▾" : "▸"}</span>
                  {c.instance.label}
                  <span className="ml-auto text-[10px] font-normal text-slate-400">
                    {c.error ? "offline" : `${c.schemas.length} schemas`}
                  </span>
                </button>
                {openInst[c.instance.id] && (
                  <div>
                    {c.error ? (
                      <div className="px-2 py-1 text-[11px] text-red-500" title={c.error}>
                        {c.error.slice(0, 80)}
                      </div>
                    ) : (
                      c.schemas
                        .slice()
                        .sort((a, b) => a.schema.localeCompare(b.schema))
                        .map((s) => (
                          <SchemaNode
                            key={s.schema}
                            inst={c.instance}
                            schema={s.schema}
                            filter={filter}
                            selectedKey={selectedKey}
                            onSelect={setSel}
                          />
                        ))
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Right: detail */}
        <div className="flex-1 flex flex-col min-w-0 border border-slate-200 rounded p-3">
          {sel ? (
            <TableDetail sel={sel} />
          ) : (
            <div className="text-[12px] text-slate-400 p-4 space-y-2">
              <div>Pick a table on the left to inspect its columns, profile, and a capped sample.</div>
              <div className="text-slate-300">
                Data never moves — the viewer only reads catalog metadata and a small
                materialized sample. Bulk export is a later phase.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

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

import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  LAKE_INSTANCES,
  fetchInstanceCatalog,
  peekInstanceCatalog,
  peekTables,
  loadTables,
  lake,
  fmtBytes,
  fmtRows,
  type InstanceCatalog,
  type LakeInstance,
  type TableEntry,
  type JsonSchema,
  type SampleResult,
  type TableActivity,
  type AppUse,
} from "@/api/dataLake";
import { EmptyState } from "@/components/ui/empty-state";
import {
  appUseLabel, appUseLine, emptyActivityLine, othersLine, parseTableLink,
} from "@/lib/data-activity";
import { useAuth } from "@/hooks/useAuth";
import { PickATable } from "@/components/illustrations/scenes";

// FinData's own browsing view, shown inside the catalog under FinData (it was a
// top-level Data tab beside Catalog/Query/Jobs, which made one dataset look
// like a feature of the whole warehouse).
const PredictionMarketsBrowser = lazy(() => import("@/components/app-surface/PredictionMarketsBrowser"));

/** Who writes and reads a table — the workflows that keep it up to date, and
 *  the ones that depend on it. Hidden for an instance that doesn't record
 *  activity (it answers with an error); honest about when recording began. */
function WhoUsesIt({ sel }: { sel: Selection }) {
  const key = `${sel.inst.id}/${sel.schema}/${sel.table.table}`;
  const [state, setState] = useState<{ key: string; act: TableActivity | null } | null>(null);
  useEffect(() => {
    let live = true;
    lake
      .tableActivity(sel.inst.basePath, sel.schema, sel.table.table)
      .then((act) => live && setState({ key, act: act && typeof act === "object" ? act : null }))
      .catch(() => live && setState({ key, act: null }));
    return () => {
      live = false;
    };
  }, [key, sel.inst.basePath, sel.schema, sel.table.table]);
  if (!state || state.key !== key || !state.act) return null;
  const wrote = Array.isArray(state.act.wrote) ? state.act.wrote : [];
  const read = Array.isArray(state.act.read) ? state.act.read : [];
  const others = othersLine(state.act.others);
  const block = (title: string, rows: AppUse[], verb: "wrote" | "read") =>
    rows.length > 0 && (
      <div>
        <div className="text-ink-600">{title}</div>
        <ul className="mt-0.5 space-y-0.5">
          {rows.slice(0, 5).map((a) => (
            <li key={`${a.app}/${a.loop}`} className="flex flex-wrap gap-x-2">
              <span className="font-medium text-ink-800">{appUseLabel(a)}</span>
              <span className="text-ink-600">{appUseLine(a, verb)}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  return (
    <div className="mt-2 rounded border border-ink-200 px-2.5 py-2 text-micro text-ink-700 space-y-1.5">
      {wrote.length === 0 && read.length === 0 ? (
        <div className="text-ink-600">{emptyActivityLine("table")}</div>
      ) : (
        <>
          {block("Written by", wrote, "wrote")}
          {block("Read by", read, "read")}
        </>
      )}
      {others && <div className="text-ink-600">{others}</div>}
    </div>
  );
}

/** Where a table lives — the first question a person inspecting a catalog
 *  has — plus the other way in, where there is one (FinData: SQL). */
function WhereItLives({ sel }: { sel: Selection }) {
  return (
    <div className="mt-2 rounded border border-ink-200 bg-ink-50 px-2.5 py-2 text-micro text-ink-700">
      <span className="text-ink-600">Where it lives: </span>
      {sel.inst.where}
      {sel.inst.otherAccess && (
        <>
          {" "}
          <Link to={sel.inst.otherAccess.to} className="text-plum-700 hover:underline">
            {sel.inst.otherAccess.label}
          </Link>
        </>
      )}
    </div>
  );
}

// ── Small shared bits ────────────────────────────────────────────────────────

function FreshnessPill({ f }: { f?: InstanceCatalog["freshness"] }) {
  if (!f) return null;
  const cell = (n: number, cls: string, title: string) =>
    n > 0 ? (
      <span className={`px-1 rounded ${cls}`} title={`${n} ${title}`}>
        {n} {title}
      </span>
    ) : null;
  return (
    <span className="inline-flex gap-1 text-nano font-medium">
      {cell(f.green, "bg-gold-100 text-gold-700", "fresh")}
      {cell(f.amber, "bg-ember-100 text-ember-700", "stale")}
      {cell(f.red, "bg-brick-100 text-brick-700", "overdue")}
      {cell(f.gray, "bg-ink-100 text-ink-600", "unknown")}
    </span>
  );
}

function GenericTable({ rows }: { rows: Record<string, unknown>[] }) {
  if (!rows.length) {
    return <div className="text-caption text-ink-600 p-4">No rows.</div>;
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
    <div className="overflow-auto max-h-[520px] border border-ink-200 rounded">
      <table className="w-full text-micro">
        <thead className="bg-ink-100 sticky top-0">
          <tr>
            {cols.map((c) => (
              <th key={c} className="text-left px-2 py-1 font-medium text-ink-600 whitespace-nowrap">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 500).map((r, i) => (
            <tr key={i} className="odd:bg-card even:bg-ink-50">
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
      <div className="text-nano text-ink-600 px-2 py-1">
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
  // Key-stamped so a stale value from the previously-selected table is never
  // shown, nor mistaken for "already loaded". (A plain truthiness guard raced
  // the reset effect: switching table while on the default Sample tab left the
  // pane blank because the effect deps [tab,key] didn't change after the reset.)
  const [sample, setSample] = useState<{ key: string; val: SampleResult } | null>(null);
  const [cols, setCols] = useState<{ key: string; val: JsonSchema } | null>(null);
  const [profile, setProfile] = useState<{ key: string; val: Record<string, unknown> } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [limit, setLimit] = useState(100);

  const key = `${sel.inst.id}/${sel.schema}/${sel.table.table}`;

  // Reset the active tab to Sample when the table changes. Data slots don't need
  // clearing — render + the load guard key off `key`, so a stale slot is ignored
  // until its replacement arrives.
  useEffect(() => {
    setTab("sample");
  }, [key]);

  useEffect(() => {
    const need =
      (tab === "sample" && sample?.key !== key) ||
      (tab === "columns" && cols?.key !== key) ||
      (tab === "profile" && profile?.key !== key);
    if (!need) {
      setErr("");
      return;
    }
    let live = true;
    setBusy(true);
    setErr("");
    (async () => {
      try {
        if (tab === "sample") {
          const r = await lake.sample(sel.inst.basePath, sel.schema, sel.table.table, limit);
          if (live) setSample({ key, val: r });
        } else if (tab === "columns") {
          const r = await lake.tableColumns(sel.inst.basePath, sel.schema, sel.table.table);
          if (live) setCols({ key, val: r });
        } else {
          const r = await lake.tableProfile(sel.inst.basePath, sel.schema, sel.table.table);
          if (live) setProfile({ key, val: r });
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
      setSample({ key, val: r });
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const t = sel.table;
  const curSample = sample?.key === key ? sample.val : null;
  const curCols = cols?.key === key ? cols.val : null;
  const curProfile = profile?.key === key ? profile.val : null;
  const colProps = curCols?.properties ?? {};
  const required = new Set(curCols?.required ?? []);

  return (
    <div className="flex-1 flex flex-col min-w-0">
      <div className="mb-2">
        <div className="font-mono text-meta text-ink-800">
          <span className="text-ink-600">{sel.inst.label} ·</span> {sel.schema}.
          <span className="font-semibold">{t.table}</span>
        </div>
        <div className="text-micro text-ink-600 flex gap-3 mt-0.5">
          <span>{fmtRows(t.est_rows)} rows</span>
          <span>{fmtBytes(t.size_bytes)}</span>
          {t.is_hypertable && <span className="text-plum-600">hypertable</span>}
          {t.comment && <span className="italic truncate max-w-[360px]" title={t.comment}>{t.comment}</span>}
        </div>
        <WhereItLives sel={sel} />
        <WhoUsesIt sel={sel} />
      </div>

      <div className="flex gap-1 border-b border-ink-200 mb-2">
        {(["sample", "columns", "profile"] as Tab[]).map((x) => (
          <button
            key={x}
            onClick={() => setTab(x)}
            className={[
              "text-caption px-3 py-1 -mb-px border-b-2 capitalize",
              tab === x
                ? "border-plum-600 text-plum-700 font-medium"
                : "border-transparent text-ink-600 hover:text-ink-700",
            ].join(" ")}
          >
            {x}
          </button>
        ))}
      </div>

      {err && <div className="text-micro text-brick-600 mb-2">error: {err}</div>}

      {tab === "sample" && (
        <>
          <div className="flex items-center gap-2 mb-2 text-micro text-ink-600">
            <span>rows</span>
            <select
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              className="border border-ink-300 rounded px-1 py-0.5 text-micro"
            >
              {[25, 100, 250, 500, 1000].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
            <button
              onClick={reSample}
              disabled={busy}
              className="px-2 py-0.5 rounded bg-plum-600 text-white hover:bg-plum-700 disabled:opacity-50"
            >
              {busy ? "Sampling…" : "Sample"}
            </button>
            {curSample && (
              <span className="text-ink-600">
                {curSample.meta.rowcount} rows · {fmtBytes(curSample.meta.size_bytes)} materialized
                {" "}(only this capped blob crossed)
              </span>
            )}
          </div>
          {busy && !curSample ? (
            <div className="text-caption text-ink-600 p-4">Materializing capped sample…</div>
          ) : curSample ? (
            <GenericTable rows={curSample.rows} />
          ) : null}
        </>
      )}

      {tab === "columns" && (
        busy && !curCols ? (
          <div className="text-caption text-ink-600 p-4">Loading columns…</div>
        ) : curCols ? (
          <div className="overflow-auto max-h-[520px] border border-ink-200 rounded">
            <table className="w-full text-micro">
              <thead className="bg-ink-100 sticky top-0">
                <tr>
                  <th className="text-left px-2 py-1 font-medium text-ink-600">column</th>
                  <th className="text-left px-2 py-1 font-medium text-ink-600">type</th>
                  <th className="text-left px-2 py-1 font-medium text-ink-600">nullable</th>
                  <th className="text-left px-2 py-1 font-medium text-ink-600">required</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(colProps).map(([name, spec]) => (
                  <tr key={name} className="odd:bg-card even:bg-ink-50">
                    <td className="px-2 py-1 font-mono">{name}</td>
                    <td className="px-2 py-1 text-ink-600">
                      {Array.isArray(spec.type) ? spec.type.join(" | ") : String(spec.type ?? "—")}
                    </td>
                    <td className="px-2 py-1 text-ink-600">{spec.nullable ? "yes" : "no"}</td>
                    <td className="px-2 py-1 text-ink-600">{required.has(name) ? "yes" : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="text-nano text-ink-600 px-2 py-1">
              {Object.keys(colProps).length} column(s) · zero rows read
            </div>
          </div>
        ) : (
          <div className="text-caption text-ink-600 p-4">No column schema.</div>
        )
      )}

      {tab === "profile" && (
        busy && !curProfile ? (
          <div className="text-caption text-ink-600 p-4">Loading profile…</div>
        ) : curProfile ? (
          <pre className="text-micro bg-ink-50 border border-ink-200 rounded p-2 overflow-auto max-h-[520px]">
            {JSON.stringify(curProfile, null, 2)}
          </pre>
        ) : (
          <div className="text-caption text-ink-600 p-4">No profile.</div>
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
  // Seed from the session cache so an already-viewed schema expands instantly.
  const [tables, setTables] = useState<TableEntry[] | null>(
    () => peekTables(inst.id, schema) ?? null,
  );
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!open) return;
    let live = true;
    // Revalidate even when cached (background) so a re-expand shows fresh data
    // without a spinner; only show 'busy' when there's nothing cached to paint.
    if (!tables) setBusy(true);
    loadTables(inst, schema)
      .then((t) => live && setTables(t))
      .catch((e) => live && !tables && setErr(String(e?.message ?? e)))
      .finally(() => live && setBusy(false));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, inst.id, inst.basePath, schema]);

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
        className="w-full text-left px-2 py-1 text-caption hover:bg-plum-50 flex items-center gap-1"
      >
        <span className="text-ink-600 w-3">{open ? "▾" : "▸"}</span>
        <span className="font-medium text-ink-700">{schema}</span>
      </button>
      {open && (
        <div className="ml-4 border-l border-ink-100">
          {busy && <div className="px-2 py-1 text-micro text-ink-600">loading…</div>}
          {err && <div className="px-2 py-1 text-micro text-brick-600">{err}</div>}
          {shown?.map((t) => {
            const k = `${inst.id}/${schema}/${t.table}`;
            return (
              <button
                key={t.table}
                onClick={() => onSelect({ inst, schema, table: t })}
                className={[
                  "w-full text-left px-2 py-0.5 text-micro font-mono truncate flex justify-between gap-2",
                  selectedKey === k
                    ? "bg-plum-100 text-plum-800"
                    : "text-ink-600 hover:bg-plum-50",
                ].join(" ")}
                title={`${t.table} · ${fmtRows(t.est_rows)} rows · ${fmtBytes(t.size_bytes)}`}
              >
                <span className="truncate">{t.table}</span>
                <span className="text-ink-600 flex-shrink-0">{fmtRows(t.est_rows)}</span>
              </button>
            );
          })}
          {shown && shown.length === 0 && (
            <div className="px-2 py-1 text-micro text-ink-600">no match</div>
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
  // Per-instance freshness counts are an engineer detail (admins only); an
  // instance that is offline is shown to everyone, since its tables are gone.
  const role = useAuth().user?.role;
  const isAdmin = role === "admin" || role === "super_admin";
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [sel, setSelState] = useState<Selection | null>(null);
  // A dataset's own view (today: FinData's prediction markets) instead of a
  // table. `?view=markets` deep-links it (the old `?tab=markets` redirects here).
  const [params] = useSearchParams();
  const [view, setView] = useState<"markets" | null>(() => (params.get("view") === "markets" ? "markets" : null));
  const setSel = (s: Selection) => {
    setView(null);
    setSelState(s);
  };
  const [openInst, setOpenInst] = useState<Record<string, boolean>>(
    () => Object.fromEntries(LAKE_INSTANCES.map((i, idx) => [i.id, idx === 0 || (i.id === "findata" && params.get("view") === "markets")])),
  );

  // Deep link from a run or a workflow: ?inst=<id>&table=<schema.table> opens
  // that instance and selects the table once its schema's tables load.
  useEffect(() => {
    const link = parseTableLink(params);
    if (!link) return;
    const inst = LAKE_INSTANCES.find((i) => i.id === link.inst);
    if (!inst) return;
    let live = true;
    setOpenInst((o) => ({ ...o, [inst.id]: true }));
    loadTables(inst, link.schema)
      .then((tables) => {
        const t = tables.find((x) => x.table === link.table);
        if (live && t) setSel({ inst, schema: link.schema, table: t });
      })
      .catch(() => { /* the instance or schema isn't there: leave the tree as is */ });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.get("inst"), params.get("table")]);

  useEffect(() => {
    let live = true;
    // Seed from the session cache for an INSTANT paint on remount; instances
    // not yet cached show 'loading…'. Then STREAM a revalidation of every
    // instance — cached ones swap in fresh data silently, uncached ones fill
    // as they land. loading only blocks the first-ever open (no cache at all).
    const seeded = LAKE_INSTANCES.map(
      (instance): InstanceCatalog =>
        peekInstanceCatalog(instance) ?? { instance, schemas: [], loading: true },
    );
    setCat(seeded);
    setLoading(seeded.every((c) => c.loading));
    LAKE_INSTANCES.forEach((instance) => {
      fetchInstanceCatalog(instance).then((c) => {
        if (!live) return;
        setCat((prev) =>
          prev.map((p) => (p.instance.id === instance.id ? c : p)),
        );
        setLoading(false);
      });
    });
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
          <div className="text-read font-semibold text-ink-800">{title}</div>
          <div className="text-micro text-ink-600">
            {loading
              ? "loading catalog…"
              : `${totals.instances}/${LAKE_INSTANCES.length} instances · ${totals.schemas} schemas · ${totals.tables} tables · read-only`}
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          {cat.filter((c) => isAdmin || c.error).map((c) => (
            <div key={c.instance.id} className="flex items-center gap-1.5 text-micro">
              <span className={c.error ? "text-brick-600" : "text-ink-600 font-medium"}>
                {c.instance.label}
              </span>
              {c.error ? (
                <span className="text-brick-600" title={c.error}>offline</span>
              ) : (
                <FreshnessPill f={c.freshness} />
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="flex gap-4 flex-1 min-h-0">
        {/* Left: tree */}
        <div className="w-[340px] flex-shrink-0 flex flex-col border border-ink-200 rounded">
          <div className="p-2 border-b border-ink-200">
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="filter tables across all instances…"
              className="w-full text-caption px-2 py-1 border border-ink-300 rounded"
            />
          </div>
          <div className="overflow-auto flex-1">
            {loading && <div className="p-3 text-caption text-ink-600">loading…</div>}
            {cat.map((c) => (
              <div key={c.instance.id} className="border-b border-ink-100">
                <button
                  onClick={() => setOpenInst((o) => ({ ...o, [c.instance.id]: !o[c.instance.id] }))}
                  className="w-full text-left px-2 py-1.5 text-caption font-semibold text-ink-800 bg-ink-50 hover:bg-ink-100 flex items-center gap-1"
                  title={c.instance.blurb}
                >
                  <span className="text-ink-600 w-3">{openInst[c.instance.id] ? "▾" : "▸"}</span>
                  {c.instance.label}
                  <span className="ml-auto text-nano font-normal text-ink-600">
                    {c.loading ? "…" : c.error ? "offline" : `${c.schemas.length} schemas`}
                  </span>
                </button>
                {/* INDENT THE SCHEMAS UNDER THEIR DATABASE.
                    This was a bare <div>, so a schema row started at exactly the
                    same left edge as the database row above it (both x=249,
                    measured). With a dozen schemas per instance and several
                    instances stacked, nothing showed where one database ended and
                    the next began -- the tree rendered as one flat list. The
                    table level one step down already did this correctly; only
                    this level was missing it. */}
                {openInst[c.instance.id] && (
                  <div className="ml-3 border-l border-ink-200">
                    {c.instance.id === "findata" && (
                      <button
                        onClick={() => {
                          setSelState(null);
                          setView("markets");
                        }}
                        className={[
                          "w-full text-left px-2 py-1 text-caption hover:bg-ink-50",
                          view === "markets" ? "text-plum-700 font-medium bg-plum-50" : "text-ink-700",
                        ].join(" ")}
                        title="Polymarket and Kalshi, browsed by category"
                      >
                        Prediction markets <span className="text-nano text-ink-600">· browse</span>
                      </button>
                    )}
                    {c.loading ? (
                      <div className="px-2 py-1 text-micro text-ink-600">loading…</div>
                    ) : c.error ? (
                      <div className="px-2 py-1 text-micro text-brick-600" title={c.error}>
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
        <div className="flex-1 flex flex-col min-w-0 border border-ink-200 rounded p-3">
          {view === "markets" ? (
            <div className="flex-1 min-h-0 overflow-auto">
              <Suspense fallback={<div className="lumen-skeleton h-64 rounded-xl" role="status" aria-label="Loading" />}>
                <PredictionMarketsBrowser />
              </Suspense>
            </div>
          ) : sel ? (
            <TableDetail sel={sel} />
          ) : (
            <EmptyState
              framed={false}
              size="sm"
              className="pt-12"
              art={<PickATable />}
              title="Pick a table to inspect"
              body="Its columns and a sample appear here."
            />
          )}
        </div>
      </div>
    </div>
  );
}

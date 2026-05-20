import { useEffect, useMemo, useState } from "react";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from "recharts";
import { findata, fmtNumber, type IpoRow } from "@/api/findata";
import { SubTabs } from "./ValuationPane";
import { cn } from "@/lib/utils";

const TREASURY_TENORS = ["1m", "2m", "3m", "6m", "1y", "2y", "3y", "5y", "7y", "10y", "20y", "30y"];

// Liquid futures contracts with COT coverage. BTC futures *are* on the
// CFTC report but kv.run's archive doesn't ingest them — dropped from
// the preset list to avoid an "empty" landing state.
const COT_PRESETS = ["ES", "NQ", "CL", "GC", "SI", "ZB", "ZN", "ZC", "ZS"];

type Sub = "indicators" | "calendar" | "treasury" | "cot" | "ipos" | "mergers" | "fda" | "symbols";

const SUBS: { id: Sub; label: string }[] = [
  { id: "indicators", label: "Indicators"       },
  { id: "calendar",   label: "Econ calendar"    },
  { id: "treasury",   label: "Treasury rates"   },
  { id: "cot",        label: "COT"              },
  { id: "ipos",       label: "IPOs"             },
  { id: "mergers",    label: "M&A (global)"     },
  { id: "fda",        label: "FDA calendar"     },
  { id: "symbols",    label: "Symbol changes"   },
];

// COT row shape — every field optional because kv.run sometimes drops
// columns when the upstream report omits them.
interface CotRow {
  report_date: string;
  name?: string;
  sector?: string;
  open_interest?: number;
  noncomm_long?: number;
  noncomm_short?: number;
  comm_long?: number;
  comm_short?: number;
  change_oi?: number;
}

export default function MacroPane({ symbol: initialSymbol, initialSub }: { symbol?: string; initialSub?: string }) {
  // Honor an explicit `initialSub` (deep-link from FinData Explorer's
  // Catalog → /dashboard/datasets/macro?sub=ipos etc.). Falls back to
  // "indicators" if the param is missing or doesn't match a known sub.
  const SUB_IDS = SUBS.map((s) => s.id);
  const startSub = (initialSub && (SUB_IDS as readonly string[]).includes(initialSub))
    ? (initialSub as Sub)
    : "indicators";
  const [sub, setSub] = useState<Sub>(startSub);
  // COT is the only sub-view that's per-symbol. State lives here, not on
  // the parent page, so the picker only renders when relevant.
  const [cotSymbol, setCotSymbol] = useState(initialSymbol || "ES");
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    setLoading(true); setErr(""); setRows([]);
    const p = sub === "indicators" ? findata.macroIndicators()
            : sub === "calendar"   ? findata.macroCalendar(80)
            : sub === "treasury"   ? findata.macroTreasury(60)
            : sub === "cot"        ? findata.cot(cotSymbol)
            : sub === "ipos"       ? findata.ipos(60)
            : sub === "mergers"    ? findata.mergersGlobal(60)
            : sub === "fda"        ? findata.fdaCalendar(60)
            :                        findata.symbolChanges(60);
    p.then((d) => setRows((d as Record<string, unknown>[]) ?? []))
     .catch((e) => setErr(String(e)))
     .finally(() => setLoading(false));
  }, [sub, cotSymbol]);

  return (
    <div className="flex flex-col gap-3">
      <SubTabs subs={SUBS} active={sub} onChange={setSub} />

      {/* COT picker — only rendered on the COT sub-tab. Other Macro
          sub-views (Indicators, Treasury rates, etc.) are global and
          don't take a symbol. */}
      {sub === "cot" && (
        <CotSymbolPicker symbol={cotSymbol} onChange={setCotSymbol} />
      )}

      {loading && <p className="text-sm text-muted-foreground animate-pulse">Loading…</p>}
      {err && <p className="text-sm text-destructive">{err}</p>}
      {!loading && !err && rows.length === 0 && (
        sub === "cot"
          ? <div className="rounded border border-border bg-card px-3 py-6 text-center text-sm text-muted-foreground">
              <div>No COT data for <span className="font-mono">{cotSymbol}</span>.</div>
              <div className="text-xs mt-1 opacity-70">
                Try a liquid futures contract: <span className="font-mono">ES, NQ, CL, GC, SI, ZB, ZN, ZC, ZS</span>.
                The CFTC report covers commodity / index / rates futures — single-stock options and crypto aren't included.
              </div>
            </div>
          : <p className="text-sm text-muted-foreground">No data for this view.</p>
      )}
      {!loading && rows.length > 0 && (
        sub === "ipos"     ? <IpoTable rows={rows as unknown as IpoRow[]} />
        : sub === "treasury" ? <TreasuryView rows={rows} />
        : sub === "calendar" ? <CalendarView rows={rows} />
        : sub === "cot"      ? <CotView rows={rows as unknown as CotRow[]} />
        :                      <DynamicTable rows={rows} />
      )}
    </div>
  );
}

// ── COT symbol picker (preset chips + custom input) ─────────────────────────

function CotSymbolPicker({ symbol, onChange }: { symbol: string; onChange: (s: string) => void }) {
  const [draft, setDraft] = useState(symbol);
  useEffect(() => { setDraft(symbol); }, [symbol]);
  const apply = () => {
    const clean = draft.trim().toUpperCase();
    if (clean && clean !== symbol) onChange(clean);
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded border border-border bg-muted/30 px-3 py-2">
      <span className="text-xs text-muted-foreground mr-1">Futures contract:</span>
      {COT_PRESETS.map((s) => (
        <button key={s} onClick={() => onChange(s)}
          className={cn(
            "text-xs px-2 py-0.5 rounded font-mono border transition-colors",
            s === symbol
              ? "border-primary text-primary bg-primary/10"
              : "border-border text-muted-foreground hover:bg-accent",
          )}>{s}</button>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value.toUpperCase())}
        onKeyDown={(e) => e.key === "Enter" && apply()}
        onBlur={apply}
        size={6}
        placeholder="custom"
        className="rounded border border-dashed border-border bg-transparent px-2 py-0.5 text-xs font-mono uppercase placeholder:text-muted-foreground/70 focus:border-primary focus:bg-background focus:outline-none"
      />
    </div>
  );
}

// ── COT view — positioning visualization for the selected contract ──────────

function CotView({ rows }: { rows: CotRow[] }) {
  if (!rows.length) return null;
  // rows arrive newest-first; the latest is the headline state.
  const latest = rows[0];
  const prev = rows[1];

  const noncommLong = latest.noncomm_long ?? 0;
  const noncommShort = latest.noncomm_short ?? 0;
  const commLong = latest.comm_long ?? 0;
  const commShort = latest.comm_short ?? 0;
  const oi = latest.open_interest ?? 0;
  const changeOi = latest.change_oi ?? 0;

  // Net positions = long minus short (positive = bullish bias).
  const noncommNet = noncommLong - noncommShort;
  const commNet = commLong - commShort;
  const prevNoncommNet = prev ? (prev.noncomm_long ?? 0) - (prev.noncomm_short ?? 0) : noncommNet;
  const noncommNetChange = noncommNet - prevNoncommNet;

  // Time-series for the chart: oldest → newest so the line trends left-to-right.
  const chart = rows.slice().reverse().map((r) => ({
    date: r.report_date,
    noncommNet: (r.noncomm_long ?? 0) - (r.noncomm_short ?? 0),
    commNet:    (r.comm_long ?? 0) - (r.comm_short ?? 0),
    oi:         r.open_interest ?? 0,
  }));

  return (
    <div className="flex flex-col gap-3">
      {/* Headline strip */}
      <div className="rounded border border-border bg-card p-3">
        <div className="flex items-baseline justify-between flex-wrap gap-2">
          <div>
            <div className="text-sm font-medium text-foreground">{latest.name ?? "—"}</div>
            <div className="text-xs text-muted-foreground">
              {latest.sector ?? ""} · report date {latest.report_date}
            </div>
          </div>
          <div className="text-xs text-muted-foreground">
            Open interest: <span className="font-mono text-foreground font-semibold">{fmtNumber(oi, { abbreviate: true, decimals: 1 })}</span>
            {changeOi !== 0 && (
              <span className={cn("ml-1.5", changeOi > 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400")}>
                ({changeOi > 0 ? "+" : ""}{fmtNumber(changeOi, { abbreviate: true, decimals: 1 })})
              </span>
            )}
          </div>
        </div>

        {/* Speculators (non-commercial) positioning bar */}
        <PositioningBar label="Speculators" long={noncommLong} short={noncommShort}
                        net={noncommNet} netChange={noncommNetChange} />
        {/* Commercials (hedgers) positioning bar */}
        <PositioningBar label="Commercials" long={commLong} short={commShort} net={commNet} />
      </div>

      {/* Net-positions history chart */}
      <div className="rounded border border-border bg-card p-3">
        <div className="text-xs text-muted-foreground mb-2">
          Net positions over time — speculators vs commercials (long − short)
        </div>
        <div style={{ width: "100%", height: 220 }}>
          <ResponsiveContainer>
            <LineChart data={chart} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} />
              <YAxis tickFormatter={(v: number) => fmtNumber(v, { abbreviate: true, decimals: 1 })} tick={{ fontSize: 10 }} />
              <Tooltip
                formatter={(v: any) => fmtNumber(Number(v), { abbreviate: true, decimals: 1 })}
                contentStyle={{ fontSize: 11 }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="noncommNet" name="Speculators net" stroke="#10b981" strokeWidth={1.5} dot={false} />
              <Line type="monotone" dataKey="commNet"    name="Commercials net" stroke="#f97316" strokeWidth={1.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Raw weekly table — useful for analysts who want the numbers */}
      <details className="rounded border border-border bg-card">
        <summary className="px-3 py-2 text-xs text-muted-foreground cursor-pointer select-none">
          Weekly report rows ({rows.length})
        </summary>
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead className="bg-muted/40">
              <tr>
                <th className="text-left px-2 py-1 font-medium text-muted-foreground">Report</th>
                <th className="text-right px-2 py-1 font-medium text-muted-foreground">Spec long</th>
                <th className="text-right px-2 py-1 font-medium text-muted-foreground">Spec short</th>
                <th className="text-right px-2 py-1 font-medium text-muted-foreground">Comm long</th>
                <th className="text-right px-2 py-1 font-medium text-muted-foreground">Comm short</th>
                <th className="text-right px-2 py-1 font-medium text-muted-foreground">Open int</th>
                <th className="text-right px-2 py-1 font-medium text-muted-foreground">Δ OI</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.report_date} className="border-t border-border/40 hover:bg-accent/40">
                  <td className="px-2 py-1 font-mono">{r.report_date}</td>
                  <td className="px-2 py-1 text-right font-mono">{fmtNumber(r.noncomm_long, { abbreviate: true, decimals: 1 })}</td>
                  <td className="px-2 py-1 text-right font-mono">{fmtNumber(r.noncomm_short, { abbreviate: true, decimals: 1 })}</td>
                  <td className="px-2 py-1 text-right font-mono">{fmtNumber(r.comm_long, { abbreviate: true, decimals: 1 })}</td>
                  <td className="px-2 py-1 text-right font-mono">{fmtNumber(r.comm_short, { abbreviate: true, decimals: 1 })}</td>
                  <td className="px-2 py-1 text-right font-mono">{fmtNumber(r.open_interest, { abbreviate: true, decimals: 1 })}</td>
                  <td className={cn(
                    "px-2 py-1 text-right font-mono",
                    (r.change_oi ?? 0) > 0 && "text-green-600 dark:text-green-400",
                    (r.change_oi ?? 0) < 0 && "text-red-600 dark:text-red-400",
                  )}>{fmtNumber(r.change_oi, { abbreviate: true, decimals: 1 })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

function PositioningBar({ label, long, short, net, netChange }: {
  label: string; long: number; short: number; net: number; netChange?: number;
}) {
  const total = long + short || 1;
  const longPct = (long / total) * 100;
  const shortPct = (short / total) * 100;
  return (
    <div className="mt-2.5">
      <div className="flex items-baseline justify-between text-xs mb-0.5">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono">
          net <span className={cn("font-semibold", net > 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400")}>
            {net > 0 ? "+" : ""}{fmtNumber(net, { abbreviate: true, decimals: 1 })}
          </span>
          {netChange !== undefined && netChange !== 0 && (
            <span className={cn("ml-1.5 text-[10px]", netChange > 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400")}>
              ({netChange > 0 ? "+" : ""}{fmtNumber(netChange, { abbreviate: true, decimals: 1 })} WoW)
            </span>
          )}
        </span>
      </div>
      <div className="flex h-3 rounded overflow-hidden bg-muted">
        <div className="bg-green-500" style={{ width: `${longPct}%` }}
             title={`Long ${fmtNumber(long, { abbreviate: true, decimals: 1 })} (${longPct.toFixed(1)}%)`} />
        <div className="bg-red-500" style={{ width: `${shortPct}%` }}
             title={`Short ${fmtNumber(short, { abbreviate: true, decimals: 1 })} (${shortPct.toFixed(1)}%)`} />
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground font-mono mt-0.5">
        <span>long {fmtNumber(long, { abbreviate: true, decimals: 1 })} ({longPct.toFixed(0)}%)</span>
        <span>short {fmtNumber(short, { abbreviate: true, decimals: 1 })} ({shortPct.toFixed(0)}%)</span>
      </div>
    </div>
  );
}

function TreasuryView({ rows }: { rows: Record<string, unknown>[] }) {
  // Server columns: m1/m2/m3/m6/y1/y2/y3/y5/y7/y10/y20/y30 etc.
  const TENOR_ORDER = ["m1","m2","m3","m6","y1","y2","y3","y5","y7","y10","y20","y30"];
  const TENOR_LABEL: Record<string, string> = { m1:"1M", m2:"2M", m3:"3M", m6:"6M", y1:"1Y", y2:"2Y", y3:"3Y", y5:"5Y", y7:"7Y", y10:"10Y", y20:"20Y", y30:"30Y" };
  const present = TENOR_ORDER.filter((t) => typeof rows[0][t] === "number");
  const latest = rows[0];
  const curve = present.map((t) => ({ tenor: TENOR_LABEL[t] ?? t, yield: latest[t] as number }));
  const spread = (a: string, b: string) =>
    rows.map((r) => ({
      date: (r.date as string ?? "").slice(0, 7),
      spread: typeof r[a] === "number" && typeof r[b] === "number" ? (r[a] as number) - (r[b] as number) : null,
    }));
  const ts = rows.slice().reverse().map((r) => ({
    date: (r.date as string ?? "").slice(0, 10),
    "10Y": r["y10"], "2Y": r["y2"], "3M": r["m3"],
  }));

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <div className="rounded border border-border p-3 bg-card">
        <div className="text-xs text-muted-foreground mb-2">Yield curve · {latest.date as string ?? ""}</div>
        <div className="h-56">
          <ResponsiveContainer>
            <LineChart data={curve} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis dataKey="tenor" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${v.toFixed(2)}%`} domain={["auto", "auto"]} />
              <Tooltip contentStyle={{ fontSize: 11, padding: 4 }} formatter={(v: any) => `${v.toFixed(3)}%`} />
              <Line dataKey="yield" stroke="#6366f1" dot={{ r: 3 }} strokeWidth={1.8} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="rounded border border-border p-3 bg-card">
        <div className="text-xs text-muted-foreground mb-2">10Y / 2Y / 3M over time</div>
        <div className="h-56">
          <ResponsiveContainer>
            <LineChart data={ts} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={40} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${v.toFixed(1)}%`} />
              <Tooltip contentStyle={{ fontSize: 11, padding: 4 }} formatter={(v: any) => v == null ? "—" : `${v.toFixed(3)}%`} />
              <Legend wrapperStyle={{ fontSize: 9 }} />
              <Line dataKey="10Y" stroke="#6366f1" dot={false} strokeWidth={1.4} />
              <Line dataKey="2Y"  stroke="#f59e0b" dot={false} strokeWidth={1.4} />
              <Line dataKey="3M"  stroke="#10b981" dot={false} strokeWidth={1.4} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="rounded border border-border p-3 bg-card md:col-span-2">
        <div className="text-xs text-muted-foreground mb-2">10Y – 2Y spread (recession indicator if inverted)</div>
        <div className="h-40">
          <ResponsiveContainer>
            <LineChart data={spread("y10", "y2").slice().reverse()} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={40} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${(v * 100).toFixed(0)}bps`} />
              <Tooltip contentStyle={{ fontSize: 11, padding: 4 }} formatter={(v: any) => v == null ? "—" : `${(v * 100).toFixed(1)} bps`} />
              <Line dataKey="spread" stroke="#ef4444" dot={false} strokeWidth={1.5} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

function CalendarView({ rows }: { rows: Record<string, unknown>[] }) {
  // Try to find date + impact + name columns
  const keys = Object.keys(rows[0]);
  const dateKey = keys.find((k) => /date|time/i.test(k)) ?? keys[0];
  return (
    <div className="overflow-x-auto rounded border border-border">
      <table className="w-full text-xs border-collapse">
        <thead className="bg-muted/50">
          <tr>{keys.map((c) => <th key={c} className="text-left px-2 py-1 text-muted-foreground font-medium">{c}</th>)}</tr>
        </thead>
        <tbody>
          {rows.slice(0, 100).map((r, i) => (
            <tr key={i} className="border-t border-border/40 hover:bg-accent/40">
              {keys.map((c) => (
                <td key={c} className={`px-2 py-1 ${c === dateKey ? "font-mono" : ""}`}>
                  {typeof r[c] === "number" ? fmtNumber(r[c] as number, { abbreviate: true, decimals: 2 }) : String(r[c] ?? "—")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// kv.run ships free-form `exchange` (mix of NASDAQ / NASDAQ Capital /
// NASDAQ Global / NYSE / NYSE MKT) and free-cased `status`
// (Expected/expected/Priced/priced). Normalize for clean grouping.
function _exchangeFamily(raw: string | null | undefined): string {
  const s = (raw || "").toUpperCase();
  if (!s) return "Unknown";
  if (s.includes("NASDAQ")) return "NASDAQ";
  if (s.includes("NYSE"))   return "NYSE";
  return raw || "Other";
}
function _normalizeStatus(raw: string | null | undefined): string {
  const s = (raw || "").trim();
  if (!s) return "Unknown";
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}
const _STATUS_COLOUR: Record<string, string> = {
  Expected: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30",
  Priced:   "bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/30",
  Filed:    "bg-blue-500/15  text-blue-700  dark:text-blue-400  border-blue-500/30",
  Withdrawn:"bg-red-500/15   text-red-700   dark:text-red-400   border-red-500/30",
};

function IpoTable({ rows }: { rows: IpoRow[] }) {
  // 1. Dedup by symbol — kv.run sometimes returns the same IPO under
  //    multiple amended filings (e.g. RIKU 2x, BWGC 2x). Keep the row
  //    with the most-complete data (prefer Priced > Expected > Filed,
  //    then non-null price).
  const STATUS_RANK = { Priced: 3, Expected: 2, Filed: 1, Withdrawn: 0 } as Record<string, number>;
  const deduped: Record<string, IpoRow & { _count: number }> = {};
  for (const r of rows) {
    const sym = r.symbol || "?";
    const status = _normalizeStatus(r.status);
    const existing = deduped[sym];
    if (!existing) {
      deduped[sym] = { ...r, status, _count: 1 };
    } else {
      existing._count += 1;
      const better =
        (STATUS_RANK[status] ?? 0) > (STATUS_RANK[_normalizeStatus(existing.status)] ?? 0) ||
        ((STATUS_RANK[status] ?? 0) === (STATUS_RANK[_normalizeStatus(existing.status)] ?? 0) &&
          r.price != null && existing.price == null);
      if (better) deduped[sym] = { ...r, status, _count: existing._count };
    }
  }
  const unique = Object.values(deduped).sort((a, b) =>
    // newest IPO date first; within same date, by symbol asc for stability
    (b.ipo_date || "").localeCompare(a.ipo_date || "") || (a.symbol || "").localeCompare(b.symbol || ""),
  );

  // 2. Aggregations: totals + by-status + by-exchange + by-date.
  const totalValue = unique.reduce((s, r) => s + (r.total_shares_value ?? 0), 0);
  const pricedN = unique.filter((r) => _normalizeStatus(r.status) === "Priced").length;
  const expectedN = unique.filter((r) => _normalizeStatus(r.status) === "Expected").length;
  const byStatus = Object.entries(unique.reduce((m, r) => {
    const k = _normalizeStatus(r.status);
    m[k] = (m[k] ?? 0) + 1;
    return m;
  }, {} as Record<string, number>)).map(([status, count]) => ({ status, count }));
  const byExchange = Object.entries(unique.reduce((m, r) => {
    const k = _exchangeFamily(r.exchange);
    m[k] = (m[k] ?? 0) + 1;
    return m;
  }, {} as Record<string, number>)).map(([ex, count]) => ({ ex, count })).sort((a, b) => b.count - a.count);
  const byDate = Object.entries(unique.reduce((m, r) => {
    const k = r.ipo_date || "?";
    m[k] = (m[k] ?? 0) + 1;
    return m;
  }, {} as Record<string, number>)).map(([date, count]) => ({ date, count })).sort((a, b) => a.date.localeCompare(b.date));

  return (
    <>
    {/* Stat strip — total raise + breakdown counts */}
    <div className="grid gap-3 md:grid-cols-4 mb-3">
      <div className="rounded border border-border p-3 bg-card text-xs">
        <div className="text-muted-foreground">Upcoming IPOs</div>
        <div className="text-2xl font-bold font-mono mt-1">{unique.length}</div>
        <div className="text-muted-foreground mt-1">unique symbols ({rows.length} filings)</div>
      </div>
      <div className="rounded border border-border p-3 bg-card text-xs">
        <div className="text-muted-foreground">Total raise</div>
        <div className="text-2xl font-bold font-mono mt-1">${fmtNumber(totalValue, { abbreviate: true, decimals: 1 })}</div>
        <div className="text-muted-foreground mt-1">where reported</div>
      </div>
      <div className="rounded border border-border p-3 bg-card text-xs">
        <div className="text-muted-foreground">Priced</div>
        <div className="text-2xl font-bold font-mono mt-1 text-green-600 dark:text-green-400">{pricedN}</div>
        <div className="text-muted-foreground mt-1">already trading</div>
      </div>
      <div className="rounded border border-border p-3 bg-card text-xs">
        <div className="text-muted-foreground">Expected</div>
        <div className="text-2xl font-bold font-mono mt-1 text-amber-600 dark:text-amber-400">{expectedN}</div>
        <div className="text-muted-foreground mt-1">filed, awaiting pricing</div>
      </div>
    </div>

    {/* Breakdown charts — show date AND exchange so the user gets variety even
        when the listing window is narrow (e.g. all in one month). */}
    <div className="grid gap-3 md:grid-cols-2 mb-3">
      <div className="rounded border border-border p-3 bg-card">
        <div className="text-xs text-muted-foreground mb-2">By IPO date</div>
        <div className="h-32">
          <ResponsiveContainer>
            <BarChart data={byDate} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis dataKey="date" tick={{ fontSize: 9 }} />
              <YAxis tick={{ fontSize: 9 }} allowDecimals={false} />
              <Tooltip contentStyle={{ fontSize: 11, padding: 4 }} />
              <Bar dataKey="count" fill="#6366f1" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="rounded border border-border p-3 bg-card">
        <div className="text-xs text-muted-foreground mb-2">By exchange family</div>
        <div className="h-32">
          <ResponsiveContainer>
            <BarChart data={byExchange} layout="vertical" margin={{ top: 5, right: 8, left: 40, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 9 }} allowDecimals={false} />
              <YAxis type="category" dataKey="ex" tick={{ fontSize: 10 }} width={70} />
              <Tooltip contentStyle={{ fontSize: 11, padding: 4 }} />
              <Bar dataKey="count" fill="#0ea5e9" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>

    {/* Status legend strip — visual key for the table's status badges */}
    <div className="flex flex-wrap items-center gap-2 mb-2 text-[10px]">
      {byStatus.sort((a, b) => b.count - a.count).map((s) => (
        <span key={s.status}
          className={cn("px-1.5 py-0.5 rounded border font-medium",
            _STATUS_COLOUR[s.status] ?? "border-border text-muted-foreground")}>
          {s.status} · {s.count}
        </span>
      ))}
    </div>

    {/* Table — newest IPO date first, deduped rows, normalized status + exchange */}
    <div className="overflow-x-auto rounded border border-border">
      <table className="w-full text-xs border-collapse">
        <thead className="bg-muted/50">
          <tr>
            <th className="text-left px-2 py-1 text-muted-foreground font-medium">IPO date</th>
            <th className="text-left px-2 py-1 text-muted-foreground font-medium">Symbol</th>
            <th className="text-left px-2 py-1 text-muted-foreground font-medium">Name</th>
            <th className="text-left px-2 py-1 text-muted-foreground font-medium">Exchange</th>
            <th className="text-right px-2 py-1 text-muted-foreground font-medium">Shares</th>
            <th className="text-right px-2 py-1 text-muted-foreground font-medium">Price</th>
            <th className="text-right px-2 py-1 text-muted-foreground font-medium">Value</th>
            <th className="text-left px-2 py-1 text-muted-foreground font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {unique.map((r) => {
            const status = _normalizeStatus(r.status);
            return (
              <tr key={r.symbol} className="border-t border-border/40 hover:bg-accent/40">
                <td className="px-2 py-1 font-mono">{r.ipo_date}</td>
                <td className="px-2 py-1 font-mono font-medium">
                  {r.symbol}
                  {r._count > 1 && (
                    <span className="ml-1 text-[9px] text-muted-foreground" title={`${r._count} filings collapsed (kept the most-complete row)`}>
                      ⊕{r._count}
                    </span>
                  )}
                </td>
                <td className="px-2 py-1 truncate max-w-[16rem]" title={r.name}>{r.name}</td>
                <td className="px-2 py-1">{_exchangeFamily(r.exchange)}</td>
                <td className="px-2 py-1 font-mono text-right">{r.number_of_shares != null ? fmtNumber(r.number_of_shares, { abbreviate: true, decimals: 1 }) : "—"}</td>
                <td className="px-2 py-1 font-mono text-right">{r.price != null ? `$${fmtNumber(r.price, { decimals: 2 })}` : "—"}</td>
                <td className="px-2 py-1 font-mono text-right">{r.total_shares_value != null ? `$${fmtNumber(r.total_shares_value, { abbreviate: true, decimals: 1 })}` : "—"}</td>
                <td className="px-2 py-1">
                  <span className={cn("px-1.5 py-0.5 rounded border text-[10px] font-medium",
                    _STATUS_COLOUR[status] ?? "border-border text-muted-foreground")}>
                    {status}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
    </>
  );
}

function DynamicTable({ rows }: { rows: Record<string, unknown>[] }) {
  const cols = Object.keys(rows[0]);
  return (
    <div className="overflow-x-auto rounded border border-border">
      <table className="w-full text-xs border-collapse">
        <thead className="bg-muted/50">
          <tr>{cols.map((c) => <th key={c} className="text-left px-2 py-1 text-muted-foreground font-medium">{c}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-border/40 hover:bg-accent/40">
              {cols.map((c) => (
                <td key={c} className="px-2 py-1 font-mono">
                  {typeof r[c] === "number" ? fmtNumber(r[c] as number, { abbreviate: true, decimals: 3 }) : String(r[c] ?? "—")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

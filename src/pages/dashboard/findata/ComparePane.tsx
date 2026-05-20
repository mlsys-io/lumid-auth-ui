import { useEffect, useMemo, useState } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, ReferenceLine } from "recharts";
import { findata, todayISO, daysAgoISO, fmtPct } from "@/api/findata";

const RANGES = [
  { label: "1M",  days: 30 },
  { label: "3M",  days: 90 },
  { label: "6M",  days: 180 },
  { label: "1Y",  days: 365 },
  { label: "2Y",  days: 2 * 365 },
];

const COLOURS = ["#6366f1", "#10b981", "#f59e0b", "#06b6d4", "#ec4899", "#8b5cf6", "#3b82f6", "#84cc16", "#f97316", "#14b8a6", "#a855f7", "#ef4444"];

interface Pt { date: string; close: number; }

export default function ComparePane({
  symbols,
  currentSymbol,
  onSelect,
}: {
  symbols: string[];
  currentSymbol: string;
  onSelect: (s: string) => void;
}) {
  // Build deterministic symbol list — current symbol first, then watchlist (deduped)
  const sset = useMemo(() => {
    const all = [currentSymbol, ...symbols].filter(Boolean);
    const seen = new Set<string>();
    const uniq: string[] = [];
    for (const s of all) { if (!seen.has(s)) { seen.add(s); uniq.push(s); } }
    return uniq.slice(0, 12);
  }, [symbols, currentSymbol]);

  const ssetKey = sset.join("|");

  const [days, setDays] = useState(90);
  const [data, setData] = useState<Record<string, Pt[]>>({});
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"normalized" | "price">("normalized");
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (sset.length === 0) { setData({}); return; }
    let cancelled = false;
    setLoading(true);
    Promise.all(
      sset.map((s) =>
        findata.ohlc(s, daysAgoISO(days), todayISO(), "1d")
          .then((r) => ({ s, bars: (r?.bars ?? []).map((b) => ({ date: b.ts.slice(0, 10), close: b.close })) }))
          .catch(() => ({ s, bars: [] as Pt[] }))
      )
    )
      .then((pairs) => {
        if (cancelled) return;
        const next: Record<string, Pt[]> = {};
        for (const p of pairs) next[p.s] = p.bars;
        setData(next);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [ssetKey, days]);

  // Merge per-date dataset
  const chartData = useMemo(() => {
    const dateMap: Record<string, Record<string, string | number | null>> = {};
    for (const sym of sset) {
      const series = data[sym] ?? [];
      if (series.length === 0) continue;
      const base = series[0].close;
      for (const b of series) {
        if (!dateMap[b.date]) dateMap[b.date] = { date: b.date };
        const v = mode === "normalized" ? (b.close / base - 1) * 100 : b.close;
        dateMap[b.date][sym] = v;
      }
    }
    return Object.values(dateMap).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }, [data, mode, sset]);

  const symbolsWithData = useMemo(() => sset.filter((s) => (data[s] ?? []).length > 0), [data, sset]);
  const symbolsWithoutData = useMemo(() => sset.filter((s) => (data[s] ?? []).length === 0), [data, sset]);

  const returns = useMemo(() => {
    return sset.map((sym) => {
      const series = data[sym] ?? [];
      if (series.length < 2) return { symbol: sym, pct: null as number | null };
      return { symbol: sym, pct: series[series.length - 1].close / series[0].close - 1 };
    }).sort((a, b) => (b.pct ?? -Infinity) - (a.pct ?? -Infinity));
  }, [data, sset]);

  return (
    <div className="flex flex-col gap-3">
      {/* Controls */}
      <div className="flex items-center gap-2 text-xs flex-wrap">
        {RANGES.map((r) => (
          <button key={r.label} onClick={() => setDays(r.days)}
            className={`px-2 py-1 rounded ${days === r.days ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-accent"}`}>
            {r.label}
          </button>
        ))}
        <span className="mx-2 h-4 w-px bg-border" />
        <button onClick={() => setMode("normalized")}
          className={`px-2 py-1 rounded ${mode === "normalized" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-accent"}`}>
          % return
        </button>
        <button onClick={() => setMode("price")}
          className={`px-2 py-1 rounded ${mode === "price" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-accent"}`}>
          $ price
        </button>
        <span className="ml-auto text-muted-foreground">{sset.length} symbol{sset.length === 1 ? "" : "s"}</span>
      </div>

      {sset.length === 1 && (
        <div className="text-xs text-muted-foreground italic">
          Showing only {currentSymbol}. Pin more symbols (☆ next to a symbol in the header) to add them.
        </div>
      )}

      {loading && <p className="text-sm text-muted-foreground animate-pulse">Loading…</p>}

      {!loading && symbolsWithoutData.length > 0 && (
        <div className="text-xs rounded border border-amber-500/40 bg-amber-500/10 p-2 text-amber-700 dark:text-amber-400">
          No OHLC data for {symbolsWithoutData.join(", ")} — kv.run hasn't backfilled prices for these. The remaining {symbolsWithData.length} are charted below.
        </div>
      )}

      {/* Chart */}
      {!loading && chartData.length > 0 && (
        <div className="rounded border border-border p-3 bg-card">
          <div className="h-80">
            <ResponsiveContainer>
              <LineChart data={chartData} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={50} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => mode === "normalized" ? `${(v as number).toFixed(0)}%` : `$${(v as number).toFixed(0)}`} />
                <Tooltip
                  contentStyle={{ fontSize: 11, padding: 4 }}
                  formatter={(v: any) =>
                    v == null ? "—"
                    : mode === "normalized" ? `${v > 0 ? "+" : ""}${v.toFixed(2)}%`
                    : `$${v.toFixed(2)}`
                  }
                />
                <Legend wrapperStyle={{ fontSize: 10 }}
                  onClick={(e) => {
                    const sym = (e as { dataKey?: string }).dataKey;
                    if (!sym) return;
                    setHidden((h) => { const n = new Set(h); n.has(sym) ? n.delete(sym) : n.add(sym); return n; });
                  }} />
                {mode === "normalized" && <ReferenceLine y={0} stroke="#64748b" />}
                {symbolsWithData.map((s, i) => (
                  <Line key={s}
                    type="monotone"
                    dataKey={s}
                    stroke={COLOURS[sset.indexOf(s) % COLOURS.length]}
                    dot={false}
                    strokeWidth={s === currentSymbol ? 2.5 : 1.4}
                    hide={hidden.has(s)}
                    connectNulls />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {!loading && chartData.length === 0 && symbolsWithoutData.length === sset.length && sset.length > 0 && (
        <div className="rounded border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
          <div className="font-medium text-amber-700 dark:text-amber-400 mb-1">No OHLC data for any pinned symbol</div>
          <div className="text-xs text-muted-foreground">
            kv.run has bars for US equities + indices + crypto + forex, but not for ETFs ({sset.join(", ")} not collected). Pin an equity ticker (AAPL, NVDA, TSLA…) to compare.
          </div>
        </div>
      )}

      {/* Return leaderboard */}
      <div className="rounded border border-border p-3 bg-card">
        <div className="text-xs text-muted-foreground mb-2">Return over selected period</div>
        <div className="grid gap-1.5">
          {returns.map((r) => (
            <button
              key={r.symbol}
              onClick={() => onSelect(r.symbol)}
              className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs hover:bg-accent transition-colors ${r.symbol === currentSymbol ? "bg-accent/50" : ""}`}
            >
              <span className="w-2 h-2 rounded-full" style={{ background: COLOURS[sset.indexOf(r.symbol) % COLOURS.length] }} />
              <span className="font-mono font-medium w-16 text-left">{r.symbol}</span>
              <div className="flex-1 relative h-2 bg-muted rounded">
                {r.pct != null && (
                  <div
                    className={`absolute top-0 h-full rounded ${r.pct >= 0 ? "bg-green-500" : "bg-red-500"}`}
                    style={{
                      left: r.pct >= 0 ? "50%" : `${50 + Math.max(-50, r.pct * 100)}%`,
                      width: `${Math.min(50, Math.abs(r.pct * 100))}%`,
                    }}
                  />
                )}
                <div className="absolute left-1/2 top-0 h-full w-px bg-foreground/30" />
              </div>
              <span className={`font-mono w-20 text-right ${r.pct == null ? "text-muted-foreground" : r.pct > 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                {r.pct == null ? "no data" : `${r.pct > 0 ? "+" : ""}${(r.pct * 100).toFixed(1)}%`}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function _unused() { return fmtPct(0); }

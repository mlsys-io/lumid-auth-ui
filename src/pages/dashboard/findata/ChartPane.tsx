import { useEffect, useMemo, useState } from "react";
import {
  ComposedChart, Line, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, ReferenceLine, Cell,
} from "recharts";
import {
  findata, todayISO, daysAgoISO, fmtNumber,
  type Bar as OhlcBar,
} from "@/api/findata";

const RANGES = [
  { label: "1M",  days: 30 },
  { label: "3M",  days: 90 },
  { label: "6M",  days: 180 },
  { label: "1Y",  days: 365 },
  { label: "5Y",  days: 5 * 365 },
];

function rollingMean(xs: number[], n: number): (number | null)[] {
  const out: (number | null)[] = [];
  for (let i = 0; i < xs.length; i++) {
    if (i < n - 1) { out.push(null); continue; }
    let sum = 0;
    for (let j = i - n + 1; j <= i; j++) sum += xs[j];
    out.push(sum / n);
  }
  return out;
}

export default function ChartPane({ symbol }: { symbol: string }) {
  const [days, setDays] = useState(180);
  const [bars, setBars] = useState<OhlcBar[]>([]);
  const [splits, setSplits] = useState<{ date: string }[]>([]);
  const [divs, setDivs] = useState<{ date: string; amount: number }[]>([]);
  const [showMA20, setShowMA20] = useState(true);
  const [showMA50, setShowMA50] = useState(true);
  const [showSplits, setShowSplits] = useState(true);
  const [showDivs, setShowDivs] = useState(true);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!symbol) return;
    setLoading(true); setErr("");
    Promise.all([
      findata.ohlc(symbol, daysAgoISO(days), todayISO(), "1d").then((r) => r.bars ?? []).catch((e) => { setErr(String(e)); return [] as OhlcBar[]; }),
      findata.splits(symbol, 20).catch(() => []),
      findata.dividends(symbol, 60).catch(() => []),
    ])
      .then(([b, s, d]) => {
        setBars(b);
        setSplits((s as { date: string }[]).filter((x) => x.date));
        setDivs((d as { date: string; amount: number }[]).filter((x) => x.date && x.amount));
      })
      .finally(() => setLoading(false));
  }, [symbol, days]);

  const data = useMemo(() => {
    if (!bars.length) return [];
    const closes = bars.map((b) => b.close);
    const ma20 = rollingMean(closes, 20);
    const ma50 = rollingMean(closes, 50);
    const divByDate = new Map(divs.map((d) => [d.date.slice(0, 10), d.amount]));
    return bars.map((b, i) => {
      const dateStr = b.ts.slice(0, 10);
      return {
        date: dateStr,
        close: b.close,
        open: b.open,
        ma20: ma20[i],
        ma50: ma50[i],
        volume: b.volume,
        volumeColor: b.close >= b.open ? "#10b981" : "#ef4444",
        divAmount: divByDate.get(dateStr) ?? null,
      };
    });
  }, [bars, divs]);

  const splitDates = useMemo(() => {
    if (!bars.length) return new Set<string>();
    const earliest = bars[0].ts.slice(0, 10);
    return new Set(splits.map((s) => s.date.slice(0, 10)).filter((d) => d >= earliest));
  }, [splits, bars]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 text-xs flex-wrap">
        {RANGES.map((r) => (
          <button
            key={r.label}
            onClick={() => setDays(r.days)}
            className={`px-2 py-1 rounded ${days === r.days ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-accent"}`}
          >
            {r.label}
          </button>
        ))}
        <span className="mx-2 h-4 w-px bg-border" />
        <ToggleChip on={showMA20} onChange={setShowMA20} colour="#f59e0b" label="MA20" />
        <ToggleChip on={showMA50} onChange={setShowMA50} colour="#8b5cf6" label="MA50" />
        <ToggleChip on={showSplits} onChange={setShowSplits} colour="#06b6d4" label="Splits" />
        <ToggleChip on={showDivs} onChange={setShowDivs} colour="#10b981" label="Dividends" />
        <span className="ml-auto text-muted-foreground">{bars.length} bars</span>
      </div>

      {loading && <p className="text-sm text-muted-foreground animate-pulse">Loading…</p>}
      {err && <p className="text-sm text-destructive">{err}</p>}
      {/* Detect sparse data (collector running at low cadence on server) */}
      {!loading && !err && bars.length > 0 && (() => {
        const sparsity = days / bars.length;
        // Expected: ~252 trading days per year so days/bars ≈ 1.45.
        // If days/bars > 7 we're hitting a low-cadence collector.
        if (sparsity > 7) {
          return (
            <div className="text-xs rounded border border-amber-500/40 bg-amber-500/10 p-2 text-amber-700 dark:text-amber-400">
              Sparse data: only {bars.length} bars for {days}-day range ({sparsity.toFixed(0)}d gap avg). kv.run's collector is running below daily cadence for {symbol}.
            </div>
          );
        }
        return null;
      })()}
      {!loading && !err && bars.length === 0 && (
        <div className="rounded border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
          <div className="font-medium text-amber-700 dark:text-amber-400 mb-1">No OHLC bars for {symbol}</div>
          <div className="text-xs text-muted-foreground">
            kv.run hasn't backfilled price history for this symbol. Daily bars exist for US equities (try AAPL, NVDA, TSLA) but ETFs, indices, crypto and forex are still pending on the server.
          </div>
        </div>
      )}

      {bars.length > 0 && (
        <>
          <div className="h-72 w-full rounded border border-border p-2 bg-card">
            <ResponsiveContainer>
              <ComposedChart data={data} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={40} />
                <YAxis tick={{ fontSize: 10 }} domain={["auto", "auto"]} />
                <Tooltip
                  labelStyle={{ fontSize: 11 }}
                  contentStyle={{ fontSize: 11, padding: 4 }}
                  formatter={(v: any, k: any) =>
                    k === "divAmount" && v
                      ? [`$${fmtNumber(v, { decimals: 3 })}`, "Dividend"]
                      : typeof v === "number"
                        ? fmtNumber(v, { decimals: 2 })
                        : v
                  }
                />
                <Line dataKey="close" stroke="#6366f1" dot={false} strokeWidth={1.8} />
                {showMA20 && <Line dataKey="ma20" stroke="#f59e0b" dot={false} strokeWidth={1} strokeDasharray="3 3" connectNulls />}
                {showMA50 && <Line dataKey="ma50" stroke="#8b5cf6" dot={false} strokeWidth={1} strokeDasharray="3 3" connectNulls />}
                {showSplits && Array.from(splitDates).map((d) => (
                  <ReferenceLine key={d} x={d} stroke="#06b6d4" strokeDasharray="2 2" label={{ value: "S", fontSize: 10, fill: "#06b6d4", position: "top" }} />
                ))}
                {showDivs && (
                  <Line
                    dataKey="divAmount"
                    stroke="transparent"
                    dot={(props: { cx?: number; cy?: number; payload?: { divAmount?: number | null } }) => {
                      const { cx, cy, payload } = props;
                      if (!payload?.divAmount || cx == null || cy == null) return <></>;
                      return <circle cx={cx} cy={cy} r={3} fill="#10b981" stroke="#fff" strokeWidth={1} />;
                    }}
                  />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="h-24 w-full rounded border border-border p-2 bg-card">
            <ResponsiveContainer>
              <ComposedChart data={data} margin={{ top: 0, right: 8, left: 0, bottom: 0 }}>
                <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={40} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => fmtNumber(v, { abbreviate: true, decimals: 0 })} />
                <Tooltip
                  labelStyle={{ fontSize: 11 }}
                  contentStyle={{ fontSize: 11, padding: 4 }}
                  formatter={(v: any) => fmtNumber(v, { abbreviate: true, decimals: 1 })}
                />
                <Bar dataKey="volume">
                  {data.map((d, i) => (
                    <Cell key={i} fill={d.volumeColor} />
                  ))}
                </Bar>
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </div>
  );
}

function ToggleChip({ on, onChange, colour, label }: { on: boolean; onChange: (v: boolean) => void; colour: string; label: string }) {
  return (
    <button
      onClick={() => onChange(!on)}
      className={`px-2 py-1 rounded text-xs font-mono inline-flex items-center gap-1 ${on ? "bg-accent" : "bg-muted/40 hover:bg-muted text-muted-foreground"}`}
    >
      <span className="w-2 h-2 rounded-full" style={{ background: on ? colour : "#999" }} />
      {label}
    </button>
  );
}

import { useEffect, useState } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend, LineChart, Line, XAxis, YAxis, CartesianGrid } from "recharts";
import { findata, fmtNumber, fmtPct, type PriceTarget, type RecommendationRow, type Grade } from "@/api/findata";

export default function EstimatesPane({ symbol }: { symbol: string }) {
  const [pt, setPT] = useState<PriceTarget | null>(null);
  const [recs, setRecs] = useState<RecommendationRow[]>([]);
  const [grades, setGrades] = useState<Grade[]>([]);
  const [forwardEst, setForwardEst] = useState<unknown>(null);
  const [last, setLast] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!symbol) return;
    setLoading(true); setErr("");
    const end = new Date().toISOString().slice(0, 10);
    const start = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10);
    Promise.all([
      findata.priceTarget(symbol).catch(() => null),
      findata.recommendation(symbol).catch(() => []),
      findata.grades(symbol, 15).catch(() => []),
      findata.analystEstimates(symbol).catch(() => null),
      findata.ohlc(symbol, start, end, "1d").catch(() => null),
    ])
      .then(([p, r, g, fe, o]) => {
        setPT(p);
        setRecs(r as RecommendationRow[]);
        setGrades(g as Grade[]);
        setForwardEst(fe);
        if (o && (o as { bars?: { close: number }[] }).bars?.length) {
          const bars = (o as { bars: { close: number }[] }).bars;
          setLast(bars[bars.length - 1].close);
        }
      })
      .catch((e) => setErr(String(e)))
      .finally(() => setLoading(false));
  }, [symbol]);

  if (loading) return <p className="text-sm text-muted-foreground animate-pulse">Loading…</p>;
  if (err) return <p className="text-sm text-destructive">{err}</p>;

  const upside = last && pt?.target_consensus ? pt.target_consensus / last - 1 : null;
  const latestRec = recs[0];
  const recTotal = latestRec
    ? latestRec.strong_buy + latestRec.buy + latestRec.hold + latestRec.sell + latestRec.strong_sell
    : 0;

  return (
    <div className="flex flex-col gap-4">
      {/* Price target cards */}
      {pt?.target_consensus != null && (
        <div className="grid gap-3 md:grid-cols-4">
          <Card label="Consensus target" value={`$${fmtNumber(pt.target_consensus, { decimals: 2 })}`} />
          <Card label="High" value={`$${fmtNumber(pt.target_high, { decimals: 2 })}`} />
          <Card label="Low" value={`$${fmtNumber(pt.target_low, { decimals: 2 })}`} />
          <Card
            label="Upside vs spot"
            value={fmtPct(upside)}
            sub={last ? `last $${fmtNumber(last, { decimals: 2 })}` : undefined}
          />
        </div>
      )}

      {/* Recommendation rollup (donut + bar + history) */}
      {latestRec && recTotal > 0 && (
        <div className="rounded border border-border p-3 bg-card">
          <div className="flex items-baseline justify-between mb-2">
            <h3 className="text-sm font-semibold">Analyst recommendation rollup</h3>
            <span className="text-xs text-muted-foreground">{latestRec.period.slice(0, 7)} · {recTotal} analysts</span>
          </div>
          <div className="grid gap-3 md:grid-cols-[200px_1fr]">
            <div className="h-44">
              <ResponsiveContainer>
                <PieChart>
                  <Pie
                    data={[
                      { name: "Strong buy",  value: latestRec.strong_buy,  fill: "#16a34a" },
                      { name: "Buy",         value: latestRec.buy,         fill: "#4ade80" },
                      { name: "Hold",        value: latestRec.hold,        fill: "#f59e0b" },
                      { name: "Sell",        value: latestRec.sell,        fill: "#f87171" },
                      { name: "Strong sell", value: latestRec.strong_sell, fill: "#dc2626" },
                    ].filter((d) => d.value > 0)}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={40}
                    outerRadius={70}
                    paddingAngle={1}
                  >
                  </Pie>
                  <Tooltip contentStyle={{ fontSize: 11, padding: 4 }} formatter={(v: number) => `${v} analysts (${((v / recTotal) * 100).toFixed(0)}%)`} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex flex-col justify-center">
              <RecBar rec={latestRec} total={recTotal} />
              <div className="grid grid-cols-5 gap-2 mt-3 text-xs">
                <Bucket label="Strong buy"  value={latestRec.strong_buy}  total={recTotal} cls="bg-green-600" />
                <Bucket label="Buy"          value={latestRec.buy}          total={recTotal} cls="bg-green-400" />
                <Bucket label="Hold"         value={latestRec.hold}         total={recTotal} cls="bg-amber-400" />
                <Bucket label="Sell"         value={latestRec.sell}         total={recTotal} cls="bg-red-400"   />
                <Bucket label="Strong sell"  value={latestRec.strong_sell}  total={recTotal} cls="bg-red-600"   />
              </div>
            </div>
          </div>
          {recs.length > 4 && (
            <div className="mt-4">
              <div className="text-xs text-muted-foreground mb-1">Recommendation drift over time</div>
              <div className="h-40">
                <ResponsiveContainer>
                  <LineChart data={recs.slice().reverse().map((r) => ({ period: r.period.slice(0, 7), strong_buy: r.strong_buy, buy: r.buy, hold: r.hold, sell: r.sell, strong_sell: r.strong_sell }))} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                    <XAxis dataKey="period" tick={{ fontSize: 9 }} minTickGap={30} />
                    <YAxis tick={{ fontSize: 9 }} />
                    <Tooltip contentStyle={{ fontSize: 11, padding: 4 }} />
                    <Legend wrapperStyle={{ fontSize: 9 }} />
                    <Line dataKey="strong_buy"  stroke="#16a34a" dot={false} strokeWidth={1.2} />
                    <Line dataKey="buy"          stroke="#4ade80" dot={false} strokeWidth={1.2} />
                    <Line dataKey="hold"         stroke="#f59e0b" dot={false} strokeWidth={1.2} />
                    <Line dataKey="sell"         stroke="#f87171" dot={false} strokeWidth={1.2} />
                    <Line dataKey="strong_sell"  stroke="#dc2626" dot={false} strokeWidth={1.2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Recent grade actions */}
      {grades.length > 0 && (
        <div className="rounded border border-border p-3 bg-card">
          <h3 className="text-sm font-semibold mb-2">Recent grade actions</h3>
          <ul className="space-y-1 text-xs">
            {grades.map((g, i) => (
              <li key={i} className="flex items-center gap-2">
                <span className="text-muted-foreground font-mono w-20">{g.date}</span>
                <span className="font-medium w-40 truncate">{g.firm}</span>
                <span className="font-mono">{g.grade}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded ml-auto ${
                  g.action === "upgrade"  ? "bg-green-500/15 text-green-600 dark:text-green-400" :
                  g.action === "downgrade" ? "bg-red-500/15 text-red-600 dark:text-red-400" :
                  g.action === "initiate" ? "bg-blue-500/15 text-blue-600 dark:text-blue-400" :
                                            "bg-muted text-muted-foreground"
                }`}>{g.action}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Forward estimates (analyst-estimates endpoint) */}
      {forwardEst != null && (
        <details className="rounded border border-border p-3 bg-card text-xs">
          <summary className="text-sm font-semibold cursor-pointer">Forward EPS / revenue estimates</summary>
          <pre className="mt-2 overflow-x-auto">{JSON.stringify(forwardEst, null, 2)}</pre>
        </details>
      )}

      {(!pt || pt.target_consensus == null) && recs.length === 0 && grades.length === 0 && (
        <p className="text-sm text-muted-foreground">No analyst coverage for {symbol}.</p>
      )}
    </div>
  );
}

function Card({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded border border-border p-3 bg-card">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-bold font-mono mt-1">{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
}

function RecBar({ rec, total }: { rec: RecommendationRow; total: number }) {
  const pct = (n: number) => (n / total) * 100;
  return (
    <div className="flex h-3 w-full rounded overflow-hidden">
      <div style={{ width: `${pct(rec.strong_buy)}%` }}  className="bg-green-600"  />
      <div style={{ width: `${pct(rec.buy)}%` }}          className="bg-green-400"  />
      <div style={{ width: `${pct(rec.hold)}%` }}         className="bg-amber-400"  />
      <div style={{ width: `${pct(rec.sell)}%` }}         className="bg-red-400"    />
      <div style={{ width: `${pct(rec.strong_sell)}%` }}  className="bg-red-600"    />
    </div>
  );
}

function Bucket({ label, value, total, cls }: { label: string; value: number; total: number; cls: string }) {
  return (
    <div className="text-center">
      <div className={`mx-auto w-3 h-3 rounded ${cls}`} />
      <div className="font-medium text-foreground mt-1">{value}</div>
      <div className="text-muted-foreground">{label}</div>
      <div className="text-muted-foreground text-[10px]">{total ? ((value / total) * 100).toFixed(0) : 0}%</div>
    </div>
  );
}

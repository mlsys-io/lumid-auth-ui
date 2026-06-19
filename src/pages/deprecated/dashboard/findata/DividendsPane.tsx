import { useEffect, useMemo, useState } from "react";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { findata, fmtNumber, type Dividend } from "@/api/findata";

export default function DividendsPane({ symbol }: { symbol: string }) {
  const [items, setItems] = useState<Dividend[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!symbol) return;
    setLoading(true); setErr("");
    findata.dividends(symbol, 80)
      .then(setItems)
      .catch((e) => setErr(String(e)))
      .finally(() => setLoading(false));
  }, [symbol]);

  const timeline = useMemo(
    () => items.slice().reverse().map((d) => ({ date: d.date.slice(0, 7), amount: d.amount, yield: d.yield_pct })),
    [items],
  );

  // Annual totals
  const annual = useMemo(() => {
    const by: Record<string, number> = {};
    for (const d of items) {
      const y = d.date.slice(0, 4);
      by[y] = (by[y] ?? 0) + d.amount;
    }
    return Object.entries(by).map(([year, total]) => ({ year, total })).sort((a, b) => a.year.localeCompare(b.year));
  }, [items]);

  const ttm = useMemo(() => {
    const cutoff = Date.now() - 365 * 86_400_000;
    return items.filter((d) => new Date(d.date).getTime() > cutoff).reduce((s, d) => s + d.amount, 0);
  }, [items]);

  // Approximate dividend growth (5y CAGR if we have it)
  const cagr5 = useMemo(() => {
    if (annual.length < 6) return null;
    const recent = annual[annual.length - 2]; // last full year
    const oldest = annual.find((a) => +a.year === +recent.year - 5);
    if (!oldest || !oldest.total) return null;
    return Math.pow(recent.total / oldest.total, 1 / 5) - 1;
  }, [annual]);

  if (loading) return <p className="text-sm text-muted-foreground animate-pulse">Loading…</p>;
  if (err) return <p className="text-sm text-destructive">{err}</p>;
  if (!items.length) return <p className="text-sm text-muted-foreground">No dividend history.</p>;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 md:grid-cols-4">
        <Card label="Most recent" value={`$${fmtNumber(items[0]?.amount, { decimals: 2 })}`} sub={items[0]?.date} />
        <Card label="TTM total" value={`$${fmtNumber(ttm, { decimals: 2 })}`} sub={`${items.length} payments`} />
        <Card label="Latest yield" value={`${fmtNumber(items[0]?.yield_pct, { decimals: 2 })}%`} sub={items[0]?.frequency} />
        <Card label="5y CAGR" value={cagr5 != null ? `${cagr5 > 0 ? "+" : ""}${(cagr5 * 100).toFixed(1)}%` : "—"} />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded border border-border p-3 bg-card">
          <div className="text-xs text-muted-foreground mb-2">Per-payment timeline</div>
          <div className="h-56">
            <ResponsiveContainer>
              <LineChart data={timeline} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={30} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip contentStyle={{ fontSize: 11, padding: 4 }} formatter={(v: any) => fmtNumber(v, { decimals: 3 })} />
                <Line dataKey="amount" stroke="#10b981" dot={{ r: 2 }} strokeWidth={1.5} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="rounded border border-border p-3 bg-card">
          <div className="text-xs text-muted-foreground mb-2">Annual total dividends</div>
          <div className="h-56">
            <ResponsiveContainer>
              <BarChart data={annual} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="year" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip contentStyle={{ fontSize: 11, padding: 4 }} formatter={(v: any) => `$${fmtNumber(v, { decimals: 2 })}`} />
                <Bar dataKey="total" fill="#10b981" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto rounded border border-border">
        <table className="w-full text-xs border-collapse">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left px-2 py-1 text-muted-foreground font-medium">Ex-div</th>
              <th className="text-left px-2 py-1 text-muted-foreground font-medium">Payment</th>
              <th className="text-left px-2 py-1 text-muted-foreground font-medium">Declared</th>
              <th className="text-right px-2 py-1 text-muted-foreground font-medium">Amount</th>
              <th className="text-right px-2 py-1 text-muted-foreground font-medium">Yield %</th>
              <th className="text-left px-2 py-1 text-muted-foreground font-medium">Freq</th>
            </tr>
          </thead>
          <tbody>
            {items.map((d, i) => (
              <tr key={i} className="border-t border-border/40 hover:bg-accent/40">
                <td className="px-2 py-1 font-mono">{d.date}</td>
                <td className="px-2 py-1 font-mono">{d.payment_date ?? "—"}</td>
                <td className="px-2 py-1 font-mono">{d.declaration_date ?? "—"}</td>
                <td className="px-2 py-1 font-mono text-right">${fmtNumber(d.amount, { decimals: 3 })}</td>
                <td className="px-2 py-1 font-mono text-right">{fmtNumber(d.yield_pct, { decimals: 2 })}%</td>
                <td className="px-2 py-1">{d.frequency}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Card({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded border border-border p-3 bg-card">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-bold font-mono mt-1">{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
}

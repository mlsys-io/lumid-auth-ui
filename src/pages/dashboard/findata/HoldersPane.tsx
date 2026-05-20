import { useEffect, useMemo, useState } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from "recharts";
import { findata, fmtNumber, type HoldersResponse } from "@/api/findata";

const COLOURS = [
  "#6366f1", "#10b981", "#f59e0b", "#06b6d4", "#ec4899",
  "#8b5cf6", "#3b82f6", "#84cc16", "#f97316", "#14b8a6",
];

export default function HoldersPane({ symbol }: { symbol: string }) {
  const [data, setData] = useState<HoldersResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!symbol) return;
    setLoading(true); setErr("");
    findata.holders(symbol, 50)
      .then(setData)
      .catch((e) => setErr(String(e)))
      .finally(() => setLoading(false));
  }, [symbol]);

  const pieData = useMemo(() => {
    if (!data?.holders?.length) return [];
    const top10 = data.holders.slice(0, 10);
    const top10Value = top10.reduce((s, h) => s + (h.market_value as number ?? 0), 0);
    const restValue = data.holders.slice(10).reduce((s, h) => s + (h.market_value as number ?? 0), 0);
    const items = top10
      .filter((h) => (h.market_value as number) > 0)
      .map((h, i) => ({
        name: String(h.institution_name ?? `holder ${i}`).slice(0, 28),
        value: h.market_value as number,
        fill: COLOURS[i % COLOURS.length],
      }));
    if (restValue > 0) items.push({ name: `+${data.holders.length - 10} more`, value: restValue, fill: "#94a3b8" });
    return items;
  }, [data]);

  const top10Pct = useMemo(() => {
    if (!data?.holders?.length) return null;
    const total = data.holders.reduce((s, h) => s + (h.market_value as number ?? 0), 0);
    const top10 = data.holders.slice(0, 10).reduce((s, h) => s + (h.market_value as number ?? 0), 0);
    return total ? top10 / total : null;
  }, [data]);

  if (loading) return <p className="text-sm text-muted-foreground animate-pulse">Loading…</p>;
  if (err) return <p className="text-sm text-destructive">{err}</p>;
  if (!data?.holders?.length) return <p className="text-sm text-muted-foreground">No institutional holders.</p>;

  const cols = Object.keys(data.holders[0]);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded border border-border p-3 bg-card">
          <div className="text-xs text-muted-foreground mb-2">
            Top-10 concentration {top10Pct != null && <span>· {(top10Pct * 100).toFixed(0)}% of disclosed value</span>}
          </div>
          <div className="h-64">
            <ResponsiveContainer>
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={90} paddingAngle={1}>
                  {pieData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                </Pie>
                <Tooltip
                  contentStyle={{ fontSize: 11, padding: 4 }}
                  formatter={(v: number) => `$${fmtNumber(v, { abbreviate: true, decimals: 1 })}`}
                />
                <Legend wrapperStyle={{ fontSize: 9 }} iconSize={8} layout="vertical" align="right" verticalAlign="middle" />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="rounded border border-border p-3 bg-card flex flex-col justify-center text-xs space-y-1">
          <div className="text-sm font-semibold mb-2">Summary</div>
          <div className="flex justify-between"><span className="text-muted-foreground">Total holders</span> <span className="font-mono font-medium">{data.count}</span></div>
          {data.as_of && <div className="flex justify-between"><span className="text-muted-foreground">As of</span> <span className="font-mono">{data.as_of.slice(0, 10)}</span></div>}
          {top10Pct != null && <div className="flex justify-between"><span className="text-muted-foreground">Top-10 share</span> <span className="font-mono">{(top10Pct * 100).toFixed(1)}%</span></div>}
          <div className="flex justify-between"><span className="text-muted-foreground">Disclosed value</span> <span className="font-mono">${fmtNumber(data.holders.reduce((s, h) => s + (h.market_value as number ?? 0), 0), { abbreviate: true, decimals: 1 })}</span></div>
        </div>
      </div>

      <div className="overflow-x-auto rounded border border-border">
        <table className="w-full text-xs border-collapse">
          <thead className="bg-muted/50">
            <tr>
              {cols.map((c) => (
                <th key={c} className="text-left px-2 py-1 text-muted-foreground font-medium">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.holders.map((h, i) => (
              <tr key={i} className="border-t border-border/40 hover:bg-accent/40">
                {cols.map((c) => (
                  <td key={c} className="px-2 py-1 font-mono">
                    {typeof h[c] === "number"
                      ? fmtNumber(h[c] as number, { abbreviate: true, decimals: 2 })
                      : String(h[c] ?? "—")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

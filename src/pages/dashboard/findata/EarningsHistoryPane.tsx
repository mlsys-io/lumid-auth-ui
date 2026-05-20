import { useEffect, useMemo, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine, Cell } from "recharts";
import { findata, fmtNumber, type EarningsHistoryRow } from "@/api/findata";

export default function EarningsHistoryPane({ symbol }: { symbol: string }) {
  const [rows, setRows] = useState<EarningsHistoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!symbol) return;
    setLoading(true); setErr("");
    findata.earningsHistory(symbol, 40)
      .then(setRows)
      .catch((e) => setErr(String(e)))
      .finally(() => setLoading(false));
  }, [symbol]);

  const chartData = useMemo(() => {
    return rows
      .filter((r) => r.actual_eps != null || r.estimated_eps != null)
      .slice()
      .reverse()
      .map((r) => ({
        date: r.report_date.slice(0, 10),
        actual: r.actual_eps,
        estimated: r.estimated_eps,
        surprise_pct: r.surprise_pct != null ? r.surprise_pct * 100 : null,
        beat: r.actual_eps != null && r.estimated_eps != null ? r.actual_eps >= r.estimated_eps : null,
      }));
  }, [rows]);

  const beats = chartData.filter((d) => d.beat === true).length;
  const misses = chartData.filter((d) => d.beat === false).length;
  const beatRate = beats + misses > 0 ? beats / (beats + misses) : null;

  if (loading) return <p className="text-sm text-muted-foreground animate-pulse">Loading…</p>;
  if (err) return <p className="text-sm text-destructive">{err}</p>;
  if (!rows.length) return <p className="text-sm text-muted-foreground">No earnings history.</p>;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 md:grid-cols-3">
        <StatCard label="Reports" value={String(chartData.length)} />
        <StatCard label="Beat rate" value={beatRate != null ? `${(beatRate * 100).toFixed(0)}%` : "—"} sub={`${beats} beats · ${misses} misses`} />
        <StatCard
          label="Avg surprise"
          value={(() => {
            const xs = chartData.map((d) => d.surprise_pct).filter((x): x is number => x != null);
            if (!xs.length) return "—";
            const m = xs.reduce((s, x) => s + x, 0) / xs.length;
            return `${m > 0 ? "+" : ""}${m.toFixed(1)}%`;
          })()}
        />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded border border-border p-3 bg-card">
          <div className="text-xs text-muted-foreground mb-2">Actual vs estimated EPS</div>
          <div className="h-56">
            <ResponsiveContainer>
              <BarChart data={chartData} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip contentStyle={{ fontSize: 11, padding: 4 }} formatter={(v: number) => v == null ? "—" : fmtNumber(v, { decimals: 2 })} />
                <Bar dataKey="estimated" fill="#94a3b8" />
                <Bar dataKey="actual" fill="#6366f1" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="rounded border border-border p-3 bg-card">
          <div className="text-xs text-muted-foreground mb-2">Surprise % (beats vs misses)</div>
          <div className="h-56">
            <ResponsiveContainer>
              <BarChart data={chartData} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}%`} />
                <Tooltip contentStyle={{ fontSize: 11, padding: 4 }} formatter={(v: number) => v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(1)}%`} />
                <ReferenceLine y={0} stroke="#64748b" />
                <Bar dataKey="surprise_pct">
                  {chartData.map((d, i) => (
                    <Cell key={i} fill={d.surprise_pct == null ? "#94a3b8" : d.surprise_pct > 0 ? "#10b981" : "#ef4444"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <details className="rounded border border-border bg-card">
        <summary className="px-3 py-2 text-xs cursor-pointer text-muted-foreground">Raw table</summary>
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-2 py-1 text-muted-foreground font-medium">Reported</th>
                <th className="text-left px-2 py-1 text-muted-foreground font-medium">Fiscal</th>
                <th className="text-right px-2 py-1 text-muted-foreground font-medium">EPS est</th>
                <th className="text-right px-2 py-1 text-muted-foreground font-medium">EPS actual</th>
                <th className="text-right px-2 py-1 text-muted-foreground font-medium">Surprise %</th>
                <th className="text-right px-2 py-1 text-muted-foreground font-medium">Rev est</th>
                <th className="text-right px-2 py-1 text-muted-foreground font-medium">Rev actual</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-border/40 hover:bg-accent/40">
                  <td className="px-2 py-1 font-mono">{r.report_date}</td>
                  <td className="px-2 py-1 font-mono">{r.fiscal_date ?? "—"}</td>
                  <td className="px-2 py-1 font-mono text-right">{r.estimated_eps != null ? fmtNumber(r.estimated_eps, { decimals: 2 }) : "—"}</td>
                  <td className="px-2 py-1 font-mono text-right">{r.actual_eps != null ? fmtNumber(r.actual_eps, { decimals: 2 }) : "—"}</td>
                  <td className={`px-2 py-1 font-mono text-right ${r.surprise_pct != null ? (r.surprise_pct > 0 ? "text-green-600 dark:text-green-400" : r.surprise_pct < 0 ? "text-red-600 dark:text-red-400" : "") : ""}`}>
                    {r.surprise_pct != null ? `${r.surprise_pct > 0 ? "+" : ""}${(r.surprise_pct * 100).toFixed(1)}%` : "—"}
                  </td>
                  <td className="px-2 py-1 font-mono text-right">{r.estimated_revenue != null ? fmtNumber(r.estimated_revenue, { abbreviate: true, decimals: 1 }) : "—"}</td>
                  <td className="px-2 py-1 font-mono text-right">{r.actual_revenue != null ? fmtNumber(r.actual_revenue, { abbreviate: true, decimals: 1 }) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded border border-border p-3 bg-card">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-bold font-mono mt-1">{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
}

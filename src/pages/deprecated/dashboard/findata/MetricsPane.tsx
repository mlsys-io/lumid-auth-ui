import { useEffect, useMemo, useState } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from "recharts";
import { findata, fmtNumber, type KeyMetricsRow, type RatiosRow } from "@/api/findata";

type Sub = "metrics" | "ratios" | "growth";

const COLOURS = ["#6366f1", "#10b981", "#f59e0b", "#06b6d4", "#ec4899", "#8b5cf6"];

const METRICS_CHART_KEYS = ["pe", "pb", "ps", "ev_ebitda", "roe", "roa", "fcf_yield", "debt_to_equity"];
const RATIOS_CHART_KEYS  = ["currentRatio", "quickRatio", "cashRatio", "debtRatio", "grossProfitMargin", "netProfitMargin", "returnOnEquity", "returnOnAssets"];

export default function MetricsPane({ symbol }: { symbol: string }) {
  const [sub, setSub] = useState<Sub>("metrics");
  const [metrics, setMetrics] = useState<KeyMetricsRow[]>([]);
  const [ratios, setRatios] = useState<RatiosRow[]>([]);
  const [growth, setGrowth] = useState<unknown[]>([]);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!symbol) return;
    setLoading(true); setErr("");
    const load = sub === "metrics"
      ? findata.keyMetrics(symbol).then(setMetrics)
      : sub === "ratios"
        ? findata.ratios(symbol).then(setRatios)
        : findata.financialGrowth(symbol).then(setGrowth);
    load.catch((e) => setErr(String(e))).finally(() => setLoading(false));
  }, [symbol, sub]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 text-xs">
        {([
          ["metrics", "Key metrics"],
          ["ratios", "Ratios"],
          ["growth", "Growth"],
        ] as [Sub, string][]).map(([id, label]) => (
          <button key={id} onClick={() => setSub(id)}
            className={`px-2 py-1 rounded ${sub === id ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-accent"}`}>
            {label}
          </button>
        ))}
      </div>

      {loading && <p className="text-sm text-muted-foreground animate-pulse">Loading…</p>}
      {err && <p className="text-sm text-destructive">{err}</p>}

      {sub === "metrics" && !loading && (
        <MetricsView rows={metrics} />
      )}
      {sub === "ratios" && !loading && (
        <RatiosView rows={ratios} />
      )}
      {sub === "growth" && !loading && (
        <GrowthView rows={growth as Record<string, unknown>[]} />
      )}
    </div>
  );
}

function MetricsView({ rows }: { rows: KeyMetricsRow[] }) {
  const chart = useMemo(() => rows.slice().reverse().map((r) => ({
    period: r.period_end_date.slice(0, 7),
    ...Object.fromEntries(METRICS_CHART_KEYS.filter((k) => typeof r[k] === "number").map((k) => [k, r[k]])),
  })), [rows]);
  if (!rows.length) return <p className="text-sm text-muted-foreground">No metrics.</p>;
  const presentKeys = METRICS_CHART_KEYS.filter((k) => chart.some((d: Record<string, unknown>) => typeof d[k] === "number"));

  return (
    <div className="flex flex-col gap-3">
      {presentKeys.length > 0 && (
        <div className="rounded border border-border p-3 bg-card">
          <div className="text-xs text-muted-foreground mb-2">Trend</div>
          <div className="h-64">
            <ResponsiveContainer>
              <LineChart data={chart} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="period" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip contentStyle={{ fontSize: 11, padding: 4 }} formatter={(v: any) => fmtNumber(v, { decimals: 3 })} />
                <Legend wrapperStyle={{ fontSize: 9 }} />
                {presentKeys.map((k, i) => (
                  <Line key={k} dataKey={k} stroke={COLOURS[i % COLOURS.length]} dot={false} strokeWidth={1.4} connectNulls />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
      <MetricsTable rows={rows} />
    </div>
  );
}

function RatiosView({ rows }: { rows: RatiosRow[] }) {
  if (!rows.length) return <p className="text-sm text-muted-foreground">No ratios.</p>;
  // Try chart keys present in r.ratios
  const present = RATIOS_CHART_KEYS.filter((k) => rows.some((r) => typeof r.ratios?.[k] === "number"));
  const chart = rows.slice().reverse().map((r) => ({
    period: r.period_end_date.slice(0, 7),
    ...Object.fromEntries(present.map((k) => [k, r.ratios?.[k]])),
  }));
  return (
    <div className="flex flex-col gap-3">
      {present.length > 0 && (
        <div className="rounded border border-border p-3 bg-card">
          <div className="text-xs text-muted-foreground mb-2">Ratio trends</div>
          <div className="h-64">
            <ResponsiveContainer>
              <LineChart data={chart} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="period" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip contentStyle={{ fontSize: 11, padding: 4 }} formatter={(v: any) => fmtNumber(v, { decimals: 3 })} />
                <Legend wrapperStyle={{ fontSize: 9 }} />
                {present.map((k, i) => (
                  <Line key={k} dataKey={k} stroke={COLOURS[i % COLOURS.length]} dot={false} strokeWidth={1.2} connectNulls />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
      <RatiosTable rows={rows} />
    </div>
  );
}

function GrowthView({ rows }: { rows: Record<string, unknown>[] }) {
  if (!rows.length) return <p className="text-sm text-muted-foreground">No growth data.</p>;
  const dateKey = Object.keys(rows[0]).find((k) => /date|period/i.test(k)) ?? Object.keys(rows[0])[0];
  const numKeys = Object.keys(rows[0]).filter((k) => k !== dateKey && typeof rows[0][k] === "number").slice(0, 6);
  const chart = rows.slice().reverse().map((r) => ({ period: String(r[dateKey] ?? "").slice(0, 7), ...Object.fromEntries(numKeys.map((k) => [k, r[k]])) }));
  return (
    <div className="flex flex-col gap-3">
      {numKeys.length > 0 && (
        <div className="rounded border border-border p-3 bg-card">
          <div className="text-xs text-muted-foreground mb-2">Growth rates</div>
          <div className="h-64">
            <ResponsiveContainer>
              <LineChart data={chart} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="period" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${(v * 100).toFixed(0)}%`} />
                <Tooltip contentStyle={{ fontSize: 11, padding: 4 }} formatter={(v: any) => v == null ? "—" : `${(v * 100).toFixed(2)}%`} />
                <Legend wrapperStyle={{ fontSize: 9 }} />
                {numKeys.map((k, i) => (
                  <Line key={k} dataKey={k} stroke={COLOURS[i % COLOURS.length]} dot={false} strokeWidth={1.4} connectNulls />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
      <DynamicTable rows={rows} />
    </div>
  );
}

function MetricsTable({ rows }: { rows: KeyMetricsRow[] }) {
  const cols = Object.keys(rows[0]).filter((c) => c !== "period_type");
  return (
    <div className="overflow-x-auto rounded border border-border">
      <table className="w-full text-xs border-collapse">
        <thead className="bg-muted/50">
          <tr>{cols.map((c) => <th key={c} className="text-left px-2 py-1 text-muted-foreground font-medium">{c}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-border/40 hover:bg-accent/40">
              {cols.map((c) => {
                const v = r[c];
                return <td key={c} className="px-2 py-1 font-mono">{typeof v === "number" ? fmtNumber(v, { decimals: 3 }) : String(v ?? "—")}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RatiosTable({ rows }: { rows: RatiosRow[] }) {
  const keys = new Set<string>();
  for (const r of rows) Object.keys(r.ratios ?? {}).forEach((k) => keys.add(k));
  const cols = ["period_end_date", "period_type", ...Array.from(keys).slice(0, 30)];
  return (
    <div className="overflow-x-auto rounded border border-border">
      <table className="w-full text-xs border-collapse">
        <thead className="bg-muted/50">
          <tr>{cols.map((c) => <th key={c} className="text-left px-2 py-1 text-muted-foreground font-medium">{c}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-border/40 hover:bg-accent/40">
              {cols.map((c) => {
                const v = c === "period_end_date" ? r.period_end_date : c === "period_type" ? r.period_type : r.ratios?.[c];
                return <td key={c} className="px-2 py-1 font-mono">{typeof v === "number" ? fmtNumber(v, { decimals: 3 }) : String(v ?? "—")}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DynamicTable({ rows }: { rows: Record<string, unknown>[] }) {
  if (!rows.length) return <p className="text-sm text-muted-foreground">No data.</p>;
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
                  {typeof r[c] === "number" ? fmtNumber(r[c] as number, { decimals: 3 }) : String(r[c] ?? "—")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

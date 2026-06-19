import { useEffect, useMemo, useState } from "react";
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";
import { findata, fmtNumber } from "@/api/findata";
import { SubTabs } from "./ValuationPane";

type Sub = "ratings" | "historical" | "disclosures";

const SUBS: { id: Sub; label: string }[] = [
  { id: "ratings",     label: "Ratings"     },
  { id: "historical",  label: "Historical"  },
  { id: "disclosures", label: "Disclosures" },
];

export default function ESGPane({ symbol }: { symbol: string }) {
  const [sub, setSub] = useState<Sub>("ratings");
  const [data, setData] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!symbol) return;
    setLoading(true); setErr(""); setData(null);
    const p = sub === "ratings"   ? findata.esgRatings(symbol)
            : sub === "historical" ? findata.esgHistorical(symbol)
            :                       findata.esgDisclosures(symbol);
    p.then(setData).catch((e) => setErr(String(e))).finally(() => setLoading(false));
  }, [symbol, sub]);

  return (
    <div className="flex flex-col gap-3">
      <SubTabs subs={SUBS} active={sub} onChange={setSub} />
      {loading && <p className="text-sm text-muted-foreground animate-pulse">Loading…</p>}
      {err && <p className="text-sm text-destructive">{err}</p>}
      {!loading && !err && (
        sub === "ratings" ? <RatingsView data={data} />
        : sub === "historical" ? <HistoricalView data={data} />
        : Array.isArray(data) && (data as unknown[]).length > 0 ? <DynamicTable rows={data as Record<string, unknown>[]} />
        : <p className="text-sm text-muted-foreground">No ESG data for {symbol}.</p>
      )}
    </div>
  );
}

function RatingsView({ data }: { data: unknown }) {
  if (!data) return <p className="text-sm text-muted-foreground">No rating data.</p>;
  const obj = Array.isArray(data) ? (data[0] as Record<string, unknown>) : (data as Record<string, unknown>);
  if (!obj || typeof obj !== "object") return <p className="text-sm text-muted-foreground">No rating data.</p>;
  // Pull numeric subscores into radar; show non-numeric as KV
  const numerics = Object.entries(obj).filter(([k, v]) => typeof v === "number" && !/year|date|score_total/i.test(k));
  const radar = numerics.map(([k, v]) => ({ axis: k, value: v as number }));
  const max = numerics.length ? Math.max(...numerics.map(([, v]) => v as number)) : 100;
  return (
    <div className="grid gap-3 md:grid-cols-[1fr_2fr]">
      <KVList data={obj} />
      {radar.length >= 3 && (
        <div className="rounded border border-border p-3 bg-card">
          <div className="text-xs text-muted-foreground mb-2">Subscore radar</div>
          <div className="h-64">
            <ResponsiveContainer>
              <RadarChart data={radar}>
                <PolarGrid strokeOpacity={0.3} />
                <PolarAngleAxis dataKey="axis" tick={{ fontSize: 10 }} />
                <PolarRadiusAxis domain={[0, max]} tick={{ fontSize: 9 }} />
                <Radar dataKey="value" stroke="#10b981" fill="#10b981" fillOpacity={0.35} />
                <Tooltip contentStyle={{ fontSize: 11, padding: 4 }} formatter={(v: any) => v.toFixed(2)} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}

function HistoricalView({ data }: { data: unknown }) {
  const rows = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
  if (!rows.length) return <p className="text-sm text-muted-foreground">No history.</p>;
  const keys = Object.keys(rows[0]);
  const dateKey = keys.find((k) => /date|year/i.test(k)) ?? keys[0];
  const numericKeys = keys.filter((k) => k !== dateKey && typeof rows[0][k] === "number");
  return (
    <div className="flex flex-col gap-3">
      {numericKeys.length > 0 && (
        <div className="rounded border border-border p-3 bg-card">
          <div className="text-xs text-muted-foreground mb-2">ESG subscores over time</div>
          <div className="h-56">
            <ResponsiveContainer>
              <LineChart data={rows.slice().reverse()} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey={dateKey} tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip contentStyle={{ fontSize: 11, padding: 4 }} />
                <Legend wrapperStyle={{ fontSize: 9 }} />
                {numericKeys.slice(0, 5).map((k, i) => (
                  <Line key={k} dataKey={k} stroke={["#10b981", "#6366f1", "#f59e0b", "#06b6d4", "#ec4899"][i]} dot={false} strokeWidth={1.5} />
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

function DynamicTable({ rows }: { rows: Record<string, unknown>[] }) {
  if (!rows.length) return <p className="text-sm text-muted-foreground">Empty.</p>;
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

function KVList({ data }: { data: Record<string, unknown> }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
      {Object.entries(data).map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="font-mono">{v == null ? "—" : String(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

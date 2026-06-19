import { useEffect, useMemo, useState } from "react";
import {
  AreaChart, Area, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";
import { findata, fmtNumber, type EvRow, type EarningsQualityRow } from "@/api/findata";

type Sub = "ev" | "dcf" | "scores" | "quality" | "owner";

const SUBS: { id: Sub; label: string }[] = [
  { id: "ev",      label: "Enterprise value" },
  { id: "dcf",     label: "DCF" },
  { id: "scores",  label: "Financial scores" },
  { id: "quality", label: "Earnings quality" },
  { id: "owner",   label: "Owner earnings" },
];

export default function ValuationPane({ symbol }: { symbol: string }) {
  const [sub, setSub] = useState<Sub>("ev");
  const [data, setData] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!symbol) return;
    setLoading(true); setErr(""); setData(null);
    const p = sub === "ev"      ? findata.enterpriseValue(symbol)
            : sub === "dcf"     ? findata.dcf(symbol)
            : sub === "scores"  ? findata.financialScores(symbol)
            : sub === "quality" ? findata.earningsQuality(symbol)
            :                     findata.ownerEarnings(symbol);
    p.then(setData).catch((e) => setErr(String(e))).finally(() => setLoading(false));
  }, [symbol, sub]);

  return (
    <div className="flex flex-col gap-3">
      <SubTabs subs={SUBS} active={sub} onChange={setSub} />
      {loading && <p className="text-sm text-muted-foreground animate-pulse">Loading…</p>}
      {err && <p className="text-sm text-destructive">{err}</p>}
      {!loading && !err && (
        sub === "ev"      ? <EvTable rows={(data as EvRow[]) ?? []} /> :
        sub === "quality" ? <QualityTable rows={(data as EarningsQualityRow[]) ?? []} /> :
                            <DynamicTable rows={(data as Record<string, unknown>[]) ?? []} />
      )}
    </div>
  );
}

function EvTable({ rows }: { rows: EvRow[] }) {
  const chart = useMemo(() => rows.slice().reverse().map((r) => ({
    period: r.period_end_date.slice(0, 7),
    market_cap: r.market_cap,
    debt: r.total_debt,
    cash: -r.cash_and_short_term, // negative = subtracted from EV
  })), [rows]);
  if (!rows.length) return <p className="text-sm text-muted-foreground">No data.</p>;
  return (
    <div className="flex flex-col gap-3">
      <div className="rounded border border-border p-3 bg-card">
        <div className="text-xs text-muted-foreground mb-2">EV composition over time</div>
        <div className="h-56">
          <ResponsiveContainer>
            <AreaChart data={chart} stackOffset="sign" margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis dataKey="period" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => fmtNumber(v, { abbreviate: true, decimals: 0 })} />
              <Tooltip contentStyle={{ fontSize: 11, padding: 4 }} formatter={(v: any) => `$${fmtNumber(Math.abs(v), { abbreviate: true, decimals: 1 })}`} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Area type="monotone" dataKey="market_cap" stackId="1" fill="#6366f1" stroke="#6366f1" />
              <Area type="monotone" dataKey="debt"       stackId="1" fill="#ef4444" stroke="#ef4444" />
              <Area type="monotone" dataKey="cash"       stackId="1" fill="#10b981" stroke="#10b981" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    <div className="overflow-x-auto rounded border border-border">
      <table className="w-full text-xs border-collapse">
        <thead className="bg-muted/50">
          <tr>
            <th className="text-left px-2 py-1 text-muted-foreground font-medium">Period</th>
            <th className="text-right px-2 py-1 text-muted-foreground font-medium">Enterprise value</th>
            <th className="text-right px-2 py-1 text-muted-foreground font-medium">Market cap</th>
            <th className="text-right px-2 py-1 text-muted-foreground font-medium">Total debt</th>
            <th className="text-right px-2 py-1 text-muted-foreground font-medium">Cash + ST</th>
            <th className="text-right px-2 py-1 text-muted-foreground font-medium">EV/MC</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-border/40 hover:bg-accent/40">
              <td className="px-2 py-1 font-mono">{r.period_end_date} {r.period_type}</td>
              <td className="px-2 py-1 font-mono text-right">${fmtNumber(r.enterprise_value, { abbreviate: true, decimals: 2 })}</td>
              <td className="px-2 py-1 font-mono text-right">${fmtNumber(r.market_cap, { abbreviate: true, decimals: 2 })}</td>
              <td className="px-2 py-1 font-mono text-right">${fmtNumber(r.total_debt, { abbreviate: true, decimals: 2 })}</td>
              <td className="px-2 py-1 font-mono text-right">${fmtNumber(r.cash_and_short_term, { abbreviate: true, decimals: 2 })}</td>
              <td className="px-2 py-1 font-mono text-right">{(r.enterprise_value / r.market_cap).toFixed(3)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </div>
  );
}

function QualityTable({ rows }: { rows: EarningsQualityRow[] }) {
  const latest = rows[0];
  const radarData = latest ? [
    { axis: "Growth",        value: latest.growth },
    { axis: "Leverage",      value: latest.leverage },
    { axis: "Profitability", value: latest.profitability },
    { axis: "Cash gen",      value: latest.cash_generation },
  ] : [];
  if (!rows.length) return <p className="text-sm text-muted-foreground">No quality scores.</p>;
  const gradeColour = (g: string) => g.startsWith("A") ? "text-green-600 dark:text-green-400"
                                   : g.startsWith("B") ? "text-blue-600 dark:text-blue-400"
                                   : g.startsWith("C") ? "text-amber-600 dark:text-amber-400"
                                   :                     "text-red-600 dark:text-red-400";
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 md:grid-cols-[1fr_2fr]">
        <div className="rounded border border-border p-3 bg-card">
          <div className="text-xs text-muted-foreground mb-2">Latest grade · {latest?.period_end_date.slice(0, 7)}</div>
          <div className={`text-5xl font-bold font-mono text-center my-2 ${gradeColour(latest!.letter_score)}`}>{latest!.letter_score}</div>
          <div className="text-center text-sm font-mono">{latest!.score.toFixed(1)} / 100</div>
        </div>
        <div className="rounded border border-border p-3 bg-card">
          <div className="text-xs text-muted-foreground mb-2">Score breakdown</div>
          <div className="h-48">
            <ResponsiveContainer>
              <RadarChart data={radarData}>
                <PolarGrid strokeOpacity={0.3} />
                <PolarAngleAxis dataKey="axis" tick={{ fontSize: 11 }} />
                <PolarRadiusAxis domain={[0, 100]} tick={{ fontSize: 9 }} />
                <Radar dataKey="value" stroke="#6366f1" fill="#6366f1" fillOpacity={0.4} />
                <Tooltip contentStyle={{ fontSize: 11, padding: 4 }} formatter={(v: any) => v.toFixed(1)} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
      <div className="overflow-x-auto rounded border border-border">
        <table className="w-full text-xs border-collapse">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left px-2 py-1 text-muted-foreground font-medium">Period</th>
              <th className="text-center px-2 py-1 text-muted-foreground font-medium">Grade</th>
              <th className="text-right px-2 py-1 text-muted-foreground font-medium">Score</th>
              <th className="text-right px-2 py-1 text-muted-foreground font-medium">Growth</th>
              <th className="text-right px-2 py-1 text-muted-foreground font-medium">Leverage</th>
              <th className="text-right px-2 py-1 text-muted-foreground font-medium">Profitability</th>
              <th className="text-right px-2 py-1 text-muted-foreground font-medium">Cash gen</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-border/40 hover:bg-accent/40">
                <td className="px-2 py-1 font-mono">{r.period_end_date}</td>
                <td className={`px-2 py-1 font-mono font-bold text-center ${gradeColour(r.letter_score)}`}>{r.letter_score}</td>
                <td className="px-2 py-1 font-mono text-right">{r.score.toFixed(1)}</td>
                <td className="px-2 py-1 font-mono text-right">{r.growth.toFixed(1)}</td>
                <td className="px-2 py-1 font-mono text-right">{r.leverage.toFixed(1)}</td>
                <td className="px-2 py-1 font-mono text-right">{r.profitability.toFixed(1)}</td>
                <td className="px-2 py-1 font-mono text-right">{r.cash_generation.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DynamicTable({ rows }: { rows: Record<string, unknown>[] }) {
  if (!rows.length) return <p className="text-sm text-muted-foreground">No data for this view.</p>;
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

export function SubTabs<T extends string>({ subs, active, onChange }: {
  subs: { id: T; label: string }[]; active: T; onChange: (s: T) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1 text-xs">
      {subs.map((s) => (
        <button key={s.id} onClick={() => onChange(s.id)}
          className={`px-2 py-1 rounded ${active === s.id ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-accent"}`}>
          {s.label}
        </button>
      ))}
    </div>
  );
}

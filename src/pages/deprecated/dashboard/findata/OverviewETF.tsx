import { useEffect, useMemo, useState } from "react";
import {
  PieChart, Pie, Cell, BarChart, Bar, AreaChart, Area,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";
import {
  findata, fmtNumber, fmtPct, todayISO, daysAgoISO,
  type SymbolProfile, type EtfHoldings, type Bar as OhlcBar,
} from "@/api/findata";

const COLOURS = ["#6366f1", "#10b981", "#f59e0b", "#06b6d4", "#ec4899", "#8b5cf6", "#3b82f6", "#84cc16", "#f97316", "#14b8a6"];

export default function OverviewETF({ symbol, onSelect }: { symbol: string; onSelect?: (s: string) => void }) {
  const [profile, setProfile] = useState<SymbolProfile | null>(null);
  const [info, setInfo] = useState<Record<string, unknown> | null>(null);
  const [holdings, setHoldings] = useState<EtfHoldings | null>(null);
  const [sectors, setSectors] = useState<Record<string, unknown>[]>([]);
  const [countries, setCountries] = useState<Record<string, unknown>[]>([]);
  const [bars, setBars] = useState<OhlcBar[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!symbol) return;
    setLoading(true);
    Promise.all([
      findata.symbol(symbol).catch(() => null),
      findata.etfInfo(symbol).then((d) => d as Record<string, unknown> | null).catch(() => null),
      findata.etfHoldings(symbol).catch(() => null),
      findata.etfSectorWeights(symbol).then((d) => (d as Record<string, unknown>[]) ?? []).catch(() => []),
      findata.etfCountryWeights(symbol).then((d) => (d as Record<string, unknown>[]) ?? []).catch(() => []),
      findata.ohlc(symbol, daysAgoISO(90), todayISO(), "1d").then((r) => r?.bars ?? []).catch(() => [] as OhlcBar[]),
    ])
      .then(([p, i, h, s, c, b]) => { setProfile(p); setInfo(i); setHoldings(h); setSectors(s); setCountries(c); setBars(b); })
      .finally(() => setLoading(false));
  }, [symbol]);

  const last = bars.length ? bars[bars.length - 1].close : null;
  const first = bars.length ? bars[0].close : null;
  const ret90d = last && first ? last / first - 1 : null;
  const sparkData = bars.map((b) => ({ ts: b.ts.slice(5, 10), close: b.close }));

  const top10 = useMemo(() => holdings?.holdings.slice(0, 10) ?? [], [holdings]);
  const restWeight = useMemo(() => holdings ? holdings.holdings.slice(10).reduce((s, h) => s + (h.weight_pct ?? 0), 0) : 0, [holdings]);
  const piePoints = useMemo(() => [
    ...top10.map((h, i) => ({ name: h.asset_symbol, value: h.weight_pct ?? 0, fill: COLOURS[i % COLOURS.length] })),
    ...(restWeight > 0 ? [{ name: `+${(holdings?.holdings.length ?? 0) - 10}`, value: restWeight, fill: "#94a3b8" }] : []),
  ], [top10, restWeight, holdings]);

  if (loading) return <p className="text-sm text-muted-foreground animate-pulse">Loading…</p>;

  return (
    <div className="flex flex-col gap-4">
      {/* Hero — price + ETF name */}
      <div className="rounded-lg border border-border p-4 bg-card grid grid-cols-1 md:grid-cols-[1fr_2fr] gap-4">
        <div className="flex flex-col justify-center">
          <div className="text-xs text-muted-foreground uppercase tracking-wider">{symbol} · ETF</div>
          <div className="text-xl font-semibold text-foreground mt-0.5">{profile?.name ?? symbol}</div>
          <div className="text-3xl font-bold font-mono mt-2">{last != null ? `$${fmtNumber(last, { decimals: 2 })}` : "—"}</div>
          {ret90d != null && (
            <div className={`text-sm font-mono mt-1 ${ret90d > 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
              {ret90d > 0 ? "▲" : "▼"} {fmtPct(ret90d)} <span className="text-muted-foreground text-xs">90d</span>
            </div>
          )}
        </div>
        <div className="h-32">
          {sparkData.length > 1 && (
            <ResponsiveContainer>
              <AreaChart data={sparkData} margin={{ top: 5, right: 0, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="sparkETF" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={ret90d != null && ret90d < 0 ? "#ef4444" : "#06b6d4"} stopOpacity={0.3} />
                    <stop offset="100%" stopColor={ret90d != null && ret90d < 0 ? "#ef4444" : "#06b6d4"} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="ts" hide />
                <YAxis hide domain={["dataMin", "dataMax"]} />
                <Tooltip contentStyle={{ fontSize: 10, padding: 4 }} formatter={(v: any) => `$${fmtNumber(v, { decimals: 2 })}`} />
                <Area type="monotone" dataKey="close" stroke={ret90d != null && ret90d < 0 ? "#ef4444" : "#06b6d4"} strokeWidth={2} fill="url(#sparkETF)" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Stat strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Holdings" value={holdings?.count != null ? String(holdings.count) : "—"} />
        <StatCard label="As of" value={holdings?.as_of?.slice(0, 10) ?? "—"} />
        <StatCard label="Market cap" value={profile?.market_cap ? `$${fmtNumber(profile.market_cap, { abbreviate: true, decimals: 2 })}` : "—"} />
        <StatCard label="Sector" value={profile?.sector ?? "—"} />
      </div>

      {/* ETF info (if available) */}
      {info && Object.keys(info).length > 0 && (
        <div className="rounded-lg border border-border p-4 bg-card">
          <h3 className="text-sm font-semibold mb-3 text-foreground">Fund info</h3>
          <dl className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1 text-xs">
            {Object.entries(info).map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="font-mono">{v == null ? "—" : String(v)}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {/* Top holdings pie + bar */}
      {top10.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-lg border border-border p-4 bg-card">
            <h3 className="text-sm font-semibold mb-3 text-foreground">Top-10 holdings</h3>
            <div className="h-64">
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={piePoints} dataKey="value" nameKey="name" innerRadius={45} outerRadius={85} paddingAngle={1}
                    onClick={(d) => onSelect?.((d as { name?: string }).name ?? "")}>
                    {piePoints.map((d, i) => <Cell key={i} fill={d.fill} cursor="pointer" />)}
                  </Pie>
                  <Tooltip contentStyle={{ fontSize: 11, padding: 4 }} formatter={(v: any) => `${v.toFixed(2)}%`} />
                  <Legend wrapperStyle={{ fontSize: 9 }} iconSize={8} layout="vertical" align="right" verticalAlign="middle" />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="rounded-lg border border-border p-4 bg-card">
            <h3 className="text-sm font-semibold mb-3 text-foreground">Top-10 by weight</h3>
            <div className="h-64">
              <ResponsiveContainer>
                <BarChart data={top10} layout="vertical" margin={{ top: 0, right: 12, left: 50, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis type="number" tickFormatter={(v) => `${v}%`} tick={{ fontSize: 10 }} />
                  <YAxis dataKey="asset_symbol" type="category" tick={{ fontSize: 10 }} />
                  <Tooltip contentStyle={{ fontSize: 11, padding: 4 }} formatter={(v: any) => `${v.toFixed(2)}%`} />
                  <Bar dataKey="weight_pct" fill="#6366f1" onClick={(d) => onSelect?.((d as { asset_symbol?: string }).asset_symbol ?? "")} cursor="pointer" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* Sector + country weights */}
      <div className="grid gap-3 md:grid-cols-2">
        {sectors.length > 0 && <WeightsCard title="Sector weights" rows={sectors} colour="#10b981" />}
        {countries.length > 0 && <WeightsCard title="Country weights" rows={countries} colour="#f59e0b" />}
      </div>

      {/* Full holdings table */}
      {holdings && holdings.holdings.length > 0 && (
        <details className="rounded border border-border bg-card">
          <summary className="px-3 py-2 text-xs cursor-pointer text-muted-foreground">All {holdings.count} holdings</summary>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-2 py-1 text-muted-foreground font-medium">Symbol</th>
                  <th className="text-left px-2 py-1 text-muted-foreground font-medium">Name</th>
                  <th className="text-right px-2 py-1 text-muted-foreground font-medium">Weight %</th>
                  <th className="text-right px-2 py-1 text-muted-foreground font-medium">Shares</th>
                  <th className="text-right px-2 py-1 text-muted-foreground font-medium">Value</th>
                </tr>
              </thead>
              <tbody>
                {holdings.holdings.map((h, i) => (
                  <tr key={i} className="border-t border-border/40 hover:bg-accent/40 cursor-pointer" onClick={() => onSelect?.(h.asset_symbol)}>
                    <td className="px-2 py-1 font-mono font-medium">{h.asset_symbol}</td>
                    <td className="px-2 py-1">{h.asset_name}</td>
                    <td className="px-2 py-1 font-mono text-right">{h.weight_pct != null ? `${h.weight_pct.toFixed(2)}%` : "—"}</td>
                    <td className="px-2 py-1 font-mono text-right">{h.shares_number != null ? fmtNumber(h.shares_number, { abbreviate: true, decimals: 1 }) : "—"}</td>
                    <td className="px-2 py-1 font-mono text-right">{h.market_value != null ? `$${fmtNumber(h.market_value, { abbreviate: true, decimals: 1 })}` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-border p-3 bg-card">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-bold font-mono mt-1 truncate">{value}</div>
    </div>
  );
}

function WeightsCard({ title, rows, colour }: { title: string; rows: Record<string, unknown>[]; colour: string }) {
  // auto-detect name + weight column
  const sample = rows[0];
  const keys = Object.keys(sample);
  const nameKey = keys.find((k) => typeof sample[k] === "string") ?? keys[0];
  const weightKey = keys.find((k) => typeof sample[k] === "number") ?? keys[1];
  const sorted = rows.slice().sort((a, b) => (b[weightKey] as number) - (a[weightKey] as number)).slice(0, 12);
  return (
    <div className="rounded-lg border border-border p-4 bg-card">
      <h3 className="text-sm font-semibold mb-3 text-foreground">{title}</h3>
      <div className="h-64">
        <ResponsiveContainer>
          <BarChart data={sorted} layout="vertical" margin={{ top: 0, right: 12, left: 100, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
            <XAxis type="number" tickFormatter={(v) => `${(v as number).toFixed ? (v as number).toFixed(1) : v}%`} tick={{ fontSize: 10 }} />
            <YAxis dataKey={nameKey} type="category" tick={{ fontSize: 10 }} width={100} />
            <Tooltip contentStyle={{ fontSize: 11, padding: 4 }} formatter={(v: any) => `${v.toFixed(2)}%`} />
            <Bar dataKey={weightKey} fill={colour} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";
import { findata, fmtNumber, type EtfHoldings, type EtfExposure } from "@/api/findata";
import { SubTabs } from "./ValuationPane";

type Sub = "info" | "holdings" | "sectors" | "countries" | "exposure";

const SUBS: { id: Sub; label: string }[] = [
  { id: "info",      label: "Info"             },
  { id: "holdings",  label: "Holdings"         },
  { id: "sectors",   label: "Sector weights"   },
  { id: "countries", label: "Country weights"  },
  { id: "exposure",  label: "In ETFs (this stock)" },
];

const COLOURS = ["#6366f1", "#10b981", "#f59e0b", "#06b6d4", "#ec4899", "#8b5cf6", "#3b82f6", "#84cc16", "#f97316", "#14b8a6"];

export default function ETFPane({ symbol, onSelect }: { symbol: string; onSelect?: (s: string) => void }) {
  const [sub, setSub] = useState<Sub>("holdings");
  return (
    <div className="flex flex-col gap-3">
      <SubTabs subs={SUBS} active={sub} onChange={setSub} />
      <div className="text-xs text-muted-foreground italic">
        First four sub-tabs work for ETF symbols (try SPY, QQQ). "In ETFs" lists ETFs that hold the current symbol.
      </div>
      {sub === "info"      && <InfoView symbol={symbol} />}
      {sub === "holdings"  && <HoldingsView symbol={symbol} onSelect={onSelect} />}
      {sub === "sectors"   && <WeightsBar fn={() => findata.etfSectorWeights(symbol)} label="Sector" />}
      {sub === "countries" && <WeightsBar fn={() => findata.etfCountryWeights(symbol)} label="Country" />}
      {sub === "exposure"  && <ExposureView symbol={symbol} onSelect={onSelect} />}
    </div>
  );
}

function InfoView({ symbol }: { symbol: string }) {
  const [data, setData] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!symbol) return;
    setLoading(true);
    findata.etfInfo(symbol).then(setData).catch(() => setData(null)).finally(() => setLoading(false));
  }, [symbol]);
  if (loading) return <p className="text-sm text-muted-foreground animate-pulse">Loading…</p>;
  if (!data) return <p className="text-sm text-muted-foreground">{symbol} is not an ETF, or info unavailable.</p>;
  return (
    <dl className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1 text-xs">
      {Object.entries(data as Record<string, unknown>).map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="font-mono">{v == null ? "—" : String(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

function HoldingsView({ symbol, onSelect }: { symbol: string; onSelect?: (s: string) => void }) {
  const [data, setData] = useState<EtfHoldings | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!symbol) return;
    setLoading(true);
    findata.etfHoldings(symbol).then(setData).catch(() => setData(null)).finally(() => setLoading(false));
  }, [symbol]);
  if (loading) return <p className="text-sm text-muted-foreground animate-pulse">Loading…</p>;
  if (!data?.holdings?.length) return <p className="text-sm text-muted-foreground">{symbol} has no ETF holdings (try SPY or QQQ).</p>;

  const top15 = data.holdings.slice(0, 15);
  const restWeight = data.holdings.slice(15).reduce((s, h) => s + (h.weight_pct ?? 0), 0);
  const pieData = [
    ...top15.map((h, i) => ({ name: h.asset_symbol, value: h.weight_pct ?? 0, fill: COLOURS[i % COLOURS.length] })),
    ...(restWeight > 0 ? [{ name: `+${data.holdings.length - 15} more`, value: restWeight, fill: "#94a3b8" }] : []),
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 md:grid-cols-[1fr_1fr]">
        <div className="rounded border border-border p-3 bg-card">
          <div className="text-xs text-muted-foreground mb-2">Top-15 weight distribution · {data.count} holdings as of {data.as_of}</div>
          <div className="h-72">
            <ResponsiveContainer>
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={50} outerRadius={100} paddingAngle={1}>
                  {pieData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                </Pie>
                <Tooltip contentStyle={{ fontSize: 11, padding: 4 }} formatter={(v: number) => `${v.toFixed(2)}%`} />
                <Legend wrapperStyle={{ fontSize: 9 }} iconSize={8} layout="vertical" align="right" verticalAlign="middle" />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="rounded border border-border p-3 bg-card">
          <div className="text-xs text-muted-foreground mb-2">Top-15 by weight</div>
          <div className="h-72">
            <ResponsiveContainer>
              <BarChart data={top15} layout="vertical" margin={{ top: 0, right: 16, left: 50, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis type="number" tickFormatter={(v) => `${v}%`} tick={{ fontSize: 10 }} />
                <YAxis dataKey="asset_symbol" type="category" tick={{ fontSize: 10 }} />
                <Tooltip contentStyle={{ fontSize: 11, padding: 4 }} formatter={(v: number) => `${v.toFixed(2)}%`} />
                <Bar dataKey="weight_pct" fill="#6366f1" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto rounded border border-border">
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
            {data.holdings.map((h, i) => (
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
    </div>
  );
}

function ExposureView({ symbol, onSelect }: { symbol: string; onSelect?: (s: string) => void }) {
  const [rows, setRows] = useState<EtfExposure[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!symbol) return;
    setLoading(true);
    findata.etfExposure(symbol).then(setRows).catch(() => setRows([])).finally(() => setLoading(false));
  }, [symbol]);
  if (loading) return <p className="text-sm text-muted-foreground animate-pulse">Loading…</p>;
  if (!rows.length) return <p className="text-sm text-muted-foreground">{symbol} is not held by any tracked ETF.</p>;

  const top15 = rows.slice(0, 15);

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded border border-border p-3 bg-card">
        <div className="text-xs text-muted-foreground mb-2">Top 15 ETFs holding {symbol} by weight</div>
        <div className="h-72">
          <ResponsiveContainer>
            <BarChart data={top15} layout="vertical" margin={{ top: 0, right: 16, left: 50, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis type="number" tickFormatter={(v) => `${v}%`} tick={{ fontSize: 10 }} />
              <YAxis dataKey="etf_symbol" type="category" tick={{ fontSize: 10 }} />
              <Tooltip contentStyle={{ fontSize: 11, padding: 4 }} formatter={(v: number) => `${v.toFixed(2)}%`} />
              <Bar dataKey="weight_pct" fill="#10b981" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="overflow-x-auto rounded border border-border">
        <table className="w-full text-xs border-collapse">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left px-2 py-1 text-muted-foreground font-medium">ETF</th>
              <th className="text-right px-2 py-1 text-muted-foreground font-medium">Weight %</th>
              <th className="text-right px-2 py-1 text-muted-foreground font-medium">Shares</th>
              <th className="text-right px-2 py-1 text-muted-foreground font-medium">Value</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 50).map((r, i) => (
              <tr key={i} className="border-t border-border/40 hover:bg-accent/40 cursor-pointer" onClick={() => onSelect?.(r.etf_symbol)}>
                <td className="px-2 py-1 font-mono font-medium">{r.etf_symbol}</td>
                <td className="px-2 py-1 font-mono text-right">{r.weight_pct.toFixed(2)}%</td>
                <td className="px-2 py-1 font-mono text-right">{fmtNumber(r.shares, { abbreviate: true, decimals: 1 })}</td>
                <td className="px-2 py-1 font-mono text-right">${fmtNumber(r.market_value, { abbreviate: true, decimals: 1 })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function WeightsBar({ fn, label }: { fn: () => Promise<unknown[]>; label: string }) {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    setLoading(true);
    fn().then((d) => setRows((d as Record<string, unknown>[]) ?? [])).catch(() => setRows([])).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (loading) return <p className="text-sm text-muted-foreground animate-pulse">Loading…</p>;
  if (!rows.length) return <p className="text-sm text-muted-foreground">No weights data.</p>;

  // Try to auto-detect name + weight columns
  const sample = rows[0];
  const keys = Object.keys(sample);
  const nameKey = keys.find((k) => typeof sample[k] === "string") ?? keys[0];
  const weightKey = keys.find((k) => typeof sample[k] === "number") ?? keys[1];

  const sorted = rows.slice().sort((a, b) => (b[weightKey] as number) - (a[weightKey] as number));

  return (
    <div className="rounded border border-border p-3 bg-card">
      <div className="text-xs text-muted-foreground mb-2">{label} weightings</div>
      <div className="h-96">
        <ResponsiveContainer>
          <BarChart data={sorted} layout="vertical" margin={{ top: 0, right: 16, left: 100, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
            <XAxis type="number" tickFormatter={(v) => `${(v as number).toFixed ? (v as number).toFixed(1) : v}%`} tick={{ fontSize: 10 }} />
            <YAxis dataKey={nameKey} type="category" tick={{ fontSize: 10 }} width={100} />
            <Tooltip contentStyle={{ fontSize: 11, padding: 4 }} formatter={(v: number) => `${v.toFixed(2)}%`} />
            <Bar dataKey={weightKey} fill="#6366f1" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

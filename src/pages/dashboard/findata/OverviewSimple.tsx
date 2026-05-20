import { useEffect, useMemo, useState } from "react";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import {
  findata, fmtNumber, fmtPct, todayISO, daysAgoISO,
  type SymbolProfile, type Bar as OhlcBar,
} from "@/api/findata";

// Simple, price-focused overview for kinds where deep fundamentals
// don't apply: crypto, forex, index, fund, unknown.
export default function OverviewSimple({
  symbol,
  kindLabel,
  accent,
}: {
  symbol: string;
  kindLabel: string;
  accent: string;
}) {
  const [profile, setProfile] = useState<SymbolProfile | null>(null);
  const [bars, setBars] = useState<OhlcBar[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!symbol) return;
    setLoading(true);
    Promise.all([
      findata.symbol(symbol).catch(() => null),
      findata.ohlc(symbol, daysAgoISO(180), todayISO(), "1d").then((r) => r?.bars ?? []).catch(() => [] as OhlcBar[]),
    ])
      .then(([p, b]) => { setProfile(p); setBars(b); })
      .finally(() => setLoading(false));
  }, [symbol]);

  const last = bars.length ? bars[bars.length - 1].close : null;
  const first = bars.length ? bars[0].close : null;
  const ret180 = last && first ? last / first - 1 : null;
  const closes = bars.map((b) => b.close);
  const hi180 = closes.length ? Math.max(...closes) : null;
  const lo180 = closes.length ? Math.min(...closes) : null;
  const range = hi180 && lo180 && hi180 !== lo180 && last ? (last - lo180) / (hi180 - lo180) : null;

  // 30d return + 7d return
  const ret30 = useMemo(() => {
    if (closes.length < 22) return null;
    const cmp = closes[closes.length - 22];
    return cmp ? last! / cmp - 1 : null;
  }, [closes, last]);
  const ret7 = useMemo(() => {
    if (closes.length < 6) return null;
    const cmp = closes[closes.length - 6];
    return cmp ? last! / cmp - 1 : null;
  }, [closes, last]);

  if (loading) return <p className="text-sm text-muted-foreground animate-pulse">Loading…</p>;
  if (!bars.length) return <p className="text-sm text-muted-foreground">No price data for {symbol}.</p>;

  const sparkData = bars.map((b) => ({ ts: b.ts.slice(5, 10), close: b.close }));

  return (
    <div className="flex flex-col gap-4">
      {/* Hero */}
      <div className="rounded-lg border border-border p-4 bg-card grid grid-cols-1 md:grid-cols-[1fr_2fr] gap-4">
        <div className="flex flex-col justify-center">
          <div className="text-xs text-muted-foreground uppercase tracking-wider">{symbol} · {kindLabel}</div>
          <div className="text-xl font-semibold text-foreground mt-0.5">{profile?.name ?? symbol}</div>
          <div className="text-3xl font-bold font-mono mt-2">{last != null ? fmtNumber(last, { decimals: 4 }) : "—"}</div>
          {ret180 != null && (
            <div className={`text-sm font-mono mt-1 ${ret180 > 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
              {ret180 > 0 ? "▲" : "▼"} {fmtPct(ret180)} <span className="text-muted-foreground text-xs">180d</span>
            </div>
          )}
        </div>
        <div className="h-32">
          <ResponsiveContainer>
            <AreaChart data={sparkData} margin={{ top: 5, right: 0, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="sparkSimple" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={ret180 != null && ret180 < 0 ? "#ef4444" : accent} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={ret180 != null && ret180 < 0 ? "#ef4444" : accent} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="ts" hide />
              <YAxis hide domain={["dataMin", "dataMax"]} />
              <Tooltip contentStyle={{ fontSize: 10, padding: 4 }} formatter={(v: any) => fmtNumber(v, { decimals: 4 })} />
              <Area type="monotone" dataKey="close" stroke={ret180 != null && ret180 < 0 ? "#ef4444" : accent} strokeWidth={2} fill="url(#sparkSimple)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Stat strip — multi-horizon returns + range */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <ReturnCard label="7-day" value={ret7} />
        <ReturnCard label="30-day" value={ret30} />
        <ReturnCard label="180-day" value={ret180} />
        <StatCard label={`Range ${lo180 ? fmtNumber(lo180, { decimals: 2 }) : ""} – ${hi180 ? fmtNumber(hi180, { decimals: 2 }) : ""}`}
          value={range != null ? `${(range * 100).toFixed(0)}%` : "—"} />
      </div>

      {/* 180-day range bar */}
      {range != null && last != null && (
        <div className="rounded border border-border p-3 bg-card">
          <div className="text-xs text-muted-foreground mb-2">Where today sits in the 180-day range</div>
          <div className="relative h-6 w-full rounded-full bg-gradient-to-r from-red-500/40 via-amber-500/40 to-green-500/40">
            <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-foreground border-2 border-card shadow"
              style={{ left: `${Math.max(2, Math.min(98, range * 100))}%` }} />
          </div>
        </div>
      )}

      {/* Volume */}
      {bars.some((b) => b.volume > 0) && (
        <div className="rounded-lg border border-border p-4 bg-card">
          <h3 className="text-sm font-semibold mb-2">Volume</h3>
          <div className="h-24">
            <ResponsiveContainer>
              <BarChart data={bars.map((b) => ({ ts: b.ts.slice(5, 10), volume: b.volume }))} margin={{ top: 0, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="ts" tick={{ fontSize: 9 }} minTickGap={40} />
                <YAxis tick={{ fontSize: 9 }} tickFormatter={(v) => fmtNumber(v, { abbreviate: true, decimals: 0 })} />
                <Tooltip contentStyle={{ fontSize: 11, padding: 4 }} formatter={(v: any) => fmtNumber(v, { abbreviate: true, decimals: 1 })} />
                <Bar dataKey="volume" fill="#94a3b8" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-border p-3 bg-card">
      <div className="text-xs text-muted-foreground truncate">{label}</div>
      <div className="text-lg font-bold font-mono mt-1 truncate">{value}</div>
    </div>
  );
}

function ReturnCard({ label, value }: { label: string; value: number | null }) {
  const colour = value == null ? "" : value > 0 ? "text-green-600 dark:text-green-400" : value < 0 ? "text-red-600 dark:text-red-400" : "";
  return (
    <div className="rounded border border-border p-3 bg-card">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-lg font-bold font-mono mt-1 ${colour}`}>
        {value == null ? "—" : `${value > 0 ? "+" : ""}${(value * 100).toFixed(2)}%`}
      </div>
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  RadialBarChart, RadialBar, PolarAngleAxis,
} from "recharts";
import {
  findata, fmtNumber, fmtPct, todayISO, daysAgoISO,
  type SymbolProfile, type PriceTarget, type Bar as OhlcBar,
  type SymbolSentiment, type RecommendationRow,
} from "@/api/findata";

export default function OverviewEquity({ symbol }: { symbol: string }) {
  const [profile, setProfile] = useState<SymbolProfile | null>(null);
  const [pt, setPT] = useState<PriceTarget | null>(null);
  const [bars, setBars] = useState<OhlcBar[]>([]);
  const [sentiment, setSentiment] = useState<SymbolSentiment | null>(null);
  const [rec, setRec] = useState<RecommendationRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!symbol) return;
    setLoading(true); setErr("");
    Promise.all([
      findata.symbol(symbol).catch(() => null),
      findata.priceTarget(symbol).catch(() => null),
      findata.ohlc(symbol, daysAgoISO(90), todayISO(), "1d").then((r) => r?.bars ?? []).catch(() => [] as OhlcBar[]),
      findata.symbolSentiment(symbol).then((s) => s?.[0] ?? null).catch(() => null),
      findata.recommendation(symbol).then((r) => r?.[0] ?? null).catch(() => null),
    ])
      .then(([p, t, b, s, r]) => { setProfile(p); setPT(t); setBars(b); setSentiment(s); setRec(r); })
      .catch((e) => setErr(String(e)))
      .finally(() => setLoading(false));
  }, [symbol]);

  if (loading) return <p className="text-sm text-muted-foreground animate-pulse">Loading…</p>;
  if (err) return <p className="text-sm text-destructive">{err}</p>;
  if (!profile) return <p className="text-sm text-muted-foreground">No company profile.</p>;

  const last = bars.length ? bars[bars.length - 1].close : null;
  const first = bars.length ? bars[0].close : null;
  const ret90d = last && first ? last / first - 1 : null;
  const upside = last && pt?.target_consensus ? pt.target_consensus / last - 1 : null;
  const sparkData = bars.map((b) => ({ ts: b.ts.slice(5, 10), close: b.close }));

  // 52-week proxy from the 90-day window we already have
  const closes = bars.map((b) => b.close);
  const hi = closes.length ? Math.max(...closes) : null;
  const lo = closes.length ? Math.min(...closes) : null;
  const range = hi && lo && hi !== lo && last ? (last - lo) / (hi - lo) : null;

  const recTotal = rec ? rec.strong_buy + rec.buy + rec.hold + rec.sell + rec.strong_sell : 0;
  const recScore = rec && recTotal
    ? ((rec.strong_buy * 1 + rec.buy * 0.5 + rec.hold * 0 + rec.sell * -0.5 + rec.strong_sell * -1) / recTotal + 1) / 2 * 100
    : null;

  return (
    <div className="flex flex-col gap-4">
      {/* Hero row — last price + sparkline + delta */}
      <div className="rounded-lg border border-border p-4 bg-card grid grid-cols-1 md:grid-cols-[1fr_2fr] gap-4">
        <div className="flex flex-col justify-center">
          <div className="text-xs text-muted-foreground uppercase tracking-wider">{profile.symbol}</div>
          <div className="text-xl font-semibold text-foreground mt-0.5">{profile.name ?? "—"}</div>
          <div className="text-3xl font-bold font-mono mt-2">{last != null ? `$${fmtNumber(last, { decimals: 2 })}` : "—"}</div>
          {ret90d != null && (
            <div className={`text-sm font-mono mt-1 ${ret90d > 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
              {ret90d > 0 ? "▲" : "▼"} {fmtPct(ret90d)} <span className="text-muted-foreground text-xs">90d</span>
            </div>
          )}
          <div className="text-xs text-muted-foreground mt-1">
            {profile.sector ?? "—"} · {profile.industry ?? "—"}
          </div>
        </div>
        <div className="h-32">
          {sparkData.length > 1 && (
            <ResponsiveContainer>
              <AreaChart data={sparkData} margin={{ top: 5, right: 0, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={ret90d != null && ret90d < 0 ? "#ef4444" : "#10b981"} stopOpacity={0.3} />
                    <stop offset="100%" stopColor={ret90d != null && ret90d < 0 ? "#ef4444" : "#10b981"} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="ts" hide />
                <YAxis hide domain={["dataMin", "dataMax"]} />
                <Tooltip
                  labelStyle={{ fontSize: 10 }}
                  contentStyle={{ fontSize: 10, padding: 4 }}
                  formatter={(v: any) => `$${fmtNumber(v, { decimals: 2 })}`}
                />
                <Area
                  type="monotone"
                  dataKey="close"
                  stroke={ret90d != null && ret90d < 0 ? "#ef4444" : "#10b981"}
                  strokeWidth={2}
                  fill="url(#sparkFill)"
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Stat strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Market cap" value={profile.market_cap ? `$${fmtNumber(profile.market_cap, { abbreviate: true, decimals: 2 })}` : "—"} />
        <StatCard label="IPO" value={profile.ipo_date ?? "—"} />
        <StatCard label="Country" value={profile.country ?? "—"} />
        <StatCard label="Type" value={profile.is_etf ? "ETF" : profile.is_fund ? "Fund" : "Equity"} />
      </div>

      {/* Visualization row — range, sentiment, recommendation */}
      <div className="grid gap-3 md:grid-cols-3">
        {range != null && (
          <VizCard label={`90-day range  ($${fmtNumber(lo!, { decimals: 2 })} — $${fmtNumber(hi!, { decimals: 2 })})`}>
            <RangeBar pct={range} last={last!} />
          </VizCard>
        )}

        {sentiment && (
          <VizCard label={`Sentiment  ·  ${sentiment.articles_last_week} articles/wk`}>
            <Gauge value={sentiment.sentiment_score} format={(v) => `${(v * 100).toFixed(0)}`} thresholds={[0.4, 0.6]} />
            <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
              <span>{(sentiment.bearish_pct * 100).toFixed(0)}% bearish</span>
              <span>{(sentiment.bullish_pct * 100).toFixed(0)}% bullish</span>
            </div>
          </VizCard>
        )}

        {rec && recScore != null && (
          <VizCard label={`Analyst rec  ·  ${recTotal} analysts`}>
            <Gauge value={recScore / 100} format={(v) => `${(v * 100).toFixed(0)}`} thresholds={[0.4, 0.6]} />
            <RecMiniBar rec={rec} total={recTotal} />
          </VizCard>
        )}
      </div>

      {/* Price target */}
      {pt?.target_consensus != null && last != null && (
        <div className="rounded-lg border border-border p-4 bg-card">
          <div className="flex items-baseline justify-between mb-3">
            <h3 className="text-sm font-semibold">Analyst price target</h3>
            <span className="text-xs text-muted-foreground">{pt.updated_at?.slice(0, 10)}</span>
          </div>
          <PriceTargetViz last={last} pt={pt} upside={upside} />
        </div>
      )}

      {/* Mini volume chart */}
      {bars.length > 1 && (
        <div className="rounded-lg border border-border p-4 bg-card">
          <h3 className="text-sm font-semibold mb-2">Volume (last 90 days)</h3>
          <div className="h-24">
            <ResponsiveContainer>
              <BarChart data={bars.map((b) => ({ ts: b.ts.slice(5, 10), volume: b.volume, color: b.close >= b.open ? "#10b981" : "#ef4444" }))} margin={{ top: 0, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="ts" tick={{ fontSize: 9 }} minTickGap={40} />
                <YAxis tick={{ fontSize: 9 }} tickFormatter={(v) => fmtNumber(v, { abbreviate: true, decimals: 0 })} />
                <Tooltip labelStyle={{ fontSize: 11 }} contentStyle={{ fontSize: 11, padding: 4 }}
                  formatter={(v: any) => fmtNumber(v, { abbreviate: true, decimals: 1 })} />
                <Bar dataKey="volume" fill="#94a3b8" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Mini components ─────────────────────────────────────────────────────────

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-border p-3 bg-card">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-bold font-mono mt-1 truncate">{value}</div>
    </div>
  );
}

function VizCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded border border-border p-3 bg-card flex flex-col">
      <div className="text-xs text-muted-foreground mb-2">{label}</div>
      {children}
    </div>
  );
}

function RangeBar({ pct, last }: { pct: number; last: number }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="relative h-6 w-full rounded-full bg-gradient-to-r from-red-500/40 via-amber-500/40 to-green-500/40">
        <div
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-foreground border-2 border-card shadow"
          style={{ left: `${Math.max(2, Math.min(98, pct * 100))}%` }}
        />
      </div>
      <div className="text-xs font-mono text-center">${fmtNumber(last, { decimals: 2 })}  <span className="text-muted-foreground">({(pct * 100).toFixed(0)}% of range)</span></div>
    </div>
  );
}

function Gauge({ value, format, thresholds }: { value: number; format: (v: number) => string; thresholds: [number, number] }) {
  // value 0..1
  const v = Math.max(0, Math.min(1, value));
  const colour = v < thresholds[0] ? "#ef4444" : v < thresholds[1] ? "#f59e0b" : "#10b981";
  const data = [{ name: "score", value: v * 100, fill: colour }];
  return (
    <div className="relative h-20">
      <ResponsiveContainer>
        <RadialBarChart innerRadius="70%" outerRadius="100%" data={data} startAngle={180} endAngle={0}>
          <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
          <RadialBar dataKey="value" cornerRadius={4} background={{ fill: "rgba(120,120,120,0.15)" }} />
        </RadialBarChart>
      </ResponsiveContainer>
      <div className="absolute inset-x-0 bottom-1 text-center">
        <div className="text-xl font-bold font-mono" style={{ color: colour }}>{format(v)}</div>
      </div>
    </div>
  );
}

function RecMiniBar({ rec, total }: { rec: RecommendationRow; total: number }) {
  const pct = (n: number) => (n / total) * 100;
  return (
    <div className="flex h-2 w-full rounded overflow-hidden mt-2">
      <div style={{ width: `${pct(rec.strong_buy)}%` }} className="bg-green-600" />
      <div style={{ width: `${pct(rec.buy)}%` }} className="bg-green-400" />
      <div style={{ width: `${pct(rec.hold)}%` }} className="bg-amber-400" />
      <div style={{ width: `${pct(rec.sell)}%` }} className="bg-red-400" />
      <div style={{ width: `${pct(rec.strong_sell)}%` }} className="bg-red-600" />
    </div>
  );
}

function PriceTargetViz({ last, pt, upside }: { last: number; pt: PriceTarget; upside: number | null }) {
  // Visualize last / low / consensus / high on a horizontal scale
  const lo = pt.target_low ?? last;
  const hi = pt.target_high ?? last;
  const cons = pt.target_consensus ?? last;
  const min = Math.min(last, lo) * 0.98;
  const max = Math.max(last, hi) * 1.02;
  const pos = (v: number) => ((v - min) / (max - min)) * 100;

  return (
    <div className="flex flex-col gap-3">
      <div className="relative h-10">
        <div className="absolute top-1/2 left-0 right-0 h-1 bg-muted -translate-y-1/2 rounded" />
        <div className="absolute top-1/2 -translate-y-1/2 h-1 bg-primary/30 rounded"
             style={{ left: `${pos(lo)}%`, right: `${100 - pos(hi)}%` }} />
        <Marker pos={pos(lo)}   label={`Low $${fmtNumber(lo, { decimals: 2 })}`}   colour="#94a3b8" />
        <Marker pos={pos(cons)} label={`Tgt $${fmtNumber(cons, { decimals: 2 })}`} colour="#6366f1" big />
        <Marker pos={pos(hi)}   label={`High $${fmtNumber(hi, { decimals: 2 })}`}  colour="#94a3b8" />
        <Marker pos={pos(last)} label={`Now $${fmtNumber(last, { decimals: 2 })}`} colour="#10b981" big />
      </div>
      {upside != null && (
        <div className={`text-sm font-mono text-center ${upside > 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
          {upside > 0 ? "▲" : "▼"} {fmtPct(upside)} upside to consensus
        </div>
      )}
    </div>
  );
}

function Marker({ pos, label, colour, big }: { pos: number; label: string; colour: string; big?: boolean }) {
  return (
    <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2" style={{ left: `${pos}%` }}>
      <div className={`mx-auto rounded-full border-2 border-card`} style={{ width: big ? 14 : 10, height: big ? 14 : 10, background: colour }} />
      <div className="text-[10px] mt-1 whitespace-nowrap font-mono" style={{ color: colour }}>{label}</div>
    </div>
  );
}

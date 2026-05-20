import { useEffect, useMemo, useState } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from "recharts";
import { findata, type SymbolSearchResult } from "@/api/findata";

const COLOURS = ["#6366f1", "#10b981", "#f59e0b", "#06b6d4", "#ec4899", "#8b5cf6", "#3b82f6", "#84cc16", "#f97316", "#14b8a6"];

export default function ScreenerPane({
  onSelect,
}: {
  onSelect: (symbol: string) => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SymbolSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [universeCount, setUniverseCount] = useState<number | null>(null);
  const [sectorFilter, setSectorFilter] = useState<string | null>(null);

  useEffect(() => {
    findata.universe(10_000)
      .then((u) => setUniverseCount(u.length))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!q.trim()) { setResults([]); return; }
    const handle = setTimeout(() => {
      setLoading(true); setErr("");
      findata.searchSymbols(q, 100)
        .then(setResults)
        .catch((e) => setErr(String(e)))
        .finally(() => setLoading(false));
    }, 300);
    return () => clearTimeout(handle);
  }, [q]);

  const sectors = useMemo(() => {
    const by: Record<string, number> = {};
    for (const r of results) {
      const k = r.sector || "Unknown";
      by[k] = (by[k] ?? 0) + 1;
    }
    return Object.entries(by).map(([sector, count]) => ({ sector, count, fill: COLOURS[Math.abs(hashCode(sector)) % COLOURS.length] }));
  }, [results]);

  const filtered = useMemo(
    () => sectorFilter ? results.filter((r) => (r.sector ?? "Unknown") === sectorFilter) : results,
    [results, sectorFilter],
  );

  const grouped = useMemo(() => {
    const by: Record<string, SymbolSearchResult[]> = {};
    for (const r of filtered) {
      const key = r.sector || "Unknown";
      (by[key] ??= []).push(r);
    }
    return Object.entries(by).sort((a, b) => b[1].length - a[1].length);
  }, [filtered]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3 text-xs">
        <input
          className="flex-1 rounded border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          placeholder="Filter — ticker prefix or company name…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {universeCount != null && (
          <span className="text-muted-foreground whitespace-nowrap">{universeCount.toLocaleString()} symbols available</span>
        )}
      </div>

      <div className="text-xs text-muted-foreground italic">
        Server-side filter by market-cap / P/E is pending on kv.run; client-side text + sector filter for now.
      </div>

      {loading && <p className="text-sm text-muted-foreground animate-pulse">Searching…</p>}
      {err && <p className="text-sm text-destructive">{err}</p>}

      {results.length > 0 && (
        <div className="grid gap-3 md:grid-cols-[260px_1fr]">
          <div className="rounded border border-border p-3 bg-card">
            <div className="text-xs text-muted-foreground mb-2">Sector mix — {results.length} matches</div>
            <div className="h-56">
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={sectors} dataKey="count" nameKey="sector" innerRadius={35} outerRadius={70} paddingAngle={1}
                    onClick={(d) => {
                      const sec = (d as { sector?: string }).sector;
                      setSectorFilter((prev) => (sec === prev ? null : sec ?? null));
                    }}>
                    {sectors.map((d, i) => <Cell key={i} fill={d.fill} cursor="pointer" stroke={d.sector === sectorFilter ? "#000" : undefined} strokeWidth={d.sector === sectorFilter ? 2 : 0} />)}
                  </Pie>
                  <Tooltip contentStyle={{ fontSize: 11, padding: 4 }} formatter={(v: number) => `${v} symbols`} />
                  <Legend wrapperStyle={{ fontSize: 8 }} iconSize={7} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            {sectorFilter && (
              <div className="text-xs mt-2 text-muted-foreground">
                Filtering sector: <span className="font-medium text-foreground">{sectorFilter}</span>
                <button onClick={() => setSectorFilter(null)} className="ml-2 px-1.5 py-0.5 rounded bg-muted hover:bg-accent">clear</button>
              </div>
            )}
          </div>

          <div className="space-y-3">
            {grouped.map(([sector, items]) => (
              <div key={sector}>
                <div className="text-xs font-semibold text-muted-foreground mb-1 px-1 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full" style={{ background: COLOURS[Math.abs(hashCode(sector)) % COLOURS.length] }} />
                  {sector} <span className="font-normal">({items.length})</span>
                </div>
                <div className="rounded border border-border overflow-hidden">
                  <table className="w-full text-xs border-collapse">
                    <tbody>
                      {items.slice(0, 40).map((r) => (
                        <tr
                          key={r.symbol}
                          className="border-t border-border/40 hover:bg-accent/40 cursor-pointer"
                          onClick={() => onSelect(r.symbol)}
                        >
                          <td className="px-2 py-1 font-mono font-medium w-20">{r.symbol}</td>
                          <td className="px-2 py-1">{r.name}</td>
                          <td className="px-2 py-1 text-muted-foreground text-right">{r.industry ?? ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading && !q.trim() && (
        <p className="text-sm text-muted-foreground">Type to filter the symbol universe.</p>
      )}
    </div>
  );
}

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = (h << 5) - h + s.charCodeAt(i); h |= 0; }
  return h;
}

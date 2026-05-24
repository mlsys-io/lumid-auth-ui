import { useEffect, useState } from "react";
import { findata, fmtNumber, type Earning } from "@/api/findata";

export default function EarningsPane({ symbol }: { symbol: string }) {
  const [items, setItems] = useState<Earning[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [scope, setScope] = useState<"symbol" | "all">("symbol");

  useEffect(() => {
    if (!symbol && scope === "symbol") return;
    setLoading(true); setErr("");
    findata.earnings(scope === "symbol" ? symbol : undefined, 50)
      .then(setItems)
      .catch((e) => setErr(String(e)))
      .finally(() => setLoading(false));
  }, [symbol, scope]);

  if (loading) return <p className="text-sm text-muted-foreground animate-pulse">Loading…</p>;
  if (err) return <p className="text-sm text-destructive">{err}</p>;

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 text-xs">
        <button
          onClick={() => setScope("symbol")}
          className={`px-2 py-1 rounded ${scope === "symbol" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-accent"}`}
        >
          {symbol} only
        </button>
        <button
          onClick={() => setScope("all")}
          className={`px-2 py-1 rounded ${scope === "all" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-accent"}`}
        >
          All upcoming
        </button>
        <span className="ml-auto text-muted-foreground">{items.length} reports</span>
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No earnings on file.</p>
      ) : (
        <div className="overflow-x-auto rounded border border-border">
          <table className="w-full text-xs border-collapse">
            <thead className="bg-muted/50">
              <tr>
                {scope === "all" && <th className="text-left px-2 py-1 text-muted-foreground font-medium">Symbol</th>}
                <th className="text-left px-2 py-1 text-muted-foreground font-medium">Report date</th>
                <th className="text-left px-2 py-1 text-muted-foreground font-medium">Time</th>
                <th className="text-right px-2 py-1 text-muted-foreground font-medium">EPS est</th>
                <th className="text-right px-2 py-1 text-muted-foreground font-medium">EPS actual</th>
                <th className="text-right px-2 py-1 text-muted-foreground font-medium">Rev est</th>
                <th className="text-right px-2 py-1 text-muted-foreground font-medium">Rev actual</th>
                <th className="text-left px-2 py-1 text-muted-foreground font-medium">Surprise</th>
              </tr>
            </thead>
            <tbody>
              {items.map((e, i) => {
                const upcoming = e.report_date >= today;
                const surprise =
                  e.eps_actual != null && e.eps_estimated != null && e.eps_estimated !== 0
                    ? (e.eps_actual / e.eps_estimated - 1) * 100
                    : null;
                return (
                  <tr key={i} className={`border-t border-border/40 hover:bg-accent/40 ${upcoming ? "" : "text-muted-foreground"}`}>
                    {scope === "all" && (
                      <td className="px-2 py-1 font-mono font-medium">{e.symbol}</td>
                    )}
                    <td className="px-2 py-1 font-mono">{e.report_date}</td>
                    <td className="px-2 py-1">{e.time_of_day ?? "—"}</td>
                    <td className="px-2 py-1 font-mono text-right">{e.eps_estimated != null ? fmtNumber(e.eps_estimated, { decimals: 2 }) : "—"}</td>
                    <td className="px-2 py-1 font-mono text-right">{e.eps_actual != null ? fmtNumber(e.eps_actual, { decimals: 2 }) : "—"}</td>
                    <td className="px-2 py-1 font-mono text-right">{e.revenue_estimated != null ? fmtNumber(e.revenue_estimated, { abbreviate: true, decimals: 1 }) : "—"}</td>
                    <td className="px-2 py-1 font-mono text-right">{e.revenue_actual != null ? fmtNumber(e.revenue_actual, { abbreviate: true, decimals: 1 }) : "—"}</td>
                    <td className={`px-2 py-1 font-mono ${surprise != null && surprise > 0 ? "text-green-600 dark:text-green-400" : surprise != null && surprise < 0 ? "text-red-600 dark:text-red-400" : ""}`}>
                      {surprise != null ? `${surprise > 0 ? "+" : ""}${surprise.toFixed(1)}%` : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

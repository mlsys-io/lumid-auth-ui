import { useEffect, useState } from "react";
import MacroPane from "./findata/MacroPane";
import { findata, type Freshness } from "@/api/findata";
import { cn } from "@/lib/utils";

// Macro Datasets page — global market data (treasury rates, economic
// calendar, IPOs, M&A, FDA approvals, symbol changes, COT). Pulled out
// of the FinData Explorer's tab strip so it's discoverable as its own
// top-level dataset rather than a sub-view of per-symbol findata.

function FreshnessBadge() {
  const [data, setData] = useState<Freshness | null>(null);
  useEffect(() => { findata.freshness().then(setData).catch(() => {}); }, []);
  if (!data) return null;
  const stale = data.red + data.amber;
  const state = stale === 0 ? "green" : stale < 10 ? "amber" : "red";
  const cls = {
    green: "bg-green-500/15 text-green-600 dark:text-green-400 border-green-500/30",
    amber: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
    red:   "bg-red-500/15   text-red-600   dark:text-red-400   border-red-500/30",
  }[state];
  return (
    <span className={cn("text-xs px-2 py-0.5 rounded-full border font-medium", cls)}>
      {data.green} fresh · {data.red} stale
    </span>
  );
}

export default function DatasetsMacroPage() {
  // COT is the only sub-view that's per-symbol; the rest are global.
  // Default to a liquid commodity proxy so COT shows something useful
  // out of the box; user can paste a different ticker.
  const [cotSymbol, setCotSymbol] = useState("ES");

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      <div className="flex items-center gap-3 px-4 py-2 border-b bg-background shrink-0">
        <div className="text-sm font-semibold text-foreground">Macro</div>
        <FreshnessBadge />
        <span className="text-xs text-muted-foreground">
          Treasury rates · economic calendar · indicators · IPOs · M&A · FDA · symbol changes · COT
        </span>
        <div className="ml-auto flex items-center gap-2">
          <label className="text-xs text-muted-foreground">COT symbol</label>
          <input
            className="w-24 rounded border border-border bg-background px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary"
            value={cotSymbol}
            onChange={(e) => setCotSymbol(e.target.value.toUpperCase())}
            placeholder="ES"
          />
        </div>
      </div>
      <div className="flex-1 overflow-auto p-4">
        <MacroPane symbol={cotSymbol} />
      </div>
    </div>
  );
}

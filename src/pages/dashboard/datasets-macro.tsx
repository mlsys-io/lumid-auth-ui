import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, RefreshCw } from "lucide-react";
import MacroPane from "./findata/MacroPane";
import { findata, type Freshness } from "@/api/findata";
import { cn } from "@/lib/utils";
import { useAutoRefresh, fmtAgo, useNowTick } from "@/hooks/useAutoRefresh";

// Macro Datasets page — global market data (treasury rates, economic
// calendar, IPOs, M&A, FDA approvals, symbol changes, COT). Pulled out
// of the FinData Explorer's tab strip so it's discoverable as its own
// top-level dataset rather than a sub-view of per-symbol findata.

function FreshnessBadge({ data }: { data: Freshness | null }) {
  if (!data) return null;
  const stale = data.red + data.amber;
  const state = stale === 0 ? "green" : stale < 10 ? "amber" : "red";
  const cls = {
    green: "bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/30",
    amber: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30",
    red:   "bg-red-500/15   text-red-700   dark:text-red-400   border-red-500/30",
  }[state];
  return (
    <span className={cn("text-xs px-2 py-0.5 rounded-full border font-medium", cls)}
          title={`${data.green} datasets fresh · ${data.amber} amber · ${data.red} red · ${data.gray} gray`}>
      {data.green} fresh{stale > 0 ? ` · ${stale} stale` : ""}
    </span>
  );
}

export default function DatasetsMacroPage() {
  const [freshness, setFreshness] = useState<Freshness | null>(null);

  // Refresh the freshness badge whenever the page loads / focuses / cot
  // symbol changes. The actual sub-pane data lives inside MacroPane and
  // re-fetches when its `symbol` prop changes.
  const loadFreshness = useCallback(async () => {
    try {
      const f = await findata.freshness();
      setFreshness(f);
    } catch { /* silent — banner is informational */ }
  }, []);
  const { loadedAt, refresh } = useAutoRefresh(loadFreshness);
  useNowTick();
  const didMount = useRef(false);
  useEffect(() => {
    if (didMount.current) return;
    didMount.current = true;
    refresh();
  }, [refresh]);

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2 border-b bg-background shrink-0">
        <Activity className="w-4 h-4 text-primary" />
        <div className="text-sm font-semibold text-foreground">Macro</div>
        <FreshnessBadge data={freshness} />
        <span className="text-xs text-muted-foreground hidden lg:inline">
          Treasury rates · econ calendar · indicators · IPOs · M&A · FDA · symbol changes · COT
        </span>
        <span className="ml-auto text-[10px] text-muted-foreground/70">loaded {fmtAgo(loadedAt)}</span>
        <button onClick={refresh}
          className="flex items-center gap-1 px-2 py-0.5 text-xs rounded border border-border hover:bg-accent">
          <RefreshCw className="w-3 h-3" /> Refresh
        </button>
        <div className="text-[10px] text-muted-foreground font-mono">kv.run:5000 · /macro/*</div>
      </div>

      {/* Content — MacroPane owns its own sub-tabs (Indicators / Calendar /
          Treasury / COT / IPOs / M&A / FDA / Symbols) and the per-tab
          COT-symbol picker. Page header stays clean. */}
      <div className="flex-1 overflow-auto p-4">
        <MacroPane />
      </div>
    </div>
  );
}

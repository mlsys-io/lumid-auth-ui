import { useState, useRef } from "react";
import { cn } from "@/lib/utils";
import { ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// Paths match sys_permission.path values from the FinData DB.
// Navigation uses hash changes on the persistent iframe (no remount)
// so the bootstrap + permission-routes round-trip only happens once.

const ANALYSIS_PAGES = [
  { path: "analysis/financials",  label: "Financials" },
  { path: "analysis/industry",    label: "Industry" },
  { path: "analysis/dividends",   label: "Dividends" },
  { path: "analysis/ownership",   label: "Ownership" },
] as const;

const EARNINGS_PAGES = [
  { path: "earnings",             label: "Earnings Calendar" },
  { path: "analysis/filings",    label: "Annual & Quarterly Reports" },
  { path: "analysis/investor",   label: "Investor Relations" },
] as const;

const SIMPLE_PAGES = [
  { path: "screener",                 label: "Screener" },
  { path: "investor/super-investors", label: "Investors" },
  { path: "charting",                 label: "Charting" },
] as const;

type ActivePath = string;

export default function DatasetsFindataPage() {
  const [active, setActive] = useState<ActivePath>("dashboard");
  const iframeRef = useRef<HTMLIFrameElement>(null);

  function navigate(path: string) {
    setActive(path);
    try {
      const cw = iframeRef.current?.contentWindow;
      if (cw) cw.location.hash = `#/${path}`;
    } catch {
      // cross-origin guard — shouldn't happen on same origin
    }
  }

  const isDashboardActive = active === "dashboard";
  const isAnalysisActive = active.startsWith("analysis");
  const isEarningsActive = active === "earnings" || active === "analysis/filings" || active === "analysis/investor";
  const tabCls = (isActive: boolean) =>
    cn(
      "flex items-center gap-1 px-3 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors",
      isActive
        ? "border-primary text-foreground"
        : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground"
    );

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      <div className="flex items-center gap-1 px-4 border-b bg-background shrink-0 overflow-x-auto">

        {/* Dashboard — plain tab */}
        <button className={tabCls(isDashboardActive)} onClick={() => navigate("dashboard")}>
          Dashboard
        </button>

        {/* Analysis — dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className={tabCls(isAnalysisActive)}>
              Analysis <ChevronDown className="h-3 w-3 opacity-60" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {ANALYSIS_PAGES.map(p => (
              <DropdownMenuItem key={p.path} onSelect={() => navigate(p.path)}>
                {p.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Screener, Investors, Charting — plain tabs */}
        {SIMPLE_PAGES.map(p => (
          <button
            key={p.path}
            onClick={() => navigate(p.path)}
            className={tabCls(active === p.path)}
          >
            {p.label}
          </button>
        ))}

        {/* Earnings — dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className={tabCls(isEarningsActive)}>
              Earnings <ChevronDown className="h-3 w-3 opacity-60" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {EARNINGS_PAGES.map(p => (
              <DropdownMenuItem key={p.path} onSelect={() => navigate(p.path)}>
                {p.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* News — plain tab */}
        <button className={tabCls(active === "news")} onClick={() => navigate("news")}>
          News
        </button>
      </div>
      <iframe
        ref={iframeRef}
        src="/findata-embed/?embed=1"
        className="flex-1 w-full border-0"
        title="Financial data"
        sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
      />
    </div>
  );
}

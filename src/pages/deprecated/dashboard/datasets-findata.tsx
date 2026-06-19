import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { GitCompareArrows, Filter, ListTree } from "lucide-react";
import { cn } from "@/lib/utils";
import { findata, type SymbolSearchResult, type Freshness, type SymbolProfile } from "@/api/findata";

import OverviewPane from "./findata/OverviewPane";
import ChartPane from "./findata/ChartPane";
import LivePane from "./findata/LivePane";
import FinancialsPane from "./findata/FinancialsPane";
import ReportsPane from "./findata/ReportsPane";
import OwnershipPane from "./findata/OwnershipPane";
import ProfilePane from "./findata/ProfilePane";
import InsightsPane from "./findata/InsightsPane";
import NewsPane from "./findata/NewsPane";
import ComparePane from "./findata/ComparePane";
import ScreenerPane from "./findata/ScreenerPane";
import CatalogPane from "./findata/CatalogPane";

type Tab =
  | "overview" | "chart" | "live"
  | "financials" | "reports" | "ownership" | "profile" | "insights"
  | "news"
  | "compare" | "screener" | "catalog";

// Tab × security-kind matrix.  `kinds` is an allowlist; absent ⇒ all.
interface TabDef { id: Tab; label: string; kinds?: SecKind[]; }
const MAIN_TABS: TabDef[] = [
  { id: "overview",   label: "Overview"   },                                              // every kind
  { id: "chart",      label: "Chart"      },                                              // every kind
  { id: "live",       label: "Live"       },                                              // every kind
  { id: "financials", label: "Financials", kinds: ["equity", "fund", "unknown"] },
  { id: "reports",    label: "Reports",    kinds: ["equity", "unknown"] },
  { id: "ownership",  label: "Ownership",  kinds: ["equity", "fund", "unknown"] },
  { id: "profile",    label: "Profile",    kinds: ["equity", "fund", "unknown"] },
  { id: "insights",   label: "Insights",   kinds: ["equity", "fund", "unknown"] },
  { id: "news",       label: "News",       kinds: ["equity", "etf", "fund", "index", "crypto", "unknown"] },
];

// For Catalog jump-to-tab: rough label → tab mapping. Catalog's per-row "tab" label
// uses the old fine-grained names; map them to the new top-level groupings.
const CATALOG_LABEL_TO_TAB: Record<string, Tab> = {
  Overview: "overview",
  Chart: "chart",
  Live: "live",
  Fundamentals: "financials",
  Metrics:      "financials",
  Valuation:    "financials",
  Estimates:    "financials",
  Dividends:    "financials",
  Reports:    "reports",
  Ownership:  "ownership",
  Profile:    "profile",
  ETF:        "insights",
  ESG:        "insights",
  Government: "insights",
  Activity:   "insights",
  News:       "news",
  Screener:   "screener",
};

// Macro is its own dataset page now (was promoted out of the FinData
// Explorer tab strip on 2026-05-20). Catalog rows still mark these as
// `tab: "Macro"`, but the routing target is the dedicated page; this
// map points each Catalog probe label at the corresponding MacroPane
// sub-tab so we can deep-link via `/dashboard/datasets/macro?sub=<X>`.
const MACRO_LABEL_TO_SUB: Record<string, string> = {
  "Indicators":     "indicators",
  "Calendar":       "calendar",
  "Treasury rates": "treasury",
  "COT":            "cot",
  "IPOs":           "ipos",
  "M&A (global)":   "mergers",
  "FDA calendar":   "fda",
  "Symbol changes": "symbols",
};

// ── Security type detection ────────────────────────────────────────────────

import type { SecKind } from "./findata/OverviewPane";

const SEC_LABEL: Record<SecKind, string> = {
  equity:  "Equity",  etf: "ETF",  fund: "Fund",
  index:   "Index",   crypto: "Crypto",  forex: "Forex",  unknown: "Unknown",
};

const SEC_COLOUR: Record<SecKind, string> = {
  equity:  "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border-indigo-500/30",
  etf:     "bg-cyan-500/15   text-cyan-600   dark:text-cyan-400   border-cyan-500/30",
  fund:    "bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/30",
  index:   "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  crypto:  "bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/30",
  forex:   "bg-amber-500/15  text-amber-600  dark:text-amber-400  border-amber-500/30",
  unknown: "bg-muted text-muted-foreground border-border",
};

// Tickers that are almost certainly ETFs — used as a hint when the server's
// profile lookup is slow/flaky so the UI doesn't briefly render an equity view.
const KNOWN_ETFS = new Set([
  "SPY", "QQQ", "DIA", "IWM", "VOO", "VTI", "VEA", "VWO", "VXUS", "VTV", "VUG", "VBR",
  "IVV", "IJR", "IJH", "EFA", "EEM", "AGG", "BND", "TLT", "IEF", "SHY", "LQD", "HYG",
  "GLD", "SLV", "USO", "UNG", "TIP", "EMB", "VNQ", "REET",
  "XLK", "XLF", "XLE", "XLV", "XLY", "XLP", "XLI", "XLB", "XLU", "XLRE", "XLC",
  "ARKK", "ARKQ", "ARKG", "ARKW", "ARKF",
  "SOXX", "SMH", "KWEB", "FXI", "MCHI", "EWZ", "EWJ", "EWG", "INDA",
  "QID", "SQQQ", "TQQQ", "SPXS", "SPXL", "UVXY",
  "JEPI", "JEPQ", "SCHD", "DGRO", "DVY", "VIG", "VYM",
]);

function detectKind(symbol: string, profile: SymbolProfile | null): SecKind {
  if (profile?.is_etf) return "etf";
  if (profile?.is_fund) return "fund";
  if (symbol.startsWith("^")) return "index";
  if (/^([A-Z]{2,5})(USDT|USD|EUR|BUSD)$/i.test(symbol)) {
    const knownCrypto = /^(BTC|ETH|SOL|ADA|DOGE|XRP|BNB|MATIC|AVAX|DOT|LINK|UNI|LTC|TRX|SHIB|ATOM|XLM|ARB|OP)/i;
    if (knownCrypto.test(symbol)) return "crypto";
    if (/^[A-Z]{6}$/.test(symbol)) return "forex";
  }
  if (/^(EUR|GBP|USD|JPY|AUD|NZD|CHF|CAD)(EUR|GBP|USD|JPY|AUD|NZD|CHF|CAD)$/.test(symbol)) return "forex";
  if (KNOWN_ETFS.has(symbol.toUpperCase())) return "etf";
  if (profile) return "equity";
  return "unknown";
}

// ── Watchlist storage ──────────────────────────────────────────────────────

const WL_KEY = "findata-explorer:watchlist";
function loadWatchlist(): string[] { try { return JSON.parse(localStorage.getItem(WL_KEY) || "[]"); } catch { return []; } }
function saveWatchlist(s: string[]) { try { localStorage.setItem(WL_KEY, JSON.stringify(s)); } catch {} }

// ── Freshness badge ─────────────────────────────────────────────────────────

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

// ── Symbol search ───────────────────────────────────────────────────────────

function SymbolSearch({ value, onChange }: { value: string; onChange: (s: string) => void }) {
  const [q, setQ] = useState(value);
  const [results, setResults] = useState<SymbolSearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { setQ(value); }, [value]);

  const search = useCallback((v: string) => {
    if (timer.current) clearTimeout(timer.current);
    if (!v.trim()) { setResults([]); setOpen(false); return; }
    setOpen(true);
    timer.current = setTimeout(() => {
      findata.searchSymbols(v, 8)
        .then((r) => { setResults(r); setOpen(true); })
        .catch(() => setResults([]));
    }, 300);
  }, []);

  // Build the dropdown options — always include the typed string as the first
  // option (server search misses exact-symbol matches for QQQ/SPY etc.).
  const cleaned = q.trim().toUpperCase();
  const dropdown = useMemo(() => {
    if (!cleaned) return results;
    const exactInResults = results.some((r) => r.symbol.toUpperCase() === cleaned);
    if (exactInResults) return results;
    return [{ symbol: cleaned, name: "Use as typed (Enter)" } as SymbolSearchResult, ...results];
  }, [cleaned, results]);

  return (
    <div className="relative w-64">
      <input
        className="w-full rounded border border-border bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        placeholder="Search symbol or paste ticker…"
        value={q}
        onChange={(e) => { setQ(e.target.value); search(e.target.value); }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && cleaned) { onChange(cleaned); setOpen(false); }
          if (e.key === "Escape") setOpen(false);
        }}
        onFocus={() => dropdown.length > 0 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && dropdown.length > 0 && (
        <ul className="absolute z-50 mt-1 w-full rounded border border-border bg-popover shadow-lg text-sm max-h-72 overflow-auto">
          {dropdown.map((r, i) => (
            <li key={r.symbol + i} className="px-3 py-1.5 cursor-pointer hover:bg-accent"
              onMouseDown={() => { onChange(r.symbol); setQ(r.symbol); setOpen(false); }}>
              <span className="font-medium font-mono">{r.symbol}</span>
              <span className={`text-xs ml-2 ${i === 0 && r.name === "Use as typed (Enter)" ? "text-muted-foreground italic" : "text-muted-foreground"}`}>{r.name}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Page shell ──────────────────────────────────────────────────────────────

export default function DatasetsFindataPage() {
  const navigate = useNavigate();
  const [symbol, setSymbol] = useState("AAPL");
  const [tab, setTab] = useState<Tab>("overview");
  const [profile, setProfile] = useState<SymbolProfile | null>(null);
  const [profileErr, setProfileErr] = useState(false);
  const [watchlist, setWatchlist] = useState<string[]>(loadWatchlist);

  // Resilient profile lookup — retry once on transient failure.
  // If /symbols still fails, probe /etf/{sym}/holdings as a secondary
  // ETF signal so QQQ/SPY don't fall back to the equity overview.
  const [etfHint, setEtfHint] = useState(false);
  useEffect(() => {
    if (!symbol) return;
    let cancelled = false;
    setProfileErr(false);
    setEtfHint(false);

    const tryProfile = async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const p = await findata.symbol(symbol);
          if (!cancelled) setProfile(p);
          return;
        } catch {
          if (attempt === 0) await new Promise((r) => setTimeout(r, 500));
        }
      }
      // Both attempts failed — fall back to other signals
      if (cancelled) return;
      setProfile(null);
      setProfileErr(true);
      // Secondary: if /etf/{sym}/holdings has data, this is an ETF
      try {
        const h = await findata.etfHoldings(symbol);
        if (!cancelled && h && Array.isArray((h as { holdings?: unknown[] }).holdings) && ((h as { holdings: unknown[] }).holdings.length > 0)) {
          setEtfHint(true);
        }
      } catch { /* ignore */ }
    };
    tryProfile();
    return () => { cancelled = true; };
  }, [symbol]);

  useEffect(() => { saveWatchlist(watchlist); }, [watchlist]);

  const kind = useMemo(() => {
    const base = detectKind(symbol, profile);
    if (base === "unknown" && etfHint) return "etf";
    return base;
  }, [symbol, profile, etfHint]);

  // Visible main tabs for this kind
  const visibleTabs = useMemo(
    () => MAIN_TABS.filter((t) => !t.kinds || t.kinds.includes(kind)),
    [kind],
  );

  // Bounce to Overview if active tab is no longer visible for this kind
  useEffect(() => {
    if (!visibleTabs.some((t) => t.id === tab) && !["compare", "screener", "catalog"].includes(tab)) {
      setTab("overview");
    }
  }, [visibleTabs, tab]);

  const handleSelect = (s: string) => {
    setSymbol(s);
    if (tab === "screener") setTab("overview");
  };

  // Catalog row click. Two routing modes:
  //  - In-page: target maps to a sibling tab in this Explorer (Overview /
  //    Chart / Live / Financials / Reports / Ownership / Profile / Insights /
  //    News / Screener / Catalog). Use setTab.
  //  - Cross-page: target tab is "Macro" — promoted to its own dataset
  //    page on 2026-05-20. Navigate to /dashboard/datasets/macro and pass
  //    the specific sub-tab via ?sub=<X> so the Macro page lands on the
  //    right view (IPOs / COT / Calendar / etc.).
  const jumpTab = (tab: string, label: string) => {
    if (tab === "Macro") {
      const sub = MACRO_LABEL_TO_SUB[label];
      navigate(sub ? `/dashboard/datasets/macro?sub=${sub}` : "/dashboard/datasets/macro");
      return;
    }
    const id = CATALOG_LABEL_TO_TAB[label];
    if (id) setTab(id);
  };

  const togglePin = () => {
    setWatchlist((wl) => wl.includes(symbol) ? wl.filter((s) => s !== symbol) : [...wl, symbol].slice(0, 12));
  };
  const isPinned = watchlist.includes(symbol);

  const tabCls = (active: boolean) =>
    cn(
      "px-3 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors",
      active
        ? "border-primary text-foreground"
        : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground",
    );

  const utilBtnCls = (active: boolean) =>
    cn(
      "inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded border transition-colors",
      active
        ? "border-primary text-primary bg-primary/10"
        : "border-border text-muted-foreground hover:bg-accent",
    );

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* Header bar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b bg-background shrink-0">
        <div className="text-sm font-semibold text-foreground">FinData Explorer</div>
        <FreshnessBadge />

        <div className="ml-auto flex items-center gap-3">
          {/* Utility shortcuts */}
          <div className="flex items-center gap-1">
            <button className={utilBtnCls(tab === "compare")}  onClick={() => setTab("compare")}  title="Compare watchlist">
              <GitCompareArrows className="w-3.5 h-3.5" /> Compare
            </button>
            <button className={utilBtnCls(tab === "screener")} onClick={() => setTab("screener")} title="Filter universe">
              <Filter className="w-3.5 h-3.5" /> Screener
            </button>
            <button className={utilBtnCls(tab === "catalog")}  onClick={() => setTab("catalog")}  title="Catalog of all endpoints">
              <ListTree className="w-3.5 h-3.5" /> Catalog
            </button>
          </div>

          <span className="h-5 w-px bg-border" />

          <SymbolSearch value={symbol} onChange={handleSelect} />
          <span className="text-xs flex items-center gap-2">
            <span className="font-mono font-semibold text-foreground">{symbol}</span>
            <span className={cn("px-2 py-0.5 rounded-full border text-[10px] font-medium", SEC_COLOUR[kind])}>
              {SEC_LABEL[kind]}
            </span>
            <button onClick={togglePin}
              className={cn("text-xs leading-none px-1.5 py-0.5 rounded border transition-colors",
                isPinned
                  ? "border-amber-500 text-amber-600 dark:text-amber-400 bg-amber-500/10"
                  : "border-border text-muted-foreground hover:bg-accent")}
              title={isPinned ? "Unpin from watchlist" : "Pin to watchlist"}>
              {isPinned ? "★" : "☆"}
            </button>
            {profileErr && <span className="text-amber-600 dark:text-amber-400 text-[10px]">profile lookup failed</span>}
          </span>
        </div>
      </div>

      {/* Watchlist strip */}
      {watchlist.length > 0 && (
        <div className="flex items-center gap-1.5 px-4 py-1.5 border-b bg-muted/30 shrink-0 overflow-x-auto">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider mr-1">Watch</span>
          {watchlist.map((s) => (
            <button key={s} onClick={() => handleSelect(s)}
              className={cn(
                "text-xs px-2 py-0.5 rounded font-mono border whitespace-nowrap transition-colors",
                s === symbol ? "border-primary text-primary bg-primary/10" : "border-border text-muted-foreground hover:bg-accent",
              )}>
              {s}
              <span className="ml-1.5 opacity-50 hover:opacity-100"
                onClick={(e) => { e.stopPropagation(); setWatchlist((wl) => wl.filter((x) => x !== s)); }}>×</span>
            </button>
          ))}
        </div>
      )}

      {/* Main tab bar (filtered by security kind) */}
      <div className="flex items-center gap-1 px-4 border-b bg-background shrink-0 overflow-x-auto">
        {visibleTabs.map((t) => (
          <button key={t.id} className={tabCls(tab === t.id)} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {tab === "overview"   && <OverviewPane   symbol={symbol} kind={kind} onSelect={handleSelect} />}
        {tab === "chart"      && <ChartPane      symbol={symbol} />}
        {tab === "live"       && <LivePane       initialSymbol={symbol} />}
        {tab === "financials" && <FinancialsPane symbol={symbol} />}
        {tab === "reports"    && <ReportsPane    symbol={symbol} />}
        {tab === "ownership"  && <OwnershipPane  symbol={symbol} onSelect={handleSelect} />}
        {tab === "profile"    && <ProfilePane    symbol={symbol} onSelect={handleSelect} />}
        {tab === "insights"   && <InsightsPane   symbol={symbol} />}
        {tab === "news"       && <NewsPane       symbol={symbol} />}
        {tab === "compare"    && <ComparePane    symbols={watchlist} currentSymbol={symbol} onSelect={handleSelect} />}
        {tab === "screener"   && <ScreenerPane   onSelect={handleSelect} />}
        {tab === "catalog"    && <CatalogPane    symbol={symbol} onJumpTab={jumpTab} />}
      </div>
    </div>
  );
}

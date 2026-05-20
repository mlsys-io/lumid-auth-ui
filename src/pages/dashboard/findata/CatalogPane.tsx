import { useEffect, useState } from "react";
import { findata } from "@/api/findata";

// Comprehensive catalog of every kv.run endpoint. Probes each for the current
// symbol and reports availability, latency, payload size. Lets users SCAN the
// data service surface and discover what's available for any symbol kind —
// stock, ETF, fund, index, crypto, forex.

type Probe = {
  group: string;
  tab: string; // which dashboard tab surfaces this
  label: string;
  endpoint: string;
  applies?: "stock" | "etf" | "fund" | "index" | "crypto" | "forex" | "any";
  fn: (sym: string) => Promise<unknown>;
};

const PROBES: Probe[] = [
  // Profile / market
  { group: "Profile",       tab: "Overview",     label: "Symbol info",          endpoint: "/symbols/{sym}",                      fn: (s) => findata.symbol(s) },
  { group: "Profile",       tab: "Overview",     label: "Universe",             endpoint: "/universe",                           applies: "any", fn: () => findata.universe(10000) },
  { group: "Profile",       tab: "Overview",     label: "Freshness",            endpoint: "/freshness",                          applies: "any", fn: () => findata.freshness() },
  { group: "Prices",        tab: "Chart",        label: "OHLC daily",           endpoint: "/ohlc/{sym}",                         fn: (s) => findata.ohlc(s, "2026-04-01", "2026-05-19", "1d") },
  { group: "Prices",        tab: "Live",         label: "Live quote stream",    endpoint: "/quotes/stream (SSE)",                fn: async () => "see Live tab" },
  // Fundamentals
  { group: "Fundamentals",  tab: "Fundamentals", label: "Latest",               endpoint: "/fundamentals/{sym}/latest",          applies: "stock", fn: (s) => findata.fundamentals(s) },
  { group: "Fundamentals",  tab: "Fundamentals", label: "History (income)",     endpoint: "/fundamentals/{sym}/history",         applies: "stock", fn: (s) => findata.fundamentalsHistory(s, "income", "quarter", 4) },
  { group: "Metrics",       tab: "Metrics",      label: "Key metrics",          endpoint: "/key-metrics/{sym}",                  applies: "stock", fn: (s) => findata.keyMetrics(s) },
  { group: "Metrics",       tab: "Metrics",      label: "Ratios",               endpoint: "/ratios/{sym}",                       applies: "stock", fn: (s) => findata.ratios(s) },
  { group: "Metrics",       tab: "Metrics",      label: "Growth",               endpoint: "/financial-growth/{sym}",              applies: "stock", fn: (s) => findata.financialGrowth(s) },
  // Valuation
  { group: "Valuation",     tab: "Valuation",    label: "Enterprise value",     endpoint: "/enterprise-value/{sym}",             applies: "stock", fn: (s) => findata.enterpriseValue(s) },
  { group: "Valuation",     tab: "Valuation",    label: "DCF",                  endpoint: "/dcf/{sym}",                          applies: "stock", fn: (s) => findata.dcf(s) },
  { group: "Valuation",     tab: "Valuation",    label: "Financial scores",     endpoint: "/financial-scores/{sym}",             applies: "stock", fn: (s) => findata.financialScores(s) },
  { group: "Valuation",     tab: "Valuation",    label: "Earnings quality",     endpoint: "/earnings-quality/{sym}",             applies: "stock", fn: (s) => findata.earningsQuality(s) },
  { group: "Valuation",     tab: "Valuation",    label: "Owner earnings",       endpoint: "/owner-earnings/{sym}",               applies: "stock", fn: (s) => findata.ownerEarnings(s) },
  // Analyst
  { group: "Analyst",       tab: "Estimates",    label: "Price target",         endpoint: "/estimates/{sym}/price-target",       applies: "stock", fn: (s) => findata.priceTarget(s) },
  { group: "Analyst",       tab: "Estimates",    label: "Forward estimates",    endpoint: "/analyst-estimates/{sym}",            applies: "stock", fn: (s) => findata.analystEstimates(s) },
  { group: "Analyst",       tab: "Estimates",    label: "Recommendation",       endpoint: "/recommendation/{sym}",               applies: "stock", fn: (s) => findata.recommendation(s) },
  { group: "Analyst",       tab: "Estimates",    label: "Grades",               endpoint: "/grades/{sym}",                       applies: "stock", fn: (s) => findata.grades(s) },
  // Income
  { group: "Income",        tab: "Dividends",    label: "Dividends",            endpoint: "/dividends/{sym}",                    fn: (s) => findata.dividends(s) },
  { group: "Income",        tab: "Activity",     label: "Splits",               endpoint: "/splits/{sym}",                       fn: (s) => findata.splits(s) },
  // Reports
  { group: "Reports",       tab: "Reports",      label: "Earnings calendar",    endpoint: "/earnings",                           applies: "stock", fn: (s) => findata.earnings(s, 5) },
  { group: "Reports",       tab: "Reports",      label: "Earnings history",     endpoint: "/earnings/{sym}/history",             applies: "stock", fn: (s) => findata.earningsHistory(s) },
  { group: "Reports",       tab: "Reports",      label: "Filings",              endpoint: "/filings/{sym}",                      applies: "stock", fn: (s) => findata.filings(s) },
  { group: "Reports",       tab: "Reports",      label: "Transcripts",          endpoint: "/transcripts/{sym}",                  applies: "stock", fn: (s) => findata.transcripts(s) },
  // Ownership
  { group: "Ownership",     tab: "Ownership",    label: "Top holders",          endpoint: "/holders/{sym}/top",                  applies: "stock", fn: (s) => findata.holders(s) },
  { group: "Ownership",     tab: "Ownership",    label: "Peers",                endpoint: "/peers/{sym}",                        applies: "stock", fn: (s) => findata.peers(s) },
  { group: "Ownership",     tab: "Ownership",    label: "Insider tx",           endpoint: "/insider/{sym}/transactions",         applies: "stock", fn: (s) => findata.insiderTransactions(s) },
  { group: "Ownership",     tab: "Ownership",    label: "Insider sentiment",    endpoint: "/insider/{sym}/sentiment",            applies: "stock", fn: (s) => findata.insiderSentiment(s) },
  { group: "Ownership",     tab: "Ownership",    label: "Insider stats",        endpoint: "/insider/{sym}/statistics",           applies: "stock", fn: (s) => findata.insiderStatistics(s) },
  { group: "Ownership",     tab: "Ownership",    label: "Fund ownership",       endpoint: "/fund-ownership/{sym}",               applies: "stock", fn: (s) => findata.fundOwnership(s) },
  { group: "Ownership",     tab: "Ownership",    label: "Fund disclosure",      endpoint: "/funds-disclosure/{sym}",             applies: "stock", fn: (s) => findata.fundsDisclosure(s) },
  // Profile depth
  { group: "Company",       tab: "Profile",      label: "Executives",           endpoint: "/executives/{sym}",                   applies: "stock", fn: (s) => findata.executives(s) },
  { group: "Company",       tab: "Profile",      label: "Employee count",       endpoint: "/employee-count/{sym}",               applies: "stock", fn: (s) => findata.employeeCount(s) },
  { group: "Company",       tab: "Profile",      label: "Shares float",         endpoint: "/shares-float/{sym}",                 applies: "stock", fn: (s) => findata.sharesFloat(s) },
  { group: "Company",       tab: "Profile",      label: "Supply chain",         endpoint: "/supply-chain/{sym}",                 applies: "stock", fn: (s) => findata.supplyChain(s) },
  { group: "Company",       tab: "Profile",      label: "Compensation",         endpoint: "/governance/{sym}/compensation",      applies: "stock", fn: (s) => findata.governanceComp(s) },
  // ETF
  { group: "ETF",           tab: "ETF",          label: "Info",                 endpoint: "/etf/{sym}/info",                     applies: "etf",   fn: (s) => findata.etfInfo(s) },
  { group: "ETF",           tab: "ETF",          label: "Holdings",             endpoint: "/etf/{sym}/holdings",                 applies: "etf",   fn: (s) => findata.etfHoldings(s) },
  { group: "ETF",           tab: "ETF",          label: "Sector weights",       endpoint: "/etf/{sym}/sector-weightings",        applies: "etf",   fn: (s) => findata.etfSectorWeights(s) },
  { group: "ETF",           tab: "ETF",          label: "Country weights",      endpoint: "/etf/{sym}/country-weightings",       applies: "etf",   fn: (s) => findata.etfCountryWeights(s) },
  { group: "ETF",           tab: "ETF",          label: "In ETFs",              endpoint: "/symbol/{sym}/etf-exposure",          applies: "stock", fn: (s) => findata.etfExposure(s) },
  // ESG
  { group: "ESG",           tab: "ESG",          label: "Ratings",              endpoint: "/esg/{sym}/ratings",                  applies: "stock", fn: (s) => findata.esgRatings(s) },
  { group: "ESG",           tab: "ESG",          label: "Historical",           endpoint: "/esg/{sym}/historical",               applies: "stock", fn: (s) => findata.esgHistorical(s) },
  { group: "ESG",           tab: "ESG",          label: "Disclosures",          endpoint: "/esg/{sym}/disclosures",              applies: "stock", fn: (s) => findata.esgDisclosures(s) },
  // Government
  { group: "Government",    tab: "Government",   label: "Lobbying",             endpoint: "/lobbying/{sym}",                     applies: "stock", fn: (s) => findata.lobbying(s) },
  { group: "Government",    tab: "Government",   label: "USA spending",         endpoint: "/usa-spending/{sym}",                 applies: "stock", fn: (s) => findata.usaSpending(s) },
  { group: "Government",    tab: "Government",   label: "Gov trades",           endpoint: "/gov-trades/{sym}",                   applies: "stock", fn: (s) => findata.govTrades(s) },
  { group: "Government",    tab: "Government",   label: "USPTO patents",        endpoint: "/uspto-patents/{sym}",                applies: "stock", fn: (s) => findata.patents(s) },
  { group: "Government",    tab: "Government",   label: "Visa applications",    endpoint: "/visa-applications/{sym}",            applies: "stock", fn: (s) => findata.visas(s) },
  // Activity
  { group: "Activity",      tab: "Activity",     label: "Acquisitions",         endpoint: "/acquisitions/{sym}",                 applies: "stock", fn: (s) => findata.acquisitions(s) },
  // News + sentiment
  { group: "News",          tab: "News",         label: "Headlines",            endpoint: "/news/{sym}",                         fn: (s) => findata.news(s) },
  { group: "News",          tab: "News",         label: "Symbol sentiment",     endpoint: "/news/symbol-sentiment/{sym}",        applies: "stock", fn: (s) => findata.symbolSentiment(s) },
  { group: "News",          tab: "News",         label: "Social sentiment",     endpoint: "/news/social-sentiment/{sym}",        applies: "stock", fn: (s) => findata.socialSentiment(s) },
  // Macro (global)
  { group: "Macro",         tab: "Macro",        label: "Indicators",           endpoint: "/macro/economic-indicators",          applies: "any",   fn: () => findata.macroIndicators() },
  { group: "Macro",         tab: "Macro",        label: "Calendar",             endpoint: "/macro/economic-calendar",            applies: "any",   fn: () => findata.macroCalendar(5) },
  { group: "Macro",         tab: "Macro",        label: "Treasury rates",       endpoint: "/macro/treasury-rates",               applies: "any",   fn: () => findata.macroTreasury(5) },
  { group: "Macro",         tab: "Macro",        label: "COT",                  endpoint: "/macro/cot/{sym}",                    fn: (s) => findata.cot(s) },
  { group: "Macro",         tab: "Macro",        label: "IPOs",                 endpoint: "/ipos",                               applies: "any",   fn: () => findata.ipos(5) },
  { group: "Macro",         tab: "Macro",        label: "M&A (global)",         endpoint: "/mergers-acquisitions",               applies: "any",   fn: () => findata.mergersGlobal(5) },
  { group: "Macro",         tab: "Macro",        label: "FDA calendar",         endpoint: "/fda-calendar",                       applies: "any",   fn: () => findata.fdaCalendar(5) },
  { group: "Macro",         tab: "Macro",        label: "Symbol changes",       endpoint: "/symbol-changes",                     applies: "any",   fn: () => findata.symbolChanges(5) },
];

type Status = "loading" | "ok" | "empty" | "error";

interface Result { status: Status; count?: number; latencyMs?: number; error?: string; }

export default function CatalogPane({ symbol, onJumpTab }: { symbol: string; onJumpTab: (label: string) => void }) {
  const [results, setResults] = useState<Record<string, Result>>({});
  const [filter, setFilter] = useState("");

  useEffect(() => {
    if (!symbol) return;
    setResults({});
    // Probe in batches of 8 to avoid hammering
    let cancelled = false;
    (async () => {
      const init: Record<string, Result> = {};
      for (const p of PROBES) init[p.endpoint] = { status: "loading" };
      setResults(init);
      const queue = [...PROBES];
      const inFlight: Promise<void>[] = [];
      const consume = async () => {
        while (queue.length) {
          const probe = queue.shift()!;
          const t0 = performance.now();
          try {
            const r = await probe.fn(symbol);
            if (cancelled) return;
            const latencyMs = Math.round(performance.now() - t0);
            const count = Array.isArray(r) ? r.length : r == null ? 0 : Object.keys(r as object).length;
            setResults((prev) => ({
              ...prev,
              [probe.endpoint]: { status: count > 0 ? "ok" : "empty", count, latencyMs },
            }));
          } catch (e) {
            if (cancelled) return;
            setResults((prev) => ({
              ...prev,
              [probe.endpoint]: { status: "error", error: String(e).slice(0, 80) },
            }));
          }
        }
      };
      for (let i = 0; i < 6; i++) inFlight.push(consume());
      await Promise.all(inFlight);
    })();
    return () => { cancelled = true; };
  }, [symbol]);

  const stats = (() => {
    const all = Object.values(results);
    return {
      total: PROBES.length,
      ok: all.filter((r) => r.status === "ok").length,
      empty: all.filter((r) => r.status === "empty").length,
      error: all.filter((r) => r.status === "error").length,
      loading: all.filter((r) => r.status === "loading").length,
    };
  })();

  const groups: Record<string, Probe[]> = {};
  for (const p of PROBES) {
    if (filter && !`${p.label} ${p.endpoint} ${p.group}`.toLowerCase().includes(filter.toLowerCase())) continue;
    (groups[p.group] ??= []).push(p);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 md:grid-cols-4 text-xs">
        <StatCard label="Endpoints" value={stats.total} colour="text-foreground" />
        <StatCard label="Have data" value={stats.ok}  colour="text-green-600 dark:text-green-400" />
        <StatCard label="Empty"      value={stats.empty} colour="text-amber-600 dark:text-amber-400" />
        <StatCard label="Errored"    value={stats.error} colour="text-red-600 dark:text-red-400" />
      </div>

      <input
        className="rounded border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        placeholder="Filter endpoints…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />

      {Object.entries(groups).map(([group, probes]) => (
        <div key={group} className="rounded border border-border bg-card overflow-hidden">
          <div className="bg-muted/50 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{group}</div>
          <table className="w-full text-xs border-collapse">
            <tbody>
              {probes.map((p) => {
                const r = results[p.endpoint] ?? { status: "loading" as Status };
                return (
                  <tr key={p.endpoint} className="border-t border-border/40 hover:bg-accent/40 cursor-pointer" onClick={() => onJumpTab(p.tab)}>
                    <td className="px-3 py-1.5 w-10"><StatusDot status={r.status} /></td>
                    <td className="px-3 py-1.5 w-48 font-medium">{p.label}</td>
                    <td className="px-3 py-1.5 font-mono text-muted-foreground">{p.endpoint.replace("{sym}", symbol)}</td>
                    <td className="px-3 py-1.5 w-24 font-mono text-right text-muted-foreground">
                      {r.status === "ok" && r.count != null ? `${r.count} rows` : r.status === "empty" ? "empty" : r.status === "error" ? "error" : "…"}
                    </td>
                    <td className="px-3 py-1.5 w-20 font-mono text-right text-muted-foreground">
                      {r.latencyMs != null ? `${r.latencyMs}ms` : ""}
                    </td>
                    <td className="px-3 py-1.5 w-24 text-right">
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">→ {p.tab}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

function StatCard({ label, value, colour }: { label: string; value: number; colour: string }) {
  return (
    <div className="rounded border border-border p-3 bg-card">
      <div className="text-muted-foreground">{label}</div>
      <div className={`text-2xl font-bold font-mono mt-1 ${colour}`}>{value}</div>
    </div>
  );
}

function StatusDot({ status }: { status: Status }) {
  const cls = {
    ok:      "bg-green-500",
    empty:   "bg-amber-500",
    error:   "bg-red-500",
    loading: "bg-muted-foreground animate-pulse",
  }[status];
  return <span className={`inline-block w-2.5 h-2.5 rounded-full ${cls}`} />;
}

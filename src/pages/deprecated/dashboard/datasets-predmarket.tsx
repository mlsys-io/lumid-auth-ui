// Prediction-markets explorer — Polymarket + Kalshi data via kv.run:5000.
//
// Surfaces /prediction-markets/* on findata. Four tabs (Markets first
// because it has the rich populated data):
//   Markets — cross-venue search (Polymarket + Kalshi) with server-side
//             ?status=open|closed|all (added 2026-05-22). Click a row
//             → slide-over with detail + multi-interval price curve +
//             orderbook + outcome chips.
//   Events  — Polymarket event index. End_date / active / closed
//             populated as of 2026-05-22; supports ?status= too.
//   Live    — SSE tick tape from /prediction-markets/stream. Bounded
//             height + pause + filters (event_type, min_size,
//             condition_ids subscription).
//   Wallets — Leaderboard with PnL/ROI/win-rate/style + whale flag.
//             24h/7d/30d/all_time windows supported (all four
//             populated as of 2026-05-22, 8.5M total rows).
//
// Price-curve source priority (MarketDetailPanel):
//   1. Candles       — PRIMARY since kv.run 2026-05-22 multi-interval
//                      backfill (1m/5m/15m/1h/1d). Kalshi 4.5y back,
//                      Polymarket 4y back. Trade-derived when volume>0,
//                      OB-midprice when volume=0. Normalized to
//                      implied-YES via `close > 0.5 ? close : 1-close`
//                      because the endpoint mixes YES + NO outcomes in
//                      one response per market.
//   2. Trades        — Used for the outcome-chip discovery path
//                      (mining token_id from rows) and as a backup
//                      when the chosen interval has no candles yet.
//   3. Orderbook mid — Final fallback for very-old closed markets
//                      where neither candles nor trades were
//                      backfilled.
//
// Same-origin proxy: lumid_landing_readdy nginx rewrites /findata-cloud/*
// to kv.run:5000/* unauthenticated (anon-read is allowed for all read
// paths). EventSource doesn't support custom auth headers, so SSE
// relies on this anon policy.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Calendar,
  ChartCandlestick,
  Globe,
  RefreshCw,
  Search,
  TrendingUp,
  Trophy,
  Radio,
  Square,
  Pause,
  Play,
  X,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { findata } from "@/api/findata";
import type {
  PmEventRow,
  PmMarketRow,
  PmLeaderboardRow,
  PmPolymarketDetail,
  PmKalshiDetail,
  PmCandleRow,
  PmOrderbookSnap,
  PmTradeRow,
} from "@/api/findata";

type Tab = "events" | "markets" | "live" | "wallets";

// ── Format helpers ──────────────────────────────────────────────────────────

function fmtUsd(n: number | null | undefined): string {
  if (n === null || n === undefined || !isFinite(n)) return "—";
  if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

function fmtPct(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || !isFinite(n)) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}

function fmtDate(s: string | null | undefined): string {
  if (!s) return "—";
  const t = new Date(s).getTime();
  if (!isFinite(t)) return s.slice(0, 10);
  return new Date(s).toISOString().slice(0, 10);
}

function shortAddr(addr: string): string {
  if (addr.length < 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function bestBid(levels: { price: string; size: string }[] | undefined): number | null {
  if (!levels?.length) return null;
  const prices = levels.map((l) => parseFloat(l.price)).filter(isFinite);
  if (prices.length === 0) return null; // guard: Math.max(...[]) → -Infinity
  return Math.max(...prices);
}
function bestAsk(levels: { price: string; size: string }[] | undefined): number | null {
  if (!levels?.length) return null;
  const prices = levels.map((l) => parseFloat(l.price)).filter(isFinite);
  if (prices.length === 0) return null;
  return Math.min(...prices);
}

// Public URL for the venue's own market page. Polymarket has stable
// slug-based URLs. Kalshi tickers decompose as <SERIES>-<DATE>-<VARIANT>;
// the series page is the most reliable public link (individual market
// URLs aren't a stable public format).
function marketExternalUrl(m: { venue: string; market_id: string; slug?: string | null; title?: string }): string {
  if (m.venue === "polymarket") {
    return m.slug
      ? `https://polymarket.com/event/${m.slug}`
      : `https://polymarket.com/markets?_q=${encodeURIComponent(m.title ?? "")}`;
  }
  if (m.venue === "kalshi") {
    const series = m.market_id.split("-")[0].toLowerCase();
    return `https://kalshi.com/markets/${series}`;
  }
  return "#";
}

const venueChip = (v: string): string => {
  if (v === "polymarket")
    return "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/30";
  if (v === "kalshi")
    return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30";
  return "bg-muted text-muted-foreground border-border";
};

const styleChip = (s: string): string => {
  switch (s) {
    case "WHALE":   return "bg-purple-500/10 text-purple-700 border-purple-500/30";
    case "SHARP":   return "bg-amber-500/10 text-amber-700 border-amber-500/30";
    case "DEGEN":   return "bg-rose-500/10 text-rose-700 border-rose-500/30";
    default:        return "bg-muted text-muted-foreground border-border";
  }
};

// Topic chips — upstream /markets/search and /events both take a free-text
// `q` param but no category enum, so each chip just re-queries with a
// curated keyword. Used by both Events and Markets tabs.
const TOPIC_CHIPS: { label: string; q: string }[] = [
  { label: "Politics",   q: "election" },
  { label: "Crypto",     q: "bitcoin" },
  { label: "Sports",     q: "nba" },
  { label: "Weather",    q: "rain" },
  { label: "Macro / Fed", q: "fed" },
  { label: "Tech / AI",  q: "ai" },
  { label: "Geopolitics", q: "russia" },
];

// ── EventsTab ───────────────────────────────────────────────────────────────

function EventsTab() {
  const [q, setQ] = useState("");
  // Server-side ?status= filter (kv.run 2026-05-22 added it to /events
  // alongside /markets/search). Default `open` so users see live events
  // first (7,742 currently-open per the kv.run update).
  const [status, setStatus] = useState<"open" | "closed" | "all">("open");
  const [rows, setRows] = useState<PmEventRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchOnce = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await findata.pmEvents({ q: q || undefined, status, limit: 100 });
      setRows(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [q, status]);

  useEffect(() => { fetchOnce(); }, [fetchOnce]);

  return (
    <div className="space-y-3">
      {/* Same topic chips as Markets — events also takes a free-text `q`
          param, so a chip just sets q and re-fetches. */}
      <div className="flex items-center gap-1 flex-wrap text-xs">
        <span className="text-muted-foreground mr-1">Topic:</span>
        {TOPIC_CHIPS.map((chip) => {
          const active = q.trim().toLowerCase() === chip.q.toLowerCase();
          return (
            <button
              key={chip.label}
              onClick={() => { setQ(chip.q); }}
              className={cn(
                "px-2 py-0.5 rounded border transition-colors",
                active
                  ? "border-indigo-500 bg-indigo-50 text-indigo-700 font-medium"
                  : "border-border bg-background hover:bg-accent",
              )}
            >
              {chip.label}
            </button>
          );
        })}
        {q && (
          <button
            onClick={() => setQ("")}
            className="ml-1 px-2 py-0.5 rounded border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100"
            title="Clear topic"
          >
            Clear
          </button>
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            className="w-full pl-7 pr-2 py-1.5 text-sm rounded border bg-background"
            placeholder="Filter events… (e.g. election, fed, china)"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") fetchOnce(); }}
          />
        </div>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as "open" | "closed" | "all")}
          className="px-2 py-1.5 text-sm rounded border bg-background"
          title="Server-side ?status= filter (added 2026-05-22)."
        >
          <option value="open">Open</option>
          <option value="closed">Closed</option>
          <option value="all">All states</option>
        </select>
        <button
          onClick={fetchOnce}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-sm rounded border bg-background hover:bg-accent"
        >
          <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
          Refresh
        </button>
      </div>

      {error && <div className="text-sm text-rose-600">Error: {error}</div>}

      <div className="border rounded overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left">
            <tr>
              <th className="px-3 py-2 font-medium">Title</th>
              <th className="px-3 py-2 font-medium w-24">Category</th>
              <th className="px-3 py-2 font-medium w-24 text-right">Volume</th>
              <th className="px-3 py-2 font-medium w-28">Resolves</th>
              <th className="px-3 py-2 font-medium w-16">State</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows?.map((row) => (
              <tr key={row.event_id} className="hover:bg-muted/30">
                <td className="px-3 py-2 truncate max-w-[420px]" title={row.title}>
                  <a
                    href={`https://polymarket.com/event/${row.slug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-indigo-600 hover:underline"
                  >
                    {row.title}
                  </a>
                </td>
                <td className="px-3 py-2 text-muted-foreground text-xs truncate">
                  {row.category || "—"}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {fmtUsd(row.total_volume)}
                </td>
                <td className="px-3 py-2 text-muted-foreground text-xs">
                  {fmtDate(row.end_date)}
                </td>
                <td className="px-3 py-2 text-xs">
                  {row.closed ? (
                    <span className="text-muted-foreground">closed</span>
                  ) : row.active ? (
                    <span className="text-emerald-700">open</span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
              </tr>
            ))}
            {!loading && rows?.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                No {status === "open" ? "open " : status === "closed" ? "closed " : ""}events match.
              </td></tr>
            )}
            {loading && !rows && (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                Loading…
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── MarketsTab ──────────────────────────────────────────────────────────────

function MarketsTab() {
  const [q, setQ] = useState("");
  const [venue, setVenue] = useState<"" | "polymarket" | "kalshi">("");
  // Server-side filter (since kv.run added `?status=` on 2026-05-22):
  // default `open` so users land on currently-trading markets. `q=*`
  // doesn't match the open index, so the empty-query default uses
  // `will` — a common token in prediction-market titles that surfaces
  // a wide variety of open markets.
  const [status, setStatus] = useState<"open" | "closed" | "all">("open");
  const [rows, setRows] = useState<PmMarketRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<PmMarketRow | null>(null);

  // Accepts optional overrides so callers (chips, useEffect, dropdowns)
  // can pass the value they just set without waiting for the next render.
  // Without this, chip-click → setQ(x) → search() races: search would
  // close over the STALE q because React batches state updates.
  const searchWith = useCallback(async (
    qOverride?: string,
    venueOverride?: "" | "polymarket" | "kalshi",
    statusOverride?: "open" | "closed" | "all",
  ) => {
    const effectiveStatus = statusOverride ?? status;
    const fallbackQ = effectiveStatus === "open" ? "will" : "*";
    const effectiveQ = (qOverride ?? q).trim() || fallbackQ;
    const effectiveVenue = venueOverride ?? venue;
    setLoading(true);
    setError(null);
    try {
      const r = await findata.pmSearch(effectiveQ, {
        venue: effectiveVenue || undefined,
        status: effectiveStatus,
        limit: 100,
      });
      setRows(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [q, venue, status]);

  // Auto-load whenever venue or status changes (explicit override keeps
  // us closure-safe).
  useEffect(() => { searchWith(undefined, venue, status); }, [venue, status]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-3">
      {/* Topic chips — one-click curated queries. Categories aren't a
          real field on upstream rows, so each chip just re-queries. */}
      <div className="flex items-center gap-1 flex-wrap text-xs">
        <span className="text-muted-foreground mr-1">Topic:</span>
        {TOPIC_CHIPS.map((chip) => {
          const active = q.trim().toLowerCase() === chip.q.toLowerCase();
          return (
            <button
              key={chip.label}
              onClick={() => { setQ(chip.q); searchWith(chip.q); }}
              className={cn(
                "px-2 py-0.5 rounded border transition-colors",
                active
                  ? "border-indigo-500 bg-indigo-50 text-indigo-700 font-medium"
                  : "border-border bg-background hover:bg-accent",
              )}
            >
              {chip.label}
            </button>
          );
        })}
        {q && (
          <button
            onClick={() => { setQ(""); searchWith(""); }}
            className="ml-1 px-2 py-0.5 rounded border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100"
            title="Clear topic"
          >
            Clear
          </button>
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            className="w-full pl-7 pr-2 py-1.5 text-sm rounded border bg-background"
            placeholder="Search markets…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") searchWith(); }}
          />
        </div>
        <select
          value={venue}
          onChange={(e) => setVenue(e.target.value as "" | "polymarket" | "kalshi")}
          className="px-2 py-1.5 text-sm rounded border bg-background"
        >
          <option value="">All venues</option>
          <option value="polymarket">Polymarket</option>
          <option value="kalshi">Kalshi</option>
        </select>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as "open" | "closed" | "all")}
          className="px-2 py-1.5 text-sm rounded border bg-background"
          title="Server-side ?status= filter (added by kv.run 2026-05-22)."
        >
          <option value="open">Open</option>
          <option value="closed">Closed</option>
          <option value="all">All states</option>
        </select>
        <button
          onClick={() => searchWith()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-sm rounded border bg-background hover:bg-accent disabled:opacity-50"
        >
          <Search className="w-3.5 h-3.5" />
          Search
        </button>
      </div>

      {error && <div className="text-sm text-rose-600">Error: {error}</div>}

      {status !== "open" && <StalenessBanner rows={rows} />}

      <div className="border rounded overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left">
            <tr>
              <th className="px-3 py-2 font-medium w-20">Venue</th>
              <th className="px-3 py-2 font-medium">Title</th>
              <th className="px-3 py-2 font-medium w-24 text-right">Volume</th>
              <th className="px-3 py-2 font-medium w-28">Resolves</th>
              <th className="px-3 py-2 font-medium w-16">State</th>
              <th className="px-3 py-2 font-medium w-10"></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows?.map((m) => (
              <tr
                key={`${m.venue}:${m.market_id}`}
                onClick={() => setSelected(m)}
                className="hover:bg-indigo-50/60 cursor-pointer"
                title="Click to inspect price + orderbook"
              >
                <td className="px-3 py-2">
                  <span className={cn("inline-flex px-1.5 py-0.5 rounded text-[10px] uppercase font-medium border", venueChip(m.venue))}>
                    {m.venue}
                  </span>
                </td>
                <td className="px-3 py-2 truncate max-w-[420px]" title={m.title}>
                  {m.title}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtUsd(m.volume)}</td>
                <td className="px-3 py-2 text-muted-foreground text-xs">{fmtDate(m.end_date)}</td>
                <td className="px-3 py-2 text-xs">
                  {m.closed ? (
                    <span className="text-muted-foreground">closed</span>
                  ) : (
                    <span className="text-emerald-700">open</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  <a
                    href={marketExternalUrl(m)}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex items-center text-muted-foreground hover:text-indigo-600"
                    title={`Open on ${m.venue}`}
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </td>
              </tr>
            ))}
            {rows && rows.length === 0 && !loading && (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                No matches{status === "open" ? " among open markets" : ""}. Try a different query or change the state filter.
              </td></tr>
            )}
            {loading && (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                Searching…
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {selected && (
        <MarketDetailPanel market={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}

// ── MarketDetailPanel — slide-over with detail + sparkline + orderbook ─────

// Candle interval (minutes). Upstream supports 1, 5, 15, 60, 1440 as of
// kv.run 2026-05-22. Default depends on market state — daily for
// long-running open markets gives a more useful zoom-out, hourly for
// recently-active markets.
type CandleInterval = 1 | 5 | 15 | 60 | 1440;
const INTERVAL_LABELS: Record<CandleInterval, string> = {
  1: "1m",
  5: "5m",
  15: "15m",
  60: "1h",
  1440: "1d",
};

function MarketDetailPanel({ market, onClose }: { market: PmMarketRow; onClose: () => void }) {
  const [detail, setDetail] = useState<PmPolymarketDetail | PmKalshiDetail | null>(null);
  const [candles, setCandles] = useState<PmCandleRow[] | null>(null);
  const [interval, setIntervalMin] = useState<CandleInterval>(60);
  // Full orderbook history for the chosen outcome — used for both the
  // latest-snapshot view AND the mid-price fallback curve.
  const [obHistory, setObHistory] = useState<PmOrderbookSnap[] | null>(null);
  // Recent trades — secondary price source. After the kv.run 2026-05-22
  // candle backfill (multi-interval, multi-year history), candles are
  // back to primary, but trades remain useful for very-recent open
  // markets and the outcome-chip discovery path (token_id mining).
  const [trades, setTrades] = useState<PmTradeRow[] | null>(null);
  const [outcome, setOutcome] = useState(0); // YES (0) vs NO (1) for Polymarket
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Reset outcome to YES whenever a new market is opened — otherwise the
  // index carries across markets and can target a non-existent outcome.
  useEffect(() => { setOutcome(0); }, [market.market_id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      setDetail(null);
      setCandles(null);
      setObHistory(null);
      setTrades(null);
      try {
        // Fan out detail + trades in parallel — trades is the primary
        // price-curve source for open markets, and we don't need detail
        // to fetch them (they're keyed by condition_id / ticker).
        const detailP =
          market.venue === "polymarket"
            ? findata.pmPolymarketDetail(market.market_id)
            : findata.pmKalshiDetail(market.market_id);
        const tradesP =
          market.venue === "polymarket"
            ? findata.pmTradesPolymarket(market.market_id, 200)
            : findata.pmTradesKalshi(market.market_id, 200);
        // /candles expects minutes (1|5|15|60|1440) as of kv.run 2026-05-22.
        const candlesP = findata.pmCandles(market.venue, market.market_id, {
          interval, limit: 200,
        });

        const [dRes, tRes, cRes] = await Promise.allSettled([detailP, tradesP, candlesP]);
        if (cancelled) return;

        const d = dRes.status === "fulfilled" ? dRes.value : null;
        const tr = tRes.status === "fulfilled" ? tRes.value : [];
        if (d) setDetail(d);
        setTrades(tr);
        setCandles(cRes.status === "fulfilled" ? cRes.value : []);

        // Discover CLOB asset_id(s) for orderbook lookup. Detail's
        // clob_token_ids field is currently null on freshly-ingested
        // open polymarket markets; trades carry the token_id directly.
        let assetIds: string[] = [];
        if (market.venue === "polymarket") {
          const fromDetail = (d as PmPolymarketDetail | null)?.clob_token_ids ?? [];
          if (fromDetail.length > 0) {
            assetIds = fromDetail;
          } else if (tr.length > 0) {
            // Unique token_ids from trades, ordered by frequency (most-
            // traded first). Most-traded side is usually YES.
            const counts = new Map<string, number>();
            for (const x of tr) {
              if (x.token_id) counts.set(x.token_id, (counts.get(x.token_id) ?? 0) + 1);
            }
            assetIds = Array.from(counts.entries())
              .sort((a, b) => b[1] - a[1])
              .map(([id]) => id);
          }
        }

        // Polymarket orderbook (per asset_id). Try the selected outcome
        // first; auto-switch to the other side if it's empty.
        let obH: PmOrderbookSnap[] = [];
        if (market.venue === "polymarket") {
          if (assetIds.length > 0) {
            const wanted = assetIds[outcome] ?? assetIds[0];
            obH = await findata.pmOrderbookPolymarket(wanted, 200).catch(() => []);
            if (obH.length === 0 && outcome === 0 && assetIds.length > 1) {
              const alt = await findata.pmOrderbookPolymarket(assetIds[1], 200).catch(() => []);
              if (alt.length > 0 && !cancelled) {
                obH = alt;
                setOutcome(1);
              }
            }
          }
        } else {
          obH = await findata.pmOrderbookKalshi(market.market_id, 200).catch(() => []);
        }
        if (!cancelled) setObHistory(obH);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [market, outcome, interval]);

  // Latest orderbook = first snapshot (server returns newest-first).
  const orderbook = obHistory && obHistory.length > 0 ? obHistory[0] : null;

  // Price curve, in source-priority order:
  //   1. Candles — primary as of kv.run 2026-05-22 multi-interval
  //      backfill. OHLC bars at 1m/5m/15m/1h/1d span 4.5y for Kalshi
  //      and 4y for Polymarket. Normalized to implied-YES probability
  //      since the endpoint mixes YES + NO sides in one response.
  //   2. Trades — recent fills, useful when the chosen interval has no
  //      candles yet (very fresh markets) or for the outcome-chip
  //      discovery path. Filter to one token_id so we don't interleave
  //      both outcomes.
  //   3. Orderbook mid — fallback for very-old closed markets where
  //      neither candles nor trades were backfilled.
  //
  // YES normalization: the candle endpoint returns whichever side last
  // traded per bucket — `close` can be ~0.98 (YES) or ~0.02 (NO) for
  // the same market depending on which side had activity. Normalize via
  // `close > 0.5 ? close : 1 - close` so the curve is a coherent
  // implied-YES probability time series.
  const derivedCurve = useMemo(() => {
    // Candles (primary).
    if (candles && candles.length > 0) {
      const pts = candles
        .slice()
        .reverse() // server returns newest-first
        .map((c) => ({
          ts: c.bucket_ts,
          price: c.close > 0.5 ? c.close : 1 - c.close,
        }))
        .filter((p) => isFinite(p.price));
      if (pts.length > 0) return pts;
    }
    // Trades — token-filtered.
    if (trades && trades.length > 0) {
      const counts = new Map<string, number>();
      for (const t of trades) {
        if (t.token_id) counts.set(t.token_id, (counts.get(t.token_id) ?? 0) + 1);
      }
      const sortedTokens = Array.from(counts.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([id]) => id);
      const fromDetail = market.venue === "polymarket"
        ? ((detail as PmPolymarketDetail | null)?.clob_token_ids ?? [])
        : [];
      const tokens = fromDetail.length > 0 ? fromDetail : sortedTokens;
      const wantedToken = tokens[outcome] ?? tokens[0];

      const filtered = wantedToken
        ? trades.filter((t) => t.token_id === wantedToken)
        : trades;
      const pts = filtered
        .slice()
        .reverse()
        .map((t) => ({ ts: t.ts, price: t.price > 0.5 ? t.price : 1 - t.price }))
        .filter((p) => isFinite(p.price));
      if (pts.length > 0) return pts;
    }
    // Orderbook-mid (final fallback).
    if (obHistory && obHistory.length > 0) {
      const pts = obHistory
        .slice()
        .reverse()
        .map((s) => {
          const bb = bestBid(s.bids);
          const ba = bestAsk(s.asks);
          let price: number | null = null;
          if (bb !== null && ba !== null) price = (bb + ba) / 2;
          else if (bb !== null)          price = bb;
          else if (ba !== null)          price = ba;
          return { ts: s.snapshot_ts, price };
        })
        .filter((p): p is { ts: string; price: number } => p.price !== null);
      if (pts.length > 0) return pts;
    }
    return null;
  }, [candles, trades, obHistory, detail, market.venue, outcome]);

  // Source label for the price-curve legend + whether candles are
  // trade-derived (volume>0) or OB-midprice-derived (volume=0).
  const curveSource: "candles" | "trades" | "orderbook" | null = useMemo(() => {
    if (candles && candles.length > 0) return "candles";
    if (trades && trades.length > 0) return "trades";
    if (obHistory && obHistory.length > 0) return "orderbook";
    return null;
  }, [candles, trades, obHistory]);
  const candlesAreTradeDerived = useMemo(() => {
    if (!candles || candles.length === 0) return false;
    return candles.some((c) => c.volume > 0 || (c.trades ?? 0) > 0);
  }, [candles]);

  // ESC to close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const pmDetail = market.venue === "polymarket" ? (detail as PmPolymarketDetail | null) : null;

  return (
    <div className="fixed inset-0 z-50 flex">
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/40"
        onClick={onClose}
        aria-label="Close detail"
      />
      <div className="relative ml-auto w-full max-w-2xl h-full bg-background shadow-xl border-l overflow-y-auto">
        <header className="sticky top-0 bg-background z-10 border-b px-4 py-3 flex items-start gap-3">
          <span className={cn("mt-0.5 inline-flex px-1.5 py-0.5 rounded text-[10px] uppercase font-medium border shrink-0", venueChip(market.venue))}>
            {market.venue}
          </span>
          <h2 className="flex-1 text-sm font-medium leading-snug">{market.title}</h2>
          <a
            href={marketExternalUrl({
              venue: market.venue,
              market_id: market.market_id,
              slug: pmDetail?.slug ?? market.slug,
              title: market.title,
            })}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-indigo-600"
            title={`Open on ${market.venue}`}
          >
            <ExternalLink className="w-4 h-4" />
          </a>
          <button onClick={onClose} className="p-1 -mr-1 rounded hover:bg-accent" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="p-4 space-y-4">
          {loading && <div className="text-sm text-muted-foreground">Loading market…</div>}
          {error && <div className="text-sm text-rose-600">Error: {error}</div>}

          {/* Stat row */}
          <div className="grid grid-cols-3 gap-2 text-xs">
            <Stat label="Volume"  value={fmtUsd(market.volume)} />
            <Stat label="Resolves" value={fmtDate(market.end_date)} />
            <Stat label="State"   value={market.closed ? "closed" : "open"} />
          </div>

          {/* Polymarket outcome chips (YES / NO with last prices) */}
          {pmDetail && pmDetail.outcomes?.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Outcomes</div>
              <div className="flex gap-1.5 flex-wrap">
                {pmDetail.outcomes.map((o, i) => {
                  const p = parseFloat(pmDetail.outcome_prices?.[i] ?? "");
                  const active = i === outcome;
                  return (
                    <button
                      key={o + i}
                      onClick={() => setOutcome(i)}
                      className={cn(
                        "px-2 py-1 rounded text-xs border transition-colors",
                        active
                          ? "border-indigo-500 bg-indigo-50 text-indigo-700 font-medium"
                          : "border-border bg-background hover:bg-accent"
                      )}
                    >
                      {o}
                      <span className={cn("ml-1.5 tabular-nums", isFinite(p) ? "" : "text-muted-foreground")}>
                        {isFinite(p) ? p.toFixed(3) : "—"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Price curve — candles primary (multi-interval), trades
              secondary, orderbook-mid as final fallback. */}
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1 flex items-center justify-between gap-2">
              <span>
                Price <span className="normal-case font-normal">(implied YES)</span>
                {curveSource === "candles" && derivedCurve && (
                  <span className="normal-case ml-1.5 text-muted-foreground font-normal">
                    · {INTERVAL_LABELS[interval]} candles, {derivedCurve.length} bars{" "}
                    {candlesAreTradeDerived ? "(trade-derived)" : "(OB-midprice)"}
                  </span>
                )}
                {curveSource === "trades" && derivedCurve && (
                  <span className="normal-case ml-1.5 text-muted-foreground font-normal">
                    · {derivedCurve.length} trades
                  </span>
                )}
                {curveSource === "orderbook" && derivedCurve && (
                  <span className="normal-case ml-1.5 text-muted-foreground font-normal">
                    · orderbook mid ({derivedCurve.length} snapshots)
                  </span>
                )}
              </span>
              <div className="flex gap-0.5">
                {(Object.keys(INTERVAL_LABELS) as unknown as string[]).map((k) => {
                  const v = parseInt(k, 10) as CandleInterval;
                  const active = interval === v;
                  return (
                    <button
                      key={v}
                      onClick={() => setIntervalMin(v)}
                      className={cn(
                        "px-1.5 py-0.5 rounded text-[10px] border tabular-nums normal-case",
                        active
                          ? "border-indigo-500 bg-indigo-50 text-indigo-700 font-medium"
                          : "border-border bg-background hover:bg-accent text-muted-foreground",
                      )}
                    >
                      {INTERVAL_LABELS[v]}
                    </button>
                  );
                })}
              </div>
            </div>
            <PriceSparkline
              candles={candles}
              derived={derivedCurve}
              loading={loading && !candles && !trades && !obHistory}
            />
          </div>

          {/* Orderbook */}
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1 flex items-center justify-between">
              <span>
                Orderbook
                {orderbook?.snapshot_ts && (
                  <span className="ml-1.5 normal-case text-[10px] text-muted-foreground font-normal">
                    · snapshot {new Date(orderbook.snapshot_ts).toISOString().slice(0, 16)}Z
                  </span>
                )}
              </span>
            </div>
            <OrderbookView ob={orderbook} loading={loading && !orderbook} />
          </div>

          {/* Raw detail (collapsible) */}
          {detail && (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Raw detail JSON</summary>
              <pre className="mt-2 max-h-60 overflow-auto p-2 bg-muted/40 rounded text-[10px] leading-tight">
                {JSON.stringify(detail, null, 2)}
              </pre>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}

// Surfaces a one-line "your data is N months old" banner when the most
// recent end_date in the current result set is more than 14 days behind
// the wall clock. The upstream kv.run:5000 dataset is currently a
// historical snapshot — every market has closed:true — so users will
// see markets that are live on polymarket.com flagged closed here.
// Making the staleness explicit avoids confusion.
function StalenessBanner({ rows }: { rows: PmMarketRow[] | null }) {
  if (!rows || rows.length === 0) return null;
  let maxTs = 0;
  for (const r of rows) {
    if (!r.end_date) continue;
    const t = new Date(r.end_date).getTime();
    if (isFinite(t) && t > maxTs) maxTs = t;
  }
  if (!maxTs) return null;
  const ageDays = Math.floor((Date.now() - maxTs) / 86_400_000);
  if (ageDays < 14) return null;
  const allClosed = rows.every((r) => r.closed === true);
  return (
    <div className="text-xs rounded border border-amber-300 bg-amber-50 text-amber-900 px-3 py-2 flex items-start gap-2">
      <span className="font-medium">⚠ Stale dataset</span>
      <span className="flex-1">
        Latest market end-date in this result is{" "}
        <span className="tabular-nums font-mono">{new Date(maxTs).toISOString().slice(0, 10)}</span>{" "}
        ({ageDays} days ago).
        {allClosed && " All markets in this set are flagged closed — Polymarket may still be running newer markets that haven't been ingested yet."}{" "}
        Upstream is <span className="font-mono">kv.run:5000/prediction-markets/*</span>.
      </span>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border bg-muted/30 px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm tabular-nums">{value}</div>
    </div>
  );
}

function PriceSparkline({
  candles,
  derived,
  loading,
}: {
  candles: PmCandleRow[] | null;
  derived: { ts: string; price: number }[] | null;
  loading: boolean;
}) {
  // Prefer candles when populated; else use derived mid-price curve.
  let series: { x: number; y: number; ts?: string }[] | null = null;
  let countLabel = "";
  if (candles && candles.length > 0) {
    series = candles
      .map((c, i) => ({ x: i, y: c.close }))
      .filter((p) => isFinite(p.y));
    countLabel = `${candles.length} bars`;
  } else if (derived && derived.length > 0) {
    series = derived.map((p, i) => ({ x: i, y: p.price, ts: p.ts }));
    countLabel = `${derived.length} snapshots`;
  }

  if (!series || series.length === 0) {
    if (loading) return <div className="h-24 grid place-items-center text-xs text-muted-foreground border rounded">Loading…</div>;
    return (
      <div className="h-24 grid place-items-center text-xs text-muted-foreground border rounded bg-muted/20">
        No price history available (no candles, no orderbook snapshots).
      </div>
    );
  }
  const ys = series.map((p) => p.y);
  const min = Math.min(...ys);
  const max = Math.max(...ys);
  // When all points are identical (flat line — e.g. resolved markets
  // pinned at 0 or 1), keep `span` > 0 AND offset the line into the
  // middle of the box instead of jamming it against the top/bottom
  // edge where a 0/1px stroke can clip against the border.
  const flat = max - min < 1e-9;
  const span = flat ? 1 : max - min;
  const W = 600, H = 96, PAD = 6;
  const n = series.length;
  const last = ys[ys.length - 1];
  const first = ys[0];
  const up = last >= first;
  const stroke = up ? "rgb(4 120 87)" : "rgb(190 18 60)";

  // For a single point: render as a horizontal segment so the user
  // sees it. For 2+ points: standard polyline.
  let svgContent: React.ReactNode;
  if (n === 1) {
    const y = PAD + (H - 2 * PAD) / 2;
    svgContent = (
      <>
        <line x1={PAD} y1={y} x2={W - PAD} y2={y} stroke={stroke} strokeWidth="1.5" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
        <circle cx={W / 2} cy={y} r={3} fill={stroke} />
      </>
    );
  } else {
    const pts = series.map((p, i) => {
      const x = PAD + (i / Math.max(n - 1, 1)) * (W - 2 * PAD);
      // For a flat series, center the line vertically (yy = H/2).
      const yy = flat
        ? H / 2
        : PAD + (1 - (p.y - min) / span) * (H - 2 * PAD);
      return `${x.toFixed(1)},${yy.toFixed(1)}`;
    }).join(" ");
    svgContent = (
      <polyline
        points={pts}
        fill="none"
        stroke={stroke}
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
    );
  }

  return (
    <div className="border rounded p-2 bg-muted/10">
      <div className="flex items-baseline justify-between mb-1 text-xs">
        <span className="text-muted-foreground">{countLabel}{flat && n > 1 ? " · flat" : ""}</span>
        <span className={cn("tabular-nums font-mono", up ? "text-emerald-700" : "text-rose-700")}>
          {first.toFixed(3)} → {last.toFixed(3)}
          {!flat && ` (${((last - first) * 100).toFixed(1)}¢)`}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-24" preserveAspectRatio="none">
        {svgContent}
      </svg>
    </div>
  );
}

function OrderbookView({ ob, loading }: { ob: PmOrderbookSnap | null; loading: boolean }) {
  if (loading) return <div className="h-32 grid place-items-center text-xs text-muted-foreground border rounded">Loading…</div>;
  if (!ob) return <div className="h-20 grid place-items-center text-xs text-muted-foreground border rounded bg-muted/20">No orderbook snapshot available.</div>;
  const bids = (ob.bids ?? []).slice(0, 10);
  const asks = (ob.asks ?? []).slice(0, 10);
  const maxSize = Math.max(
    ...bids.map((l) => parseFloat(l.size) || 0),
    ...asks.map((l) => parseFloat(l.size) || 0),
    1,
  );
  return (
    <div className="grid grid-cols-2 gap-2 text-xs font-mono">
      <div className="border rounded overflow-hidden">
        <div className="px-2 py-1 bg-emerald-50 text-emerald-800 font-medium text-[10px] uppercase">
          Bids ({bids.length})
        </div>
        {bids.length === 0 && <div className="px-2 py-3 text-muted-foreground text-center text-[11px]">empty</div>}
        {bids.map((l, i) => {
          const sz = parseFloat(l.size) || 0;
          return (
            <div key={i} className="relative px-2 py-0.5 flex justify-between border-t first:border-t-0">
              <div
                className="absolute inset-y-0 right-0 bg-emerald-100/50"
                style={{ width: `${(sz / maxSize) * 100}%` }}
              />
              <span className="relative text-emerald-700 tabular-nums">{l.price}</span>
              <span className="relative tabular-nums">{Number(sz).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
            </div>
          );
        })}
      </div>
      <div className="border rounded overflow-hidden">
        <div className="px-2 py-1 bg-rose-50 text-rose-800 font-medium text-[10px] uppercase">
          Asks ({asks.length})
        </div>
        {asks.length === 0 && <div className="px-2 py-3 text-muted-foreground text-center text-[11px]">empty</div>}
        {asks.map((l, i) => {
          const sz = parseFloat(l.size) || 0;
          return (
            <div key={i} className="relative px-2 py-0.5 flex justify-between border-t first:border-t-0">
              <div
                className="absolute inset-y-0 left-0 bg-rose-100/50"
                style={{ width: `${(sz / maxSize) * 100}%` }}
              />
              <span className="relative text-rose-700 tabular-nums">{l.price}</span>
              <span className="relative tabular-nums">{Number(sz).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── LiveTab — SSE tape ──────────────────────────────────────────────────────

interface Tick {
  id: number;
  ts: string;
  channel: string;
  event_type: string;
  market: string;
  asset_id?: string;
  price?: string;
  side?: string;
  size?: string;
}

const MAX_TICKS = 500;
const RATE_WINDOW_MS = 5000; // rolling window for ticks/sec readout

type EventTypeFilter = "all" | "price_change" | "book";

function LiveTab() {
  const [streaming, setStreaming] = useState(false);
  const [paused, setPaused] = useState(false);
  const [ticks, setTicks] = useState<Tick[]>([]);
  const [draftFilter, setDraftFilter] = useState("");
  const [eventTypeFilter, setEventTypeFilter] = useState<EventTypeFilter>("price_change");
  const [minSize, setMinSize] = useState(0);
  const [status, setStatus] = useState<"idle" | "connecting" | "open" | "error">("idle");
  const [rate, setRate] = useState(0); // events/sec from the stream
  const [droppedSinceStart, setDroppedSinceStart] = useState(0);

  const esRef = useRef<EventSource | null>(null);
  const seqRef = useRef(0);
  const pausedRef = useRef(false);
  const filterRef = useRef({ eventType: eventTypeFilter, minSize });
  const rateBufRef = useRef<number[]>([]);
  const droppedRef = useRef(0);

  // Mirror filter state into refs so the SSE callback sees fresh values
  // without resubscribing.
  useEffect(() => { pausedRef.current = paused; }, [paused]);
  useEffect(() => { filterRef.current = { eventType: eventTypeFilter, minSize }; }, [eventTypeFilter, minSize]);

  // Rolling ticks/sec readout (always shows the upstream rate, even
  // when paused so user can see what they're holding back).
  useEffect(() => {
    if (!streaming) { setRate(0); return; }
    const tid = setInterval(() => {
      const now = Date.now();
      rateBufRef.current = rateBufRef.current.filter((t) => now - t < RATE_WINDOW_MS);
      setRate(Math.round((rateBufRef.current.length / RATE_WINDOW_MS) * 1000));
    }, 500);
    return () => clearInterval(tid);
  }, [streaming]);

  const stop = useCallback(() => {
    if (esRef.current) { esRef.current.close(); esRef.current = null; }
    setStreaming(false);
    setStatus("idle");
    setPaused(false);
    rateBufRef.current = [];
    setRate(0);
  }, []);

  const start = useCallback(() => {
    if (esRef.current) { esRef.current.close(); esRef.current = null; }
    droppedRef.current = 0;
    setDroppedSinceStart(0);

    const url = findata.pmStreamUrl({
      conditionIds: draftFilter
        ? draftFilter.split(",").map((s) => s.trim()).filter(Boolean)
        : undefined,
    });
    setStatus("connecting");
    const es = new EventSource(url);
    esRef.current = es;
    setStreaming(true);

    es.addEventListener("open", () => setStatus("open"));
    es.addEventListener("error", () => setStatus("error"));
    es.addEventListener("tick", (e) => {
      rateBufRef.current.push(Date.now());

      if (pausedRef.current) {
        droppedRef.current++;
        setDroppedSinceStart(droppedRef.current);
        return;
      }
      try {
        const payload = JSON.parse((e as MessageEvent).data);
        const { eventType: fType, minSize: fMin } = filterRef.current;
        if (fType !== "all" && payload.event_type !== fType) {
          droppedRef.current++;
          setDroppedSinceStart(droppedRef.current);
          return;
        }
        const sz = parseFloat(payload.size ?? "0") || 0;
        if (fMin > 0 && sz < fMin) {
          droppedRef.current++;
          setDroppedSinceStart(droppedRef.current);
          return;
        }
        const t: Tick = {
          id: seqRef.current++,
          ts: payload.timestamp ?? Date.now().toString(),
          channel: payload.channel ?? "?",
          event_type: payload.event_type ?? "?",
          market: payload.market ?? "",
          asset_id: payload.asset_id,
          price: payload.price,
          side: payload.side,
          size: payload.size,
        };
        setTicks((prev) => {
          const next = [t, ...prev];
          return next.length > MAX_TICKS ? next.slice(0, MAX_TICKS) : next;
        });
      } catch {
        // Skip non-JSON ticks.
      }
    });
  }, [draftFilter]);

  useEffect(() => () => stop(), [stop]);

  return (
    <div className="space-y-3">
      {/* Control bar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 px-2 py-1 rounded border text-xs">
          <span
            className={cn("w-1.5 h-1.5 rounded-full", {
              "bg-emerald-500 animate-pulse": status === "open" && !paused,
              "bg-amber-500": status === "connecting" || (status === "open" && paused),
              "bg-rose-500": status === "error",
              "bg-muted-foreground/40": status === "idle",
            })}
          />
          <span className="font-medium uppercase">{paused ? "paused" : status}</span>
          {streaming && (
            <span className="text-muted-foreground tabular-nums">
              · {rate}/s upstream · {ticks.length} shown
              {droppedSinceStart > 0 ? ` · ${droppedSinceStart.toLocaleString()} filtered` : ""}
            </span>
          )}
        </div>

        {streaming ? (
          <>
            <button
              onClick={() => setPaused((p) => !p)}
              className={cn(
                "inline-flex items-center gap-1.5 px-2.5 py-1.5 text-sm rounded border",
                paused ? "bg-emerald-600 text-white hover:bg-emerald-700" : "bg-background hover:bg-accent",
              )}
            >
              {paused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
              {paused ? "Resume" : "Pause"}
            </button>
            <button
              onClick={stop}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-sm rounded border border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100"
            >
              <Square className="w-3.5 h-3.5" />
              Stop
            </button>
          </>
        ) : (
          <button
            onClick={start}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-sm rounded border bg-indigo-600 text-white hover:bg-indigo-700"
          >
            <Radio className="w-3.5 h-3.5" />
            Start
          </button>
        )}

        <button
          onClick={() => setTicks([])}
          disabled={!ticks.length}
          className="px-2.5 py-1.5 text-sm rounded border bg-background hover:bg-accent disabled:opacity-50"
        >
          Clear
        </button>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-2 flex-wrap text-xs">
        <label className="flex items-center gap-1.5">
          <span className="text-muted-foreground">Event:</span>
          <select
            value={eventTypeFilter}
            onChange={(e) => setEventTypeFilter(e.target.value as EventTypeFilter)}
            className="px-2 py-1 rounded border bg-background"
          >
            <option value="price_change">price_change only</option>
            <option value="book">book only (snapshots)</option>
            <option value="all">all</option>
          </select>
        </label>

        <label className="flex items-center gap-1.5">
          <span className="text-muted-foreground">Min size:</span>
          <input
            type="number"
            min={0}
            step={100}
            value={minSize || ""}
            placeholder="0"
            onChange={(e) => setMinSize(parseFloat(e.target.value) || 0)}
            className="w-24 px-2 py-1 rounded border bg-background tabular-nums"
          />
        </label>

        <label className="flex-1 max-w-md flex items-center gap-1.5">
          <span className="text-muted-foreground shrink-0">Condition:</span>
          <input
            className="flex-1 px-2 py-1 rounded border bg-background font-mono"
            placeholder="0xabc…,0xdef… (applied on Start, comma-separated)"
            value={draftFilter}
            onChange={(e) => setDraftFilter(e.target.value)}
            disabled={streaming}
            title={streaming ? "Stop the stream to change subscription filter" : ""}
          />
        </label>
      </div>

      {/* Tape — bounded height; max 500 most-recent rows on screen. */}
      <div className="border rounded overflow-hidden">
        <div className="max-h-[420px] overflow-y-auto">
          <table className="w-full text-xs font-mono">
            <thead className="bg-muted/40 text-left sticky top-0 z-10">
              <tr>
                <th className="px-2 py-1.5 w-20">Time</th>
                <th className="px-2 py-1.5 w-20">Channel</th>
                <th className="px-2 py-1.5 w-24">Event</th>
                <th className="px-2 py-1.5">Market</th>
                <th className="px-2 py-1.5 w-16 text-right">Price</th>
                <th className="px-2 py-1.5 w-12">Side</th>
                <th className="px-2 py-1.5 w-24 text-right">Size</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {ticks.map((t) => (
                <tr key={t.id} className="hover:bg-muted/30">
                  <td className="px-2 py-1 text-muted-foreground">
                    {new Date(Number(t.ts)).toISOString().slice(11, 19)}
                  </td>
                  <td className="px-2 py-1">{t.channel}</td>
                  <td className="px-2 py-1 text-muted-foreground">{t.event_type}</td>
                  <td className="px-2 py-1 truncate max-w-[280px]" title={t.market}>
                    {t.market ? `${t.market.slice(0, 10)}…${t.market.slice(-6)}` : ""}
                  </td>
                  <td className={cn("px-2 py-1 text-right tabular-nums",
                    t.side === "BUY" ? "text-emerald-700" : t.side === "SELL" ? "text-rose-700" : "")}>
                    {t.price ?? ""}
                  </td>
                  <td className="px-2 py-1">{t.side ?? ""}</td>
                  <td className="px-2 py-1 text-right tabular-nums">
                    {t.size ? Number(t.size).toLocaleString(undefined, { maximumFractionDigits: 0 }) : ""}
                  </td>
                </tr>
              ))}
              {!ticks.length && (
                <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground font-sans">
                  {streaming
                    ? (paused ? "Paused — resume to fill the tape." : "Waiting for ticks matching the filter…")
                    : "Press Start to subscribe."}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── WalletsTab — leaderboard ────────────────────────────────────────────────

function WalletsTab() {
  const [windowKey, setWindowKey] = useState("");
  const [rows, setRows] = useState<PmLeaderboardRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchOnce = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await findata.pmLeaderboard({
        window: windowKey || undefined,
        limit: 100,
      });
      setRows(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [windowKey]);

  useEffect(() => { fetchOnce(); }, [fetchOnce]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <select
          value={windowKey}
          onChange={(e) => setWindowKey(e.target.value)}
          className="px-2 py-1.5 text-sm rounded border bg-background"
        >
          <option value="">All time</option>
          <option value="24h">24 hours</option>
          <option value="7d">7 days</option>
          <option value="30d">30 days</option>
        </select>
        <button
          onClick={fetchOnce}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-sm rounded border bg-background hover:bg-accent"
        >
          <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
          Refresh
        </button>
      </div>

      {error && <div className="text-sm text-rose-600">Error: {error}</div>}

      <div className="border rounded overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left">
            <tr>
              <th className="px-3 py-2 font-medium w-10">#</th>
              <th className="px-3 py-2 font-medium">Wallet</th>
              <th className="px-3 py-2 font-medium w-20">Style</th>
              <th className="px-3 py-2 font-medium w-24 text-right">PnL</th>
              <th className="px-3 py-2 font-medium w-24 text-right">Volume</th>
              <th className="px-3 py-2 font-medium w-16 text-right">ROI</th>
              <th className="px-3 py-2 font-medium w-16 text-right">Win%</th>
              <th className="px-3 py-2 font-medium w-16 text-right">Trades</th>
              <th className="px-3 py-2 font-medium w-24">Since</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows?.map((r) => (
              <tr key={r.wallet} className="hover:bg-muted/30">
                <td className="px-3 py-2 tabular-nums text-muted-foreground">{r.rank}</td>
                <td className="px-3 py-2 font-mono text-xs">
                  <a
                    href={`https://polymarket.com/profile/${r.wallet}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-indigo-600 hover:underline"
                  >
                    {shortAddr(r.wallet)}
                  </a>
                  {r.is_whale && (
                    <span className="ml-1.5 text-[9px] uppercase text-purple-600">whale</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <span className={cn("inline-flex px-1.5 py-0.5 rounded text-[10px] uppercase font-medium border", styleChip(r.primary_style))}>
                    {r.primary_style || "—"}
                  </span>
                </td>
                <td className={cn("px-3 py-2 text-right tabular-nums",
                  r.total_pnl >= 0 ? "text-emerald-700" : "text-rose-700")}>
                  {fmtUsd(r.total_pnl)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtUsd(r.volume)}</td>
                <td className={cn("px-3 py-2 text-right tabular-nums",
                  r.roi >= 0 ? "text-emerald-700" : "text-rose-700")}>
                  {fmtPct(r.roi)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtPct(r.win_rate, 0)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.trades.toLocaleString()}</td>
                <td className="px-3 py-2 text-muted-foreground text-xs">
                  {fmtDate(r.first_trade_at)}
                </td>
              </tr>
            ))}
            {!loading && rows?.length === 0 && (
              <tr><td colSpan={9} className="px-3 py-6 text-center text-muted-foreground">
                No data.
              </td></tr>
            )}
            {loading && !rows && (
              <tr><td colSpan={9} className="px-3 py-6 text-center text-muted-foreground">
                Loading…
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Shell ───────────────────────────────────────────────────────────────────

const TABS: { key: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  // Markets first — has the rich data (volume, dates, state). Events is a
  // sparse upstream index (title only) so it sits second.
  { key: "markets", label: "Markets",     icon: TrendingUp },
  { key: "events",  label: "Events",      icon: Calendar },
  { key: "live",    label: "Live tape",   icon: Radio },
  { key: "wallets", label: "Top wallets", icon: Trophy },
];

export default function DatasetsPredmarket() {
  const [tab, setTab] = useState<Tab>("markets");

  const body = useMemo(() => {
    switch (tab) {
      case "events":  return <EventsTab />;
      case "markets": return <MarketsTab />;
      case "live":    return <LiveTab />;
      case "wallets": return <WalletsTab />;
    }
  }, [tab]);

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <div className="p-2 rounded bg-purple-500/10 text-purple-700 border border-purple-500/30">
          <ChartCandlestick className="w-5 h-5" />
        </div>
        <div className="flex-1">
          <h1 className="text-lg font-semibold">Event prediction markets</h1>
          <p className="text-sm text-muted-foreground">
            Polymarket + Kalshi via <span className="font-mono">kv.run:5000</span>.
            Search markets, browse events, watch orderbook ticks live, and track
            top wallets.
          </p>
        </div>
      </div>

      <div className="border-b">
        <nav className="flex gap-1">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={cn(
                  "inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border-b-2 -mb-px transition-colors",
                  active
                    ? "border-indigo-600 text-indigo-700 font-medium"
                    : "border-transparent text-slate-600 hover:text-slate-900"
                )}
              >
                <Icon className="w-3.5 h-3.5" />
                {t.label}
              </button>
            );
          })}
        </nav>
      </div>

      {body}

      <p className="text-xs text-muted-foreground pt-2 border-t flex items-center gap-1.5">
        <Globe className="w-3 h-3" />
        Data from <span className="font-mono">kv.run:5000</span>, proxied
        same-origin via <span className="font-mono">/findata-cloud/</span>.
      </p>
    </div>
  );
}

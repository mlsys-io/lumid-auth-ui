import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Newspaper, ExternalLink, RefreshCw, TrendingUp, TrendingDown, MessageCircle, Plus, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAutoRefresh, fmtAgo, useNowTick } from "@/hooks/useAutoRefresh";
import {
  findata,
  fmtNumber,
  daysAgoISO,
  type NewsArticleWithCategory,
  type NewsCategoryStats,
  type SymbolSentiment,
  type SocialSentimentRow,
} from "@/api/findata";

type Tab = "feed" | "search" | "sentiment" | "social";

// ── Watchlist storage ───────────────────────────────────────────────────────

const WL_KEY = "news-explorer:watchlist";
const DEFAULT_WATCHLIST = ["NVDA", "AAPL", "TSLA", "MSFT", "META", "GOOGL", "AMZN", "SPY"];

function loadWatchlist(): string[] {
  try {
    const raw = localStorage.getItem(WL_KEY);
    if (!raw) return DEFAULT_WATCHLIST;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : DEFAULT_WATCHLIST;
  } catch {
    return DEFAULT_WATCHLIST;
  }
}
function saveWatchlist(s: string[]) {
  try { localStorage.setItem(WL_KEY, JSON.stringify(s)); } catch { /* noop */ }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  if (!isFinite(t)) return iso;
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 60)        return `${s}s ago`;
  if (s < 3600)      return `${Math.floor(s / 60)}m ago`;
  if (s < 86400)     return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toISOString().slice(0, 10);
}

const CATEGORY_COLOUR: Record<string, string> = {
  stock_market: "bg-blue-500/10    text-blue-700    dark:text-blue-400    border-blue-500/30",
  company:      "bg-purple-500/10  text-purple-700  dark:text-purple-400  border-purple-500/30",
  general:      "bg-muted          text-muted-foreground                   border-border",
  crypto:       "bg-orange-500/10  text-orange-700  dark:text-orange-400  border-orange-500/30",
  forex:        "bg-amber-500/10   text-amber-700   dark:text-amber-400   border-amber-500/30",
};
function catCls(c: string | null | undefined): string {
  if (!c) return CATEGORY_COLOUR.general;
  return CATEGORY_COLOUR[c.toLowerCase()] ?? "bg-muted text-muted-foreground border-border";
}

// kv.run's NewsArticleWithCategory is the unified shape across both
// /news/latest and /news/search (cross-roster) and /news/{symbol} (per-symbol).
// The per-symbol variant returns the symbol from the path; latest/search
// include the field in the row itself.
type FeedItem = NewsArticleWithCategory & { symbol: string | null };

// ── Watchlist editor ────────────────────────────────────────────────────────

function WatchlistEditor({
  watchlist, current, onPick, onAdd, onRemove,
}: {
  watchlist: string[];
  current: string;
  onPick: (s: string | "all") => void;
  onAdd: (s: string) => void;
  onRemove: (s: string) => void;
}) {
  const [draft, setDraft] = useState("");

  const chipCls = (active: boolean, isAll = false) =>
    cn(
      "inline-flex items-center text-xs rounded border whitespace-nowrap transition-colors",
      // "All" is wider (no × button), use straight px-2.5; tickers leave
      // room on the right for the inline × button.
      isAll ? "px-2.5 py-0.5 font-medium" : "pl-2 pr-0.5 py-0.5 font-mono",
      active ? "border-primary text-primary bg-primary/10" : "border-border text-muted-foreground hover:bg-accent",
    );

  return (
    <div className="flex flex-wrap items-center gap-1.5 px-4 py-2 border-b border-border bg-muted/30">
      <button className={chipCls(current === "all", true)} onClick={() => onPick("all")}>All</button>
      {watchlist.map((s) => (
        <span key={s} className={chipCls(current === s)}>
          <button onClick={() => onPick(s)} className="leading-none">{s}</button>
          <button
            onClick={(e) => { e.stopPropagation(); onRemove(s); }}
            title={`Remove ${s} from watchlist`}
            aria-label={`Remove ${s} from watchlist`}
            className="ml-1 px-1 leading-none opacity-40 hover:opacity-100 hover:text-red-500"
          >×</button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value.toUpperCase())}
        onKeyDown={(e) => {
          if (e.key === "Enter" && draft.trim()) {
            onAdd(draft.trim()); setDraft("");
          }
        }}
        placeholder="+ ticker"
        size={draft.length > 4 ? draft.length + 2 : 6}
        className="rounded border border-dashed border-border bg-transparent px-2 py-0.5 text-xs font-mono uppercase placeholder:text-muted-foreground/70 focus:border-primary focus:bg-background focus:outline-none"
      />
      {draft && (
        <button onClick={() => { onAdd(draft.trim()); setDraft(""); }}
          className="inline-flex items-center gap-0.5 text-xs px-1.5 py-0.5 rounded border border-primary text-primary bg-primary/10 hover:bg-primary/20">
          <Plus className="w-3 h-3" /> Add
        </button>
      )}
    </div>
  );
}

// ── Shared article-row renderer ─────────────────────────────────────────────

function ArticleRow({ n, idx }: { n: FeedItem; idx: number }) {
  const ts = n.published_at ?? null;
  const pub = n.publisher ?? "";
  return (
    <li key={n.url || `${n.symbol ?? ""}-${idx}`} className="px-4 py-2.5 hover:bg-muted/30 transition-colors">
      <a href={n.url} target="_blank" rel="noopener noreferrer" className="block group">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-0.5 flex-wrap text-[11px]">
              {n.symbol && <span className="font-mono font-semibold text-primary">${n.symbol}</span>}
              {pub && <span className="text-muted-foreground">{pub}</span>}
              {n.category && (
                <span className={cn("px-1.5 py-0.5 rounded border font-medium", catCls(n.category))}>
                  {n.category}
                </span>
              )}
              {ts && <span className="text-muted-foreground ml-auto" title={ts}>{timeAgo(ts)}</span>}
            </div>
            <div className="text-sm font-medium text-foreground leading-snug group-hover:underline">{n.headline}</div>
            {n.summary && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{n.summary}</p>}
          </div>
          <ExternalLink className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 shrink-0 mt-1" />
        </div>
      </a>
    </li>
  );
}

// ── Cross-roster feed (kv.run /news/latest) ─────────────────────────────────
//
// Was a fan-out across the user's watchlist (one /news/{symbol} call per
// ticker, then dedup + sort). kv.run added /news/latest 2026-05-20 which
// returns a single ordered cross-roster stream — drop the fan-out.
// The watchlist is now only used to scope down via the per-symbol path when
// the user picks a single ticker.

function MergedFeed({ watchlist, current }: { watchlist: string[]; current: string | "all" }) {
  void watchlist;
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [publisher, setPublisher] = useState<string>("");
  const [category, setCategory] = useState<string>("");

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const since = daysAgoISO(14);
      if (current === "all") {
        // kv.run cross-roster stream — already sorted newest-first server-side.
        const rows = await findata.newsLatest({ since, limit: 100 });
        setItems(rows.map((r) => ({ ...r, symbol: r.symbol ?? null })));
      } else {
        // Single-symbol drill-down via /news/{symbol}.
        const rows = await findata.news(current, 50, since);
        setItems(rows.map((r) => ({
          published_at: (r.published_at ?? r.ts ?? "") as string,
          publisher: (r.publisher ?? r.source ?? null) as string | null,
          headline: r.headline,
          summary: (r.summary ?? null) as string | null,
          url: r.url,
          category: (r.category ?? null) as string | null,
          symbol: current,
        })));
      }
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    } finally {
      setLoading(false);
    }
  }, [current]);

  // Auto-refresh when the tab regains focus after >60s hidden; track
  // load timestamp for the "loaded Nm ago" hint. Re-render every 30s so
  // that label stays live without the user clicking anything.
  const { loadedAt, refresh } = useAutoRefresh(load);
  useNowTick();
  const didMount = useRef(false);
  useEffect(() => {
    if (didMount.current) return;
    didMount.current = true;
    refresh();
  }, [refresh]);
  // When the symbol scope (`current`) changes, the loader closure changes
  // too — re-fire (also through refresh() so loadedAt updates).
  const prevCurrent = useRef(current);
  useEffect(() => {
    if (prevCurrent.current !== current) {
      prevCurrent.current = current;
      refresh();
    }
  }, [current, refresh]);

  const publishers = useMemo(() => {
    const s = new Set<string>();
    items.forEach((i) => { if (i.publisher) s.add(i.publisher); });
    return Array.from(s).sort();
  }, [items]);

  const categories = useMemo(() => {
    const s = new Set<string>();
    items.forEach((i) => { if (i.category) s.add(i.category); });
    return Array.from(s).sort();
  }, [items]);

  const visible = useMemo(() => items.filter((it) => {
    if (publisher && it.publisher !== publisher) return false;
    if (category && it.category !== category) return false;
    return true;
  }), [items, publisher, category]);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-border bg-muted/20 text-xs">
        <span className="text-muted-foreground">Filter:</span>
        <select value={publisher} onChange={(e) => setPublisher(e.target.value)}
          className="rounded border border-border bg-background px-2 py-0.5 text-xs">
          <option value="">All publishers</option>
          {publishers.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={category} onChange={(e) => setCategory(e.target.value)}
          className="rounded border border-border bg-background px-2 py-0.5 text-xs">
          <option value="">All categories</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <span className="text-muted-foreground ml-2">
          {visible.length}{visible.length !== items.length && ` / ${items.length}`} articles ·{" "}
          {current === "all" ? "cross-roster" : current} · last 14 days
        </span>
        <span className="text-muted-foreground/70 text-[10px]">loaded {fmtAgo(loadedAt)}</span>
        <button onClick={refresh} disabled={loading}
          className="ml-auto flex items-center gap-1 px-2 py-0.5 rounded border border-border hover:bg-accent disabled:opacity-50">
          <RefreshCw className={cn("w-3 h-3", loading && "animate-spin")} /> Refresh
        </button>
      </div>
      {err && <div className="px-4 py-2 text-xs text-red-600">{err}</div>}
      {loading && items.length === 0 && (
        <div className="px-4 py-6 text-center text-sm text-muted-foreground animate-pulse">Loading articles…</div>
      )}
      {!loading && !err && visible.length === 0 && (
        <div className="px-4 py-8 text-center text-sm text-muted-foreground">
          <div>No articles for the current filters.</div>
          <div className="text-xs mt-1 opacity-70">
            {current === "all"
              ? "Try a different category or clear the publisher filter."
              : <>Try <b>All</b> in the watchlist row above, or pick a different ticker.</>}
          </div>
        </div>
      )}
      <ul className="divide-y divide-border">
        {visible.map((n, i) => <ArticleRow key={n.url || `${n.symbol ?? ""}-${i}`} n={n} idx={i} />)}
      </ul>
    </div>
  );
}

// ── Full-text search (kv.run /news/search) ──────────────────────────────────

function SearchFeed({ initialQuery = "" }: { initialQuery?: string }) {
  const [draft, setDraft] = useState(initialQuery);
  const [q, setQ] = useState(initialQuery);
  const [category, setCategory] = useState<string>("");
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!q.trim()) { setItems([]); return; }
    setLoading(true);
    setErr(null);
    try {
      const since = daysAgoISO(30);
      const rows = await findata.newsSearch(q.trim(), {
        since,
        limit: 100,
        category: category || undefined,
      });
      setItems(rows.map((r) => ({ ...r, symbol: r.symbol ?? null })));
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    } finally {
      setLoading(false);
    }
  }, [q, category]);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-border bg-muted/20 text-xs">
        <Search className="w-3.5 h-3.5 text-muted-foreground" />
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && setQ(draft.trim())}
          placeholder="rate cut, NVDA earnings, AI bubble…"
          className="flex-1 min-w-[200px] rounded border border-border bg-background px-2 py-1 text-sm"
        />
        <select value={category} onChange={(e) => setCategory(e.target.value)}
          className="rounded border border-border bg-background px-2 py-0.5 text-xs">
          <option value="">All categories</option>
          <option value="company">company</option>
          <option value="stock_market">stock_market</option>
          <option value="press_release">press_release</option>
          <option value="crypto">crypto</option>
          <option value="forex">forex</option>
          <option value="general">general</option>
        </select>
        <button onClick={() => setQ(draft.trim())}
          className="px-3 py-1 rounded border border-primary text-primary bg-primary/10 hover:bg-primary/20">
          Search
        </button>
        {q && (
          <span className="text-muted-foreground ml-2">
            {items.length} matches · last 30 days
          </span>
        )}
      </div>
      {err && <div className="px-4 py-2 text-xs text-red-600">{err}</div>}
      {!q && (
        <div className="px-4 py-8 text-center text-sm text-muted-foreground">
          Enter a query and press Enter. Full-text search across the kv.run news archive.
        </div>
      )}
      {q && loading && items.length === 0 && (
        <div className="px-4 py-6 text-center text-sm text-muted-foreground animate-pulse">Searching…</div>
      )}
      {q && !loading && !err && items.length === 0 && (
        <div className="px-4 py-8 text-center text-sm text-muted-foreground">
          <div>No headlines mention <span className="font-mono">"{q}"</span> in the last 30 days.</div>
          <div className="text-xs mt-1 opacity-70">Try a broader term, change category, or check the <b>Feed</b> tab for what's flowing now.</div>
        </div>
      )}
      <ul className="divide-y divide-border">
        {items.map((n, i) => <ArticleRow key={n.url || `${n.symbol ?? ""}-${i}`} n={n} idx={i} />)}
      </ul>
    </div>
  );
}

// ── Stats banner (kv.run /news/stats) ───────────────────────────────────────

function NewsStatsBanner() {
  const [stats, setStats] = useState<NewsCategoryStats | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Tick re-render every 30s so the "newest · Xm" pill keeps ticking up
  // without the user reloading. Auto-refetch the actual stats every 5 min
  // — cheap call, and matters when the page is left open for a long time.
  useNowTick();
  useEffect(() => {
    let cancelled = false;
    const fetchOnce = () => {
      findata.newsStats()
        .then((s) => { if (!cancelled) setStats(s); })
        .catch((e) => { if (!cancelled) setErr(String((e as Error)?.message ?? e)); });
    };
    fetchOnce();
    const id = window.setInterval(fetchOnce, 5 * 60_000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, []);
  if (err) return null; // silent on error — banner is informational only
  if (!stats?.categories) return null;
  const sorted = [...stats.categories]
    .filter((r) => r.category)
    .sort((a, b) => (b.rows_last_7d ?? 0) - (a.rows_last_7d ?? 0))
    .slice(0, 5);
  const total7d = stats.categories.reduce((sum, r) => sum + (r.rows_last_7d ?? 0), 0);

  // Freshness — what's the newest article across all categories? Surface this
  // explicitly so users see at a glance when upstream ingestion has stalled.
  const newestIso = stats.categories
    .map((r) => r.latest_in_60d)
    .filter((s): s is string => !!s)
    .sort()
    .pop();
  let freshLabel = "—";
  let freshCls = "border-border text-muted-foreground";
  if (newestIso) {
    const ageMs = Date.now() - new Date(newestIso).getTime();
    const ageMin = Math.floor(ageMs / 60_000);
    if      (ageMin < 60)   { freshLabel = `${ageMin}m old`;             freshCls = "border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-400"; }
    else if (ageMin < 4*60) { freshLabel = `${Math.floor(ageMin/60)}h old`; freshCls = "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"; }
    else                    { freshLabel = `${Math.floor(ageMin/60)}h stale`; freshCls = "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400"; }
  }

  return (
    <div className="flex items-center gap-3 px-4 py-1.5 border-b border-border bg-muted/10 text-[11px] text-muted-foreground overflow-x-auto">
      <span className={cn("px-2 py-0.5 rounded-full border font-medium", freshCls)} title={newestIso ?? ""}>
        newest · {freshLabel}
      </span>
      <span className="text-muted-foreground/70">|</span>
      <span>Last 7d:</span>
      <span><span className="font-mono font-semibold text-foreground">{fmtNumber(total7d, { abbreviate: true, decimals: 1 })}</span> total</span>
      {sorted.map((r) => (
        <span key={r.category ?? "?"} className="whitespace-nowrap">
          <span className={cn("px-1.5 py-0.5 rounded border", catCls(r.category))}>{r.category}</span>{" "}
          <span className="font-mono text-foreground">{fmtNumber(r.rows_last_7d, { abbreviate: true, decimals: 1 })}</span>
        </span>
      ))}
    </div>
  );
}

// ── Sentiment view ──────────────────────────────────────────────────────────

function SentimentScoreBadge({ score }: { score: number | null | undefined }) {
  if (score == null || !isFinite(score)) return <span className="text-muted-foreground">—</span>;
  const cls = score > 0.6 ? "text-green-600 dark:text-green-400"
            : score < 0.4 ? "text-red-600 dark:text-red-400"
            : "text-amber-600 dark:text-amber-400";
  return <span className={cn("font-mono font-bold", cls)}>{(score * 100).toFixed(0)}</span>;
}

function SentimentBar({ bullish, bearish }: { bullish: number | null; bearish: number | null }) {
  const b = bullish ?? 0;
  const r = bearish ?? 0;
  const total = b + r || 1;
  return (
    <div className="flex h-1.5 rounded overflow-hidden bg-muted">
      <div className="bg-green-500" style={{ width: `${(b / total) * 100}%` }} />
      <div className="bg-red-500"   style={{ width: `${(r / total) * 100}%` }} />
    </div>
  );
}

function SentimentView({ symbols }: { symbols: string[] }) {
  const [rows, setRows] = useState<Map<string, SymbolSentiment | null>>(new Map());
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const m = new Map<string, SymbolSentiment | null>();
    const settled = await Promise.allSettled(
      symbols.map((s) => findata.symbolSentiment(s).then((r) => ({ s, row: r?.[0] ?? null }))),
    );
    for (const r of settled) {
      if (r.status === "fulfilled") m.set(r.value.s, r.value.row);
    }
    setRows(m);
    setLoading(false);
  }, [symbols]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-3 text-xs text-muted-foreground">
        <span>News sentiment per symbol (latest period)</span>
        <button onClick={load} disabled={loading}
          className="flex items-center gap-1 px-2 py-0.5 rounded border border-border hover:bg-accent disabled:opacity-50">
          <RefreshCw className={cn("w-3 h-3", loading && "animate-spin")} /> Refresh
        </button>
      </div>
      <div className="grid gap-2 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
        {symbols.map((s) => {
          const r = rows.get(s);
          return (
            <div key={s} className="rounded border border-border bg-card p-3">
              <div className="flex items-center justify-between mb-1.5">
                <span className="font-mono font-bold text-foreground">{s}</span>
                <span className="text-xs text-muted-foreground">{r?.period_end_date ?? "—"}</span>
              </div>
              {r ? (
                <>
                  <div className="grid grid-cols-3 gap-2 text-xs mb-2">
                    <div>
                      <div className="text-[10px] text-muted-foreground uppercase">Score</div>
                      <div className="text-lg leading-tight"><SentimentScoreBadge score={r.sentiment_score} /></div>
                    </div>
                    <div>
                      <div className="text-[10px] text-muted-foreground uppercase">Articles / wk</div>
                      <div className="text-lg font-mono font-bold leading-tight">{fmtNumber(r.articles_last_week, { decimals: 0 })}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-muted-foreground uppercase">Buzz</div>
                      <div className="text-lg font-mono font-bold leading-tight">{fmtNumber(r.buzz, { decimals: 2 })}</div>
                    </div>
                  </div>
                  <SentimentBar bullish={r.bullish_pct} bearish={r.bearish_pct} />
                  <div className="flex justify-between mt-1 text-[10px] text-muted-foreground font-mono">
                    <span className="text-green-600 dark:text-green-400 flex items-center gap-1">
                      <TrendingUp className="w-3 h-3" />{(((r.bullish_pct ?? 0) as number) * 100).toFixed(0)}% bull
                    </span>
                    <span className="text-red-600 dark:text-red-400 flex items-center gap-1">
                      <TrendingDown className="w-3 h-3" />{(((r.bearish_pct ?? 0) as number) * 100).toFixed(0)}% bear
                    </span>
                  </div>
                </>
              ) : (
                <div className="text-xs text-muted-foreground py-4 text-center">no sentiment data</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Social sentiment hourly time-series (single symbol) ─────────────────────

function SocialSentimentView({ initialSymbol }: { initialSymbol: string }) {
  const [symbol, setSymbol] = useState(initialSymbol);
  const [draft, setDraft] = useState(initialSymbol);
  const [rows, setRows] = useState<SocialSentimentRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { setSymbol(initialSymbol); setDraft(initialSymbol); }, [initialSymbol]);

  const load = useCallback(async () => {
    if (!symbol) return;
    setLoading(true);
    setErr(null);
    try {
      const data = await findata.socialSentiment(symbol, { limit: 168 }); // last week of hourly data
      setRows(data);
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    } finally {
      setLoading(false);
    }
  }, [symbol]);

  useEffect(() => { load(); }, [load]);

  // Build a simple sparkline-style table — total mention count + net sentiment per hour
  const max = useMemo(() => Math.max(1, ...rows.map((r) => r.mention ?? 0)), [rows]);
  const totals = useMemo(() => {
    let totMention = 0, totPos = 0, totNeg = 0;
    for (const r of rows) {
      totMention += r.mention ?? 0;
      totPos += r.positive_mention ?? 0;
      totNeg += r.negative_mention ?? 0;
    }
    return { totMention, totPos, totNeg };
  }, [rows]);

  return (
    <div className="p-4">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <MessageCircle className="w-4 h-4 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">Symbol</span>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value.toUpperCase())}
          onKeyDown={(e) => e.key === "Enter" && setSymbol(draft.trim())}
          className="w-24 font-mono rounded border border-border bg-background px-2 py-1 text-sm uppercase"
        />
        <button onClick={() => setSymbol(draft.trim())}
          className="px-3 py-1 rounded border border-primary text-primary bg-primary/10 hover:bg-primary/20 text-sm">
          Load
        </button>
        <button onClick={load} disabled={loading}
          className="ml-auto flex items-center gap-1 text-xs px-2 py-1 rounded border border-border hover:bg-accent disabled:opacity-50">
          <RefreshCw className={cn("w-3 h-3", loading && "animate-spin")} /> Refresh
        </button>
      </div>

      {err && <div className="px-2 py-2 text-xs text-red-600">{err}</div>}

      {rows.length > 0 && (
        <div className="grid grid-cols-3 gap-2 mb-3 text-xs">
          <div className="rounded border border-border p-2 bg-card">
            <div className="text-muted-foreground">Total mentions</div>
            <div className="text-lg font-bold font-mono">{fmtNumber(totals.totMention, { abbreviate: true, decimals: 1 })}</div>
            <div className="text-[10px] text-muted-foreground">last {rows.length}h</div>
          </div>
          <div className="rounded border border-border p-2 bg-card">
            <div className="text-muted-foreground flex items-center gap-1"><TrendingUp className="w-3 h-3" />Positive</div>
            <div className="text-lg font-bold font-mono text-green-600 dark:text-green-400">{fmtNumber(totals.totPos, { abbreviate: true, decimals: 1 })}</div>
          </div>
          <div className="rounded border border-border p-2 bg-card">
            <div className="text-muted-foreground flex items-center gap-1"><TrendingDown className="w-3 h-3" />Negative</div>
            <div className="text-lg font-bold font-mono text-red-600 dark:text-red-400">{fmtNumber(totals.totNeg, { abbreviate: true, decimals: 1 })}</div>
          </div>
        </div>
      )}

      {loading && rows.length === 0 && (
        <div className="py-6 text-center text-sm text-muted-foreground animate-pulse">Loading social mentions…</div>
      )}
      {!loading && !err && rows.length === 0 && (
        <div className="py-8 text-center text-sm text-muted-foreground">
          <div>No social-sentiment data for <span className="font-mono">${symbol}</span> yet.</div>
          <div className="text-xs mt-1 opacity-70">Social sentiment is only tracked for actively-discussed tickers — try a mega-cap or popular crypto symbol.</div>
        </div>
      )}

      {rows.length > 0 && (
        <div className="rounded border border-border bg-card overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-muted/30 border-b border-border text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-1.5 font-medium">Hour (UTC)</th>
                <th className="text-right px-3 py-1.5 font-medium">Mentions</th>
                <th className="text-right px-3 py-1.5 font-medium">+ score</th>
                <th className="text-right px-3 py-1.5 font-medium">– score</th>
                <th className="text-left px-3 py-1.5 font-medium w-1/3">Volume</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 60).map((r, i) => {
                const m = r.mention ?? 0;
                const pos = r.positive_mention ?? 0;
                const neg = r.negative_mention ?? 0;
                const tot = pos + neg || 1;
                return (
                  <tr key={i} className="border-b border-border hover:bg-muted/30">
                    <td className="px-3 py-1 font-mono">{r.ts.slice(0, 16).replace("T", " ")}</td>
                    <td className="px-3 py-1 text-right font-mono">{fmtNumber(m, { decimals: 0 })}</td>
                    <td className="px-3 py-1 text-right font-mono text-green-600 dark:text-green-400">{r.positive_score?.toFixed(2) ?? "—"}</td>
                    <td className="px-3 py-1 text-right font-mono text-red-600 dark:text-red-400">{r.negative_score?.toFixed(2) ?? "—"}</td>
                    <td className="px-3 py-1">
                      <div className="flex h-2 rounded overflow-hidden bg-muted" style={{ width: `${Math.min(100, (m / max) * 100)}%` }}>
                        <div className="bg-green-500" style={{ width: `${(pos / tot) * 100}%` }} />
                        <div className="bg-red-500"   style={{ width: `${(neg / tot) * 100}%` }} />
                      </div>
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

// ── Page shell ──────────────────────────────────────────────────────────────

export default function DatasetsNewsPage() {
  const [watchlist, setWatchlist] = useState<string[]>(loadWatchlist);
  const [current, setCurrent] = useState<string | "all">("all");
  const [tab, setTab] = useState<Tab>("feed");

  useEffect(() => { saveWatchlist(watchlist); }, [watchlist]);

  const addSym = useCallback((s: string) => {
    const sym = s.replace(/^\$/, "").toUpperCase().trim();
    if (!sym) return;
    setWatchlist((wl) => wl.includes(sym) ? wl : [...wl, sym].slice(0, 24));
  }, []);
  const removeSym = useCallback((s: string) => {
    setWatchlist((wl) => {
      const next = wl.filter((x) => x !== s);
      // If current symbol was removed, fall back to All
      setCurrent((c) => (c === s ? "all" : c));
      return next.length > 0 ? next : DEFAULT_WATCHLIST;
    });
  }, []);

  const focused = current === "all" ? watchlist : [current];
  const socialSym = current === "all" ? (watchlist[0] ?? "NVDA") : current;

  const tabCls = (active: boolean) =>
    cn(
      "px-3 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors inline-flex items-center gap-1.5",
      active
        ? "border-primary text-foreground"
        : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground",
    );

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2 border-b bg-background shrink-0">
        <Newspaper className="w-4 h-4 text-primary" />
        <div className="text-sm font-semibold text-foreground">News Explorer</div>
        <span className="text-[11px] text-muted-foreground ml-2">
          Cross-roster headlines · full-text search · sentiment · social mentions
        </span>
        <div className="ml-auto text-[10px] text-muted-foreground font-mono">kv.run:5000 · /news/*</div>
      </div>

      {/* Stats banner (last 7d per-category) — only meaningful on cross-roster surfaces */}
      {(tab === "feed" || tab === "search") && <NewsStatsBanner />}

      {/* Watchlist chips — only relevant for symbol-scoped tabs */}
      {tab !== "search" && (
        <WatchlistEditor
          watchlist={watchlist}
          current={current}
          onPick={setCurrent}
          onAdd={addSym}
          onRemove={removeSym}
        />
      )}

      {/* Tab bar */}
      <div className="flex items-center gap-1 px-4 border-b bg-background shrink-0">
        <button className={tabCls(tab === "feed")} onClick={() => setTab("feed")}>
          <Newspaper className="w-3.5 h-3.5" /> Feed
        </button>
        <button className={tabCls(tab === "search")} onClick={() => setTab("search")}>
          <Search className="w-3.5 h-3.5" /> Search
        </button>
        <button className={tabCls(tab === "sentiment")} onClick={() => setTab("sentiment")}>
          <TrendingUp className="w-3.5 h-3.5" /> Sentiment
        </button>
        <button className={tabCls(tab === "social")} onClick={() => setTab("social")}>
          <MessageCircle className="w-3.5 h-3.5" /> Social
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {tab === "feed"      && <MergedFeed         watchlist={watchlist} current={current} />}
        {tab === "search"    && <SearchFeed />}
        {tab === "sentiment" && <SentimentView      symbols={focused} />}
        {tab === "social"    && <SocialSentimentView initialSymbol={socialSym} />}
      </div>
    </div>
  );
}


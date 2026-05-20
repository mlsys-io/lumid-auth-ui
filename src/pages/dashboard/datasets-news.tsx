import { useCallback, useEffect, useMemo, useState } from "react";
import { Newspaper, ExternalLink, RefreshCw, TrendingUp, TrendingDown, MessageCircle, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  findata,
  fmtNumber,
  daysAgoISO,
  type NewsItem,
  type SymbolSentiment,
  type SocialSentimentRow,
} from "@/api/findata";

type Tab = "feed" | "sentiment" | "social";

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

interface FeedItem extends NewsItem {
  symbol: string;
}

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

  const chipCls = (active: boolean) =>
    cn(
      "text-xs px-2 py-0.5 rounded font-mono border whitespace-nowrap transition-colors group",
      active ? "border-primary text-primary bg-primary/10" : "border-border text-muted-foreground hover:bg-accent",
    );

  return (
    <div className="flex flex-wrap items-center gap-1.5 px-4 py-2 border-b border-border bg-muted/30">
      <button className={chipCls(current === "all")} onClick={() => onPick("all")}>All</button>
      {watchlist.map((s) => (
        <button key={s} className={chipCls(current === s)} onClick={() => onPick(s)}>
          {s}
          <span className="ml-1.5 opacity-40 hover:opacity-100"
            onClick={(e) => { e.stopPropagation(); onRemove(s); }}
            title="Remove from watchlist">×</span>
        </button>
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
        className="w-24 ml-1 rounded border border-border bg-background px-2 py-0.5 text-xs font-mono uppercase"
      />
      {draft && (
        <button onClick={() => { onAdd(draft.trim()); setDraft(""); }}
          className="text-xs px-1.5 py-0.5 rounded border border-primary text-primary bg-primary/10 hover:bg-primary/20">
          <Plus className="w-3 h-3 inline" /> Add
        </button>
      )}
    </div>
  );
}

// ── Merged feed (fan-out across watchlist) ──────────────────────────────────

function MergedFeed({ watchlist, current }: { watchlist: string[]; current: string | "all" }) {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [publisher, setPublisher] = useState<string>("");
  const [category, setCategory] = useState<string>("");

  const symbols = current === "all" ? watchlist : [current];

  const load = useCallback(async () => {
    if (symbols.length === 0) { setItems([]); return; }
    setLoading(true);
    setErr(null);
    try {
      const since = daysAgoISO(14);
      const perSym = current === "all" ? Math.max(10, Math.ceil(80 / symbols.length)) : 50;
      const settled = await Promise.allSettled(
        symbols.map((s) => findata.news(s, perSym, since).then((rows) => rows.map((r) => ({ ...r, symbol: s })))),
      );
      const merged: FeedItem[] = [];
      const seen = new Set<string>();
      for (const r of settled) {
        if (r.status === "fulfilled") {
          for (const it of r.value) {
            const k = it.url || `${it.symbol}:${it.headline}`;
            if (seen.has(k)) continue;
            seen.add(k);
            merged.push(it);
          }
        }
      }
      merged.sort((a, b) => {
        const ta = a.published_at ?? a.ts ?? "";
        const tb = b.published_at ?? b.ts ?? "";
        return ta < tb ? 1 : ta > tb ? -1 : 0;
      });
      setItems(merged);
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, watchlist.join(",")]);

  useEffect(() => { load(); }, [load]);

  const publishers = useMemo(() => {
    const s = new Set<string>();
    items.forEach((i) => { const p = i.publisher ?? i.source; if (p) s.add(String(p)); });
    return Array.from(s).sort();
  }, [items]);

  const categories = useMemo(() => {
    const s = new Set<string>();
    items.forEach((i) => { if (i.category) s.add(String(i.category)); });
    return Array.from(s).sort();
  }, [items]);

  const visible = useMemo(() => items.filter((it) => {
    if (publisher) {
      const p = String(it.publisher ?? it.source ?? "");
      if (p !== publisher) return false;
    }
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
          {visible.length}{visible.length !== items.length && ` / ${items.length}`} articles · last 14 days
        </span>
        <button onClick={load} disabled={loading}
          className="ml-auto flex items-center gap-1 px-2 py-0.5 rounded border border-border hover:bg-accent disabled:opacity-50">
          <RefreshCw className={cn("w-3 h-3", loading && "animate-spin")} /> Refresh
        </button>
      </div>
      {err && <div className="px-4 py-2 text-xs text-red-600">{err}</div>}
      {loading && items.length === 0 && (
        <div className="px-4 py-6 text-center text-sm text-muted-foreground animate-pulse">Loading articles…</div>
      )}
      {!loading && !err && visible.length === 0 && (
        <div className="px-4 py-6 text-center text-sm text-muted-foreground">No articles match.</div>
      )}
      <ul className="divide-y divide-border">
        {visible.map((n, i) => {
          const ts = (n.published_at ?? n.ts) as string | undefined;
          const pub = String(n.publisher ?? n.source ?? "");
          return (
            <li key={n.url || `${n.symbol}-${i}`} className="px-4 py-2.5 hover:bg-muted/30 transition-colors">
              <a href={n.url} target="_blank" rel="noopener noreferrer" className="block group">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5 flex-wrap text-[11px]">
                      <span className="font-mono font-semibold text-primary">${n.symbol}</span>
                      {pub && <span className="text-muted-foreground">{pub}</span>}
                      {n.category && (
                        <span className={cn("px-1.5 py-0.5 rounded border font-medium", catCls(String(n.category)))}>
                          {String(n.category)}
                        </span>
                      )}
                      {ts && <span className="text-muted-foreground ml-auto" title={ts}>{timeAgo(ts)}</span>}
                    </div>
                    <div className="text-sm font-medium text-foreground leading-snug group-hover:underline">{n.headline}</div>
                    {n.summary && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{String(n.summary)}</p>}
                  </div>
                  <ExternalLink className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 shrink-0 mt-1" />
                </div>
              </a>
            </li>
          );
        })}
      </ul>
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
        <div className="py-6 text-center text-sm text-muted-foreground">No social-sentiment data for ${symbol}.</div>
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
          Headlines · sentiment · social mentions across your watchlist
        </span>
        <div className="ml-auto text-[10px] text-muted-foreground font-mono">kv.run:5000 · /news/*</div>
      </div>

      {/* Watchlist chips */}
      <WatchlistEditor
        watchlist={watchlist}
        current={current}
        onPick={setCurrent}
        onAdd={addSym}
        onRemove={removeSym}
      />

      {/* Tab bar */}
      <div className="flex items-center gap-1 px-4 border-b bg-background shrink-0">
        <button className={tabCls(tab === "feed")} onClick={() => setTab("feed")}>
          <Newspaper className="w-3.5 h-3.5" /> Feed
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
        {tab === "feed"      && <MergedFeed     watchlist={watchlist} current={current} />}
        {tab === "sentiment" && <SentimentView  symbols={focused} />}
        {tab === "social"    && <SocialSentimentView initialSymbol={socialSym} />}
      </div>
    </div>
  );
}


import { useCallback, useEffect, useMemo, useState, useRef, type ReactNode } from "react";
import { useAutoRefresh, fmtAgo, useNowTick } from "@/hooks/useAutoRefresh";
import { Users, MessageSquare, Search, Hash, ExternalLink, RefreshCw, Heart, Repeat2, Eye, BadgeCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { findata, fmtNumber, daysAgoISO, todayISO, resolveMediaProxyUrl, isVideoMediaUrl, type Kol, type KolArchiveStats, type KolTweet } from "@/api/findata";

type Tab = "recent" | "symbol" | "search" | "roster";

// ── Helpers ─────────────────────────────────────────────────────────────────

function fmtRelTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (!isFinite(t)) return iso;
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 60)     return `${s}s ago`;
  if (s < 3600)   return `${Math.floor(s / 60)}m ago`;
  if (s < 86400)  return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toISOString().slice(0, 10);
}

const TIER_COLOUR: Record<string, string> = {
  macro:    "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
  trader:   "bg-blue-500/15    text-blue-700    dark:text-blue-400    border-blue-500/30",
  analyst:  "bg-purple-500/15  text-purple-700  dark:text-purple-400  border-purple-500/30",
  crypto:   "bg-orange-500/15  text-orange-700  dark:text-orange-400  border-orange-500/30",
  political:"bg-rose-500/15    text-rose-700    dark:text-rose-400    border-rose-500/30",
  fund:     "bg-cyan-500/15    text-cyan-700    dark:text-cyan-400    border-cyan-500/30",
};

function TierBadge({ tier }: { tier: string | null }) {
  if (!tier) return null;
  const cls = TIER_COLOUR[tier.toLowerCase()] ?? "bg-muted text-muted-foreground border-border";
  return <span className={cn("text-[10px] px-1.5 py-0.5 rounded border font-medium uppercase tracking-wider", cls)}>{tier}</span>;
}

// Highlight $CASHTAGS and #HASHTAGS in tweet text.
function renderTweetText(text: string, onCashtagClick: (sym: string) => void) {
  const parts: ReactNode[] = [];
  const re = /(\$[A-Z]{1,6}|#\w+|https?:\/\/\S+)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("$")) {
      const sym = tok.slice(1);
      parts.push(
        <button key={`c${i++}`} className="text-primary hover:underline font-medium" onClick={() => onCashtagClick(sym)}>
          {tok}
        </button>
      );
    } else if (tok.startsWith("#")) {
      parts.push(<span key={`h${i++}`} className="text-muted-foreground">{tok}</span>);
    } else {
      parts.push(<a key={`u${i++}`} href={tok} target="_blank" rel="noreferrer" className="text-primary underline truncate inline-block max-w-[200px] align-bottom">{tok}</a>);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

// ── Tweet card ──────────────────────────────────────────────────────────────

// ── Media grid ──────────────────────────────────────────────────────────────
// kv.run pre-resolves Twitter CDN URLs to a local mirror (the only size
// available is /hi/, the original 960×… pixels). `media_proxy_urls` is a
// relative URL we map to `/findata-cloud/kols/media/img/hi/<file>` in
// resolveMediaProxyUrl() — see findata.ts for why we bypass the 302.
//
// Sizing strategy (Twitter-web-feed-style):
//   1 image  → preserve aspect (object-contain), cap at max-h, full width
//   2+ images → uniform tile height with object-cover, 2-column grid

function MediaGrid({ proxyUrls, rawUrls }: { proxyUrls: string[] | null | undefined; rawUrls: string[] | null | undefined }) {
  if (!proxyUrls || proxyUrls.length === 0) return null;
  // kv.run only mirrors still-image assets, not videos. A video tweet
  // typically ships 3-4 video variants (different resolutions) + 1 still
  // thumbnail JPG in `media_*_urls`. Filtering out video URLs collapses
  // each tweet to the thumbnail(s) we can actually render.
  const imageOnly = proxyUrls
    .map((p, i) => ({ proxy: p, raw: rawUrls?.[i] }))
    .filter(({ proxy, raw }) => !isVideoMediaUrl(proxy) && !isVideoMediaUrl(raw ?? ""));
  if (imageOnly.length === 0) return null;

  const items = imageOnly.slice(0, 4).map(({ proxy, raw }) => ({
    src: resolveMediaProxyUrl(proxy),
    href: raw ?? resolveMediaProxyUrl(proxy),
  }));
  const remaining = imageOnly.length - 4;
  const isSingle = items.length === 1;

  const wrapCls = isSingle
    ? "mt-2 rounded overflow-hidden border border-border bg-muted/30"
    : "mt-2 grid gap-1 grid-cols-2 rounded overflow-hidden border border-border";

  // Single image: keep natural aspect ratio, modest cap for feed density.
  // Grid: small uniform tiles — clickable to view full-res in a new tab.
  const imgCls = isSingle
    ? "w-full h-auto max-h-[260px] object-contain bg-muted/30 mx-auto block"
    : "w-full h-24 object-cover bg-muted";

  return (
    <div className={wrapCls}>
      {items.map((m, i) => (
        <a key={i} href={m.href} target="_blank" rel="noopener noreferrer"
           className="block relative hover:opacity-90 transition-opacity"
           onClick={(e) => e.stopPropagation()}>
          <img src={m.src} alt="" loading="lazy" className={imgCls}
               onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
          {/* "+N more" overlay on the last visible tile when items overflow */}
          {i === items.length - 1 && remaining > 0 && (
            <div className="absolute inset-0 bg-black/55 flex items-center justify-center text-white text-sm font-medium pointer-events-none">
              +{remaining} more
            </div>
          )}
        </a>
      ))}
    </div>
  );
}

function TweetCard({ t, onCashtagClick, onHandleClick }: {
  t: KolTweet;
  onCashtagClick: (sym: string) => void;
  onHandleClick: (handle: string) => void;
}) {
  return (
    <div className="border-b border-border px-3 py-2.5 hover:bg-muted/30 transition-colors">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap text-sm">
            <button onClick={() => onHandleClick(t.kol_username)} className="font-semibold text-foreground hover:underline">
              {t.author_name || t.author_username}
            </button>
            {t.author_verified && <BadgeCheck className="w-3.5 h-3.5 text-blue-500 shrink-0" />}
            <button onClick={() => onHandleClick(t.kol_username)} className="text-muted-foreground text-xs hover:underline">
              @{t.author_username}
            </button>
            {t.tweet_type && t.tweet_type !== "original" && (
              <span className="text-[10px] px-1 py-0.5 rounded bg-muted text-muted-foreground border border-border uppercase">
                {t.tweet_type}
              </span>
            )}
            <span className="text-xs text-muted-foreground ml-auto" title={t.created_at}>{fmtRelTime(t.created_at)}</span>
          </div>
          <div className="text-sm text-foreground mt-0.5 whitespace-pre-wrap break-words">
            {renderTweetText(t.text, onCashtagClick)}
          </div>
          <MediaGrid proxyUrls={t.media_proxy_urls} rawUrls={t.media_urls} />
          {(t.cashtags?.length || t.hashtags?.length) ? (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {t.cashtags?.map((c) => (
                <button key={`c-${c}`} onClick={() => onCashtagClick(c)}
                  className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-primary/30 text-primary bg-primary/10 hover:bg-primary/20">
                  ${c}
                </button>
              ))}
            </div>
          ) : null}
          <div className="flex items-center gap-3 mt-1.5 text-[11px] text-muted-foreground">
            {t.like_count != null && (
              <span className="flex items-center gap-1"><Heart className="w-3 h-3" />{fmtNumber(t.like_count, { abbreviate: true, decimals: 1 })}</span>
            )}
            {t.retweet_count != null && (
              <span className="flex items-center gap-1"><Repeat2 className="w-3 h-3" />{fmtNumber(t.retweet_count, { abbreviate: true, decimals: 1 })}</span>
            )}
            {t.view_count != null && (
              <span className="flex items-center gap-1"><Eye className="w-3 h-3" />{fmtNumber(t.view_count, { abbreviate: true, decimals: 1 })}</span>
            )}
            <a href={t.url} target="_blank" rel="noreferrer" className="ml-auto flex items-center gap-1 hover:text-foreground">
              x.com <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Archive stats banner ────────────────────────────────────────────────────

function StatsBanner() {
  const [s, setS] = useState<KolArchiveStats | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    findata.kolArchiveStats().then(setS).catch((e) => setErr(String(e?.message ?? e)));
  }, []);
  if (err) return <div className="text-xs text-red-600 dark:text-red-400">archive stats: {err}</div>;
  if (!s) return null;
  const span = s.earliest && s.latest
    ? `${s.earliest.slice(0, 10)} → ${s.latest.slice(0, 10)}`
    : "—";
  return (
    <div className="flex items-center gap-4 text-xs text-muted-foreground">
      <span><span className="font-mono text-foreground font-semibold">{fmtNumber(s.total_rows, { abbreviate: true, decimals: 1 })}</span> tweets</span>
      <span><span className="font-mono text-foreground font-semibold">{fmtNumber(s.distinct_kols)}</span> KOLs</span>
      <span className="font-mono">{span}</span>
    </div>
  );
}

// ── Recent feed (cross-roster) ──────────────────────────────────────────────

function RecentFeed({ onCashtagClick, onHandleClick }: {
  onCashtagClick: (s: string) => void;
  onHandleClick: (h: string) => void;
}) {
  const [tweets, setTweets] = useState<KolTweet[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      // Truly-recent strategy: fan out across broad finance/news terms via
      // /kols/tweets/search and merge. Search results are sorted desc by
      // created_at server-side, ship the full archive-row shape including
      // media_urls + media_proxy_urls, and have stable tweet_ids for dedup.
      //
      // The "live ticker" /kols/tweets endpoint is NOT used here — it returns
      // a simpler KOLTweet shape (no media, no tweet_id, different field
      // names like `handle`/`likes` vs `kol_username`/`like_count`) that
      // breaks dedup and would suppress media on otherwise-rich rows.
      const terms = [
        "market", "stock", "earnings", "trade", "rate",
        "fed", "crypto", "trump", "tesla", "NVDA",
      ];
      const settled = await Promise.allSettled(
        terms.map((q) => findata.kolSearch(q, { limit: 30 })),
      );
      const merged = new Map<string, KolTweet>();
      for (const r of settled) {
        if (r.status === "fulfilled") {
          for (const t of r.value) {
            if (t.tweet_id) merged.set(t.tweet_id, t);
          }
        }
      }
      const rows = Array.from(merged.values())
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
        .slice(0, 50);
      setTweets(rows);
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    } finally {
      setLoading(false);
    }
  }, []);

  // Re-fetch when the tab regains focus after >60s hidden; also records
  // `loadedAt` so the header can show "loaded Nm ago".
  const { loadedAt, refresh } = useAutoRefresh(load);
  // Initial load on mount — calls refresh() (not raw load()) so loadedAt
  // is captured. Subsequent refreshes go through the same wrapper.
  const didMount = useRef(false);
  useEffect(() => {
    if (didMount.current) return;
    didMount.current = true;
    refresh();
  }, [refresh]);
  // Tick the clock every 30s so "loaded Nm ago" + "newest Nm ago" stay live.
  useNowTick();

  const newestIso = tweets[0]?.created_at;

  return (
    <div>
      <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground border-b border-border">
        <span>Latest across the roster</span>
        {newestIso && (
          <span className="text-[10px] px-1.5 py-0.5 rounded border border-border bg-muted/30 font-mono">
            newest · {fmtRelTime(newestIso)}
          </span>
        )}
        <span className="text-[10px] opacity-60">{tweets.length} tweets · 10 finance queries merged</span>
        <span className="text-[10px] opacity-60">loaded {fmtAgo(loadedAt)}</span>
        <button onClick={refresh} disabled={loading}
          className="ml-auto flex items-center gap-1 px-2 py-0.5 rounded border border-border hover:bg-accent disabled:opacity-50">
          <RefreshCw className={cn("w-3 h-3", loading && "animate-spin")} />
          Refresh
        </button>
      </div>
      {err && <div className="px-3 py-2 text-xs text-red-600">{err}</div>}
      {!err && !loading && tweets.length === 0 && (
        <div className="px-3 py-8 text-center text-sm text-muted-foreground">
          <div>Quiet across the roster right now.</div>
          <div className="text-xs mt-1 opacity-70">Try the <b>Search</b> tab for a specific topic or <b>By symbol</b> for cashtag activity.</div>
        </div>
      )}
      {tweets.map((t) => (
        <TweetCard key={t.tweet_id} t={t} onCashtagClick={onCashtagClick} onHandleClick={onHandleClick} />
      ))}
    </div>
  );
}

// ── By-symbol view ──────────────────────────────────────────────────────────

function BySymbolView({ initialSymbol, onCashtagClick, onHandleClick }: {
  initialSymbol: string;
  onCashtagClick: (s: string) => void;
  onHandleClick: (h: string) => void;
}) {
  const [symbol, setSymbol] = useState(initialSymbol);
  const [draft, setDraft] = useState(initialSymbol);
  const [since, setSince] = useState(daysAgoISO(30));
  const [until, setUntil] = useState(todayISO());
  const [tweets, setTweets] = useState<KolTweet[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { setSymbol(initialSymbol); setDraft(initialSymbol); }, [initialSymbol]);

  const load = useCallback(async () => {
    if (!symbol) return;
    setLoading(true);
    setErr(null);
    try {
      const rows = await findata.kolSymbolHistory(symbol, { since, until, limit: 100 });
      setTweets(rows);
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    } finally {
      setLoading(false);
    }
  }, [symbol, since, until]);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-border bg-muted/20">
        <span className="text-xs text-muted-foreground">Symbol</span>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value.toUpperCase())}
          onKeyDown={(e) => e.key === "Enter" && setSymbol(draft.trim())}
          className="w-24 font-mono rounded border border-border bg-background px-2 py-1 text-sm uppercase"
          placeholder="NVDA"
        />
        <span className="text-xs text-muted-foreground ml-2">From</span>
        <input type="date" value={since} onChange={(e) => setSince(e.target.value)}
          className="rounded border border-border bg-background px-2 py-1 text-xs font-mono" />
        <span className="text-xs text-muted-foreground">To</span>
        <input type="date" value={until} onChange={(e) => setUntil(e.target.value)}
          className="rounded border border-border bg-background px-2 py-1 text-xs font-mono" />
        <button onClick={() => setSymbol(draft.trim())}
          className="ml-auto px-3 py-1 rounded border border-primary text-primary bg-primary/10 hover:bg-primary/20 text-sm">
          Search
        </button>
      </div>
      {err && <div className="px-3 py-2 text-xs text-red-600">{err}</div>}
      {loading && <div className="px-3 py-6 text-center text-sm text-muted-foreground">Loading…</div>}
      {!loading && !err && tweets.length === 0 && (
        <div className="px-3 py-6 text-center text-sm text-muted-foreground">No KOL mentions of ${symbol} in this window.</div>
      )}
      {!loading && tweets.length > 0 && (
        <div className="px-3 py-1.5 text-[11px] text-muted-foreground bg-muted/10 border-b border-border">
          <span className="font-mono text-foreground font-semibold">{tweets.length}</span> mentions of <span className="font-mono text-primary">${symbol}</span>
        </div>
      )}
      {tweets.map((t) => (
        <TweetCard key={t.tweet_id} t={t} onCashtagClick={onCashtagClick} onHandleClick={onHandleClick} />
      ))}
    </div>
  );
}

// ── Search view (full-text) ─────────────────────────────────────────────────

function SearchView({ onCashtagClick, onHandleClick }: {
  onCashtagClick: (s: string) => void;
  onHandleClick: (h: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const [q, setQ] = useState("");
  const [since, setSince] = useState(daysAgoISO(30));
  const [until, setUntil] = useState(todayISO());
  const [tweets, setTweets] = useState<KolTweet[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!q.trim()) { setTweets([]); return; }
    setLoading(true);
    setErr(null);
    try {
      const rows = await findata.kolSearch(q.trim(), { since, until, limit: 100 });
      setTweets(rows);
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    } finally {
      setLoading(false);
    }
  }, [q, since, until]);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-border bg-muted/20">
        <Search className="w-4 h-4 text-muted-foreground" />
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && setQ(draft.trim())}
          className="flex-1 min-w-[200px] rounded border border-border bg-background px-2 py-1 text-sm"
          placeholder="rate cut, $TSLA earnings, AI bubble…"
        />
        <span className="text-xs text-muted-foreground ml-2">From</span>
        <input type="date" value={since} onChange={(e) => setSince(e.target.value)}
          className="rounded border border-border bg-background px-2 py-1 text-xs font-mono" />
        <span className="text-xs text-muted-foreground">To</span>
        <input type="date" value={until} onChange={(e) => setUntil(e.target.value)}
          className="rounded border border-border bg-background px-2 py-1 text-xs font-mono" />
        <button onClick={() => setQ(draft.trim())}
          className="px-3 py-1 rounded border border-primary text-primary bg-primary/10 hover:bg-primary/20 text-sm">
          Search
        </button>
      </div>
      {err && <div className="px-3 py-2 text-xs text-red-600">{err}</div>}
      {!q && (
        <div className="px-3 py-6 text-center text-sm text-muted-foreground">Enter a query and press Enter. Full-text + cashtag-indexed across 11M tweets.</div>
      )}
      {loading && <div className="px-3 py-6 text-center text-sm text-muted-foreground">Searching…</div>}
      {q && !loading && !err && tweets.length === 0 && (
        <div className="px-3 py-8 text-center text-sm text-muted-foreground">
          <div>No tweets mention <span className="font-mono">"{q}"</span> in this window.</div>
          <div className="text-xs mt-1 opacity-70">Try a broader term, widen the date range, or browse <b>Roster</b> for specific KOLs.</div>
        </div>
      )}
      {tweets.length > 0 && (
        <div className="px-3 py-1.5 text-[11px] text-muted-foreground bg-muted/10 border-b border-border">
          <span className="font-mono text-foreground font-semibold">{tweets.length}</span> matches for "{q}"
        </div>
      )}
      {tweets.map((t) => (
        <TweetCard key={t.tweet_id} t={t} onCashtagClick={onCashtagClick} onHandleClick={onHandleClick} />
      ))}
    </div>
  );
}

// ── Roster view (KOL list) ──────────────────────────────────────────────────

function RosterView({ onHandleClick }: { onHandleClick: (h: string) => void }) {
  const [kols, setKols] = useState<Kol[]>([]);
  const [stats, setStats] = useState<KolArchiveStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [filter, setFilter] = useState("");
  const [tierFilter, setTierFilter] = useState<string>("");

  useEffect(() => {
    setLoading(true);
    findata.kolRoster(includeInactive)
      .then(setKols)
      .catch((e) => setErr(String((e as Error)?.message ?? e)))
      .finally(() => setLoading(false));
  }, [includeInactive]);

  useEffect(() => { findata.kolArchiveStats().then(setStats).catch(() => {}); }, []);

  const tiers = useMemo(() => {
    const s = new Set<string>();
    kols.forEach((k) => k.follower_tier && s.add(k.follower_tier));
    return Array.from(s).sort();
  }, [kols]);

  const visible = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return kols.filter((k) => {
      if (tierFilter && k.follower_tier !== tierFilter) return false;
      if (!f) return true;
      return (
        k.handle.toLowerCase().includes(f) ||
        (k.display_name?.toLowerCase().includes(f) ?? false) ||
        (k.notes?.toLowerCase().includes(f) ?? false)
      );
    });
  }, [kols, filter, tierFilter]);

  return (
    <div>
      <div className="px-3 py-2 border-b border-border bg-muted/10 text-[11px] text-muted-foreground">
        Curated allowlist — handles the live ingestion pipeline pulls from.
        {stats && (
          <> The archive holds tweets from <span className="font-mono text-foreground">{fmtNumber(stats.distinct_kols)}</span> distinct authors historically (incl. retweet/quote chains and prior-roster handles); Search and By-symbol query the full archive.</>
        )}
      </div>
      <OpenAnyHandle onPick={onHandleClick} />
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-border bg-muted/20">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by handle, name, notes…"
          className="flex-1 min-w-[200px] rounded border border-border bg-background px-2 py-1 text-sm"
        />
        <select value={tierFilter} onChange={(e) => setTierFilter(e.target.value)}
          className="rounded border border-border bg-background px-2 py-1 text-sm">
          <option value="">All tiers</option>
          {tiers.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
          <input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} />
          Include inactive
        </label>
        <span className="ml-auto text-xs text-muted-foreground">
          {visible.length} / {kols.length} allowlisted
        </span>
      </div>
      {err && <div className="px-3 py-2 text-xs text-red-600">{err}</div>}
      {loading && <div className="px-3 py-6 text-center text-sm text-muted-foreground">Loading roster…</div>}
      {!loading && !err && (
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/10 text-xs text-muted-foreground">
            <tr>
              <th className="text-left px-3 py-1.5 font-medium">Handle</th>
              <th className="text-left px-3 py-1.5 font-medium">Name</th>
              <th className="text-left px-3 py-1.5 font-medium">Tier</th>
              <th className="text-left px-3 py-1.5 font-medium">Notes</th>
              <th className="text-left px-3 py-1.5 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((k) => (
              <tr key={k.handle} className="border-b border-border hover:bg-muted/30">
                <td className="px-3 py-1.5">
                  <button onClick={() => onHandleClick(k.handle)} className="font-mono font-medium text-primary hover:underline">
                    @{k.handle}
                  </button>
                </td>
                <td className="px-3 py-1.5">{k.display_name ?? "—"}</td>
                <td className="px-3 py-1.5"><TierBadge tier={k.follower_tier} /></td>
                <td className="px-3 py-1.5 text-muted-foreground text-xs">{k.notes ?? ""}</td>
                <td className="px-3 py-1.5">
                  {k.active ? (
                    <span className="text-[10px] px-1.5 py-0.5 rounded border border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-400">active</span>
                  ) : (
                    <span className="text-[10px] px-1.5 py-0.5 rounded border border-muted text-muted-foreground">inactive</span>
                  )}
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-8 text-center text-sm text-muted-foreground">No handles match your filter. Clear it or try a different tier.</td></tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── Handle detail drawer ────────────────────────────────────────────────────

function HandleDrawer({ handle, onClose, onCashtagClick, onHandleClick }: {
  handle: string;
  onClose: () => void;
  onCashtagClick: (s: string) => void;
  onHandleClick: (h: string) => void;
}) {
  const [tweets, setTweets] = useState<KolTweet[]>([]);
  const [source, setSource] = useState<"live" | "archive" | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    setSource(null);
    (async () => {
      try {
        // Try live ticker first (allowlisted handles); fall back to archive
        // history (works for any of the 1,347 historical authors).
        const live = await findata.kolHandleTweets(handle, 50);
        if (cancelled) return;
        if (live.length > 0) {
          setTweets(live);
          setSource("live");
          return;
        }
        const hist = await findata.kolHandleHistory(handle, { limit: 50 });
        if (cancelled) return;
        setTweets(hist);
        setSource("archive");
      } catch (e) {
        if (!cancelled) setErr(String((e as Error)?.message ?? e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [handle]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div className="relative w-full max-w-xl bg-background border-l border-border shadow-xl overflow-auto"
        onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-background px-3 py-2">
          <Users className="w-4 h-4 text-muted-foreground" />
          <span className="font-mono font-semibold">@{handle}</span>
          {source === "live" && (
            <span className="text-[10px] px-1.5 py-0.5 rounded border border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-400 uppercase tracking-wider">live</span>
          )}
          {source === "archive" && (
            <span className="text-[10px] px-1.5 py-0.5 rounded border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400 uppercase tracking-wider">archive</span>
          )}
          <a href={`https://x.com/${handle}`} target="_blank" rel="noreferrer"
             className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
            x.com <ExternalLink className="w-3 h-3" />
          </a>
          <button onClick={onClose} className="ml-auto text-sm text-muted-foreground hover:text-foreground px-2 py-0.5 rounded border border-border">
            Close
          </button>
        </div>
        {err && <div className="px-3 py-2 text-xs text-red-600">{err}</div>}
        {loading && <div className="px-3 py-6 text-center text-sm text-muted-foreground">Loading…</div>}
        {!loading && tweets.length === 0 && !err && (
          <div className="px-3 py-8 text-center text-sm text-muted-foreground">
            <div>No tweets cached for <span className="font-mono">@{handle}</span>.</div>
            <div className="text-xs mt-1 opacity-70">The handle may not be in the kv.run archive yet, or the cache is rebuilding.</div>
          </div>
        )}
        {tweets.map((t) => (
          <TweetCard key={t.tweet_id} t={t} onCashtagClick={onCashtagClick} onHandleClick={onHandleClick} />
        ))}
      </div>
    </div>
  );
}

// ── Browse-any-handle picker (covers the 1,347 archive authors) ─────────────

function OpenAnyHandle({ onPick }: { onPick: (h: string) => void }) {
  const [draft, setDraft] = useState("");
  const [discovered, setDiscovered] = useState<{ handle: string; count: number }[]>([]);
  const [loading, setLoading] = useState(false);

  // Mine search results across broad finance terms to surface archive-only
  // authors. No /kols/archive/authors endpoint exists, so this is the
  // pragmatic discovery path.
  const discover = useCallback(async () => {
    setLoading(true);
    try {
      const terms = ["market", "stock", "earnings", "rate", "fed", "trade", "AI", "crypto", "BTC", "ETH", "tesla", "nvidia", "oil", "gold", "bank"];
      const settled = await Promise.allSettled(
        terms.map((q) => findata.kolSearch(q, { limit: 100 })),
      );
      const counts = new Map<string, number>();
      for (const s of settled) {
        if (s.status === "fulfilled") {
          for (const t of s.value) {
            const h = t.kol_username;
            if (h) counts.set(h, (counts.get(h) ?? 0) + 1);
          }
        }
      }
      const rows = Array.from(counts.entries())
        .map(([handle, count]) => ({ handle, count }))
        .sort((a, b) => b.count - a.count);
      setDiscovered(rows);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { discover(); }, [discover]);

  const cleaned = draft.replace(/^@/, "").trim();

  return (
    <div className="px-3 py-2 border-b border-border bg-muted/20">
      <div className="text-[11px] text-muted-foreground mb-1.5">
        Open any handle from the archive (1,347 historical authors). The drawer shows live tweets if the handle is allowlisted, archive otherwise.
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && cleaned && onPick(cleaned)}
          className="flex-1 min-w-[200px] rounded border border-border bg-background px-2 py-1 text-sm font-mono"
          placeholder="@chamath, @arkinvest, @altcoindaily, …"
        />
        <button
          onClick={() => cleaned && onPick(cleaned)}
          disabled={!cleaned}
          className="px-3 py-1 rounded border border-primary text-primary bg-primary/10 hover:bg-primary/20 text-sm disabled:opacity-50">
          Open
        </button>
        <button onClick={discover} disabled={loading}
          className="text-xs px-2 py-1 rounded border border-border hover:bg-accent disabled:opacity-50">
          {loading ? "Discovering…" : "Refresh discovered"}
        </button>
      </div>
      {discovered.length > 0 && (
        <div className="mt-2">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
            Discovered in archive ({discovered.length}) — sample sorted by recent mentions
          </div>
          <div className="flex flex-wrap gap-1 max-h-32 overflow-auto">
            {discovered.slice(0, 80).map((d) => (
              <button key={d.handle} onClick={() => onPick(d.handle)}
                className="text-[11px] font-mono px-1.5 py-0.5 rounded border border-border hover:bg-accent text-foreground">
                @{d.handle}<span className="opacity-50 ml-1">{d.count}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Page shell ──────────────────────────────────────────────────────────────

export default function DatasetsKolsPage() {
  const [tab, setTab] = useState<Tab>("recent");
  const [symbol, setSymbol] = useState("NVDA");
  const [drawer, setDrawer] = useState<string | null>(null);

  const handleCashtag = useCallback((s: string) => {
    setSymbol(s.toUpperCase());
    setTab("symbol");
  }, []);
  const handleHandleClick = useCallback((h: string) => setDrawer(h), []);

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
        <MessageSquare className="w-4 h-4 text-primary" />
        <div className="text-sm font-semibold text-foreground">KOL Tweet Explorer</div>
        <StatsBanner />
        <div className="ml-auto text-[10px] text-muted-foreground font-mono">kv.run:5000 · /kols/*</div>
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-1 px-4 border-b bg-background shrink-0">
        <button className={tabCls(tab === "recent")} onClick={() => setTab("recent")}>
          <MessageSquare className="w-3.5 h-3.5" /> Recent
        </button>
        <button className={tabCls(tab === "symbol")} onClick={() => setTab("symbol")}>
          <Hash className="w-3.5 h-3.5" /> By symbol
        </button>
        <button className={tabCls(tab === "search")} onClick={() => setTab("search")}>
          <Search className="w-3.5 h-3.5" /> Search
        </button>
        <button className={tabCls(tab === "roster")} onClick={() => setTab("roster")}>
          <Users className="w-3.5 h-3.5" /> Roster
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {tab === "recent" && <RecentFeed onCashtagClick={handleCashtag} onHandleClick={handleHandleClick} />}
        {tab === "symbol" && <BySymbolView initialSymbol={symbol} onCashtagClick={handleCashtag} onHandleClick={handleHandleClick} />}
        {tab === "search" && <SearchView onCashtagClick={handleCashtag} onHandleClick={handleHandleClick} />}
        {tab === "roster" && <RosterView onHandleClick={handleHandleClick} />}
      </div>

      {drawer && (
        <HandleDrawer handle={drawer} onClose={() => setDrawer(null)}
          onCashtagClick={(s) => { setDrawer(null); handleCashtag(s); }}
          onHandleClick={(h) => setDrawer(h)} />
      )}
    </div>
  );
}

import { useEffect, useState } from "react";
import { findata, type NewsItem, type SymbolSentiment } from "@/api/findata";

function timeAgo(iso?: string): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  if (isNaN(ms)) return iso.slice(0, 10);
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return iso.slice(0, 10);
}

export default function NewsPane({ symbol }: { symbol: string }) {
  const [items, setItems] = useState<NewsItem[]>([]);
  const [sentiment, setSentiment] = useState<SymbolSentiment | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!symbol) return;
    setLoading(true); setErr(""); setItems([]); setSentiment(null);
    Promise.all([
      findata.news(symbol, 30).then((r) => setItems(r ?? [])).catch((e) => { throw e; }),
      findata.symbolSentiment(symbol).then((s) => setSentiment(s?.[0] ?? null)).catch(() => {}),
    ])
      .catch((e) => setErr(String(e)))
      .finally(() => setLoading(false));
  }, [symbol, reloadKey]);

  if (loading) return <p className="text-sm text-muted-foreground animate-pulse">Loading…</p>;
  if (err) {
    const is5xx = /\b5\d\d\b/.test(err);
    return (
      <div className="rounded border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
        <div className="font-medium text-amber-700 dark:text-amber-400 mb-1">
          {is5xx ? "kv.run news service is currently unavailable" : "Couldn't load news"}
        </div>
        <div className="text-xs text-muted-foreground mb-2 font-mono">{err}</div>
        <button onClick={() => setReloadKey((k) => k + 1)}
          className="text-xs px-2 py-1 rounded bg-amber-600 text-white hover:bg-amber-700">
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {sentiment && (
        <div className="grid gap-2 md:grid-cols-4 text-xs">
          <div className="rounded border border-border p-2 bg-card">
            <div className="text-muted-foreground">Sentiment score</div>
            <div className={`text-lg font-bold font-mono ${sentiment.sentiment_score > 0.6 ? "text-green-600 dark:text-green-400" : sentiment.sentiment_score < 0.4 ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400"}`}>
              {(sentiment.sentiment_score * 100).toFixed(0)}
            </div>
          </div>
          <div className="rounded border border-border p-2 bg-card">
            <div className="text-muted-foreground">Articles / week</div>
            <div className="text-lg font-bold font-mono">{sentiment.articles_last_week}</div>
          </div>
          <div className="rounded border border-border p-2 bg-card">
            <div className="text-muted-foreground">Bullish %</div>
            <div className="text-lg font-bold font-mono text-green-600 dark:text-green-400">{(sentiment.bullish_pct * 100).toFixed(0)}%</div>
          </div>
          <div className="rounded border border-border p-2 bg-card">
            <div className="text-muted-foreground">Bearish %</div>
            <div className="text-lg font-bold font-mono text-red-600 dark:text-red-400">{(sentiment.bearish_pct * 100).toFixed(0)}%</div>
          </div>
        </div>
      )}
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No recent news.</p>
      ) : (
      <ul className="space-y-2">
      {items.map((n, i) => {
        const ts = (n.ts || n.published_at) as string | undefined;
        return (
          <li key={i} className="rounded border border-border p-3 bg-card hover:bg-accent/40 transition-colors">
            <a href={n.url} target="_blank" rel="noopener noreferrer" className="block">
              <div className="flex items-start gap-3">
                <div className="flex-1">
                  <div className="text-sm font-medium text-foreground leading-snug">{n.headline}</div>
                  {n.summary && (
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{n.summary}</p>
                  )}
                  <div className="text-xs text-muted-foreground mt-1.5 flex items-center gap-2">
                    {n.source && <span className="font-medium">{n.source}</span>}
                    {ts && <span>· {timeAgo(ts)}</span>}
                    {n.category && <span className="px-1.5 py-0.5 rounded bg-muted">{n.category}</span>}
                  </div>
                </div>
              </div>
            </a>
          </li>
        );
      })}
      </ul>
      )}
    </div>
  );
}

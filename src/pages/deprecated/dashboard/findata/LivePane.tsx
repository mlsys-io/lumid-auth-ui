import { useEffect, useRef, useState } from "react";

// SSE for /quotes/stream — EventSource native doesn't allow Authorization
// headers, so consume via fetch + ReadableStream + manual SSE parsing.

interface Tick {
  symbol: string;
  ts: string;
  price?: number;
  change_pct?: number;
  lag_ms?: number;
  source?: string;
  [k: string]: unknown;
}

const SUGGESTED = ["AAPL", "NVDA", "MSFT", "GOOGL", "AMZN", "META", "TSLA", "SPY"];

export default function LivePane({ initialSymbol }: { initialSymbol: string }) {
  const [symbols, setSymbols] = useState<string[]>([initialSymbol]);
  const [latest, setLatest] = useState<Record<string, Tick>>({});
  const [status, setStatus] = useState<"idle" | "connecting" | "open" | "closed" | "error">("idle");
  const [err, setErr] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    // Reset on symbol set change
    abortRef.current?.abort();
    abortRef.current = null;
    setStatus("idle");
  }, [symbols]);

  async function connect() {
    if (!symbols.length) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setStatus("connecting"); setErr("");

    try {
      const t = await fetch("/api/v1/session-bearer").then((r) => r.json());
      const token = (t.data?.token ?? t.token) as string;

      const url = `/findata-cloud/quotes/stream?symbols=${symbols.join(",")}`;
      const r = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: ac.signal,
      });
      if (!r.ok || !r.body) throw new Error(`stream ${r.status}`);
      setStatus("open");

      const reader = r.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      let event = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) { setStatus("closed"); break; }
        buffer += value;
        let idx;
        while ((idx = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 1);
          if (!line) continue;
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:") && event === "tick") {
            try {
              const tick = JSON.parse(line.slice(5).trim()) as Tick;
              if (tick.symbol) {
                setLatest((prev) => ({ ...prev, [tick.symbol]: tick }));
              }
            } catch { /* skip malformed */ }
          }
        }
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") setStatus("closed");
      else { setStatus("error"); setErr(String(e)); }
    }
  }

  function disconnect() {
    abortRef.current?.abort();
    abortRef.current = null;
    setStatus("closed");
  }

  useEffect(() => () => abortRef.current?.abort(), []);

  const dot = {
    idle:       "bg-muted-foreground",
    connecting: "bg-amber-500 animate-pulse",
    open:       "bg-green-500 animate-pulse",
    closed:     "bg-muted-foreground",
    error:      "bg-red-500",
  }[status];

  return (
    <div className="flex flex-col gap-4">
      {/* Controls */}
      <div className="rounded border border-border p-3 bg-card flex flex-wrap items-center gap-2 text-xs">
        <span className={`w-2 h-2 rounded-full ${dot}`} />
        <span className="font-medium">{status.toUpperCase()}</span>
        {err && <span className="text-destructive ml-2">{err}</span>}
        <span className="mx-2 h-4 w-px bg-border" />
        <span>Subscribed:</span>
        {symbols.map((s) => (
          <button
            key={s}
            onClick={() => setSymbols(symbols.filter((x) => x !== s))}
            className="px-2 py-0.5 rounded bg-primary/15 text-primary font-mono hover:bg-primary/25"
            title="Click to remove"
          >
            {s} ×
          </button>
        ))}
        <span className="mx-2 h-4 w-px bg-border" />
        <span>Suggest:</span>
        {SUGGESTED.filter((s) => !symbols.includes(s)).slice(0, 5).map((s) => (
          <button
            key={s}
            onClick={() => setSymbols([...symbols, s])}
            className="px-2 py-0.5 rounded bg-muted text-muted-foreground hover:bg-accent font-mono"
          >
            + {s}
          </button>
        ))}
        <span className="ml-auto" />
        {status === "open" || status === "connecting" ? (
          <button onClick={disconnect} className="px-3 py-1 rounded bg-destructive text-destructive-foreground font-medium">
            Disconnect
          </button>
        ) : (
          <button onClick={connect} className="px-3 py-1 rounded bg-primary text-primary-foreground font-medium">
            Connect stream
          </button>
        )}
      </div>

      {/* Tick grid */}
      {Object.values(latest).length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {status === "open" ? "Connected. Waiting for ticks…" : "Click Connect to start streaming."}
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {Object.values(latest).map((t) => (
            <div key={t.symbol} className="rounded border border-border p-3 bg-card">
              <div className="flex items-center justify-between">
                <span className="font-mono font-semibold">{t.symbol}</span>
                {typeof t.lag_ms === "number" && (
                  <span className="text-[10px] text-muted-foreground">{t.lag_ms}ms lag</span>
                )}
              </div>
              <div className="text-2xl font-bold font-mono mt-1">
                {typeof t.price === "number" ? `$${t.price.toFixed(2)}` : "—"}
              </div>
              {typeof t.change_pct === "number" && (
                <div className={`text-sm font-mono mt-1 ${t.change_pct > 0 ? "text-green-600 dark:text-green-400" : t.change_pct < 0 ? "text-red-600 dark:text-red-400" : ""}`}>
                  {t.change_pct > 0 ? "+" : ""}{(t.change_pct * 100).toFixed(2)}%
                </div>
              )}
              <div className="text-[10px] text-muted-foreground mt-1">
                {t.ts?.slice(11, 19)} {t.source && `· ${t.source}`}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

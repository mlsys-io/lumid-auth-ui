import { useEffect, useState } from "react";
import { findata, type TranscriptRef, type TranscriptDetail } from "@/api/findata";

export default function TranscriptsPane({ symbol }: { symbol: string }) {
  const [items, setItems] = useState<TranscriptRef[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [selected, setSelected] = useState<{ year: number; quarter: number } | null>(null);
  const [detail, setDetail] = useState<TranscriptDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    if (!symbol) return;
    setLoading(true); setErr(""); setDetail(null); setSelected(null);
    findata.transcripts(symbol, 20)
      .then(setItems)
      .catch((e) => setErr(String(e)))
      .finally(() => setLoading(false));
  }, [symbol]);

  useEffect(() => {
    if (!symbol || !selected) return;
    setDetailLoading(true);
    findata.transcript(symbol, selected.year, selected.quarter)
      .then(setDetail)
      .catch(() => setDetail(null))
      .finally(() => setDetailLoading(false));
  }, [symbol, selected]);

  if (loading) return <p className="text-sm text-muted-foreground animate-pulse">Loading…</p>;
  if (err) return <p className="text-sm text-destructive">{err}</p>;
  if (!items.length) return <p className="text-sm text-muted-foreground">No earnings-call transcripts.</p>;

  const body = (detail?.transcript as string) || (detail?.body as string) || (detail?.transcript_excerpt as string) || "";

  return (
    <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-3 h-[70vh]">
      {/* List */}
      <div className="overflow-y-auto rounded border border-border">
        <ul>
          {items.map((t) => {
            const isSel = selected?.year === t.fiscal_year && selected?.quarter === t.quarter;
            return (
              <li
                key={`${t.fiscal_year}_${t.quarter}`}
                onClick={() => setSelected({ year: t.fiscal_year, quarter: t.quarter })}
                className={`px-3 py-2 cursor-pointer text-sm border-b border-border/40 ${isSel ? "bg-accent" : "hover:bg-accent/50"}`}
              >
                <div className="font-medium">FY{t.fiscal_year} Q{t.quarter}</div>
                <div className="text-xs text-muted-foreground">{t.call_date}</div>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Detail */}
      <div className="overflow-y-auto rounded border border-border p-4 bg-card">
        {!selected && (
          <div className="text-sm text-muted-foreground">
            Select a call from the list to view the transcript.
          </div>
        )}
        {selected && detailLoading && <p className="text-sm text-muted-foreground animate-pulse">Loading transcript…</p>}
        {selected && !detailLoading && (
          <>
            <h3 className="text-sm font-semibold mb-3">
              {symbol} · FY{selected.year} Q{selected.quarter} earnings call
            </h3>
            {body ? (
              <pre className="text-xs whitespace-pre-wrap font-sans leading-relaxed">{body}</pre>
            ) : (
              <p className="text-sm text-muted-foreground">No transcript body returned by the server.</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import { findata, fmtNumber } from "@/api/findata";

type Sub = "acquisitions" | "mergers" | "splits" | "changes";

export default function ActivityPane({ symbol }: { symbol: string }) {
  const [sub, setSub] = useState<Sub>("acquisitions");
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true); setErr(""); setRows([]);
    const p = sub === "acquisitions" ? findata.acquisitions(symbol)
            : sub === "mergers"      ? findata.mergersGlobal(60)
            : sub === "splits"       ? findata.splits(symbol, 20)
            :                          findata.symbolChanges(60);
    p.then((d) => setRows((d as Record<string, unknown>[]) ?? []))
     .catch((e) => setErr(String(e)))
     .finally(() => setLoading(false));
  }, [symbol, sub]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 text-xs">
        {([
          ["acquisitions", "Acquisitions"],
          ["mergers",      "M&A (global)"],
          ["splits",       "Splits"],
          ["changes",      "Symbol changes"],
        ] as [Sub, string][]).map(([id, label]) => (
          <button key={id} onClick={() => setSub(id)}
            className={`px-2 py-1 rounded ${sub === id ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-accent"}`}>
            {label}
          </button>
        ))}
      </div>
      {loading && <p className="text-sm text-muted-foreground animate-pulse">Loading…</p>}
      {err && <p className="text-sm text-destructive">{err}</p>}
      {!loading && !err && rows.length === 0 && <p className="text-sm text-muted-foreground">No data for this view.</p>}
      {!loading && rows.length > 0 && (
        <div className="overflow-x-auto rounded border border-border">
          <table className="w-full text-xs border-collapse">
            <thead className="bg-muted/50">
              <tr>{Object.keys(rows[0]).map((c) => <th key={c} className="text-left px-2 py-1 text-muted-foreground font-medium">{c}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-border/40 hover:bg-accent/40">
                  {Object.entries(r).map(([k, v]) => (
                    <td key={k} className="px-2 py-1 font-mono">
                      {typeof v === "number" ? fmtNumber(v, { abbreviate: true, decimals: 2 }) : String(v ?? "—")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

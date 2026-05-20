import { useEffect, useMemo, useState } from "react";
import { findata, type Filing } from "@/api/findata";

const FORM_DESCRIPTIONS: Record<string, string> = {
  "10-K":   "Annual report",
  "10-Q":   "Quarterly report",
  "8-K":    "Material event",
  "4":      "Insider transaction",
  "13F-HR": "Institutional holdings",
  "DEF 14A": "Proxy statement",
  "S-1":    "Registration statement",
  "424B":   "Prospectus",
  "SC 13G": "Beneficial ownership",
  "SC 13D": "Activist stake",
};

export default function FilingsPane({ symbol }: { symbol: string }) {
  const [items, setItems] = useState<Filing[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [filter, setFilter] = useState<string>("all");

  useEffect(() => {
    if (!symbol) return;
    setLoading(true); setErr("");
    findata.filings(symbol, 100)
      .then(setItems)
      .catch((e) => setErr(String(e)))
      .finally(() => setLoading(false));
  }, [symbol]);

  const forms = useMemo(() => {
    const c: Record<string, number> = {};
    for (const f of items) c[f.form] = (c[f.form] ?? 0) + 1;
    return Object.entries(c).sort((a, b) => b[1] - a[1]);
  }, [items]);

  const filtered = useMemo(
    () => (filter === "all" ? items : items.filter((f) => f.form === filter)),
    [items, filter],
  );

  if (loading) return <p className="text-sm text-muted-foreground animate-pulse">Loading…</p>;
  if (err) return <p className="text-sm text-destructive">{err}</p>;
  if (!items.length) return <p className="text-sm text-muted-foreground">No filings.</p>;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-1 text-xs">
        <button
          onClick={() => setFilter("all")}
          className={`px-2 py-1 rounded ${filter === "all" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-accent"}`}
        >
          All ({items.length})
        </button>
        {forms.slice(0, 8).map(([form, count]) => (
          <button
            key={form}
            onClick={() => setFilter(form)}
            className={`px-2 py-1 rounded ${filter === form ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-accent"}`}
            title={FORM_DESCRIPTIONS[form]}
          >
            {form} ({count})
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded border border-border">
        <table className="w-full text-xs border-collapse">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left px-2 py-1 text-muted-foreground font-medium">Form</th>
              <th className="text-left px-2 py-1 text-muted-foreground font-medium">Filed</th>
              <th className="text-left px-2 py-1 text-muted-foreground font-medium">Description</th>
              <th className="text-left px-2 py-1 text-muted-foreground font-medium">Links</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((f) => (
              <tr key={f.accession_no} className="border-t border-border/40 hover:bg-accent/40">
                <td className="px-2 py-1 font-mono font-medium">{f.form}</td>
                <td className="px-2 py-1 font-mono">{f.filed_date.slice(0, 10)}</td>
                <td className="px-2 py-1 text-muted-foreground">{FORM_DESCRIPTIONS[f.form] ?? "—"}</td>
                <td className="px-2 py-1 space-x-2">
                  <a className="text-primary hover:underline" href={f.report_url} target="_blank" rel="noopener noreferrer">Report</a>
                  <a className="text-primary hover:underline" href={f.filing_url} target="_blank" rel="noopener noreferrer">Index</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

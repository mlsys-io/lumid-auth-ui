import { useEffect, useMemo, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { findata, fmtNumber, type Patent } from "@/api/findata";
import { SubTabs } from "./ValuationPane";

type Sub = "lobbying" | "spending" | "trades" | "patents" | "visas";

const SUBS: { id: Sub; label: string }[] = [
  { id: "lobbying", label: "Lobbying"      },
  { id: "spending", label: "USA spending"  },
  { id: "trades",   label: "Gov trades"    },
  { id: "patents",  label: "USPTO patents" },
  { id: "visas",    label: "Visa apps"     },
];

export default function GovernmentPane({ symbol }: { symbol: string }) {
  const [sub, setSub] = useState<Sub>("lobbying");
  const [rows, setRows] = useState<Record<string, unknown>[] | Patent[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!symbol) return;
    setLoading(true); setErr(""); setRows([]);
    const p = sub === "lobbying" ? findata.lobbying(symbol)
            : sub === "spending" ? findata.usaSpending(symbol)
            : sub === "trades"   ? findata.govTrades(symbol)
            : sub === "patents"  ? findata.patents(symbol, 50)
            :                      findata.visas(symbol);
    p.then((d) => setRows((d as Record<string, unknown>[]) ?? []))
     .catch((e) => setErr(String(e)))
     .finally(() => setLoading(false));
  }, [symbol, sub]);

  return (
    <div className="flex flex-col gap-3">
      <SubTabs subs={SUBS} active={sub} onChange={setSub} />
      {loading && <p className="text-sm text-muted-foreground animate-pulse">Loading…</p>}
      {err && <p className="text-sm text-destructive">{err}</p>}
      {!loading && !err && rows.length === 0 && <p className="text-sm text-muted-foreground">No data for this view.</p>}
      {!loading && rows.length > 0 && (
        sub === "patents" ? <PatentsTable rows={rows as Patent[]} /> : <DynamicTable rows={rows as Record<string, unknown>[]} />
      )}
    </div>
  );
}

function PatentsTable({ rows }: { rows: Patent[] }) {
  const byYear = useMemo(() => {
    const by: Record<string, { year: string; filed: number; granted: number }> = {};
    for (const p of rows) {
      const fy = p.filing_date?.slice(0, 4);
      const gy = p.granted_date?.slice(0, 4);
      if (fy) (by[fy] ??= { year: fy, filed: 0, granted: 0 }).filed += 1;
      if (gy) (by[gy] ??= { year: gy, filed: 0, granted: 0 }).granted += 1;
    }
    return Object.values(by).sort((a, b) => a.year.localeCompare(b.year));
  }, [rows]);
  return (
    <div className="flex flex-col gap-3">
      <div className="rounded border border-border p-3 bg-card">
        <div className="text-xs text-muted-foreground mb-2">Patents per year ({rows.length} total)</div>
        <div className="h-48">
          <ResponsiveContainer>
            <BarChart data={byYear} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis dataKey="year" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip contentStyle={{ fontSize: 11, padding: 4 }} />
              <Bar dataKey="filed"   fill="#6366f1" />
              <Bar dataKey="granted" fill="#10b981" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    <div className="overflow-x-auto rounded border border-border">
      <table className="w-full text-xs border-collapse">
        <thead className="bg-muted/50">
          <tr>
            <th className="text-left px-2 py-1 text-muted-foreground font-medium">Filed</th>
            <th className="text-left px-2 py-1 text-muted-foreground font-medium">Granted</th>
            <th className="text-left px-2 py-1 text-muted-foreground font-medium">Patent</th>
            <th className="text-left px-2 py-1 text-muted-foreground font-medium">Title</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p, i) => (
            <tr key={i} className="border-t border-border/40 hover:bg-accent/40">
              <td className="px-2 py-1 font-mono">{p.filing_date}</td>
              <td className="px-2 py-1 font-mono">{p.granted_date ?? "—"}</td>
              <td className="px-2 py-1 font-mono">{p.patent_id}</td>
              <td className="px-2 py-1">{p.title}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </div>
  );
}

function DynamicTable({ rows }: { rows: Record<string, unknown>[] }) {
  const cols = Object.keys(rows[0]);
  return (
    <div className="overflow-x-auto rounded border border-border">
      <table className="w-full text-xs border-collapse">
        <thead className="bg-muted/50">
          <tr>{cols.map((c) => <th key={c} className="text-left px-2 py-1 text-muted-foreground font-medium">{c}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-border/40 hover:bg-accent/40">
              {cols.map((c) => (
                <td key={c} className="px-2 py-1 font-mono">
                  {typeof r[c] === "number" ? fmtNumber(r[c] as number, { abbreviate: true, decimals: 2 }) : String(r[c] ?? "—")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

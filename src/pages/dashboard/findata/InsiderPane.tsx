import { useEffect, useMemo, useState } from "react";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine } from "recharts";
import { findata, fmtNumber, type InsiderTx } from "@/api/findata";
import { SubTabs } from "./ValuationPane";

type Sub = "tx" | "chart" | "sentiment" | "stats";

const TX_TYPE_LABEL: Record<string, string> = {
  "P": "Purchase", "S": "Sale", "A": "Award", "M": "Option exercise",
  "F": "Tax withheld", "G": "Gift", "D": "Disposed", "J": "Other",
};

const SUBS: { id: Sub; label: string }[] = [
  { id: "tx", label: "Transactions" },
  { id: "chart", label: "Net buying" },
  { id: "sentiment", label: "Sentiment" },
  { id: "stats", label: "Statistics" },
];

export default function InsiderPane({ symbol }: { symbol: string }) {
  const [sub, setSub] = useState<Sub>("chart");
  const [tx, setTx] = useState<InsiderTx[]>([]);
  const [sentiment, setSentiment] = useState<unknown[]>([]);
  const [stats, setStats] = useState<unknown>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!symbol) return;
    setLoading(true); setErr("");
    const load = (sub === "tx" || sub === "chart")
      ? findata.insiderTransactions(symbol, 200).then(setTx)
      : sub === "sentiment"
        ? findata.insiderSentiment(symbol).then(setSentiment)
        : findata.insiderStatistics(symbol).then(setStats);
    load.catch((e) => setErr(String(e))).finally(() => setLoading(false));
  }, [symbol, sub]);

  const chartData = useMemo(() => {
    if (!tx.length) return [];
    // Group by month, sum signed value
    const byMonth: Record<string, { month: string; net: number; buys: number; sales: number }> = {};
    for (const t of tx) {
      const month = String(t.date).slice(0, 7);
      const r = byMonth[month] ?? (byMonth[month] = { month, net: 0, buys: 0, sales: 0 });
      r.net += t.value;
      if (t.value > 0) r.buys += t.value;
      if (t.value < 0) r.sales += t.value;
    }
    const months = Object.values(byMonth).sort((a, b) => a.month.localeCompare(b.month));
    // Cumulative
    let cum = 0;
    return months.map((m) => { cum += m.net; return { ...m, cumulative: cum }; });
  }, [tx]);

  return (
    <div className="flex flex-col gap-3">
      <SubTabs subs={SUBS} active={sub} onChange={setSub} />

      {loading && <p className="text-sm text-muted-foreground animate-pulse">Loading…</p>}
      {err && <p className="text-sm text-destructive">{err}</p>}

      {sub === "chart" && !loading && !err && (
        chartData.length === 0 ? (
          <p className="text-sm text-muted-foreground">No insider transactions.</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded border border-border p-3 bg-card">
              <div className="text-xs text-muted-foreground mb-2">Monthly buys vs sales ($)</div>
              <div className="h-56">
                <ResponsiveContainer>
                  <BarChart data={chartData} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                    <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => fmtNumber(v, { abbreviate: true, decimals: 0 })} />
                    <Tooltip contentStyle={{ fontSize: 11, padding: 4 }} formatter={(v: number) => `$${fmtNumber(v, { abbreviate: true, decimals: 1 })}`} />
                    <ReferenceLine y={0} stroke="#64748b" />
                    <Bar dataKey="buys"  stackId="a" fill="#10b981" />
                    <Bar dataKey="sales" stackId="a" fill="#ef4444" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="rounded border border-border p-3 bg-card">
              <div className="text-xs text-muted-foreground mb-2">Cumulative net buying ($)</div>
              <div className="h-56">
                <ResponsiveContainer>
                  <LineChart data={chartData} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                    <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => fmtNumber(v, { abbreviate: true, decimals: 0 })} />
                    <Tooltip contentStyle={{ fontSize: 11, padding: 4 }} formatter={(v: number) => `$${fmtNumber(v, { abbreviate: true, decimals: 1 })}`} />
                    <ReferenceLine y={0} stroke="#64748b" />
                    <Line dataKey="cumulative" stroke="#6366f1" dot={false} strokeWidth={1.8} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )
      )}

      {sub === "tx" && !loading && (
        tx.length === 0 ? (
          <p className="text-sm text-muted-foreground">No insider transactions.</p>
        ) : (
          <div className="overflow-x-auto rounded border border-border">
            <table className="w-full text-xs border-collapse">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-2 py-1 text-muted-foreground font-medium">Date</th>
                  <th className="text-left px-2 py-1 text-muted-foreground font-medium">Insider</th>
                  <th className="text-left px-2 py-1 text-muted-foreground font-medium">Type</th>
                  <th className="text-right px-2 py-1 text-muted-foreground font-medium">Shares</th>
                  <th className="text-right px-2 py-1 text-muted-foreground font-medium">Price</th>
                  <th className="text-right px-2 py-1 text-muted-foreground font-medium">Value</th>
                </tr>
              </thead>
              <tbody>
                {tx.slice(0, 200).map((t, i) => (
                  <tr key={i} className="border-t border-border/40 hover:bg-accent/40">
                    <td className="px-2 py-1 font-mono">{t.date}</td>
                    <td className="px-2 py-1">
                      <div>{t.insider_name}</div>
                      {t.insider_title && <div className="text-muted-foreground text-[10px]">{t.insider_title}</div>}
                    </td>
                    <td className="px-2 py-1">
                      <span className="font-mono">{t.transaction_type}</span>
                      <span className="text-muted-foreground text-[10px] ml-1">{TX_TYPE_LABEL[t.transaction_type] ?? ""}</span>
                    </td>
                    <td className={`px-2 py-1 font-mono text-right ${t.shares < 0 ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}`}>
                      {fmtNumber(t.shares, { decimals: 0 })}
                    </td>
                    <td className="px-2 py-1 font-mono text-right">${fmtNumber(t.price, { decimals: 2 })}</td>
                    <td className="px-2 py-1 font-mono text-right">${fmtNumber(t.value, { abbreviate: true, decimals: 1 })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {sub === "sentiment" && !loading && (
        <DynamicTable rows={sentiment as Record<string, unknown>[]} empty="No sentiment data." />
      )}

      {sub === "stats" && !loading && (
        stats == null ? (
          <p className="text-sm text-muted-foreground">No statistics.</p>
        ) : Array.isArray(stats) ? (
          <DynamicTable rows={stats as Record<string, unknown>[]} empty="" />
        ) : (
          <KVList data={stats as Record<string, unknown>} />
        )
      )}
    </div>
  );
}

function DynamicTable({ rows, empty }: { rows: Record<string, unknown>[]; empty: string }) {
  if (!rows.length) return <p className="text-sm text-muted-foreground">{empty || "Empty."}</p>;
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
                <td key={c} className="px-2 py-1 font-mono">{r[c] == null ? "—" : String(r[c])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function KVList({ data }: { data: Record<string, unknown> }) {
  return (
    <dl className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1 text-xs">
      {Object.entries(data).map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="font-mono">{v == null ? "—" : String(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

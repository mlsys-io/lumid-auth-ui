import { useEffect, useMemo, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell, LineChart, Line, Legend,
} from "recharts";
import { findata, fmtNumber, type Fundamentals, type FundamentalsHistRow } from "@/api/findata";

type Statement = "income" | "balance" | "cashflow";
type Period = "quarter" | "fy";

const STATEMENTS: { id: Statement; label: string }[] = [
  { id: "income",   label: "Income"   },
  { id: "balance",  label: "Balance"  },
  { id: "cashflow", label: "Cashflow" },
];

const PERIODS: { id: Period; label: string }[] = [
  { id: "quarter", label: "Quarterly" },
  { id: "fy",      label: "Annual"    },
];

// Which numeric columns to chart per statement (the ones with the most signal)
const CHART_KEYS: Record<Statement, string[]> = {
  income:   ["revenue", "gross_profit", "operating_income", "ebitda", "net_income"],
  balance:  ["total_assets", "total_liabilities", "total_equity", "cash", "long_term_debt"],
  cashflow: ["operating_cash_flow", "investing_cash_flow", "financing_cash_flow", "free_cash_flow"],
};

const COLOURS = ["#6366f1", "#10b981", "#f59e0b", "#06b6d4", "#ec4899", "#8b5cf6"];

export default function FundamentalsPane({ symbol }: { symbol: string }) {
  const [latest, setLatest] = useState<Fundamentals | null>(null);
  const [statement, setStatement] = useState<Statement>("income");
  const [period, setPeriod] = useState<Period>("quarter");
  const [history, setHistory] = useState<FundamentalsHistRow[]>([]);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!symbol) return;
    setLoading(true); setErr("");
    Promise.all([
      findata.fundamentals(symbol).catch(() => null),
      findata.fundamentalsHistory(symbol, statement, period, 16).catch(() => []),
    ])
      .then(([f, h]) => { setLatest(f); setHistory((h as FundamentalsHistRow[]).slice().reverse()); })
      .catch((e) => setErr(String(e)))
      .finally(() => setLoading(false));
  }, [symbol, statement, period]);

  const chartKeys = useMemo(() => {
    if (!history.length) return [] as string[];
    const sample = history[0];
    const candidates = CHART_KEYS[statement];
    return candidates.filter((k) => typeof sample[k] === "number");
  }, [history, statement]);

  const yoy = useMemo(() => {
    if (history.length < 5) return [];
    const lag = period === "quarter" ? 4 : 1;
    return history.map((r, i) => {
      const prev = history[i - lag];
      const out: Record<string, number | string | null> = { period: String(r.period_end_date).slice(0, 7) };
      for (const k of chartKeys) {
        const cur = r[k] as number | null | undefined;
        const past = prev ? prev[k] as number | null | undefined : null;
        out[k] = cur != null && past != null && past !== 0 ? cur / past - 1 : null;
      }
      return out;
    }).slice(lag);
  }, [history, chartKeys, period]);

  if (loading) return <p className="text-sm text-muted-foreground animate-pulse">Loading…</p>;
  if (err) return <p className="text-sm text-destructive">{err}</p>;

  return (
    <div className="flex flex-col gap-4">
      {latest && (
        <div className="rounded border border-border p-3 bg-card">
          <h3 className="text-sm font-semibold mb-2 text-foreground">Latest snapshot</h3>
          <dl className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1 text-xs">
            {Object.entries(latest).slice(0, 24).map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted-foreground truncate">{k}</dt>
                <dd className="font-mono truncate">
                  {typeof v === "number" ? fmtNumber(v, { abbreviate: true, decimals: 2 }) : String(v ?? "—")}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-xs">
          {STATEMENTS.map((s) => (
            <button key={s.id} onClick={() => setStatement(s.id)}
              className={`px-2 py-1 rounded ${statement === s.id ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-accent"}`}>
              {s.label}
            </button>
          ))}
          <span className="mx-2 h-4 w-px bg-border" />
          {PERIODS.map((p) => (
            <button key={p.id} onClick={() => setPeriod(p.id)}
              className={`px-2 py-1 rounded ${period === p.id ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-accent"}`}>
              {p.label}
            </button>
          ))}
        </div>

        {history.length === 0 ? (
          <p className="text-sm text-muted-foreground">No history.</p>
        ) : (
          <>
            {chartKeys.length > 0 && (
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded border border-border p-3 bg-card">
                  <div className="text-xs text-muted-foreground mb-2">Absolute ({chartKeys.join(" · ")})</div>
                  <div className="h-56">
                    <ResponsiveContainer>
                      <BarChart data={history.map((r) => ({ period: String(r.period_end_date).slice(0, 7), ...Object.fromEntries(chartKeys.map((k) => [k, r[k] ?? 0])) }))} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                        <XAxis dataKey="period" tick={{ fontSize: 10 }} />
                        <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => fmtNumber(v, { abbreviate: true, decimals: 0 })} />
                        <Tooltip
                          labelStyle={{ fontSize: 11 }}
                          contentStyle={{ fontSize: 11, padding: 4 }}
                          formatter={(v: number) => fmtNumber(v, { abbreviate: true, decimals: 2 })}
                        />
                        <Legend wrapperStyle={{ fontSize: 10 }} />
                        {chartKeys.map((k, i) => (
                          <Bar key={k} dataKey={k} fill={COLOURS[i % COLOURS.length]} />
                        ))}
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
                {yoy.length > 0 && (
                  <div className="rounded border border-border p-3 bg-card">
                    <div className="text-xs text-muted-foreground mb-2">{period === "quarter" ? "YoY %" : "YoY % (annual)"}</div>
                    <div className="h-56">
                      <ResponsiveContainer>
                        <LineChart data={yoy} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                          <XAxis dataKey="period" tick={{ fontSize: 10 }} />
                          <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${(v * 100).toFixed(0)}%`} />
                          <Tooltip
                            labelStyle={{ fontSize: 11 }}
                            contentStyle={{ fontSize: 11, padding: 4 }}
                            formatter={(v: number) => v == null ? "—" : `${(v * 100).toFixed(1)}%`}
                          />
                          <Legend wrapperStyle={{ fontSize: 10 }} />
                          {chartKeys.map((k, i) => (
                            <Line key={k} dataKey={k} stroke={COLOURS[i % COLOURS.length]} dot={false} strokeWidth={1.5} connectNulls />
                          ))}
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}
              </div>
            )}

            <details className="rounded border border-border bg-card">
              <summary className="px-3 py-2 text-xs cursor-pointer text-muted-foreground">Raw data table</summary>
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead className="bg-muted/50">
                    <tr>
                      {Object.keys(history[0]).map((c) => (
                        <th key={c} className="text-left px-2 py-1 text-muted-foreground font-medium">{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {history.slice().reverse().map((row, i) => (
                      <tr key={i} className="border-t border-border/40 hover:bg-accent/40">
                        {Object.keys(history[0]).map((c) => (
                          <td key={c} className="px-2 py-1 font-mono">
                            {typeof row[c] === "number"
                              ? fmtNumber(row[c] as number, { abbreviate: true, decimals: 2 })
                              : String(row[c] ?? "—")}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </>
        )}
      </div>
    </div>
  );
}

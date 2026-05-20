import { useEffect, useMemo, useState } from "react";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from "recharts";
import { findata, fmtNumber, type IpoRow } from "@/api/findata";
import { SubTabs } from "./ValuationPane";

const TREASURY_TENORS = ["1m", "2m", "3m", "6m", "1y", "2y", "3y", "5y", "7y", "10y", "20y", "30y"];

type Sub = "indicators" | "calendar" | "treasury" | "cot" | "ipos" | "mergers" | "fda" | "symbols";

const SUBS: { id: Sub; label: string }[] = [
  { id: "indicators", label: "Indicators"       },
  { id: "calendar",   label: "Econ calendar"    },
  { id: "treasury",   label: "Treasury rates"   },
  { id: "cot",        label: "COT"              },
  { id: "ipos",       label: "IPOs"             },
  { id: "mergers",    label: "M&A (global)"     },
  { id: "fda",        label: "FDA calendar"     },
  { id: "symbols",    label: "Symbol changes"   },
];

export default function MacroPane({ symbol }: { symbol: string }) {
  const [sub, setSub] = useState<Sub>("indicators");
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    setLoading(true); setErr(""); setRows([]);
    const p = sub === "indicators" ? findata.macroIndicators()
            : sub === "calendar"   ? findata.macroCalendar(80)
            : sub === "treasury"   ? findata.macroTreasury(60)
            : sub === "cot"        ? findata.cot(symbol)
            : sub === "ipos"       ? findata.ipos(60)
            : sub === "mergers"    ? findata.mergersGlobal(60)
            : sub === "fda"        ? findata.fdaCalendar(60)
            :                        findata.symbolChanges(60);
    p.then((d) => setRows((d as Record<string, unknown>[]) ?? []))
     .catch((e) => setErr(String(e)))
     .finally(() => setLoading(false));
  }, [sub, symbol]);

  return (
    <div className="flex flex-col gap-3">
      <SubTabs subs={SUBS} active={sub} onChange={setSub} />
      {sub === "cot" && (
        <div className="text-xs text-muted-foreground italic">COT data is per-symbol — currently showing {symbol}.</div>
      )}
      {loading && <p className="text-sm text-muted-foreground animate-pulse">Loading…</p>}
      {err && <p className="text-sm text-destructive">{err}</p>}
      {!loading && !err && rows.length === 0 && <p className="text-sm text-muted-foreground">No data for this view.</p>}
      {!loading && rows.length > 0 && (
        sub === "ipos"     ? <IpoTable rows={rows as unknown as IpoRow[]} />
        : sub === "treasury" ? <TreasuryView rows={rows} />
        : sub === "calendar" ? <CalendarView rows={rows} />
        :                      <DynamicTable rows={rows} />
      )}
    </div>
  );
}

function TreasuryView({ rows }: { rows: Record<string, unknown>[] }) {
  // Server columns: m1/m2/m3/m6/y1/y2/y3/y5/y7/y10/y20/y30 etc.
  const TENOR_ORDER = ["m1","m2","m3","m6","y1","y2","y3","y5","y7","y10","y20","y30"];
  const TENOR_LABEL: Record<string, string> = { m1:"1M", m2:"2M", m3:"3M", m6:"6M", y1:"1Y", y2:"2Y", y3:"3Y", y5:"5Y", y7:"7Y", y10:"10Y", y20:"20Y", y30:"30Y" };
  const present = TENOR_ORDER.filter((t) => typeof rows[0][t] === "number");
  const latest = rows[0];
  const curve = present.map((t) => ({ tenor: TENOR_LABEL[t] ?? t, yield: latest[t] as number }));
  const spread = (a: string, b: string) =>
    rows.map((r) => ({
      date: (r.date as string ?? "").slice(0, 7),
      spread: typeof r[a] === "number" && typeof r[b] === "number" ? (r[a] as number) - (r[b] as number) : null,
    }));
  const ts = rows.slice().reverse().map((r) => ({
    date: (r.date as string ?? "").slice(0, 10),
    "10Y": r["y10"], "2Y": r["y2"], "3M": r["m3"],
  }));

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <div className="rounded border border-border p-3 bg-card">
        <div className="text-xs text-muted-foreground mb-2">Yield curve · {latest.date as string ?? ""}</div>
        <div className="h-56">
          <ResponsiveContainer>
            <LineChart data={curve} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis dataKey="tenor" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${v.toFixed(2)}%`} domain={["auto", "auto"]} />
              <Tooltip contentStyle={{ fontSize: 11, padding: 4 }} formatter={(v: number) => `${v.toFixed(3)}%`} />
              <Line dataKey="yield" stroke="#6366f1" dot={{ r: 3 }} strokeWidth={1.8} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="rounded border border-border p-3 bg-card">
        <div className="text-xs text-muted-foreground mb-2">10Y / 2Y / 3M over time</div>
        <div className="h-56">
          <ResponsiveContainer>
            <LineChart data={ts} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={40} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${v.toFixed(1)}%`} />
              <Tooltip contentStyle={{ fontSize: 11, padding: 4 }} formatter={(v: number) => v == null ? "—" : `${v.toFixed(3)}%`} />
              <Legend wrapperStyle={{ fontSize: 9 }} />
              <Line dataKey="10Y" stroke="#6366f1" dot={false} strokeWidth={1.4} />
              <Line dataKey="2Y"  stroke="#f59e0b" dot={false} strokeWidth={1.4} />
              <Line dataKey="3M"  stroke="#10b981" dot={false} strokeWidth={1.4} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="rounded border border-border p-3 bg-card md:col-span-2">
        <div className="text-xs text-muted-foreground mb-2">10Y – 2Y spread (recession indicator if inverted)</div>
        <div className="h-40">
          <ResponsiveContainer>
            <LineChart data={spread("y10", "y2").slice().reverse()} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={40} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${(v * 100).toFixed(0)}bps`} />
              <Tooltip contentStyle={{ fontSize: 11, padding: 4 }} formatter={(v: number) => v == null ? "—" : `${(v * 100).toFixed(1)} bps`} />
              <Line dataKey="spread" stroke="#ef4444" dot={false} strokeWidth={1.5} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

function CalendarView({ rows }: { rows: Record<string, unknown>[] }) {
  // Try to find date + impact + name columns
  const keys = Object.keys(rows[0]);
  const dateKey = keys.find((k) => /date|time/i.test(k)) ?? keys[0];
  return (
    <div className="overflow-x-auto rounded border border-border">
      <table className="w-full text-xs border-collapse">
        <thead className="bg-muted/50">
          <tr>{keys.map((c) => <th key={c} className="text-left px-2 py-1 text-muted-foreground font-medium">{c}</th>)}</tr>
        </thead>
        <tbody>
          {rows.slice(0, 100).map((r, i) => (
            <tr key={i} className="border-t border-border/40 hover:bg-accent/40">
              {keys.map((c) => (
                <td key={c} className={`px-2 py-1 ${c === dateKey ? "font-mono" : ""}`}>
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

function IpoTable({ rows }: { rows: IpoRow[] }) {
  const byMonth: Record<string, number> = {};
  let totalValue = 0;
  for (const r of rows) {
    const m = r.ipo_date.slice(0, 7);
    byMonth[m] = (byMonth[m] ?? 0) + 1;
    totalValue += r.total_shares_value ?? 0;
  }
  const monthly = Object.entries(byMonth).map(([month, count]) => ({ month, count })).sort((a, b) => a.month.localeCompare(b.month));

  return (
    <>
    <div className="grid gap-3 md:grid-cols-[1fr_3fr] mb-3">
      <div className="rounded border border-border p-3 bg-card flex flex-col justify-center text-xs">
        <div className="text-muted-foreground">{rows.length} IPOs upcoming</div>
        <div className="text-2xl font-bold font-mono mt-1">${fmtNumber(totalValue, { abbreviate: true, decimals: 1 })}</div>
        <div className="text-muted-foreground mt-1">total raise</div>
      </div>
      <div className="rounded border border-border p-3 bg-card">
        <div className="text-xs text-muted-foreground mb-2">IPOs per month</div>
        <div className="h-32">
          <ResponsiveContainer>
            <BarChart data={monthly} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis dataKey="month" tick={{ fontSize: 9 }} />
              <YAxis tick={{ fontSize: 9 }} />
              <Tooltip contentStyle={{ fontSize: 11, padding: 4 }} />
              <Bar dataKey="count" fill="#6366f1" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
    <div className="overflow-x-auto rounded border border-border">
      <table className="w-full text-xs border-collapse">
        <thead className="bg-muted/50">
          <tr>
            <th className="text-left px-2 py-1 text-muted-foreground font-medium">IPO date</th>
            <th className="text-left px-2 py-1 text-muted-foreground font-medium">Symbol</th>
            <th className="text-left px-2 py-1 text-muted-foreground font-medium">Name</th>
            <th className="text-left px-2 py-1 text-muted-foreground font-medium">Exchange</th>
            <th className="text-right px-2 py-1 text-muted-foreground font-medium">Shares</th>
            <th className="text-right px-2 py-1 text-muted-foreground font-medium">Price</th>
            <th className="text-right px-2 py-1 text-muted-foreground font-medium">Value</th>
            <th className="text-left px-2 py-1 text-muted-foreground font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-border/40 hover:bg-accent/40">
              <td className="px-2 py-1 font-mono">{r.ipo_date}</td>
              <td className="px-2 py-1 font-mono font-medium">{r.symbol}</td>
              <td className="px-2 py-1">{r.name}</td>
              <td className="px-2 py-1">{r.exchange}</td>
              <td className="px-2 py-1 font-mono text-right">{r.number_of_shares != null ? fmtNumber(r.number_of_shares, { abbreviate: true, decimals: 1 }) : "—"}</td>
              <td className="px-2 py-1 font-mono text-right">{r.price != null ? `$${fmtNumber(r.price, { decimals: 2 })}` : "—"}</td>
              <td className="px-2 py-1 font-mono text-right">{r.total_shares_value != null ? `$${fmtNumber(r.total_shares_value, { abbreviate: true, decimals: 1 })}` : "—"}</td>
              <td className="px-2 py-1">{r.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </>
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
                  {typeof r[c] === "number" ? fmtNumber(r[c] as number, { abbreviate: true, decimals: 3 }) : String(r[c] ?? "—")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

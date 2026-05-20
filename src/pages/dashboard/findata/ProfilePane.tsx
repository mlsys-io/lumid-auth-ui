import { useEffect, useState } from "react";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell } from "recharts";
import { findata, fmtNumber, type Executive, type SupplyChainItem, type GovernanceComp } from "@/api/findata";
import { SubTabs } from "./ValuationPane";

type Sub = "executives" | "employees" | "supply" | "compensation" | "shares";

const SUBS: { id: Sub; label: string }[] = [
  { id: "executives",   label: "Executives"    },
  { id: "employees",    label: "Employees"     },
  { id: "supply",       label: "Supply chain"  },
  { id: "compensation", label: "Compensation"  },
  { id: "shares",       label: "Shares float"  },
];

export default function ProfilePane({ symbol, onSelect }: { symbol: string; onSelect?: (s: string) => void }) {
  const [sub, setSub] = useState<Sub>("executives");
  return (
    <div className="flex flex-col gap-3">
      <SubTabs subs={SUBS} active={sub} onChange={setSub} />
      {sub === "executives"   && <ExecutivesView symbol={symbol} />}
      {sub === "employees"    && <EmployeesView symbol={symbol} />}
      {sub === "supply"       && <SupplyChainView symbol={symbol} onSelect={onSelect} />}
      {sub === "compensation" && <CompensationView symbol={symbol} />}
      {sub === "shares"       && <SharesFloatView symbol={symbol} />}
    </div>
  );
}

function ExecutivesView({ symbol }: { symbol: string }) {
  const [rows, setRows] = useState<Executive[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!symbol) return;
    setLoading(true);
    findata.executives(symbol).then(setRows).catch(() => setRows([])).finally(() => setLoading(false));
  }, [symbol]);
  if (loading) return <p className="text-sm text-muted-foreground animate-pulse">Loading…</p>;
  if (!rows.length) return <p className="text-sm text-muted-foreground">No executive data.</p>;
  return (
    <div className="overflow-x-auto rounded border border-border">
      <table className="w-full text-xs border-collapse">
        <thead className="bg-muted/50">
          <tr>
            <th className="text-left px-2 py-1 text-muted-foreground font-medium">Name</th>
            <th className="text-left px-2 py-1 text-muted-foreground font-medium">Title</th>
            <th className="text-left px-2 py-1 text-muted-foreground font-medium">Since</th>
            <th className="text-right px-2 py-1 text-muted-foreground font-medium">Age</th>
            <th className="text-right px-2 py-1 text-muted-foreground font-medium">Pay</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e, i) => (
            <tr key={i} className="border-t border-border/40 hover:bg-accent/40">
              <td className="px-2 py-1 font-medium">{e.name}</td>
              <td className="px-2 py-1 text-muted-foreground">{e.title}</td>
              <td className="px-2 py-1 font-mono">{e.since?.slice(0, 10) ?? "—"}</td>
              <td className="px-2 py-1 font-mono text-right">{e.age ?? "—"}</td>
              <td className="px-2 py-1 font-mono text-right">{e.pay != null ? `$${fmtNumber(e.pay, { abbreviate: true, decimals: 1 })}` : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EmployeesView({ symbol }: { symbol: string }) {
  const [rows, setRows] = useState<{ as_of: string; employee_count: number }[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!symbol) return;
    setLoading(true);
    findata.employeeCount(symbol).then((d) => {
      // De-dupe by as_of
      const seen = new Set<string>();
      const u = d.filter((r) => { if (seen.has(r.as_of)) return false; seen.add(r.as_of); return true; });
      setRows(u);
    }).catch(() => setRows([])).finally(() => setLoading(false));
  }, [symbol]);
  if (loading) return <p className="text-sm text-muted-foreground animate-pulse">Loading…</p>;
  if (!rows.length) return <p className="text-sm text-muted-foreground">No headcount data.</p>;
  const chart = rows.slice().reverse().map((r) => ({ date: r.as_of, count: r.employee_count }));
  return (
    <div className="flex flex-col gap-3">
      <div className="rounded border border-border p-3 bg-card">
        <div className="text-xs text-muted-foreground mb-2">Employee count over time</div>
        <div className="h-56">
          <ResponsiveContainer>
            <LineChart data={chart} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={30} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => fmtNumber(v, { decimals: 0 })} />
              <Tooltip contentStyle={{ fontSize: 11, padding: 4 }} formatter={(v: number) => fmtNumber(v, { decimals: 0 })} />
              <Line dataKey="count" stroke="#6366f1" dot={{ r: 3 }} strokeWidth={1.8} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    <div className="overflow-x-auto rounded border border-border">
      <table className="w-full text-xs border-collapse">
        <thead className="bg-muted/50">
          <tr>
            <th className="text-left px-2 py-1 text-muted-foreground font-medium">As of</th>
            <th className="text-right px-2 py-1 text-muted-foreground font-medium">Employees</th>
            <th className="text-right px-2 py-1 text-muted-foreground font-medium">YoY change</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const prev = rows[i + 1];
            const change = prev ? (r.employee_count / prev.employee_count - 1) : null;
            return (
              <tr key={i} className="border-t border-border/40 hover:bg-accent/40">
                <td className="px-2 py-1 font-mono">{r.as_of}</td>
                <td className="px-2 py-1 font-mono text-right">{fmtNumber(r.employee_count, { decimals: 0 })}</td>
                <td className={`px-2 py-1 font-mono text-right ${change != null ? (change > 0 ? "text-green-600 dark:text-green-400" : change < 0 ? "text-red-600 dark:text-red-400" : "") : ""}`}>
                  {change != null ? `${change > 0 ? "+" : ""}${(change * 100).toFixed(1)}%` : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
    </div>
  );
}

function SupplyChainView({ symbol, onSelect }: { symbol: string; onSelect?: (s: string) => void }) {
  const [rows, setRows] = useState<SupplyChainItem[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!symbol) return;
    setLoading(true);
    findata.supplyChain(symbol).then(setRows).catch(() => setRows([])).finally(() => setLoading(false));
  }, [symbol]);
  if (loading) return <p className="text-sm text-muted-foreground animate-pulse">Loading…</p>;
  if (!rows.length) return <p className="text-sm text-muted-foreground">No supply-chain data.</p>;
  const suppliers = rows.filter((r) => r.kind === "supplier");
  const customers = rows.filter((r) => r.kind === "customer");
  const SymBox = ({ s }: { s: SupplyChainItem }) => (
    <button
      onClick={() => onSelect?.(s.related_symbol)}
      className="px-2 py-1 rounded border border-border hover:bg-accent text-xs font-mono"
      title={`weight ${s.weight}`}
    >
      {s.related_symbol} <span className="text-muted-foreground">{s.weight.toFixed(2)}</span>
    </button>
  );
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div>
        <h4 className="text-xs font-semibold text-muted-foreground mb-2">Suppliers ({suppliers.length})</h4>
        <div className="flex flex-wrap gap-1">{suppliers.map((s, i) => <SymBox key={i} s={s} />)}</div>
      </div>
      <div>
        <h4 className="text-xs font-semibold text-muted-foreground mb-2">Customers ({customers.length})</h4>
        <div className="flex flex-wrap gap-1">{customers.map((s, i) => <SymBox key={i} s={s} />)}</div>
      </div>
    </div>
  );
}

function CompensationView({ symbol }: { symbol: string }) {
  const [rows, setRows] = useState<GovernanceComp[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!symbol) return;
    setLoading(true);
    findata.governanceComp(symbol).then(setRows).catch(() => setRows([])).finally(() => setLoading(false));
  }, [symbol]);
  if (loading) return <p className="text-sm text-muted-foreground animate-pulse">Loading…</p>;
  if (!rows.length) return <p className="text-sm text-muted-foreground">No executive compensation data.</p>;
  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <div key={i} className="rounded border border-border p-3 bg-card">
          <div className="flex items-baseline justify-between">
            <div className="font-medium text-sm">{r.name}</div>
            <div className="text-xs text-muted-foreground">{r.year}</div>
          </div>
          <div className="text-xl font-mono font-bold mt-1">${fmtNumber(r.compensation_total, { abbreviate: true, decimals: 2 })}</div>
          <dl className="grid grid-cols-2 md:grid-cols-3 gap-x-3 gap-y-0.5 text-xs mt-2">
            {Object.entries(r.compensation_breakdown ?? {}).map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="font-mono">${fmtNumber(v, { abbreviate: true, decimals: 1 })}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  );
}

function SharesFloatView({ symbol }: { symbol: string }) {
  const [rows, setRows] = useState<unknown[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!symbol) return;
    setLoading(true);
    findata.sharesFloat(symbol).then((d) => setRows(d ?? [])).catch(() => setRows([])).finally(() => setLoading(false));
  }, [symbol]);
  if (loading) return <p className="text-sm text-muted-foreground animate-pulse">Loading…</p>;
  if (!rows.length) return <p className="text-sm text-muted-foreground">No shares-float data.</p>;
  const cols = Object.keys(rows[0] as object);
  return (
    <div className="overflow-x-auto rounded border border-border">
      <table className="w-full text-xs border-collapse">
        <thead className="bg-muted/50">
          <tr>{cols.map((c) => <th key={c} className="text-left px-2 py-1 text-muted-foreground font-medium">{c}</th>)}</tr>
        </thead>
        <tbody>
          {(rows as Record<string, unknown>[]).map((r, i) => (
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

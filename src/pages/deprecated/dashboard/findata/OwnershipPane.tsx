import { useEffect, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import HoldersPane from "./HoldersPane";
import InsiderPane from "./InsiderPane";
import FundsPane from "./FundsPane";
import { SubTabs } from "./ValuationPane";
import { findata, fmtNumber, type EtfExposure } from "@/api/findata";

type Sub = "holders" | "peers" | "insider" | "funds" | "exposure";

const SUBS: { id: Sub; label: string }[] = [
  { id: "holders",  label: "Holders"      },
  { id: "peers",    label: "Peers"        },
  { id: "insider",  label: "Insider"      },
  { id: "funds",    label: "Funds"        },
  { id: "exposure", label: "ETF exposure" },
];

export default function OwnershipPane({ symbol, onSelect }: { symbol: string; onSelect: (s: string) => void }) {
  const [sub, setSub] = useState<Sub>("holders");
  return (
    <div className="flex flex-col gap-3">
      <SubTabs subs={SUBS} active={sub} onChange={setSub} />
      {sub === "holders"  && <HoldersPane symbol={symbol} />}
      {sub === "peers"    && <PeersList symbol={symbol} onSelect={onSelect} />}
      {sub === "insider"  && <InsiderPane symbol={symbol} />}
      {sub === "funds"    && <FundsPane   symbol={symbol} />}
      {sub === "exposure" && <ExposureView symbol={symbol} onSelect={onSelect} />}
    </div>
  );
}

function PeersList({ symbol, onSelect }: { symbol: string; onSelect: (s: string) => void }) {
  const [peers, setPeers] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => {
    if (!symbol) return;
    setLoading(true); setErr("");
    findata.peers(symbol).then(setPeers).catch((e) => setErr(String(e))).finally(() => setLoading(false));
  }, [symbol]);
  if (loading) return <p className="text-sm text-muted-foreground animate-pulse">Loading…</p>;
  if (err) return <p className="text-sm text-destructive">{err}</p>;
  if (!peers.length) return <p className="text-sm text-muted-foreground">No peers identified.</p>;
  return (
    <div className="flex flex-wrap gap-2">
      {peers.map((p) => (
        <button
          key={p}
          onClick={() => onSelect(p)}
          className={`px-3 py-1.5 rounded border text-sm font-mono ${p === symbol ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-accent"}`}
        >
          {p}
        </button>
      ))}
    </div>
  );
}

function ExposureView({ symbol, onSelect }: { symbol: string; onSelect: (s: string) => void }) {
  const [rows, setRows] = useState<EtfExposure[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!symbol) return;
    setLoading(true);
    findata.etfExposure(symbol).then(setRows).catch(() => setRows([])).finally(() => setLoading(false));
  }, [symbol]);
  if (loading) return <p className="text-sm text-muted-foreground animate-pulse">Loading…</p>;
  if (!rows.length) return <p className="text-sm text-muted-foreground">{symbol} is not held by any tracked ETF.</p>;

  const top15 = rows.slice(0, 15);
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded border border-border p-3 bg-card">
        <div className="text-xs text-muted-foreground mb-2">Top 15 ETFs holding {symbol} by weight</div>
        <div className="h-72">
          <ResponsiveContainer>
            <BarChart data={top15} layout="vertical" margin={{ top: 0, right: 16, left: 50, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis type="number" tickFormatter={(v) => `${v}%`} tick={{ fontSize: 10 }} />
              <YAxis dataKey="etf_symbol" type="category" tick={{ fontSize: 10 }} />
              <Tooltip contentStyle={{ fontSize: 11, padding: 4 }} formatter={(v: any) => `${v.toFixed(2)}%`} />
              <Bar dataKey="weight_pct" fill="#10b981" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="overflow-x-auto rounded border border-border">
        <table className="w-full text-xs border-collapse">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left px-2 py-1 text-muted-foreground font-medium">ETF</th>
              <th className="text-right px-2 py-1 text-muted-foreground font-medium">Weight %</th>
              <th className="text-right px-2 py-1 text-muted-foreground font-medium">Shares</th>
              <th className="text-right px-2 py-1 text-muted-foreground font-medium">Value</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 50).map((r, i) => (
              <tr key={i} className="border-t border-border/40 hover:bg-accent/40 cursor-pointer" onClick={() => onSelect(r.etf_symbol)}>
                <td className="px-2 py-1 font-mono font-medium">{r.etf_symbol}</td>
                <td className="px-2 py-1 font-mono text-right">{r.weight_pct.toFixed(2)}%</td>
                <td className="px-2 py-1 font-mono text-right">{fmtNumber(r.shares, { abbreviate: true, decimals: 1 })}</td>
                <td className="px-2 py-1 font-mono text-right">${fmtNumber(r.market_value, { abbreviate: true, decimals: 1 })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

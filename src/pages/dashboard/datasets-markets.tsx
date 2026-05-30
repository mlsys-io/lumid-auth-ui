// Markets dataset page — surfaces the market-wide endpoints added to
// kv.run:5000 v0.1.0 (movers, sectors, industries, calendars, screener,
// index constituents). Sibling to FinData Explorer (per-symbol) and
// Macro (economy-wide). Lives at /dashboard/datasets/markets.

import { useCallback, useEffect, useMemo, useState } from "react";
import { TrendingUp, RefreshCw } from "lucide-react";
import {
	findata,
	type ScreenerRow, type MarketMoverRow, type IndexConstituent,
	type SectorRow, type IndustryRow,
	type DividendCalendarRow, type SplitCalendarRow, type ExchangeHoursRow,
	fmtNumber, fmtPct,
} from "@/api/findata";
import { cn } from "@/lib/utils";
import { useAutoRefresh, fmtAgo, useNowTick } from "@/hooks/useAutoRefresh";

type TabId = "movers" | "sectors" | "industries" | "calendars" | "screener" | "index";

const TABS: { id: TabId; label: string; hint: string }[] = [
	{ id: "movers",     label: "Movers",     hint: "Top gainers / losers / most-active" },
	{ id: "sectors",    label: "Sectors",    hint: "Sector PE + daily return" },
	{ id: "industries", label: "Industries", hint: "Industry PE + daily return" },
	{ id: "calendars",  label: "Calendars",  hint: "Dividends · splits · exchange hours" },
	{ id: "screener",   label: "Screener",   hint: "Filter the universe by criteria" },
	{ id: "index",      label: "Index",      hint: "Index constituents (SPX / NDX / etc.)" },
];

// ── Small table primitive shared across all tabs ─────────────────────
function Table<T extends Record<string, any>>({
	rows, cols, empty = "—",
}: {
	rows: T[];
	cols: { key: keyof T | string; label: string; cell?: (r: T) => any; align?: "right" | "left"; w?: string }[];
	empty?: string;
}) {
	if (rows.length === 0) {
		return <div className="text-xs text-muted-foreground p-4">No rows.</div>;
	}
	return (
		<div className="rounded-md border border-border overflow-hidden">
			<table className="w-full text-[12.5px]">
				<thead className="bg-muted/40 border-b border-border">
					<tr>
						{cols.map((c) => (
							<th key={String(c.key)}
								className={cn(
									"px-3 py-1.5 text-left font-medium text-muted-foreground",
									c.align === "right" && "text-right",
									c.w,
								)}>
								{c.label}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{rows.map((r, i) => (
						<tr key={i} className={i % 2 ? "bg-muted/20" : ""}>
							{cols.map((c) => {
								const v = c.cell ? c.cell(r) : (r as any)[c.key];
								return (
									<td key={String(c.key)}
										className={cn("px-3 py-1.5 truncate",
											c.align === "right" && "text-right tabular-nums")}>
										{v ?? empty}
									</td>
								);
							})}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

// ── Movers tab ─────────────────────────────────────────────────────────
function MoversTab() {
	const [kind, setKind] = useState<"gainer" | "loser" | "most_active">("gainer");
	const [rows, setRows] = useState<MarketMoverRow[]>([]);
	const load = useCallback(async () => {
		setRows(await findata.marketMovers(kind, 50));
	}, [kind]);
	useEffect(() => { load(); }, [load]);

	return (
		<div className="space-y-3">
			<div className="flex items-center gap-2">
				{(["gainer", "loser", "most_active"] as const).map((k) => (
					<button key={k}
						onClick={() => setKind(k)}
						className={cn("px-3 py-1 text-xs rounded border",
							kind === k
								? "bg-foreground text-background border-foreground"
								: "border-border hover:bg-accent")}>
						{k.replace("_", " ")}
					</button>
				))}
				<button onClick={load} className="ml-auto inline-flex items-center gap-1 px-2 py-1 text-xs rounded border border-border hover:bg-accent">
					<RefreshCw className="w-3 h-3" /> Refresh
				</button>
			</div>
			<Table
				rows={rows}
				cols={[
					{ key: "symbol", label: "Symbol",       w: "w-24" },
					{ key: "name",   label: "Name" },
					{ key: "price",       label: "Price",   align: "right", cell: (r) => fmtNumber(r.price ?? null, { decimals: 2 }) },
					{ key: "change",      label: "Δ",       align: "right", cell: (r) => fmtNumber(r.change ?? null, { decimals: 2 }) },
					{ key: "change_pct",  label: "Δ %",     align: "right", cell: (r) => fmtPct((r.change_pct ?? 0) / 100, 2) },
					{ key: "volume",      label: "Volume",  align: "right", cell: (r) => fmtNumber(r.volume ?? null, { decimals: 0, abbreviate: true }) },
				]}
			/>
		</div>
	);
}

// ── Sectors tab ────────────────────────────────────────────────────────
function SectorsTab() {
	const [view, setView] = useState<"pe" | "performance">("pe");
	const [rows, setRows] = useState<SectorRow[]>([]);
	const load = useCallback(async () => {
		const data = view === "pe" ? await findata.sectorsPE() : await findata.sectorsPerformance();
		setRows(data);
	}, [view]);
	useEffect(() => { load(); }, [load]);

	return (
		<div className="space-y-3">
			<div className="flex items-center gap-2">
				{(["pe", "performance"] as const).map((v) => (
					<button key={v}
						onClick={() => setView(v)}
						className={cn("px-3 py-1 text-xs rounded border capitalize",
							view === v ? "bg-foreground text-background border-foreground"
							           : "border-border hover:bg-accent")}>
						{v === "pe" ? "Valuation (PE)" : "Performance"}
					</button>
				))}
				<button onClick={load} className="ml-auto inline-flex items-center gap-1 px-2 py-1 text-xs rounded border border-border hover:bg-accent">
					<RefreshCw className="w-3 h-3" /> Refresh
				</button>
			</div>
			<Table
				rows={rows}
				cols={[
					{ key: "sector",     label: "Sector" },
					{ key: "pe",         label: "PE",       align: "right", cell: (r) => fmtNumber(r.pe ?? null, { decimals: 2 }) },
					{ key: "return_1d",  label: "1d return", align: "right", cell: (r) => fmtPct((r.return_1d ?? 0) / 100, 2) },
					{ key: "return_1w",  label: "1w return", align: "right", cell: (r) => fmtPct((r.return_1w ?? 0) / 100, 2) },
				]}
			/>
		</div>
	);
}

// ── Industries tab ─────────────────────────────────────────────────────
function IndustriesTab() {
	const [view, setView] = useState<"pe" | "performance">("pe");
	const [rows, setRows] = useState<IndustryRow[]>([]);
	const load = useCallback(async () => {
		const data = view === "pe" ? await findata.industriesPE() : await findata.industriesPerformance();
		setRows(data);
	}, [view]);
	useEffect(() => { load(); }, [load]);

	return (
		<div className="space-y-3">
			<div className="flex items-center gap-2">
				{(["pe", "performance"] as const).map((v) => (
					<button key={v}
						onClick={() => setView(v)}
						className={cn("px-3 py-1 text-xs rounded border capitalize",
							view === v ? "bg-foreground text-background border-foreground"
							           : "border-border hover:bg-accent")}>
						{v === "pe" ? "Valuation (PE)" : "Performance"}
					</button>
				))}
				<button onClick={load} className="ml-auto inline-flex items-center gap-1 px-2 py-1 text-xs rounded border border-border hover:bg-accent">
					<RefreshCw className="w-3 h-3" /> Refresh
				</button>
			</div>
			<Table
				rows={rows}
				cols={[
					{ key: "industry",   label: "Industry" },
					{ key: "sector",     label: "Sector" },
					{ key: "pe",         label: "PE",        align: "right", cell: (r) => fmtNumber(r.pe ?? null, { decimals: 2 }) },
					{ key: "return_1d",  label: "1d return", align: "right", cell: (r) => fmtPct((r.return_1d ?? 0) / 100, 2) },
				]}
			/>
		</div>
	);
}

// ── Calendars tab ──────────────────────────────────────────────────────
function CalendarsTab() {
	const [view, setView] = useState<"dividends" | "splits" | "hours">("dividends");
	const [divs, setDivs] = useState<DividendCalendarRow[]>([]);
	const [splits, setSplits] = useState<SplitCalendarRow[]>([]);
	const [hours, setHours] = useState<ExchangeHoursRow[]>([]);
	const load = useCallback(async () => {
		if (view === "dividends")     setDivs(await findata.dividendsCalendar({ limit: 100 }));
		else if (view === "splits")   setSplits(await findata.splitsCalendar({ limit: 50 }));
		else                          setHours(await findata.exchangeMarketHours());
	}, [view]);
	useEffect(() => { load(); }, [load]);

	return (
		<div className="space-y-3">
			<div className="flex items-center gap-2">
				{(["dividends", "splits", "hours"] as const).map((v) => (
					<button key={v}
						onClick={() => setView(v)}
						className={cn("px-3 py-1 text-xs rounded border capitalize",
							view === v ? "bg-foreground text-background border-foreground"
							           : "border-border hover:bg-accent")}>
						{v === "hours" ? "Exchange hours" : v}
					</button>
				))}
				<button onClick={load} className="ml-auto inline-flex items-center gap-1 px-2 py-1 text-xs rounded border border-border hover:bg-accent">
					<RefreshCw className="w-3 h-3" /> Refresh
				</button>
			</div>
			{view === "dividends" && (
				<Table
					rows={divs}
					cols={[
						{ key: "date",        label: "Date" },
						{ key: "symbol",      label: "Symbol" },
						{ key: "amount",      label: "Amount", align: "right", cell: (r) => fmtNumber(r.amount ?? null, { decimals: 4 }) },
						{ key: "yield",       label: "Yield",  align: "right", cell: (r) => fmtPct((r.yield ?? 0) / 100, 2) },
						{ key: "record_date", label: "Record" },
						{ key: "pay_date",    label: "Pay" },
					]}
				/>
			)}
			{view === "splits" && (
				<Table
					rows={splits}
					cols={[
						{ key: "date",        label: "Date" },
						{ key: "symbol",      label: "Symbol" },
						{ key: "numerator",   label: "Num",  align: "right" },
						{ key: "denominator", label: "Denom",align: "right" },
					]}
				/>
			)}
			{view === "hours" && (
				<Table
					rows={hours}
					cols={[
						{ key: "exchange", label: "Exchange" },
						{ key: "open",     label: "Open" },
						{ key: "close",    label: "Close" },
						{ key: "timezone", label: "TZ" },
						{ key: "is_open",  label: "Live?",  cell: (r) => (r.is_open ? "open" : "closed") },
					]}
				/>
			)}
		</div>
	);
}

// ── Screener tab ───────────────────────────────────────────────────────
function ScreenerTab() {
	const [sector, setSector]   = useState("");
	const [industry, setIndustry] = useState("");
	const [exchange, setExchange] = useState("");
	const [capMin, setCapMin]   = useState("");
	const [capMax, setCapMax]   = useState("");
	const [rows, setRows]       = useState<ScreenerRow[]>([]);
	const [loading, setLoading] = useState(false);

	const run = useCallback(async () => {
		setLoading(true);
		try {
			const data = await findata.screener({
				sector:   sector   || undefined,
				industry: industry || undefined,
				exchange: exchange || undefined,
				market_cap_min: capMin ? Number(capMin) : undefined,
				market_cap_max: capMax ? Number(capMax) : undefined,
				limit: 200,
			});
			setRows(data);
		} finally { setLoading(false); }
	}, [sector, industry, exchange, capMin, capMax]);

	return (
		<div className="space-y-3">
			<div className="grid grid-cols-2 md:grid-cols-5 gap-2">
				<input placeholder="sector" value={sector} onChange={(e) => setSector(e.target.value)}
					className="px-2 py-1 text-xs rounded border border-border bg-background" />
				<input placeholder="industry" value={industry} onChange={(e) => setIndustry(e.target.value)}
					className="px-2 py-1 text-xs rounded border border-border bg-background" />
				<input placeholder="exchange (e.g. NASDAQ)" value={exchange} onChange={(e) => setExchange(e.target.value)}
					className="px-2 py-1 text-xs rounded border border-border bg-background" />
				<input placeholder="market_cap_min" value={capMin} onChange={(e) => setCapMin(e.target.value)}
					type="number"
					className="px-2 py-1 text-xs rounded border border-border bg-background" />
				<input placeholder="market_cap_max" value={capMax} onChange={(e) => setCapMax(e.target.value)}
					type="number"
					className="px-2 py-1 text-xs rounded border border-border bg-background" />
			</div>
			<div className="flex items-center gap-2">
				<button onClick={run} disabled={loading}
					className="px-3 py-1 text-xs rounded bg-foreground text-background hover:opacity-90 disabled:opacity-50">
					{loading ? "running…" : "Screen"}
				</button>
				<span className="text-xs text-muted-foreground">{rows.length} symbols</span>
			</div>
			<Table
				rows={rows}
				cols={[
					{ key: "symbol",     label: "Symbol",   w: "w-20" },
					{ key: "name",       label: "Name" },
					{ key: "sector",     label: "Sector" },
					{ key: "industry",   label: "Industry" },
					{ key: "exchange",   label: "Exch" },
					{ key: "market_cap", label: "Mkt cap", align: "right", cell: (r) => fmtNumber(r.market_cap ?? null, { decimals: 1, abbreviate: true }) },
				]}
			/>
		</div>
	);
}

// ── Index tab ──────────────────────────────────────────────────────────
function IndexTab() {
	const [idx, setIdx] = useState("SPX");
	const [rows, setRows] = useState<IndexConstituent[]>([]);
	const load = useCallback(async () => {
		setRows(await findata.indexConstituents(idx));
	}, [idx]);
	useEffect(() => { load(); }, [load]);

	return (
		<div className="space-y-3">
			<div className="flex items-center gap-2">
				<input value={idx} onChange={(e) => setIdx(e.target.value.toUpperCase())}
					placeholder="SPX / NDX / RUT / …"
					className="px-2 py-1 text-xs rounded border border-border bg-background w-44" />
				<button onClick={load}
					className="px-3 py-1 text-xs rounded bg-foreground text-background hover:opacity-90">
					Load
				</button>
				<span className="text-xs text-muted-foreground">{rows.length} constituents</span>
			</div>
			<Table
				rows={rows}
				cols={[
					{ key: "symbol",   label: "Symbol",   w: "w-20" },
					{ key: "name",     label: "Name" },
					{ key: "sector",   label: "Sector" },
					{ key: "weight",   label: "Weight",   align: "right", cell: (r) => fmtPct((r.weight ?? 0) / 100, 3) },
					{ key: "added_on", label: "Added" },
				]}
			/>
		</div>
	);
}

// ── Page shell ─────────────────────────────────────────────────────────
export default function DatasetsMarketsPage() {
	const [tab, setTab] = useState<TabId>("movers");
	const visible = useMemo(() => TABS.find((t) => t.id === tab)!, [tab]);
	useNowTick();
	const { loadedAt } = useAutoRefresh(async () => {/* per-tab fetches own load */});

	return (
		<div className="flex flex-col h-[calc(100vh-4rem)]">
			<div className="flex items-center gap-3 px-4 py-2 border-b bg-background shrink-0">
				<TrendingUp className="w-4 h-4 text-primary" />
				<div className="text-sm font-semibold text-foreground">Markets</div>
				<span className="text-xs text-muted-foreground hidden lg:inline">{visible.hint}</span>
				<span className="ml-auto text-[10px] text-muted-foreground/70">loaded {fmtAgo(loadedAt)}</span>
				<div className="text-[10px] text-muted-foreground font-mono">kv.run:5000 · markets-wide</div>
			</div>

			<div className="px-4 py-2 border-b bg-background shrink-0 flex items-center gap-1 overflow-x-auto">
				{TABS.map((t) => (
					<button key={t.id} onClick={() => setTab(t.id)}
						className={cn("px-3 py-1 text-xs rounded whitespace-nowrap",
							tab === t.id
								? "bg-foreground text-background"
								: "text-foreground hover:bg-accent")}>
						{t.label}
					</button>
				))}
			</div>

			<div className="flex-1 overflow-auto p-4">
				{tab === "movers"     && <MoversTab />}
				{tab === "sectors"    && <SectorsTab />}
				{tab === "industries" && <IndustriesTab />}
				{tab === "calendars"  && <CalendarsTab />}
				{tab === "screener"   && <ScreenerTab />}
				{tab === "index"      && <IndexTab />}
			</div>
		</div>
	);
}

// Prediction markets — the "Prediction markets" tab of /studio/data.
//
// Browse Polymarket + Kalshi by CATEGORY. One vocabulary for both venues
// (findata ddl/31, GET /prediction-markets/categories): Kalshi's own series
// categories, slugified, with Polymarket event tags mapped onto them.
//
// The two venues are not browsed the same way, on purpose:
//   • Polymarket — events (a question + its markets). Category comes from the
//     event's tags; the legacy `category` field is '' on ~99% of rows.
//   • Kalshi     — SERIES, then a series' markets. Kalshi categorises series,
//     not markets, and a whole category spans thousands of series, so a flat
//     "every Kalshi market in Sports" list cannot be answered inside the read
//     timeout. The drill-down is one indexed range scan per series.
//
// Reads go through the findata client (session-bearer), the same routes the
// findata MCP tools expose (prediction-markets_events / _categories /
// _kalshi_series / _kalshi_series_markets), so chat and this page agree.
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, ExternalLink, Loader2, Search } from 'lucide-react';
import {
	findata,
	type PmCategoryRow,
	type PmEventRow,
	type PmKalshiMarketRow,
	type PmKalshiSeriesRow,
} from '@/api/findata';
import { cn } from '@/lib/utils';

type Venue = 'polymarket' | 'kalshi';
type Status = 'open' | 'closed' | 'all';
const PAGE = 50;

const errText = (e: unknown) => (e instanceof Error && e.message ? e.message : 'request failed');

const fmtUsd = (v: number | null | undefined) => {
	if (v == null || !Number.isFinite(Number(v))) return '—';
	const n = Number(v);
	if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
	if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
	if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}k`;
	return `$${n.toFixed(0)}`;
};

const fmtDate = (s: string | null | undefined) => (s ? new Date(s).toISOString().slice(0, 10) : '—');

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
	return (
		<button
			onClick={onClick}
			className={cn(
				'px-2.5 py-1 text-[12px] rounded-full border transition-colors whitespace-nowrap',
				active
					? 'border-gold-300 bg-gold-50 text-gold-900'
					: 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900',
			)}
		>
			{children}
		</button>
	);
}

export default function PredictionMarketsBrowser() {
	const [cats, setCats] = useState<PmCategoryRow[]>([]);
	const [venue, setVenue] = useState<Venue>('polymarket');
	const [category, setCategory] = useState<string>('');
	const [status, setStatus] = useState<Status>('open');
	const [draft, setDraft] = useState('');
	const [q, setQ] = useState('');

	const [events, setEvents] = useState<PmEventRow[]>([]);
	const [series, setSeries] = useState<PmKalshiSeriesRow[]>([]);
	const [more, setMore] = useState(false);
	const [busy, setBusy] = useState(false);
	const [err, setErr] = useState('');

	const labelOf = useCallback((slug: string) => cats.find((c) => c.slug === slug)?.label ?? slug, [cats]);

	useEffect(() => {
		findata.pmCategories().then(setCats).catch((e) => setErr(errText(e)));
	}, []);

	const load = useCallback(
		async (offset: number) => {
			setBusy(true);
			setErr('');
			try {
				if (venue === 'polymarket') {
					const rows = await findata.pmEvents({ q, status, category: category || undefined, limit: PAGE, offset });
					setEvents((prev) => (offset ? [...prev, ...rows] : rows));
					setMore(rows.length === PAGE);
				} else {
					const rows = await findata.pmKalshiSeries({ q: q || undefined, category: category || undefined, limit: PAGE, offset });
					setSeries((prev) => (offset ? [...prev, ...rows] : rows));
					setMore(rows.length === PAGE);
				}
			} catch (e) {
				setErr(errText(e));
				if (!offset) {
					setEvents([]);
					setSeries([]);
				}
				setMore(false);
			} finally {
				setBusy(false);
			}
		},
		[venue, q, status, category],
	);

	// Any filter change restarts from the first page.
	useEffect(() => {
		load(0);
	}, [load]);

	const shown = venue === 'polymarket' ? events.length : series.length;

	return (
		<div className="h-full flex flex-col min-h-0 gap-3">
			{/* Venue + search + status */}
			<div className="flex flex-wrap items-center gap-2">
				<div className="inline-flex rounded-lg border border-slate-200 overflow-hidden">
					{(['polymarket', 'kalshi'] as Venue[]).map((v) => (
						<button
							key={v}
							onClick={() => setVenue(v)}
							className={cn(
								'px-3 py-1.5 text-[12.5px] font-medium',
								venue === v ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-50',
							)}
						>
							{v === 'polymarket' ? 'Polymarket' : 'Kalshi'}
						</button>
					))}
				</div>
				<form
					className="flex items-center gap-1.5 flex-1 min-w-[200px] max-w-md"
					onSubmit={(e) => {
						e.preventDefault();
						setQ(draft.trim());
					}}
				>
					<div className="relative flex-1">
						<Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
						<input
							value={draft}
							onChange={(e) => setDraft(e.target.value)}
							placeholder={venue === 'polymarket' ? 'Search events…' : 'Search series (title or ticker)…'}
							className="w-full pl-8 pr-2 py-1.5 text-[12.5px] rounded-lg border border-slate-200 focus:outline-none focus:border-gold-300"
						/>
					</div>
				</form>
				{venue === 'polymarket' && (
					<select
						value={status}
						onChange={(e) => setStatus(e.target.value as Status)}
						className="px-2 py-1.5 text-[12.5px] rounded-lg border border-slate-200 bg-white"
					>
						<option value="open">Open</option>
						<option value="closed">Closed</option>
						<option value="all">All</option>
					</select>
				)}
			</div>

			{/* Categories */}
			<div className="flex gap-1.5 overflow-x-auto pb-1">
				<Chip active={!category} onClick={() => setCategory('')}>
					All
				</Chip>
				{cats.map((c) => (
					<Chip key={c.slug} active={category === c.slug} onClick={() => setCategory(c.slug)}>
						{c.label}
					</Chip>
				))}
			</div>

			{err && (
				<div className="flex items-start gap-2 text-[12.5px] text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
					<AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
					<span className="break-all">{err}</span>
				</div>
			)}

			<div className="flex-1 min-h-0 overflow-auto rounded-lg border border-slate-200 bg-white">
				{venue === 'polymarket' ? (
					<PolymarketList rows={events} labelOf={labelOf} />
				) : (
					<KalshiSeriesList rows={series} />
				)}
				{!busy && !err && shown === 0 && (
					<div className="px-4 py-8 text-center text-[12.5px] text-slate-500">
						No {venue === 'polymarket' ? 'events' : 'series'}
						{category ? ` in ${labelOf(category)}` : ''}
						{q ? ` matching “${q}”` : ''}.
					</div>
				)}
				<div className="flex justify-center py-3">
					{busy ? (
						<Loader2 className="w-4 h-4 animate-spin text-slate-400" />
					) : (
						more && (
							<button
								onClick={() => load(shown)}
								className="px-3 py-1.5 text-[12.5px] rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
							>
								Load more
							</button>
						)
					)}
				</div>
			</div>
		</div>
	);
}

function PolymarketList({ rows, labelOf }: { rows: PmEventRow[]; labelOf: (slug: string) => string }) {
	if (!rows.length) return null;
	return (
		<table className="w-full text-[12.5px]">
			<thead className="sticky top-0 bg-slate-50 text-slate-500 text-left">
				<tr>
					<th className="px-3 py-2 font-medium">Event</th>
					<th className="px-3 py-2 font-medium">Categories</th>
					<th className="px-3 py-2 font-medium text-right">Volume</th>
					<th className="px-3 py-2 font-medium">Ends</th>
				</tr>
			</thead>
			<tbody>
				{/* Index in the key: an event can carry one row per source (the
				    Predexon snapshot + the Gamma ingest), so event_id repeats. */}
				{rows.map((e, i) => (
					<tr key={`${e.event_id}:${i}`} className="border-t border-slate-100 hover:bg-slate-50/60">
						<td className="px-3 py-2">
							<a
								href={`https://polymarket.com/event/${encodeURIComponent(e.slug)}`}
								target="_blank"
								rel="noreferrer"
								className="inline-flex items-center gap-1 text-slate-800 hover:underline"
							>
								{e.title}
								<ExternalLink className="w-3 h-3 text-slate-400" />
							</a>
						</td>
						<td className="px-3 py-2">
							<div className="flex flex-wrap gap-1">
								{(e.categories ?? []).map((c) => (
									<span key={c} className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[11px]">
										{labelOf(c)}
									</span>
								))}
							</div>
						</td>
						<td className="px-3 py-2 text-right tabular-nums">{fmtUsd(e.total_volume)}</td>
						<td className="px-3 py-2 tabular-nums text-slate-500">{fmtDate(e.end_date)}</td>
					</tr>
				))}
			</tbody>
		</table>
	);
}

function KalshiSeriesList({ rows }: { rows: PmKalshiSeriesRow[] }) {
	const [open, setOpen] = useState<string | null>(null);
	if (!rows.length) return null;
	return (
		<div className="divide-y divide-slate-100">
			{rows.map((s) => (
				<div key={s.ticker}>
					<button
						onClick={() => setOpen(open === s.ticker ? null : s.ticker)}
						className="w-full flex items-center gap-2 px-3 py-2 text-left text-[12.5px] hover:bg-slate-50/60"
					>
						{open === s.ticker ? (
							<ChevronDown className="w-3.5 h-3.5 text-slate-400" />
						) : (
							<ChevronRight className="w-3.5 h-3.5 text-slate-400" />
						)}
						<span className="font-mono text-[11.5px] text-slate-500 w-40 shrink-0 truncate">{s.ticker}</span>
						<span className="flex-1 text-slate-800 truncate">{s.title}</span>
						<span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[11px]">{s.category ?? '—'}</span>
						{s.frequency && <span className="text-[11px] text-slate-400 w-16 text-right">{s.frequency}</span>}
					</button>
					{open === s.ticker && <KalshiSeriesMarkets ticker={s.ticker} />}
				</div>
			))}
		</div>
	);
}

function KalshiSeriesMarkets({ ticker }: { ticker: string }) {
	const [rows, setRows] = useState<PmKalshiMarketRow[] | null>(null);
	const [err, setErr] = useState('');
	useEffect(() => {
		findata
			.pmKalshiSeriesMarkets(ticker, { status: 'open', limit: 100 })
			.then(setRows)
			.catch((e) => setErr(errText(e)));
	}, [ticker]);
	if (err) return <div className="px-9 py-2 text-[12px] text-red-700">{err}</div>;
	if (!rows) return <div className="px-9 py-2"><Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" /></div>;
	if (!rows.length) return <div className="px-9 py-2 text-[12px] text-slate-500">No open markets in this series.</div>;
	return (
		<div className="px-9 pb-2">
			<table className="w-full text-[12px]">
				<thead className="text-slate-400 text-left">
					<tr>
						<th className="py-1 font-medium">Market</th>
						<th className="py-1 font-medium text-right">Last</th>
						<th className="py-1 font-medium">Closes</th>
					</tr>
				</thead>
				<tbody>
					{rows.map((m) => (
						<tr key={m.ticker} className="border-t border-slate-100">
							<td className="py-1 pr-2">
								<a
									href={`https://kalshi.com/markets/${encodeURIComponent(ticker.toLowerCase())}`}
									target="_blank"
									rel="noreferrer"
									className="text-slate-700 hover:underline"
								>
									{m.title}
									{m.yes_sub_title ? ` — ${m.yes_sub_title}` : ''}
								</a>
								<div className="font-mono text-[10.5px] text-slate-400">{m.ticker}</div>
							</td>
							<td className="py-1 text-right tabular-nums">{m.last_price != null ? `${m.last_price}¢` : '—'}</td>
							<td className="py-1 pl-2 tabular-nums text-slate-500">{fmtDate(m.close_time)}</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

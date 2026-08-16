// TableArtifact — sortable / filterable grid for query result rows.
//
// Why this exists: `data_query` results previously reached the user as whatever
// prose or markdown table the model chose to type out. For exploration that is
// the wrong shape — you want to sort by the column you care about and narrow to
// the row you're chasing, without asking the model to re-run the query.
//
// Hand-rolled deliberately. The whole requirement is "derive columns, sort by
// header, filter by substring", which is ~100 lines; @tanstack/react-table v9 is
// a new features-based API and 134 KB for the same outcome.
//
// Content shape (kind = "table"): a bare array of row objects, or
//   { "columns": ["a","b"], "rows": [ {...} ] }   // `columns` fixes the order
//
// Loaded through React.lazy from ArtifactView for consistency with the other
// rich kinds (it has no heavy dependency of its own).

import { useMemo, useState } from 'react';
import { ChevronUp, ChevronDown, Search } from 'lucide-react';

type Row = Record<string, unknown>;

// Scan a bounded prefix rather than every row: a million-row result would
// otherwise walk the whole set just to decide column order.
const COLUMN_SCAN_ROWS = 200;

function deriveColumns(rows: Row[]): string[] {
	const seen: string[] = [];
	const known = new Set<string>();
	for (const r of rows.slice(0, COLUMN_SCAN_ROWS)) {
		if (!r || typeof r !== 'object') continue;
		for (const k of Object.keys(r)) {
			if (!known.has(k)) { known.add(k); seen.push(k); }
		}
	}
	return seen;
}

function cellText(v: unknown): string {
	if (v === null || v === undefined) return '';
	if (typeof v === 'object') return JSON.stringify(v);
	return String(v);
}

// Thousands separators earn their keep on financial magnitudes (row counts,
// volumes, PnL). Small numbers are left alone so ranks and prices stay literal.
function cellDisplay(v: unknown): string {
	if (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) >= 1000) {
		return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
	}
	return cellText(v);
}

export default function TableArtifact({ spec }: { spec: string }) {
	const [sortKey, setSortKey] = useState<string | null>(null);
	const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
	const [filter, setFilter] = useState('');

	const parsed = useMemo(() => {
		try {
			const p = JSON.parse(spec);
			const rows: Row[] = Array.isArray(p) ? p : (p?.rows ?? p?.data ?? []);
			const cols: string[] | undefined = Array.isArray(p?.columns) && p.columns.length ? p.columns : undefined;
			if (!Array.isArray(rows)) return { error: 'Expected an array of rows.' };
			return { rows, cols };
		} catch {
			return { error: 'Invalid table spec — not JSON.' };
		}
	}, [spec]);

	const rows = parsed.rows ?? [];
	const columns = useMemo(() => parsed.cols ?? deriveColumns(rows), [parsed.cols, rows]);

	// Right-align a column only when every value present is numeric, so a mixed
	// column doesn't get a misleading numeric treatment.
	const numericCols = useMemo(() => {
		const out = new Set<string>();
		for (const c of columns) {
			let sawValue = false;
			const allNumeric = rows.slice(0, COLUMN_SCAN_ROWS).every((r) => {
				const v = r?.[c];
				if (v === null || v === undefined || v === '') return true;
				sawValue = true;
				return typeof v === 'number' && Number.isFinite(v);
			});
			if (sawValue && allNumeric) out.add(c);
		}
		return out;
	}, [columns, rows]);

	const view = useMemo(() => {
		const needle = filter.trim().toLowerCase();
		let out = needle
			? rows.filter((r) => columns.some((c) => cellText(r?.[c]).toLowerCase().includes(needle)))
			: rows.slice();
		if (sortKey) {
			const dir = sortDir === 'asc' ? 1 : -1;
			out.sort((a, b) => {
				const av = a?.[sortKey], bv = b?.[sortKey];
				// Nulls always sort last, regardless of direction — an empty cell is
				// never the "biggest" answer someone is looking for.
				const aEmpty = av === null || av === undefined || av === '';
				const bEmpty = bv === null || bv === undefined || bv === '';
				if (aEmpty && bEmpty) return 0;
				if (aEmpty) return 1;
				if (bEmpty) return -1;
				if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
				return cellText(av).localeCompare(cellText(bv), 'en-US', { numeric: true }) * dir;
			});
		}
		return out;
	}, [rows, columns, filter, sortKey, sortDir]);

	if (parsed.error) {
		return <div className="text-rose-600 text-[11.5px]">{parsed.error}</div>;
	}
	if (!rows.length || !columns.length) {
		return <div className="text-slate-500 text-[11.5px]">No rows.</div>;
	}

	const toggleSort = (c: string) => {
		if (sortKey !== c) { setSortKey(c); setSortDir('desc'); return; }
		if (sortDir === 'desc') { setSortDir('asc'); return; }
		setSortKey(null); // third click clears back to source order
	};

	return (
		<div className="w-full">
			<div className="flex items-center gap-2 mb-1.5">
				<div className="relative flex-1 min-w-0">
					<Search className="w-3 h-3 text-slate-400 absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none" />
					<input
						value={filter}
						onChange={(e) => setFilter(e.target.value)}
						placeholder="Filter rows…"
						aria-label="Filter rows"
						className="w-full pl-6 pr-2 py-1 text-[11.5px] border border-slate-200 rounded-md
						           bg-white focus:outline-none focus:ring-1 focus:ring-sky-400"
					/>
				</div>
				<span className="text-[11px] text-slate-500 tabular-nums flex-shrink-0">
					{view.length.toLocaleString('en-US')}
					{view.length !== rows.length && ` of ${rows.length.toLocaleString('en-US')}`} rows
				</span>
			</div>

			<div className="border border-slate-200 rounded-lg overflow-auto" style={{ maxHeight: '60vh' }}>
				<table className="w-full text-[11.5px] border-collapse">
					<thead className="sticky top-0 z-10">
						<tr className="bg-slate-50">
							{columns.map((c) => (
								<th
									key={c}
									onClick={() => toggleSort(c)}
									title={`Sort by ${c}`}
									className={`px-2 py-1.5 font-semibold text-slate-600 whitespace-nowrap cursor-pointer
									            select-none border-b border-slate-200 hover:bg-slate-100
									            ${numericCols.has(c) ? 'text-right' : 'text-left'}`}
								>
									<span className="inline-flex items-center gap-1">
										{c}
										{sortKey === c && (sortDir === 'asc'
											? <ChevronUp className="w-3 h-3 text-sky-600" />
											: <ChevronDown className="w-3 h-3 text-sky-600" />)}
									</span>
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{view.map((r, i) => (
							<tr key={i} className="odd:bg-white even:bg-slate-50/50 hover:bg-sky-50/60">
								{columns.map((c) => (
									<td
										key={c}
										title={cellText(r?.[c])}
										className={`px-2 py-1 border-b border-slate-100 text-slate-700 max-w-[22rem] truncate
										            ${numericCols.has(c) ? 'text-right tabular-nums' : 'text-left'}`}
									>
										{cellDisplay(r?.[c])}
									</td>
								))}
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</div>
	);
}

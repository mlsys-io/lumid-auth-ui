// SQL console — the Query tab of /studio/data.
//
// Runs through POST /me/data-query, which wraps the SAME toolDataQuery path
// chat's data_query tool uses. That is deliberate: the console and the
// assistant must not be able to answer the same question differently.
//
// NOT routed via /dataapp-proxy/findata/, which the browser can already reach.
// That nginx block overwrites Authorization with a shared service PAT, so every
// user's query would arrive as one account and the audit row would name nobody.
//
// This is NOT the sql_<name> Postgres seat. That one connects over the wire as
// the user's own role and is the only path with warehouse-level attribution.
// This is the no-credential path — it runs as your session, like chat.
import { useCallback, useMemo, useState } from 'react';
import { Play, Loader2, AlertTriangle, Table2 } from 'lucide-react';
import { me } from '@/api/me';

const SAMPLE = 'SELECT * FROM market.ohlcv LIMIT 20';

export default function SqlConsole() {
	const [sql, setSql] = useState(SAMPLE);
	const [rows, setRows] = useState<Array<Record<string, unknown>> | null>(null);
	const [err, setErr] = useState<string>('');
	const [busy, setBusy] = useState(false);
	const [ms, setMs] = useState<number | null>(null);

	const run = useCallback(async () => {
		const q = sql.trim();
		if (!q || busy) return;
		setBusy(true);
		setErr('');
		const t0 = performance.now();
		try {
			const r = await me.dataQuery(q);
			setRows(r.rows ?? []);
			setMs(Math.round(performance.now() - t0));
		} catch (e) {
			// Surface the warehouse's own words. "relation market.ohlcv does not
			// exist" tells the reader what to fix; "query failed" does not.
			//
			// me.ts throws MeApiError, whose `message` IS the server's `message`
			// field (doCall unwraps the {ret_code,message,data} envelope). Do not
			// reach for `e.response.data.message` here -- that is the axios shape,
			// which this client never produces, so it would silently always miss
			// and fall through to the generic text.
			setErr(e instanceof Error && e.message ? e.message : 'query failed');
			setRows(null);
			setMs(null);
		} finally {
			setBusy(false);
		}
	}, [sql, busy]);

	// Union of keys rather than the first row's: a JSONL result set can be ragged,
	// and taking row[0] silently drops columns that appear later.
	const cols = useMemo(() => {
		if (!rows?.length) return [];
		const seen: string[] = [];
		for (const r of rows) for (const k of Object.keys(r)) if (!seen.includes(k)) seen.push(k);
		return seen;
	}, [rows]);

	return (
		<div className="flex flex-col gap-3 h-full min-h-0">
			<div className="text-xs text-muted-foreground">
				Read-only <code>SELECT</code> against the FinData warehouse, run as you — no
				credential to set up. A <code>LIMIT</code> is added if you omit one. Browse{' '}
				<strong>Catalog</strong> first to find schemas and tables.
			</div>

			<textarea
				value={sql}
				onChange={(e) => setSql(e.target.value)}
				onKeyDown={(e) => {
					// Ctrl/Cmd+Enter runs. Plain Enter must insert a newline — this is a
					// SQL editor, and stealing Enter makes multi-line queries painful.
					if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
						e.preventDefault();
						run();
					}
				}}
				spellCheck={false}
				rows={5}
				className="w-full font-mono text-[12.5px] leading-relaxed rounded-lg border border-slate-200 bg-white p-3 focus:outline-none focus:ring-2 focus:ring-gold-300"
				placeholder="SELECT …"
			/>

			<div className="flex items-center gap-3">
				<button
					onClick={run}
					disabled={busy || !sql.trim()}
					className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12.5px] font-medium rounded-lg border border-gold-300 bg-gold-50 text-gold-900 hover:bg-gold-100 disabled:opacity-50 disabled:cursor-not-allowed"
				>
					{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
					{busy ? 'Running…' : 'Run'}
				</button>
				<span className="text-xs text-slate-500">⌘/Ctrl + Enter</span>
				{ms !== null && rows && (
					<span className="text-xs text-slate-500">
						{rows.length} row{rows.length === 1 ? '' : 's'} · {ms} ms
					</span>
				)}
			</div>

			{err && (
				<div className="flex items-start gap-2 rounded-lg border border-amber-500/50 bg-amber-500/5 p-3 text-xs">
					<AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
					{/* Verbatim, and monospace, because it is usually a Postgres error
					    with a caret pointing at the offending token. */}
					<pre className="whitespace-pre-wrap font-mono text-amber-900">{err}</pre>
				</div>
			)}

			{rows && !err && (
				<div className="flex-1 min-h-0 overflow-auto rounded-lg border border-slate-200">
					{rows.length === 0 ? (
						<div className="p-4 text-xs text-slate-500 inline-flex items-center gap-2">
							<Table2 className="w-3.5 h-3.5" />
							No rows. The query ran — this is an empty result, not a failure.
						</div>
					) : (
						<table className="w-full text-[12px] border-collapse">
							<thead className="sticky top-0 bg-slate-50">
								<tr>
									{cols.map((c) => (
										<th key={c} className="text-left font-medium text-slate-600 px-2 py-1.5 border-b border-slate-200 whitespace-nowrap">
											{c}
										</th>
									))}
								</tr>
							</thead>
							<tbody className="font-mono">
								{rows.map((r, i) => (
									<tr key={i} className="even:bg-slate-50/50">
										{cols.map((c) => {
											const v = r[c];
											return (
												<td key={c} className="px-2 py-1 border-b border-slate-100 whitespace-nowrap tabular-nums">
													{/* null is a real value and must not render as blank —
													    an empty cell reads as "no data", which is different. */}
													{v === null || v === undefined ? (
														<span className="text-slate-400 italic">null</span>
													) : typeof v === 'object' ? (
														JSON.stringify(v)
													) : (
														String(v)
													)}
												</td>
											);
										})}
									</tr>
								))}
							</tbody>
						</table>
					)}
				</div>
			)}
		</div>
	);
}

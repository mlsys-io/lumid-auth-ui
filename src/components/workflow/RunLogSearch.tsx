// RunLogSearch — grep a run's transcript + step errors (WS-6). A search box
// that calls GET /me/cycles/:app/:loop/:ts/search and lists the matches. Click
// a result → onJump(index) (the host scrolls/highlights that log row);
// right-click → "Ask AI about this" via the existing studio:ask chat event
// (grep for finding, chat for "why").
//
// Reused by the Run log (TrajectoryLogView) and the Stages drill-down.

import { useCallback, useEffect, useRef, useState } from "react";
import { Search, Loader2, X } from "lucide-react";
import { me, type MeRunLogMatch } from "@/api/me";
import { cn } from "@/lib/utils";

type FilterType = "" | "llm" | "stage" | "error";

export default function RunLogSearch({ app, loop, ts, onJump, compact }: {
	app: string;
	loop: string;
	ts?: string;
	// Called with a matched row's index so the host scrolls/highlights it.
	onJump?: (index: number, match: MeRunLogMatch) => void;
	compact?: boolean;
}) {
	const [q, setQ] = useState("");
	const [type, setType] = useState<FilterType>("");
	const [matches, setMatches] = useState<MeRunLogMatch[] | null>(null);
	const [count, setCount] = useState(0);
	const [busy, setBusy] = useState(false);
	const reqRef = useRef(0);

	const run = useCallback(async () => {
		const query = q.trim();
		if (!query || !ts) { setMatches(null); return; }
		const seq = ++reqRef.current;
		setBusy(true);
		try {
			const res = await me.searchRunLog(app, loop, ts, query, type || undefined);
			if (seq !== reqRef.current) return; // stale
			setMatches(res.matches || []);
			setCount(res.count || (res.matches?.length ?? 0));
		} catch {
			if (seq !== reqRef.current) return;
			setMatches([]); setCount(0);
		} finally {
			if (seq === reqRef.current) setBusy(false);
		}
	}, [app, loop, ts, q, type]);

	// Debounce typed queries.
	useEffect(() => {
		if (!q.trim()) { setMatches(null); return; }
		const id = window.setTimeout(run, 300);
		return () => window.clearTimeout(id);
	}, [q, type, run]);

	const askAbout = (m: MeRunLogMatch, e: React.MouseEvent) => {
		e.preventDefault();
		window.dispatchEvent(new CustomEvent("studio:ask", {
			detail: {
				prompt: `In the run log for ${app} / ${loop}${ts ? ` (run ${ts})` : ""}, explain this ${m.event || "event"}${m.field ? ` (${m.field})` : ""}: ${m.snippet || ""}`,
				autosend: true,
				context: { app, loop, ...(ts ? { cycle: { app, loop, ts } } : {}) },
			},
		}));
	};

	return (
		<div className={cn("flex flex-col min-h-0", compact ? "gap-1" : "gap-1.5")}>
			<div className="flex items-center gap-1.5">
				<div className="relative flex-1">
					<Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
					<input value={q} onChange={(e) => setQ(e.target.value)}
						placeholder="Search this run's log (e.g. error)…"
						className="w-full pl-7 pr-7 py-1.5 text-xs rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-gold-400/40" />
					{q && (
						<button onClick={() => { setQ(""); setMatches(null); }} className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-slate-400 hover:text-slate-700">
							<X className="w-3 h-3" />
						</button>
					)}
				</div>
				<select value={type} onChange={(e) => setType(e.target.value as FilterType)}
					title="Narrow the scan" className="px-1.5 py-1.5 text-[11px] rounded-lg border border-slate-200 bg-white">
					<option value="">all</option>
					<option value="llm">llm</option>
					<option value="stage">stage</option>
					<option value="error">errors</option>
				</select>
			</div>

			{q.trim() && (
				<div className="rounded-lg border border-slate-100 bg-slate-50/60 max-h-40 overflow-y-auto">
					{busy && matches === null ? (
						<div className="px-2.5 py-2 text-[11px] text-slate-400 flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" /> Searching…</div>
					) : matches && matches.length === 0 ? (
						<div className="px-2.5 py-2 text-[11px] text-slate-400">No matches.</div>
					) : matches ? (
						<ul>
							<li className="px-2.5 py-1 text-[10px] uppercase tracking-wide text-slate-400 font-semibold">{count} match{count === 1 ? "" : "es"} · right-click → ask AI</li>
							{matches.map((m, i) => (
								<li key={`${m.index}-${i}`}>
									<button onClick={() => onJump?.(m.index, m)} onContextMenu={(e) => askAbout(m, e)}
										className="w-full text-left px-2.5 py-1.5 hover:bg-white transition-colors flex items-start gap-2">
										<span className="text-[9px] uppercase tracking-wide text-slate-400 font-semibold mt-0.5 flex-shrink-0">{m.event || "row"}{m.field ? `·${m.field}` : ""}</span>
										<span className="text-[11px] text-slate-600 leading-snug truncate">{m.snippet || "(match)"}</span>
									</button>
								</li>
							))}
						</ul>
					) : null}
				</div>
			)}
		</div>
	);
}

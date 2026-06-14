// AirflowCalendar — heatmap (day × hour-of-day) showing run count + failure
// density over a window. Default window: last 14 days. Each cell color
// encodes (success_count, failure_count) — emerald saturates on volume,
// rose tints on failures.

import { useMemo } from "react";
import type { MeRunRow } from "@/api/me";

interface Props {
	runs: MeRunRow[];
	/** Days back from today to show. Default 14. */
	days?: number;
	onCellClick?: (dayISO: string, hour: number) => void;
}

interface CellStats {
	ok: number;
	fail: number;
}

export function AirflowCalendar({ runs, days = 14, onCellClick }: Props) {
	const { dayKeys, cells } = useMemo(() => buildCells(runs, days), [runs, days]);

	const maxCount = useMemo(() => {
		let m = 1;
		Object.values(cells).forEach((row) => {
			Object.values(row).forEach((c) => {
				const total = (c.ok || 0) + (c.fail || 0);
				if (total > m) m = total;
			});
		});
		return m;
	}, [cells]);

	if (runs.length === 0) {
		return (
			<div className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-500">
				No runs in the window — try widening the date range.
			</div>
		);
	}

	return (
		<div className="rounded-xl border border-slate-200 bg-white p-4 overflow-x-auto">
			<div className="inline-block">
				{/* Hour-of-day header */}
				<div className="flex items-end ml-24 mb-1.5">
					{Array.from({ length: 24 }, (_, h) => (
						<div key={h} className="w-5 text-[9px] text-slate-400 font-mono text-center">
							{h % 6 === 0 ? h : ""}
						</div>
					))}
				</div>
				{dayKeys.map((day) => (
					<div key={day} className="flex items-center mb-px">
						<div className="w-24 text-[11px] text-slate-600 font-mono pr-2 truncate" title={day}>
							{formatDayLabel(day)}
						</div>
						{Array.from({ length: 24 }, (_, h) => {
							const c = cells[day]?.[h] || { ok: 0, fail: 0 };
							return (
								<button
									key={h}
									title={`${day} ${pad2(h)}:00 — ${c.ok} ok, ${c.fail} failed`}
									className="w-5 h-5 rounded-sm hover:ring-2 hover:ring-slate-900/30 transition-all"
									style={{ background: cellColor(c, maxCount) }}
									onClick={() => onCellClick?.(day, h)}
									disabled={(c.ok || 0) + (c.fail || 0) === 0}
								/>
							);
						})}
					</div>
				))}
				<div className="mt-3 flex items-center gap-3 text-[10px] text-slate-500">
					<span className="inline-flex items-center gap-1">
						<span className="w-2.5 h-2.5 rounded-sm bg-amber-100" />
						light
					</span>
					<span className="inline-flex items-center gap-1">
						<span className="w-2.5 h-2.5 rounded-sm bg-amber-500" />
						many ok
					</span>
					<span className="inline-flex items-center gap-1">
						<span className="w-2.5 h-2.5 rounded-sm bg-rose-300" />
						some failures
					</span>
					<span className="inline-flex items-center gap-1">
						<span className="w-2.5 h-2.5 rounded-sm bg-rose-600" />
						many failures
					</span>
				</div>
			</div>
		</div>
	);
}

function buildCells(runs: MeRunRow[], days: number) {
	const now = new Date();
	const dayKeys: string[] = [];
	for (let i = days - 1; i >= 0; i--) {
		const d = new Date(now);
		d.setUTCHours(0, 0, 0, 0);
		d.setUTCDate(d.getUTCDate() - i);
		dayKeys.push(d.toISOString().slice(0, 10));
	}
	const cells: Record<string, Record<number, CellStats>> = {};
	dayKeys.forEach((k) => { cells[k] = {}; });

	for (const r of runs) {
		const t = new Date(r.started_at * 1000);
		const day = t.toISOString().slice(0, 10);
		const hour = t.getUTCHours();
		if (!cells[day]) continue;
		cells[day][hour] = cells[day][hour] || { ok: 0, fail: 0 };
		if (r.state === "failed") cells[day][hour].fail += 1;
		else if (r.state === "succeeded") cells[day][hour].ok += 1;
	}
	return { dayKeys, cells };
}

function cellColor(c: CellStats, maxCount: number): string {
	const total = (c.ok || 0) + (c.fail || 0);
	if (total === 0) return "rgb(241 245 249)"; // slate-100
	const failFrac = c.fail / total;
	const intensity = Math.min(1, total / maxCount);
	if (failFrac >= 0.5) {
		// More red as failure ratio + total grow.
		const r = 220 + Math.floor(35 * intensity);
		const g = Math.floor(80 * (1 - intensity));
		const b = Math.floor(100 * (1 - intensity));
		return `rgb(${r}, ${g}, ${b})`;
	}
	// Mostly successful — emerald scale.
	const r = Math.floor(220 - 180 * intensity);
	const g = Math.floor(252 - 50 * intensity);
	const b = Math.floor(231 - 100 * intensity);
	return `rgb(${r}, ${g}, ${b})`;
}

function formatDayLabel(iso: string): string {
	const d = new Date(iso + "T00:00:00Z");
	return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function pad2(n: number) { return n.toString().padStart(2, "0"); }

export default AirflowCalendar;

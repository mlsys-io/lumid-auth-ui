// LearningVelocity — is this workflow COMPOUNDING knowledge?
//
// Every cycle that publishes memories writes the counts into
// summary.auto_publish.memories[agent].pushed. Summed per cycle, that's the
// learning rate; accumulated over the window, that's the compounding total.
// This pulls the last N runs (oldest→newest), draws a tiny per-run mini-bar of
// memories-learned + the running total, and reads it back in one line
// ("learning +N over last K runs" vs "no new memories — not compounding yet").
// Self-hides for apps whose allowlist never publishes (no auto_publish block at
// all on any run in the window).

import { useEffect, useState } from "react";
import { Brain } from "lucide-react";
import { me, type MeCycleDetail } from "@/api/me";
import { cn } from "@/lib/utils";

const MAX_RUNS = 12;
const GOLD = "#B08F45";

export default function LearningVelocity({ app, loop, runs }: { app: string; loop: string; runs: string[] }) {
	/* eslint-disable @typescript-eslint/no-explicit-any */
	const [details, setDetails] = useState<Record<string, MeCycleDetail | null> | null>(null);
	const sel = [...runs].filter(Boolean).slice(0, MAX_RUNS);
	const key = sel.join(",");

	useEffect(() => {
		let live = true;
		setDetails(null);
		if (!sel.length) { setDetails({}); return; }
		Promise.all(sel.map((ts) =>
			me.cycleDetail(app, loop, ts).then((d) => [ts, d] as const).catch(() => [ts, null] as const)))
			.then((pairs) => { if (live) setDetails(Object.fromEntries(pairs)); });
		return () => { live = false; };
	}, [app, loop, key]); // eslint-disable-line react-hooks/exhaustive-deps

	if (details === null) return <div className="h-12 rounded-lg bg-slate-100 animate-pulse" />;

	// oldest → newest so the bar reads left=old, right=new.
	const ordered = [...sel].sort((a, b) => a.localeCompare(b));
	// memories learned in a cycle = Σ auto_publish.memories[agent].pushed.
	const apOf = (ts: string) => (details[ts]?.summary as any)?.auto_publish?.memories as Record<string, { pushed?: number }> | undefined;
	const learnedOf = (ts: string) => {
		const m = apOf(ts);
		return m ? Object.values(m).reduce((n, v) => n + (Number(v?.pushed) || 0), 0) : 0;
	};

	// Self-hide only when this app NEVER publishes (no auto_publish block on any
	// loaded run). A present-but-zero block is meaningful ("not compounding yet").
	const everPublishes = ordered.some((ts) => apOf(ts) !== undefined);
	if (!everPublishes) return null;

	const perRun = ordered.map((ts) => learnedOf(ts));
	const total = perRun.reduce((n, v) => n + v, 0);
	const maxBar = Math.max(1, ...perRun);
	const k = perRun.length;

	const read = total > 0
		? `learning +${total} over last ${k} run${k === 1 ? "" : "s"}`
		: "no new memories — not compounding yet";

	return (
		<div className="rounded-xl border border-slate-200 bg-white">
			<div className="px-2.5 py-1.5 text-[10px] uppercase tracking-wide text-slate-400 font-semibold border-b border-slate-100 flex items-center gap-1.5">
				<Brain className="w-3 h-3" /> Learning velocity
			</div>
			<div className="px-2.5 py-2 space-y-1.5">
				<div className="flex items-baseline gap-1.5">
					<span className={cn("text-[15px] font-semibold tabular-nums leading-none", total > 0 ? "text-slate-900" : "text-slate-400")}>{total}</span>
					<span className="text-[11px] text-slate-400">memories learned</span>
				</div>
				{/* Per-run mini-bar — one column per run, height ∝ memories that cycle. */}
				<div className="flex items-end gap-0.5 h-7" title="memories learned per run (oldest → newest)">
					{perRun.map((v, i) => (
						<div
							key={ordered[i] || i}
							className="flex-1 min-w-[2px] rounded-sm"
							style={{
								height: `${Math.max(v > 0 ? 12 : 3, (v / maxBar) * 100)}%`,
								backgroundColor: v > 0 ? GOLD : "#e2e8f0",
							}}
							title={`${v} learned`}
						/>
					))}
				</div>
				<div className={cn("text-[11px]", total > 0 ? "text-gold-700" : "text-slate-400 italic")}>{read}</div>
			</div>
		</div>
	);
}

// VersionChain — the versions an experiment tried, in the order they first
// produced a result: v1 → v2 → v3, each with its state in words. The winner is
// filled in, dropped versions sit below in a peach row, versions never run are
// dashed ghosts (Novix's v0…v6 chain with rejected chips below).

import type { ChainLink } from "@/lib/evolution";
import { cn } from "@/lib/utils";

const CHIP: Record<ChainLink["state"], string> = {
	winning: "bg-plum-700 border-plum-700 text-white shadow-e2",
	"best so far": "bg-plum-50 border-plum-300 text-ink-900",
	trying: "bg-card border-plum-200 text-ink-900",
	collecting: "bg-card border-dashed border-plum-300 text-ink-900",
	dropped: "bg-ember-50 border-ember-200 text-ember-800",
	"not run yet": "bg-transparent border-dashed border-ink-300 text-ink-600",
};

export default function VersionChain({ chain, labelOf, valueOf, onPick, picked, progress }: {
	chain: ChainLink[];
	/** How far a version got when it has no result at the experiment's metric
	 *  yet (lib/evidence versionProgress) — said instead of "no results yet". */
	progress?: Map<string, { text: string; tag: "stopped" | "passed" | "measured" }>;
	labelOf: (arm: string) => string;
	valueOf: (v: number) => string;
	/** Clicking a version card selects it (on the graph, and in the panel). */
	onPick?: (arm: string) => void;
	picked?: string | null;
}) {
	const main = chain.filter((c) => c.state !== "dropped");
	const dropped = chain.filter((c) => c.state === "dropped");
	const chip = (c: ChainLink, i: number) => (
		<button type="button" key={c.arm} onClick={onPick ? () => onPick(c.arm) : undefined} disabled={!onPick} aria-pressed={picked === c.arm}
			title={onPick ? `Select ${labelOf(c.arm)}` : undefined}
			className={cn("min-w-0 rounded-md border px-2.5 py-1.5 text-left animate-lumen-rise transition-[colors,box-shadow] duration-300 disabled:cursor-default", CHIP[c.state],
				onPick && "cursor-pointer hover:shadow-e2", picked === c.arm && "ring-2 ring-plum-500 ring-offset-1")} style={{ animationDelay: `${i * 70}ms` }}>
			<div className="flex items-baseline gap-1.5">
				<span className={cn("font-mono text-nano", c.state === "winning" ? "text-white/80" : "text-ink-600")}>v{c.index + 1}</span>
				<span className="text-caption font-medium truncate">{labelOf(c.arm)}</span>
			</div>
			<div className={cn("text-micro tabular-nums", c.state === "winning" ? "text-white/90" : "text-ink-600")}>
				{c.mean == null ? (progress?.get(c.arm)?.text ?? "no results yet") : `${valueOf(c.mean)} · ${c.n} result${c.n === 1 ? "" : "s"}`}
			</div>
			<div className={cn("text-nano font-medium uppercase tracking-wide mt-0.5", c.state === "winning" ? "text-white" : c.state === "dropped" || (c.mean == null && progress?.get(c.arm)?.tag === "stopped") ? "text-ember-700" : c.state === "best so far" ? "text-plum-700" : "text-ink-600")}>
				{c.mean == null && progress?.get(c.arm) ? progress.get(c.arm)!.tag : c.state}
			</div>
		</button>
	);
	return (
		<div className="space-y-2" aria-label="Versions tried, in order">
			{/* An even grid (the order is in each card's v-number): a wrapping row
			    with arrows broke v3 onto its own line, under an arrow (2026-11-27). */}
			<div className="grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-1.5">
				{main.map((c, i) => chip(c, i))}
			</div>
			{dropped.length > 0 && (
				<div className="grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] items-start gap-1.5">
					<span className="text-micro text-ember-700">Dropped:</span>
					{dropped.map((c, i) => chip(c, main.length + i))}
				</div>
			)}
		</div>
	);
}

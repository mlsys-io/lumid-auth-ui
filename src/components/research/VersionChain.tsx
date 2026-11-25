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

export default function VersionChain({ chain, labelOf, valueOf }: {
	chain: ChainLink[];
	labelOf: (arm: string) => string;
	valueOf: (v: number) => string;
}) {
	const main = chain.filter((c) => c.state !== "dropped");
	const dropped = chain.filter((c) => c.state === "dropped");
	const chip = (c: ChainLink, i: number) => (
		<div key={c.arm} className={cn("rounded-md border px-2.5 py-1.5 min-w-[7.5rem] animate-lumen-rise transition-colors duration-500", CHIP[c.state])} style={{ animationDelay: `${i * 70}ms` }}>
			<div className="flex items-baseline gap-1.5">
				<span className={cn("font-mono text-nano", c.state === "winning" ? "text-white/80" : "text-ink-600")}>v{c.index + 1}</span>
				<span className="text-caption font-medium truncate">{labelOf(c.arm)}</span>
			</div>
			<div className={cn("text-micro tabular-nums", c.state === "winning" ? "text-white/90" : "text-ink-600")}>
				{c.mean == null ? "no results yet" : `${valueOf(c.mean)} · ${c.n} result${c.n === 1 ? "" : "s"}`}
			</div>
			<div className={cn("text-nano font-medium uppercase tracking-wide mt-0.5", c.state === "winning" ? "text-white" : c.state === "dropped" ? "text-ember-700" : c.state === "best so far" ? "text-plum-700" : "text-ink-600")}>{c.state}</div>
		</div>
	);
	return (
		<div className="space-y-2" aria-label="Versions tried, in order">
			<div className="flex items-center gap-1.5 flex-wrap">
				{main.map((c, i) => (
					<div key={c.arm} className="flex items-center gap-1.5">
						{i > 0 && (
							<svg width="18" height="8" viewBox="0 0 18 8" className="text-plum-300" aria-hidden>
								<path d="M1 4h14M12 1l3 3-3 3" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
							</svg>
						)}
						{chip(c, i)}
					</div>
				))}
			</div>
			{dropped.length > 0 && (
				<div className="flex items-center gap-1.5 flex-wrap pl-4">
					<span className="text-micro text-ember-700">Dropped:</span>
					{dropped.map((c, i) => chip(c, main.length + i))}
				</div>
			)}
		</div>
	);
}

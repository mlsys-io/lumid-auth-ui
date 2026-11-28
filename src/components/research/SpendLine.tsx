// SpendLine — "what has this cost, and what's left?" in one line.
//
// With a budget (spec compute.budget, served by /me/usage): a thin meter and
// "38 of 168 GPU-min used · 130 GPU-min left (about 18 more GPU sandbox runs)".
// Without one: what the given rows used ("6.9 GPU-min on RTX 5080 · $0.03
// notional · reuse saved 12 GPU-min"), honest about runs nobody metered.
// Words come from lib/spend.ts.

import { useEffect, useState } from "react";
import { Gauge } from "lucide-react";
import { me, type MeExperimentRow } from "@/api/me";
import { useStudioRefetch } from "@/hooks/useStudioRefetch";
import { instrumentName } from "@/lib/measure";
import { budgetMeter, experimentSpend, spendWords, type MeUsage } from "@/lib/spend";
import { cn } from "@/lib/utils";

/** The app's usage against its budget; null until read or when unavailable. */
export function useAppUsage(app: string | undefined): MeUsage | null {
	const [u, setU] = useState<MeUsage | null>(null);
	const [tick, setTick] = useState(0);
	useStudioRefetch(["runs", "experiments"], () => setTick((t) => t + 1));
	useEffect(() => {
		if (!app) return;
		let live = true;
		me.usage(app).then((d) => { if (live) setU(d); }).catch(() => {});
		return () => { live = false; };
	}, [app, tick]);
	return u;
}

export default function SpendLine({ app, rows, usage, instruments, className }: {
	app?: string;
	/** Rows to total when the app declares no budget (an experiment's results). */
	rows?: MeExperimentRow[] | null;
	/** Pass a usage you already read; otherwise it is read for `app`. */
	usage?: MeUsage | null;
	/** The services this app's spec measures with (budget estimates use only these). */
	instruments?: string[];
	className?: string;
}) {
	const own = useAppUsage(usage === undefined ? app : undefined);
	const u = usage === undefined ? own : usage;
	const meter = budgetMeter(u, (n) => instrumentName(n).replace(/^the /, ""), { instruments });
	const spend = rows && rows.length ? experimentSpend(rows) : null;
	const line = spend ? spendWords(spend) : null;
	if (!meter && !line) return null;
	const tone = meter?.over ? "brick" : meter?.low ? "ember" : "gold";
	return (
		<div className={cn("space-y-1", className)} data-testid="spend-line">
			{meter && (
				<div className="flex flex-wrap items-center gap-x-2 gap-y-1">
					<Gauge className={cn("h-3.5 w-3.5 shrink-0", meter.over ? "text-brick-600" : meter.low ? "text-ember-600" : "text-ink-500")} aria-hidden />
					<div className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-ink-100" role="meter" aria-valuemin={0} aria-valuemax={meter.limit}
						aria-valuenow={Math.round(meter.used * 10) / 10} aria-label={`Budget: ${meter.words}`}>
						<div className={cn("h-full rounded-full transition-[width] duration-700", tone === "brick" ? "bg-brick-500" : tone === "ember" ? "bg-ember-500" : "bg-gold-500")}
							style={{ width: `${Math.max(2, meter.share * 100)}%` }} />
					</div>
					<span className={cn("min-w-[12rem] flex-1 text-micro", meter.over ? "text-brick-700" : meter.low ? "text-ember-700" : "text-ink-700")}>
						Budget: {meter.words}
					</span>
				</div>
			)}
			{line && <div className="text-micro text-ink-600">This experiment: {line}</div>}
		</div>
	);
}

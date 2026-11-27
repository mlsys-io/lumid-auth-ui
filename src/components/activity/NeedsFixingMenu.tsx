// NeedsFixingMenu — an app's broken workflows, behind one button in the top
// strip ("⚠ 4 need fixing ⌄"). It replaced the band that sat above the app's
// home and pushed the research map down (2026-11-27: "move needs fixing to a
// pop up menu"). Renders NOTHING when the app is healthy.
//
// Same window as the sidebar's per-app count (useShellActivity, 3 days), so the
// number on the app's row and the number on this button agree.

import { useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRight, ChevronDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { failingSentence, groupActivity } from "@/lib/activity";
import { runRowHref } from "@/lib/run-routes";
import { loopLabel } from "@/lib/workflow-names";
import { useRunsFeed } from "./hooks";

export const NEEDS_FIXING_DAYS = 3;

export default function NeedsFixingMenu({ app }: { app: string }) {
	const { runs } = useRunsFeed(NEEDS_FIXING_DAYS);
	const [open, setOpen] = useState(false);
	if (!runs || !app) return null;
	const failing = groupActivity(runs, { app }).failing;
	if (failing.length === 0) return null;
	const n = failing.length;
	const span = `in the last ${NEEDS_FIXING_DAYS} days`;
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<button
					type="button"
					data-needs-fixing={n}
					aria-label={`${n} workflow${n === 1 ? "" : "s"} need fixing — show them`}
					className="inline-flex items-center gap-1.5 h-7 rounded-full border border-brick-200 bg-brick-50 px-2.5 text-caption font-medium text-brick-700 hover:bg-brick-100 transition-colors"
				>
					<AlertTriangle className="w-3.5 h-3.5" aria-hidden />
					<span className="tabular-nums">{n}</span>
					<span className="hidden sm:inline">need{n === 1 ? "s" : ""} fixing</span>
					<ChevronDown className="w-3 h-3" aria-hidden />
				</button>
			</PopoverTrigger>
			<PopoverContent align="end" sideOffset={6} className="w-[min(26rem,calc(100vw-2rem))] p-0">
				<div className="flex items-baseline gap-2 px-3 pt-3 pb-2 border-b border-ink-100">
					<h2 className="eyebrow text-brick-700">Needs fixing · {n}</h2>
					<Link to={`/studio/runs?app=${encodeURIComponent(app)}`} onClick={() => setOpen(false)}
						className="ml-auto inline-flex items-center gap-1 text-micro text-ink-700 hover:text-ink-900 hover:underline">
						All activity <ArrowRight className="w-3 h-3" />
					</Link>
				</div>
				<ul className="max-h-[60vh] overflow-y-auto py-1">
					{failing.map((wf) => {
						const f = wf.failing!;
						return (
							<li key={wf.key}>
								<Link to={runRowHref(f.latestRunId)} onClick={() => setOpen(false)} title={f.rawReason || f.cause}
									className="flex items-start gap-2 px-3 py-2 hover:bg-brick-50/60 transition-colors">
									<AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-brick-600" aria-hidden />
									<span className="min-w-0 flex-1">
										<span className="flex items-baseline gap-2">
											<span className="font-medium text-caption text-ink-900 truncate">{loopLabel(wf.name, wf.loop)}</span>
											<span className="ml-auto flex-shrink-0 inline-flex items-center gap-0.5 text-micro text-ink-700">Open run <ArrowRight className="w-3 h-3" /></span>
										</span>
										<span className="block text-micro text-ink-700 line-clamp-2">
											{failingSentence(f, span)} · <span className="text-brick-700">{f.cause}</span>
										</span>
									</span>
								</Link>
							</li>
						);
					})}
				</ul>
			</PopoverContent>
		</Popover>
	);
}

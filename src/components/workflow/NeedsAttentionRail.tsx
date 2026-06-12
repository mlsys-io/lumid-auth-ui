// NeedsAttentionRail — the one place failures surface on Home.
//
// Grouping rule (2026-06-12 scrub): failures in the SAME app almost
// always share a root cause, so generic failures collapse to one row
// per app ("Quant Research · 4 workflows failing") with one CTA —
// four identical "Run failed → Diagnose" rows were worse noise than
// the failures themselves. Only failures with a SPECIFIC triaged fix
// (connect Google, missing skill, …) keep their own row, because
// their CTA differs. Renders nothing when everything is healthy.

import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRight, MessagesSquare } from "lucide-react";
import type { LoopHealth } from "@/components/workflow/WorkflowObservabilityPanel";
import type { ViewingContext } from "@/components/StudioContext";
import { triageFailure } from "@/lib/failure-triage";
import { loopLabel } from "@/lib/workflow-names";
import { appTitle } from "@/components/workflow/AppCard";

const MAX_ROWS = 4;

function ask(prompt: string, context?: Partial<ViewingContext>) {
	window.dispatchEvent(new CustomEvent("studio:ask", { detail: { prompt, autosend: true, context } }));
}

export default function NeedsAttentionRail({ loops }: { loops: LoopHealth[] }) {
	const failing = loops.filter((l) => l.enabled !== false && (l.status === "failing" || l.status === "stale"));
	if (failing.length === 0) return null;

	const errOf = (l: LoopHealth) =>
		l.last_errors?.[0]?.error || (l.status === "stale" ? "Hasn't run on schedule recently." : "Last run failed.");

	// Specific fixes stay individual; generic failures group per app.
	const specific: Array<{ l: LoopHealth; t: ReturnType<typeof triageFailure> }> = [];
	const genericByApp = new Map<string, LoopHealth[]>();
	for (const l of failing) {
		const t = triageFailure(errOf(l), l.app, l.loop);
		if (t.kind !== "unknown") {
			specific.push({ l, t });
		} else {
			const arr = genericByApp.get(l.app) || [];
			arr.push(l);
			genericByApp.set(l.app, arr);
		}
	}

	type Row = { key: string; node: ReactNode };
	const rows: Row[] = [];

	for (const { l, t } of specific) {
		rows.push({
			key: `s:${l.app}:${l.loop}`,
			node: (
				<li key={`s:${l.app}:${l.loop}`} className="flex items-center gap-2 min-w-0">
					<Link
						to={`/studio/apps/${encodeURIComponent(l.app)}?selected=${encodeURIComponent(l.loop)}`}
						className="text-[11.5px] font-medium text-slate-700 hover:text-slate-900 transition-colors truncate flex-shrink-0 max-w-[220px]"
					>
						{appTitle(l.app)} · {loopLabel(undefined, l.loop)}
					</Link>
					<span className="text-[11px] text-rose-800 truncate flex-1 min-w-0" title={t.explanation}>{t.label}</span>
					{t.cta && (t.cta.to ? (
						<Link to={t.cta.to} className="px-2 py-0.5 text-[10.5px] font-medium rounded-lg bg-rose-600 text-white hover:bg-rose-700 transition-colors flex-shrink-0">
							{t.cta.label}
						</Link>
					) : (
						<button
							onClick={() => t.cta?.ask && ask(t.cta.ask, { app: l.app, loop: l.loop })}
							className="inline-flex items-center gap-1 px-2 py-0.5 text-[10.5px] font-medium rounded-lg bg-rose-600 text-white hover:bg-rose-700 transition-colors flex-shrink-0"
						>
							<MessagesSquare className="w-3 h-3" />{t.cta.label}
						</button>
					))}
				</li>
			),
		});
	}

	for (const [app, ls] of genericByApp.entries()) {
		const names = ls.map((l) => loopLabel(undefined, l.loop));
		const shown = names.slice(0, 3).join(", ") + (names.length > 3 ? `, +${names.length - 3}` : "");
		rows.push({
			key: `g:${app}`,
			node: (
				<li key={`g:${app}`} className="flex items-center gap-2 min-w-0">
					<Link
						to={`/studio/apps/${encodeURIComponent(app)}?selected=${encodeURIComponent(ls[0].loop)}`}
						className="text-[11.5px] font-medium text-slate-700 hover:text-slate-900 transition-colors flex-shrink-0"
					>
						{appTitle(app)}
					</Link>
					<span className="text-[11px] text-rose-800 truncate flex-1 min-w-0" title={names.join(", ")}>
						{ls.length === 1 ? `${shown} failing` : `${ls.length} workflows failing — ${shown}`}
					</span>
					<button
						onClick={() => ask(
							ls.length === 1
								? `The ${names[0]} workflow in ${app} is failing — diagnose it and tell me how to fix it.`
								: `In ${app}, ${ls.length} workflows are failing (${names.join(", ")}). They likely share a root cause — diagnose and tell me how to fix it.`,
							{ app, loop: ls[0].loop },
						)}
						className="inline-flex items-center gap-1 px-2 py-0.5 text-[10.5px] font-medium rounded-lg bg-rose-600 text-white hover:bg-rose-700 transition-colors flex-shrink-0"
					>
						<MessagesSquare className="w-3 h-3" />Diagnose
					</button>
					<Link
						to={`/studio/apps/${encodeURIComponent(app)}?selected=${encodeURIComponent(ls[0].loop)}`}
						className="text-slate-400 hover:text-slate-700 transition-colors flex-shrink-0"
						title={`Open ${appTitle(app)}`}
					>
						<ArrowRight className="w-3.5 h-3.5" />
					</Link>
				</li>
			),
		});
	}

	const overflow = rows.length - MAX_ROWS;

	return (
		<section className="rounded-xl border border-rose-200/70 bg-rose-50/40 px-3 py-2 space-y-1.5">
			<div className="flex items-center gap-1.5">
				<AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
				<h2 className="text-[11.5px] font-semibold text-rose-800">Needs attention ({failing.length})</h2>
			</div>
			<ul className="space-y-1.5">
				{rows.slice(0, MAX_ROWS).map((r) => r.node)}
			</ul>
			{overflow > 0 && (
				<Link to="/studio/runs?state=failed" className="block text-[10.5px] text-rose-700 hover:text-rose-900 transition-colors pl-5">
					+{overflow} more in Activity
				</Link>
			)}
		</section>
	);
}

// AppWorkflowList — the open app's workflows, listed in the sidebar under the
// app (not behind a dropdown): status dot, name, how often it runs; the one
// you're on is lit. Ends with "New workflow": describe it in chat (the chat
// drafts it for approval), or the form (icon on the right).

import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { ClipboardList, Plus } from "lucide-react";
import { me, type MeWorkflowRow } from "@/api/me";
import { workflowPath } from "@/lib/run-routes";
import { describeSchedule } from "@/lib/schedule";
import { TONES, workflowTone } from "@/lib/tones";
import { loopLabel } from "@/lib/workflow-names";
import { cn } from "@/lib/utils";

// One fetch for every app folder; refreshed at most every 30 s.
let cache: { at: number; p: Promise<MeWorkflowRow[]> } | null = null;
function allWorkflows(): Promise<MeWorkflowRow[]> {
	if (!cache || Date.now() - cache.at > 30_000) {
		const p = me.listWorkflows("scheduled").then((r) => r.workflows || []);
		cache = { at: Date.now(), p };
		p.catch(() => { cache = null; });
	}
	return cache.p;
}

function loopOf(w: MeWorkflowRow): string {
	const app = w.app || "";
	if (app && w.slug.startsWith(app + ":")) return w.slug.slice(app.length + 1);
	const i = w.slug.indexOf(":");
	return i >= 0 ? w.slug.slice(i + 1) : w.slug;
}

export default function AppWorkflowList({ app }: { app: string }) {
	const location = useLocation();
	const [rows, setRows] = useState<MeWorkflowRow[] | null>(null);
	useEffect(() => {
		let live = true;
		allWorkflows().then((all) => { if (live) setRows(all.filter((w) => w.app === app)); }).catch(() => { if (live) setRows([]); });
		return () => { live = false; };
	}, [app, location.pathname]);
	if (!rows) return null;
	const prefix = `/studio/apps/${encodeURIComponent(app)}/w/`;
	const current = location.pathname.startsWith(prefix) ? decodeURIComponent(location.pathname.slice(prefix.length).split("/")[0]) : null;
	const ask = () => window.dispatchEvent(new CustomEvent("studio:ask", { detail: {
		prompt: "I'd like to add a new workflow to this app. Ask me what it should do and how often it should run, then draft it for me to approve before anything is saved.",
		context: { app },
	} }));
	return (
		<nav aria-label={`${app} workflows`} className="ml-5 pl-2 border-l border-sidebar-border mt-0.5 mb-1.5 space-y-px">
			{rows.map((w) => {
				const loop = loopOf(w);
				const on = loop === current;
				const tone = workflowTone(w);
				return (
					<Link key={w.slug} to={workflowPath(app, loop)} aria-current={on ? "page" : undefined}
						title={`${loopLabel(w.name, loop)} — ${describeSchedule(w.trigger)}${w.enabled === false ? " · paused" : ""}`}
						className={cn("flex items-center gap-2 rounded-md px-2 py-1 text-caption transition-colors min-w-0",
							on ? "bg-ink-100/80 text-ink-900 font-medium" : "text-ink-700 hover:bg-ink-100/60 hover:text-ink-900")}>
						<span className={cn("w-1.5 h-1.5 rounded-full flex-shrink-0", TONES[tone].dot, tone === "running" && "animate-lumen-breathe")} />
						<span className="truncate min-w-0 flex-1">{loopLabel(w.name, loop)}</span>
						{w.enabled === false && <span className="text-micro text-ink-500 flex-shrink-0">paused</span>}
					</Link>
				);
			})}
			<div className="flex items-center gap-0.5">
				<button type="button" onClick={ask} title="Describe the workflow in the chat; it drafts it for you to approve"
					className="flex-1 flex items-center gap-2 rounded-md px-2 py-1 text-caption text-ink-600 hover:bg-ink-100/60 hover:text-ink-900 transition-colors text-left min-w-0">
					<Plus className="w-3 h-3 flex-shrink-0" /> <span className="truncate">New workflow</span>
				</button>
				<Link to={`/studio/a/${encodeURIComponent(app)}/manage?new=1`} title="Or fill in a form: name, schedule, steps" aria-label="New workflow from a form"
					className="inline-flex items-center justify-center w-6 h-6 rounded-md text-ink-500 hover:text-ink-900 hover:bg-ink-100/60 flex-shrink-0">
					<ClipboardList className="w-3 h-3" />
				</Link>
			</div>
		</nav>
	);
}

// AppWorkflowList — the open app's workflows, listed in the sidebar under the
// app (not behind a dropdown): status dot, name, how often it runs; the one
// you're on is lit. Ends with "New workflow": describe it in chat (the chat
// drafts it for approval), or the form (icon on the right). Each row has a ⋯
// on hover/focus: Run now · Open · Delete workflow… — deleting used to live
// only behind the workflow page's ⋯ or Manage app, and people couldn't find it.

import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ArrowRight, ClipboardList, MoreHorizontal, Play, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { me, MeApiError, type MeWorkflowRow } from "@/api/me";
import { appTitle } from "@/components/workflow/AppCard";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useStudioRefetch } from "@/hooks/useStudioRefetch";
import { deleteWorkflow } from "@/lib/delete-workflow";
import { useWorkflowColors } from "@/hooks/useWorkflowColors";
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
	const navigate = useNavigate();
	const colorOf = useWorkflowColors();
	const [rows, setRows] = useState<MeWorkflowRow[] | null>(null);
	const [tick, setTick] = useState(0);
	useEffect(() => {
		let live = true;
		allWorkflows().then((all) => { if (live) setRows(all.filter((w) => w.app === app)); }).catch(() => { if (live) setRows([]); });
		return () => { live = false; };
	}, [app, location.pathname, tick]);
	// A workflow added or deleted anywhere (here, the page's ⋯, Manage app, the chat).
	useStudioRefetch(["workflows", "loops", "apps"], () => { cache = null; setTick((t) => t + 1); });
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
				const label = loopLabel(w.name, loop);
				const runNow = async () => {
					try {
						await me.launchRun(app, loop, {});
						toast.success(`Started "${label}" — it shows under Running in a moment.`);
					} catch (e) {
						toast.error(`Couldn't start "${label}": ${e instanceof MeApiError ? e.message : String(e)}`);
					}
				};
				const del = async () => {
					if (!(await deleteWorkflow(app, appTitle(app), loop, label))) return;
					if (on) navigate(`/studio/apps/${encodeURIComponent(app)}`, { replace: true });
				};
				return (
					<div key={w.slug} className="group/wf relative">
						{/* The workflow's colour — the same on the map's branches and running boxes. */}
						{colorOf(app, loop) && <span aria-hidden className={cn("absolute -left-[9px] top-1.5 bottom-1.5 w-[3px] rounded-full", colorOf(app, loop)!.bar)} />}
						<Link to={workflowPath(app, loop)} aria-current={on ? "page" : undefined}
							title={`${label} — ${describeSchedule(w.trigger)}${w.enabled === false ? " · paused" : ""}`}
							className={cn("flex items-center gap-2 rounded-md py-1 pl-2 pr-7 text-caption transition-colors min-w-0",
								on ? "bg-ink-100/80 text-ink-900 font-medium" : "text-ink-700 hover:bg-ink-100/60 hover:text-ink-900")}>
							<span className={cn("w-1.5 h-1.5 rounded-full flex-shrink-0", TONES[tone].dot, tone === "running" && "animate-lumen-breathe")} />
							<span className="truncate min-w-0 flex-1">{label}</span>
							{w.enabled === false && <span className="text-micro text-ink-500 flex-shrink-0">paused</span>}
						</Link>
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<button type="button" aria-label={`${label}: more`}
									className="absolute right-0.5 top-1/2 -translate-y-1/2 inline-flex h-5 w-5 items-center justify-center rounded text-ink-500 opacity-0 transition-opacity hover:bg-ink-200/60 hover:text-ink-900 focus-visible:opacity-100 group-hover/wf:opacity-100 data-[state=open]:opacity-100">
									<MoreHorizontal className="h-3.5 w-3.5" />
								</button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="start" className="w-48">
								<DropdownMenuItem onSelect={runNow}><Play className="w-3.5 h-3.5" /> Run now</DropdownMenuItem>
								<DropdownMenuItem asChild><Link to={workflowPath(app, loop)}><ArrowRight className="w-3.5 h-3.5" /> Open</Link></DropdownMenuItem>
								<DropdownMenuSeparator />
								<DropdownMenuItem onSelect={del} className="text-brick-600 focus:text-brick-700 focus:bg-brick-50">
									<Trash2 className="w-3.5 h-3.5" /> Delete workflow…
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
					</div>
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

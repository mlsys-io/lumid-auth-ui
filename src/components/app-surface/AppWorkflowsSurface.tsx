// Native surface "app-workflows" — the app's workflow/autoresearch machinery
// (loop list, run sparklines, cycle inspector) embedded as a TAB of the app's
// configured UI. Apps with loops declare it in xpcloud.yaml:
//
//   ui:
//     surfaces: { workflows: "ui/workflows.md" }   # md containing lumid:native key: app-workflows
//     nav:      [ ..., { surface: workflows, label: Workflows } ]
//
// so the app's face (config surfaces) and its machinery (cycle observability)
// live on one page — no separate route a fresh user has to discover.
//
// `config.include: [<app>, …]` renders OTHER apps' workflows as compact rows
// below this app's own — a domain can present a related loop as part of its
// surface before (or instead of) a bundle-level merge. quant-research lists
// venue-link-matcher this way: trading's one complete experiment (dataset +
// metric + live arms) belongs on the trading page, wherever its bundle lives.
// Rows LINK OUT to the owning app (selecting them here would pin a ?selected=
// loop this app does not have); apps the caller cannot see contribute no rows
// and the section renders nothing.

import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { me, type MeWorkflowRow } from "@/api/me";
import WorkflowList from "@/components/workflow/WorkflowList";
import { AppOverview } from "@/pages/studio/apps";

function IncludedAppRows({ app }: { app: string }) {
	const navigate = useNavigate();
	const [rows, setRows] = useState<MeWorkflowRow[]>([]);
	useEffect(() => {
		let live = true;
		me.listWorkflows()
			.then((r) => { if (live) setRows((r.workflows ?? []).filter((w) => w.app === app)); })
			.catch(() => { if (live) setRows([]); });
		return () => { live = false; };
	}, [app]);
	if (rows.length === 0) return null;
	return (
		<section className="mt-6 space-y-1.5 px-1">
			<div className="text-[10px] uppercase tracking-wide font-semibold text-slate-400">
				{app.replace(/-/g, " ")} — related workflows
			</div>
			<WorkflowList
				rows={rows.map((wf) => ({ loop: wf.name, wf }))}
				selected={null}
				onSelect={(loop) => navigate(`/studio/apps/${encodeURIComponent(app)}?selected=${encodeURIComponent(loop)}`)}
			/>
		</section>
	);
}

export default function AppWorkflowsSurface({ config }: { config?: Record<string, unknown> }) {
	const { app = "" } = useParams<{ app: string }>();
	const own = typeof config?.app === "string" && config.app ? String(config.app) : app;
	if (!own) return null;
	const include = Array.isArray(config?.include)
		? (config!.include as unknown[]).map(String).filter((a) => a && a !== own)
		: [];
	return (
		<>
			<AppOverview app={own} embedded />
			{include.map((a) => <IncludedAppRows key={a} app={a} />)}
		</>
	);
}

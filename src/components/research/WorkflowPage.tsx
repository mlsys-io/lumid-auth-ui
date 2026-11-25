// WorkflowPage — a workflow's own page (/studio/apps/:app/w/:loop) is the
// SAME panel the research graph opens (WorkflowPanel), full width: Overview ·
// Runs · Compare · Feedback, the same verbs. One implementation, so a workflow
// looks the same wherever it is opened (user, 2026-11-26: "some tabs are
// inconsistent when clicking around"). A run's own page (/w/:loop/r/:run)
// keeps the detailed run view.

import { lazy, Suspense, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { me, type MeExperiment } from "@/api/me";
import WorkflowPanel, { wfLabel, type CompareSide, type PanelView } from "@/components/research/WorkflowPanel";
import TrySetups from "@/components/research/TrySetups";
import { useAppGraph } from "@/hooks/useAppGraph";
import { useStudioRefetch } from "@/hooks/useStudioRefetch";
import { workflowPath } from "@/lib/run-routes";
import { Skeleton } from "@/components/ui/skeleton";

const VariantSheet = lazy(() => import("@/components/research/VariantSheet"));

export default function WorkflowPage({ app, loop }: { app: string; loop: string }) {
	const { graph, save } = useAppGraph(app);
	const navigate = useNavigate();
	const [exps, setExps] = useState<MeExperiment[]>([]);
	const [view, setView] = useState<PanelView>("overview");
	const [compareB, setCompareB] = useState<CompareSide | null>(null);
	const [picking, setPicking] = useState(false);
	const [variant, setVariant] = useState(false);
	const [setups, setSetups] = useState(false);
	const loadExps = () => { me.experiments(app).then((r) => setExps(r.experiments || [])).catch(() => {}); };
	useEffect(loadExps, [app]);
	useStudioRefetch(["experiments"], loadExps);
	useEffect(() => { setView("overview"); setCompareB(null); setPicking(false); }, [loop]);

	const wf = graph?.spec.workflows.find((w) => w.id === loop);
	if (!graph) return <Skeleton className="h-64 rounded-xl" />;
	if (!wf) return null;
	const others = graph.spec.workflows.filter((w) => w.id !== loop && !w.helper);
	return (
		<div className="space-y-3">
			<WorkflowPanel page app={app} wf={wf} spec={graph.spec} row={graph.rows.get(wf.id)} exps={exps}
				view={view} onView={setView} compareWith={compareB} onPickCompare={() => setPicking(true)}
				onMakeVariant={() => setVariant(true)} onTrySetups={() => setSetups(true)}
				// On a page, a node link goes to that workflow's page or back to the graph.
				onSelect={(id) => navigate(id.startsWith("wf:") ? workflowPath(app, id.slice(3)) : `/studio/apps/${encodeURIComponent(app)}`)}
				save={save} editable={graph.editable} onClose={() => navigate(`/studio/apps/${encodeURIComponent(app)}`)} />
			{picking && (
				<div role="dialog" aria-label="Compare with" className="rounded-xl border border-plum-200 bg-card p-3 shadow-e2">
					<div className="mb-2 text-caption font-medium text-ink-800">Compare {wfLabel(wf)} with…</div>
					<div className="flex flex-wrap gap-1.5">
						{others.map((o) => (
							<button key={o.id} type="button" onClick={() => { setCompareB({ kind: "workflow", id: o.id, label: wfLabel(o) }); setPicking(false); setView("compare"); }}
								className="rounded-md border border-ink-200 px-2 py-1 text-caption text-ink-800 hover:bg-ink-50">{wfLabel(o)}</button>
						))}
						{others.length === 0 && <span className="text-caption text-ink-600">This app has no other workflow to compare with.</span>}
						<button type="button" onClick={() => setPicking(false)} className="ml-auto text-caption text-ink-600 hover:text-ink-900">Cancel</button>
					</div>
					<p className="mt-2 text-micro text-ink-600">To compare setups (versions), open the graph and ⇧-click two of them.</p>
				</div>
			)}
			{setups && <TrySetups app={app} wf={wf} spec={graph.spec} onClose={() => setSetups(false)}
				onCreated={() => { setSetups(false); navigate(`/studio/apps/${encodeURIComponent(app)}`); }} />}
			{variant && (
				<Suspense fallback={null}>
					<VariantSheet app={app} parent={wf} spec={graph.spec} save={save} onClose={() => setVariant(false)}
						onCreated={(ids) => { setVariant(false); if (ids[0]) navigate(workflowPath(app, ids[0])); }} />
				</Suspense>
			)}
		</div>
	);
}
